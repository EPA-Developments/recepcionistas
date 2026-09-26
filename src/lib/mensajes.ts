/**
 * Mensajes: la bandeja de Recepción para las conversaciones con los pacientes — las que
 * abren desde el portal ("Mensajes" en `EPA-Developments/app`, `src/fhir/mensajes.ts`)
 * y las que llegan por **WhatsApp**, que es un canal de la misma conversación
 * (`src/lib/whatsapp.ts`, bots `som-whatsapp-entrante` / `som-whatsapp-responder`).
 *
 * Contrato (el mismo modelo que el ThreadInbox/ThreadChat de Medplum):
 *  - Conversación = Communication "topic": sin `partOf`, `subject` = el paciente y
 *    `topic` = el MOTIVO (`SYSTEM.motivoMensaje` + su texto).
 *  - Mensaje = Communication hija: `partOf` → la conversación, `sender`, `sent`, `payload`.
 *  - Leído: el que lo lee pasa los mensajes del otro lado a `completed` + `received`.
 *  - Cerrada: `status = completed` en la conversación (el portal ya no deja escribir ahí).
 *  - Las Novedades (campanita) también son Communication sin `partOf`, pero sin hijas:
 *    nunca aparecen en la bandeja.
 *
 * Cuando Recepción responde, el paciente recibe además una Novedad `mensaje-nuevo`
 * (campanita) que abre la conversación; una sola por tanda de respuestas.
 */
import type { MedplumClient, MedplumRequestOptions } from '@medplum/core';
import type { Attachment, Communication } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import { usoDelBorrador } from './borrador.js';
import { esInicioContacto, esWhatsApp, nombreDePaciente, tipoAutomatica, vistaPrevia } from './whatsapp.js';
import { cargarAvisosContacto, type AvisoWhatsApp } from './contactos-whatsapp.js';

/**
 * El cliente de la app cachea las búsquedas unos segundos: la bandeja pide siempre lo
 * último (si no, un mensaje nuevo tardaría en aparecer aunque llegue el aviso en vivo).
 */
const SIN_CACHE = { cache: 'no-cache' } as MedplumRequestOptions;

/** Motivos que elige el paciente (mismos códigos y textos que el portal). */
export const MOTIVOS_MENSAJE: Readonly<Record<string, string>> = {
  turnos: 'Turnos y reservas',
  estudios: 'Estudios y resultados',
  'consulta-salud': 'Consulta sobre mi salud',
  'plan-bienestar': 'Mi Plan Bienestar',
  pagos: 'Pagos y membresía',
  otro: 'Otro motivo',
};

export type EstadoBandeja = 'abiertas' | 'cerradas';

export interface ConversacionResumen {
  topic: Communication;
  /** `Patient/<id>` de la conversación. */
  pacienteRef?: string;
  paciente: string;
  motivo: { code?: string; titulo: string };
  ultimo?: Communication;
  /** Mensajes del paciente que Recepción todavía no leyó. */
  sinLeer: number;
  /** Última actividad (ISO), para ordenar. */
  actividad: string;
  /** El último mensaje del paciente llegó por WhatsApp: la respuesta sale por ahí. */
  porWhatsApp: boolean;
  /** Primer WhatsApp de un número nuevo, sin leer: la lista lo marca «Nuevo». */
  nuevoContacto: boolean;
}

export function motivoDe(topic: Communication): { code?: string; titulo: string } {
  const code = topic.topic?.coding?.find((c) => c.system === SYSTEM.motivoMensaje)?.code;
  if (code && MOTIVOS_MENSAJE[code]) {
    return { code, titulo: MOTIVOS_MENSAJE[code] };
  }
  return { titulo: topic.topic?.text ?? 'Conversación' };
}

export function esDelPaciente(m: Communication): boolean {
  return Boolean(m.sender?.reference?.startsWith('Patient/'));
}

export function textoMensaje(m: Communication): string {
  return (m.payload ?? [])
    .map((p) => p.contentString)
    .filter((t): t is string => Boolean(t?.trim()))
    .join('\n');
}

/** Lo que mandó solo el sistema (acuse / fuera de horario): se ve «🤖 Automática». */
export function esAutomatica(m: Communication): boolean {
  return tipoAutomatica(m) !== undefined;
}

function esNovedad(c: Communication): boolean {
  return (c.category ?? []).some((cc) => cc.coding?.some((cd) => cd.system === SYSTEM.notificacion));
}

function porFecha(a: Communication, b: Communication): number {
  return (a.sent ?? '').localeCompare(b.sent ?? '');
}


/**
 * Conversaciones abiertas o cerradas, de la más activa a la menos, con el nombre del
 * paciente, el motivo, el último mensaje y cuántos mensajes del paciente faltan leer.
 */
