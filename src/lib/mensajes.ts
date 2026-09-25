/**
 * Mensajes: la bandeja de Recepción para las conversaciones que abren los pacientes
 * desde el portal ("Mensajes" en `EPA-Developments/app`, `src/fhir/mensajes.ts`).
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
import type { MedplumClient } from '@medplum/core';
import type { Communication, Patient } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';

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

function esNovedad(c: Communication): boolean {
  return (c.category ?? []).some((cc) => cc.coding?.some((cd) => cd.system === SYSTEM.notificacion));
}

function porFecha(a: Communication, b: Communication): number {
  return (a.sent ?? '').localeCompare(b.sent ?? '');
}

function nombre(p: Patient): string {
  const n = p.name?.[0];
  const texto = n?.text ?? [...(n?.given ?? []), n?.family].filter(Boolean).join(' ');
  return texto || 'Paciente';
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
    await medplum.searchResources('Communication', {
      'part-of:missing': 'true',
      status: estado === 'abiertas' ? 'in-progress' : 'completed',
      // Solo las que tienen mensajes (como el ThreadInbox): deja afuera las Novedades.
      '_has:Communication:part-of:_id:not': 'null',
      _sort: '-_lastUpdated',
      _count: '100',
    })
  ).filter((t) => t.id && !esNovedad(t));
  if (topics.length === 0) {
    return [];
  }

  const mensajes = await medplum.searchResources('Communication', {
    'part-of': topics.map((t) => `Communication/${t.id}`).join(','),
    _sort: '-sent',
    _count: '1000',
  });
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
  const nombres = new Map(pacientes.map((p) => [`Patient/${p.id}`, nombre(p)]));

  const resumenes: ConversacionResumen[] = [];
  for (const topic of topics) {
    const suyos = (porConversacion.get(`Communication/${topic.id}`) ?? []).sort(porFecha);
    if (suyos.length === 0) {
      continue; // Sin mensajes no es una conversación (p. ej. una Novedad).
    }
    const ultimo = suyos[suyos.length - 1];
    const pacienteRef = topic.subject?.reference;
    resumenes.push({
      topic,
      pacienteRef,
      paciente: (pacienteRef && nombres.get(pacienteRef)) || topic.subject?.display || 'Paciente',
      motivo: motivoDe(topic),
      ultimo,
      sinLeer: suyos.filter((m) => esDelPaciente(m) && m.status === 'in-progress').length,
      actividad: ultimo?.sent ?? topic.meta?.lastUpdated ?? '',
    });
  }
  return resumenes.sort((a, b) => b.actividad.localeCompare(a.actividad));
}

/** Mensajes de una conversación, del más viejo al más nuevo. */
export async function cargarMensajes(medplum: MedplumClient, topic: Communication): Promise<Communication[]> {
  const lista = await medplum.searchResources('Communication', {
    'part-of': `Communication/${topic.id}`,
    _sort: 'sent',
    _count: '500',
  });
  return [...lista].sort(porFecha);
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

/**
 * Responde en la conversación como `autor` (el usuario de Recepción). Si es la primera
 * respuesta desde el último mensaje del paciente, le deja además una Novedad
 * `mensaje-nuevo` que abre la conversación.
 */
export async function responder(
  medplum: MedplumClient,
  autor: NonNullable<Communication['sender']>,
  topic: Communication,
  texto: string,
  anteriores: Communication[],
): Promise<{ mensaje: Communication; aviso?: Communication }> {
  const limpio = texto.trim();
  if (!limpio) {
    throw new Error('Escribí la respuesta.');
  }
  const ahora = new Date().toISOString();
  const mensaje = await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: topic.subject,
    sender: autor,
    recipient: (topic.recipient ?? []).filter((r) => r.reference !== autor.reference),
    partOf: [{ reference: `Communication/${topic.id}` }],
    sent: ahora,
    payload: [{ contentString: limpio }],
  });

  const ultimoPrevio = [...anteriores].sort(porFecha).pop();
  const paciente = topic.subject;
  if (!paciente?.reference?.startsWith('Patient/') || (ultimoPrevio && !esDelPaciente(ultimoPrevio))) {
    return { mensaje };
  }
  const { titulo } = motivoDe(topic);
  const aviso = await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    subject: paciente,
    recipient: [paciente],
    sent: ahora,
    category: [{ coding: [{ system: SYSTEM.notificacion, code: 'mensaje-nuevo', display: 'Mensaje nuevo' }] }],
    about: [{ reference: `Communication/${topic.id}` }],
    payload: [{ contentString: `Te respondimos sobre «${titulo}». Tocá para ver la respuesta.` }],
  });
  return { mensaje, aviso };
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

/** Mensajes de pacientes sin leer en toda la bandeja (el contador de la pestaña). */
export async function contarSinLeer(medplum: MedplumClient): Promise<number> {
  const pendientes = await medplum.searchResources('Communication', {
    'part-of:missing': 'false',
    status: 'in-progress',
    _count: '500',
  });
  return pendientes.filter(esDelPaciente).length;
}