export async function cargarConversaciones(
  medplum: MedplumClient,
  estado: EstadoBandeja,
): Promise<ConversacionResumen[]> {
  const topics = (
    await medplum.searchResources(
      'Communication',
      {
        'part-of:missing': 'true',
        status: estado === 'abiertas' ? 'in-progress' : 'completed',
        // Solo las que tienen mensajes (como el ThreadInbox): deja afuera las Novedades.
        '_has:Communication:part-of:_id:not': 'null',
        _sort: '-_lastUpdated',
        _count: '100',
      },
      SIN_CACHE,
    )
  ).filter((t) => t.id && !esNovedad(t));
  if (topics.length === 0) {
    return [];
  }

  const mensajes = await medplum.searchResources(
    'Communication',
    { 'part-of': topics.map((t) => `Communication/${t.id}`).join(','), _sort: '-sent', _count: '1000' },
    SIN_CACHE,
  );
  const porConversacion = new Map<string, Communication[]>();
  for (const m of mensajes) {
    const ref = m.partOf?.[0]?.reference;
    if (ref) {
      porConversacion.set(ref, [...(porConversacion.get(ref) ?? []), m]);
    }
  }

  const ids = [
    ...new Set(
      topics
        .map((t) => t.subject?.reference)
        .filter((r): r is string => Boolean(r?.startsWith('Patient/')))
        .map((r) => r.slice('Patient/'.length)),
    ),
  ];
  const pacientes =
    ids.length > 0
      ? await medplum.searchResources('Patient', { _id: ids.join(','), _count: String(ids.length) }).catch(() => [])
      : [];
  const nombres = new Map(pacientes.map((p) => [`Patient/${p.id}`, nombreDePaciente(p)]));

  const resumenes: ConversacionResumen[] = [];
  for (const topic of topics) {
    const suyos = (porConversacion.get(`Communication/${topic.id}`) ?? []).sort(porFecha);
    if (suyos.length === 0) {
      continue; // Sin mensajes no es una conversación (p. ej. una Novedad).
    }
    const ultimo = suyos[suyos.length - 1];
    const pacienteRef = topic.subject?.reference;
    const delPaciente = suyos.filter(esDelPaciente);
    const sinLeer = delPaciente.filter((m) => m.status === 'in-progress');
    const ultimoDelPaciente = delPaciente[delPaciente.length - 1];
    resumenes.push({
      topic,
      pacienteRef,
      paciente: (pacienteRef && nombres.get(pacienteRef)) || topic.subject?.display || 'Paciente',
      motivo: motivoDe(topic),
      ultimo,
      sinLeer: sinLeer.length,
      actividad: ultimo?.sent ?? topic.meta?.lastUpdated ?? '',
      porWhatsApp: Boolean(ultimoDelPaciente && esWhatsApp(ultimoDelPaciente)),
      nuevoContacto: sinLeer.some(esInicioContacto),
    });
  }
  return resumenes.sort((a, b) => b.actividad.localeCompare(a.actividad));
}

/** Mensajes de una conversación, del más viejo al más nuevo. */
export async function cargarMensajes(medplum: MedplumClient, topic: Communication): Promise<Communication[]> {
  const lista = await medplum.searchResources(
    'Communication',
    { 'part-of': `Communication/${topic.id}`, _sort: 'sent', _count: '500' },
    SIN_CACHE,
  );
  return [...lista].sort(porFecha);
}

/** Una línea del último mensaje para la bandeja (o qué adjunto es). */
export function vistaPreviaMensaje(m: Communication | undefined): string {
  return m ? vistaPrevia(m) : '';
}

/** Marca leídos los mensajes del paciente (`completed` + `received`). */
export async function marcarLeidos(medplum: MedplumClient, mensajes: Communication[]): Promise<number> {
  const ahora = new Date().toISOString();
  const pendientes = mensajes.filter((m) => esDelPaciente(m) && m.status === 'in-progress');
  await Promise.all(
    pendientes.map((m) => medplum.updateResource<Communication>({ ...m, status: 'completed', received: ahora })),
  );
  return pendientes.length;
}

/** Novedad `mensaje-nuevo` para el paciente (campanita del portal): abre la conversación. */
async function avisarAlPaciente(medplum: MedplumClient, topic: Communication, texto: string): Promise<Communication> {
  const paciente = topic.subject!;
  return medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: paciente,
    recipient: [paciente],
    sent: new Date().toISOString(),
    category: [{ coding: [{ system: SYSTEM.notificacion, code: 'mensaje-nuevo', display: 'Mensaje nuevo' }] }],
    about: [{ reference: `Communication/${topic.id}` }],
    payload: [{ contentString: texto }],
  });
}

/**
 * Responde en la conversación como `autor` (el usuario de Recepción). Si es la primera
 * respuesta desde el último mensaje del paciente, le deja además una Novedad
 * `mensaje-nuevo` que abre la conversación. Si la respuesta partió de un borrador de
 * "Sugerir", queda marcado si salió tal cual o editado (`EXT.borradorUsado`).
 */
export async function responder(
  medplum: MedplumClient,
  autor: NonNullable<Communication['sender']>,
  topic: Communication,
  texto: string,
  anteriores: Communication[],
  borradorSugerido?: string,
  adjuntos: Attachment[] = [],
): Promise<{ mensaje: Communication; aviso?: Communication }> {
  const limpio = texto.trim();
  if (!limpio && adjuntos.length === 0) {
    throw new Error('Escribí la respuesta.');
  }
  const uso = limpio ? usoDelBorrador(limpio, borradorSugerido) : undefined;
  const mensaje = await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: topic.subject,
    sender: autor,
    recipient: (topic.recipient ?? []).filter((r) => r.reference !== autor.reference),
    partOf: [{ reference: `Communication/${topic.id}` }],
    sent: new Date().toISOString(),
    payload: [...(limpio ? [{ contentString: limpio }] : []), ...adjuntos.map((a) => ({ contentAttachment: a }))],
    ...(uso ? { extension: [{ url: EXT.borradorUsado, valueCode: uso }] } : {}),
  });

  // Las respuestas automáticas no cuentan: la primera respuesta de una persona igual avisa.
  const ultimoPrevio = [...anteriores].filter((m) => !esAutomatica(m)).sort(porFecha).pop();
  if (!topic.subject?.reference?.startsWith('Patient/') || (ultimoPrevio && !esDelPaciente(ultimoPrevio))) {
    return { mensaje };
  }
  const { titulo } = motivoDe(topic);
  const aviso = await avisarAlPaciente(medplum, topic, `Te respondimos sobre «${titulo}». Tocá para ver la respuesta.`);
  return { mensaje, aviso };
}

/**
 * Recepción le escribe primero al paciente: conversación con motivo + primer mensaje
 * (el mismo modelo que crea el portal) y la Novedad en su campanita.
 */
export async function nuevaConversacion(
  medplum: MedplumClient,
  autor: NonNullable<Communication['sender']>,
  pacienteRef: string,
  motivoCode: string,
  texto: string,
): Promise<Communication> {
  const titulo = MOTIVOS_MENSAJE[motivoCode];
  if (!titulo) {
    throw new Error('Elegí el motivo de la conversación.');
  }
  const limpio = texto.trim();
  if (!pacienteRef.startsWith('Patient/') || !limpio) {
    throw new Error('Elegí el paciente y escribí el mensaje.');
  }
  const paciente = { reference: pacienteRef };
  const ahora = new Date().toISOString();
  const topic = await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: paciente,
    sender: autor,
    recipient: [paciente],
    topic: { coding: [{ system: SYSTEM.motivoMensaje, code: motivoCode, display: titulo }], text: titulo },
  });
  await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: paciente,
    sender: autor,
    recipient: [paciente],
    partOf: [{ reference: `Communication/${topic.id}` }],
    sent: ahora,
    payload: [{ contentString: limpio }],
  });
  await avisarAlPaciente(medplum, topic, `Te escribimos sobre «${titulo}». Tocá para leer el mensaje.`);
  return topic;
}

/** Cierra (o reabre) la conversación. */
export async function cambiarEstado(
  medplum: MedplumClient,
  topic: Communication,
  estado: EstadoBandeja,
): Promise<Communication> {
  return medplum.updateResource<Communication>({
    ...topic,
    status: estado === 'abiertas' ? 'in-progress' : 'completed',
  });
}

async function pendientesDeLeer(medplum: MedplumClient): Promise<Communication[]> {
  const pendientes = await medplum.searchResources(
    'Communication',
    { 'part-of:missing': 'false', status: 'in-progress', _sort: '-sent', _count: '500' },
    SIN_CACHE,
  );
  return pendientes.filter(esDelPaciente);
}

/** Mensajes de pacientes sin leer en toda la bandeja (el contador de la pestaña). */
export async function contarSinLeer(medplum: MedplumClient): Promise<number> {
  return (await pendientesDeLeer(medplum)).length;
}

export interface AvisosMensajes {
  /** Mensajes de pacientes sin leer (contador de la pestaña "Mensajes"). */
  sinLeer: number;
  /**
   * La campanita y el contador de la pestaña "WhatsApp": los avisos pendientes de
   * números nuevos (`Task` `whatsapp-nuevo-contacto`, `contactos-whatsapp.ts`).
   */
  nuevosContactos: AvisoWhatsApp[];
}

/** Lo que revisa la app en vivo: el contador de Mensajes y los avisos de WhatsApp (dos búsquedas). */
export async function cargarAvisos(medplum: MedplumClient): Promise<AvisosMensajes> {
  const [pendientes, nuevosContactos] = await Promise.all([pendientesDeLeer(medplum), cargarAvisosContacto(medplum)]);
  return { sinLeer: pendientes.length, nuevosContactos };
}
