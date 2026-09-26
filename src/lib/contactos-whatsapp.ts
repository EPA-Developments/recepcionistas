/**
 * Contactos nuevos por WhatsApp: el aviso a Recepción que lista la pestaña **WhatsApp**
 * (el "Avisos" del demo) y que hace sonar la campanita.
 *
 * Cuando escribe un número que no estaba en SOM, `som-whatsapp-entrante` crea el lead y
 * la conversación de Mensajes (como con cualquier WhatsApp) y deja además este aviso:
 * un `Task` por número, pendiente hasta que Recepción lo atiende. Desde la pestaña
 * WhatsApp se le responde (en su conversación, y sale por WhatsApp), se le completa la
 * ficha (el aviso se resuelve solo) o se marca resuelto.
 *
 * Modelo (FHIR R4 `Task`, como las demás tareas de Recepción):
 *  - `code` = `CodeSystem/task-tipo|whatsapp-nuevo-contacto`, `intent` = `order`.
 *  - `status`: `requested` (pendiente) → `completed`, con `businessStatus`
 *    (`CodeSystem/resolucion-aviso`: `ficha-completada` | `resuelto`), `owner` = quién lo
 *    resolvió y `executionPeriod.end` = cuándo.
 *  - `identifier` = `Identifier/aviso-recepcion|whatsapp-nuevo-contacto-<paciente>`: uno
 *    por número aunque Twilio reintente o lleguen dos mensajes a la vez.
 *  - `for` / `requester` = el paciente (lead), `focus` = su conversación de Mensajes,
 *    `reasonReference` = el primer mensaje.
 *  - `input` (por `type.text`, como las otras tareas): `telefono` (E.164), `perfil`
 *    (nombre del perfil de WhatsApp) y `texto` (vista previa del primer mensaje).
 */
import type { MedplumClient, MedplumRequestOptions } from '@medplum/core';
import type { Communication, Meta, Patient, Task } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../fhir/identifiers.js';
import { esSinFicha, formatoTelefono, nombreDePaciente, tipoAutomatica } from './whatsapp.js';

export const TITULO_AVISO_CONTACTO = 'Contacto nuevo por WhatsApp';

/** Búsqueda por token de los avisos de contacto nuevo (`Task?code=`). */
export const CODIGO_AVISO_CONTACTO = `${SYSTEM.taskTipo}|${COD.whatsappNuevoContacto}`;

/** Datos del aviso (`Task.input`, por `type.text`). */
export type CampoAviso = 'telefono' | 'perfil' | 'texto';

/** Cómo se resolvió (`Task.businessStatus`). */
export type ResolucionAviso = 'ficha-completada' | 'resuelto';

const RESOLUCIONES: Readonly<Record<ResolucionAviso, string>> = {
  'ficha-completada': 'Ficha completada',
  resuelto: 'Resuelto',
};

// ───────────────────────────── el aviso (Task) ─────────────────────────────

/** Clave del aviso de un paciente (identifier): uno por número nuevo. */
export function claveAvisoContacto(pacienteRef: string): string {
  return `${COD.whatsappNuevoContacto}-${pacienteRef.split('/')[1] ?? pacienteRef}`;
}

/** La búsqueda `If-None-Exist` del aviso de ese paciente (creación idempotente). */
export function busquedaAvisoContacto(pacienteRef: string): string {
  return new URLSearchParams({ identifier: `${SYSTEM.avisoRecepcion}|${claveAvisoContacto(pacienteRef)}` }).toString();
}

/** El aviso a Recepción por el primer WhatsApp de un número nuevo (pendiente). */
export function construirAvisoContacto(p: {
  pacienteRef: string;
  conversacionRef: string;
  /** El primer mensaje (el que lo provocó). */
  mensajeRef?: string;
  telefono: string;
  /** Nombre del perfil de WhatsApp, si lo tiene. */
  perfil?: string;
  /** Vista previa del primer mensaje. */
  texto: string;
  ahora: string;
}): Task {
  const paciente = { reference: p.pacienteRef };
  const perfil = p.perfil?.replace(/\s+/g, ' ').trim();
  const texto = p.texto.trim();
  const quien = perfil ? `${perfil} (${formatoTelefono(p.telefono)})` : formatoTelefono(p.telefono);
  return {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    identifier: [{ system: SYSTEM.avisoRecepcion, value: claveAvisoContacto(p.pacienteRef) }],
    code: {
      coding: [{ system: SYSTEM.taskTipo, code: COD.whatsappNuevoContacto, display: TITULO_AVISO_CONTACTO }],
      text: TITULO_AVISO_CONTACTO,
    },
    description: `Escribió por WhatsApp un número que no estaba en SOM: ${quien}. Respondele, completale la ficha o marcalo resuelto.`,
    for: paciente,
    requester: paciente,
    focus: { reference: p.conversacionRef },
    ...(p.mensajeRef ? { reasonReference: { reference: p.mensajeRef } } : {}),
    authoredOn: p.ahora,
    lastModified: p.ahora,
    input: [
      { type: { text: 'telefono' }, valueString: p.telefono },
      ...(perfil ? [{ type: { text: 'perfil' }, valueString: perfil }] : []),
      ...(texto ? [{ type: { text: 'texto' }, valueString: texto }] : []),
    ],
  };
}

export function esAvisoContacto(t: Task): boolean {
  return t.code?.coding?.some((c) => c.system === SYSTEM.taskTipo && c.code === COD.whatsappNuevoContacto) === true;
}

export function datoAviso(t: Task, campo: CampoAviso): string | undefined {
  return t.input?.find((i) => i.type?.text === campo)?.valueString;
}

/** El aviso resuelto: cómo, cuándo y (si fue una persona) quién. */
export function resolverAviso(t: Task, p: { como: ResolucionAviso; ahora: string; owner?: Task['owner'] }): Task {
  return {
    ...t,
    status: 'completed',
    businessStatus: {
      coding: [{ system: SYSTEM.resolucionAviso, code: p.como, display: RESOLUCIONES[p.como] }],
      text: RESOLUCIONES[p.como],
    },
    executionPeriod: { ...(t.executionPeriod ?? {}), end: p.ahora },
    lastModified: p.ahora,
    ...(p.owner ? { owner: p.owner } : {}),
  };
}

/** Dato de demostración (tag `demo`): la tarjeta lo dice, para no tomarlo por real. */
export function esDemo(r: { meta?: Meta }): boolean {
  return r.meta?.tag?.some((t) => t.system === SYSTEM.demo && t.code === 'demo') === true;
}

/**
 * ¿Falta que una persona le conteste? Sí, si lo último que no mandó solo el sistema es
 * del paciente: el acuse automático no cuenta como respuesta.
 */
export function faltaResponder(mensajes: Communication[]): boolean {
  const ultimo = [...mensajes]
    .filter((m) => tipoAutomatica(m) === undefined)
    .sort((a, b) => (a.sent ?? '').localeCompare(b.sent ?? ''))
    .pop();
  return !ultimo || Boolean(ultimo.sender?.reference?.startsWith('Patient/'));
}

function idDe(ref: string | undefined, tipo: string): string | undefined {
  return ref?.startsWith(`${tipo}/`) ? ref.slice(tipo.length + 1) : undefined;
}

// ───────────────────────────── campanita ─────────────────────────────

/** Un aviso de la campanita: un número nuevo escribió por WhatsApp y nadie lo resolvió. */
export interface AvisoWhatsApp {
  /** Id del `Task` (la tarjeta de la pestaña WhatsApp). */
  avisoId: string;
  pacienteRef?: string;
  /** Id de la conversación de Mensajes donde entró. */
  conversacionId?: string;
  /** El nombre del perfil de WhatsApp o, sin perfil, el número. */
  nombre: string;
  telefono?: string;
  /** Vista previa del primer mensaje. */
  texto: string;
  /** Cuándo llegó (ISO). */
  sent: string;
}

export function avisoDeTask(t: Task): AvisoWhatsApp {
  const telefono = datoAviso(t, 'telefono');
  const conversacionId = idDe(t.focus?.reference, 'Communication');
  return {
    avisoId: t.id ?? '',
    ...(t.for?.reference ? { pacienteRef: t.for.reference } : {}),
    ...(conversacionId ? { conversacionId } : {}),
    nombre: datoAviso(t, 'perfil') || formatoTelefono(telefono) || 'Contacto nuevo',
    ...(telefono ? { telefono } : {}),
    texto: datoAviso(t, 'texto') ?? '',
    sent: t.authoredOn ?? t.meta?.lastUpdated ?? '',
  };
}

/** Los avisos pendientes, del más nuevo al más viejo. */
export function avisosPendientes(tasks: Task[]): AvisoWhatsApp[] {
  return tasks
    .filter((t) => t.id && t.status === 'requested' && esAvisoContacto(t))
    .map(avisoDeTask)
    .sort((a, b) => b.sent.localeCompare(a.sent));
}

// ───────────────────────────── lectura y resolución (Medplum) ─────────────────────────────

/** El cliente de la app cachea unos segundos: la pestaña y la campanita piden lo último. */
const SIN_CACHE = { cache: 'no-cache' } as MedplumRequestOptions;

async function buscarPendientes(medplum: MedplumClient, extra: Record<string, string> = {}): Promise<Task[]> {
  return medplum.searchResources(
    'Task',
    { code: CODIGO_AVISO_CONTACTO, status: 'requested', _sort: '-authored-on', _count: '100', ...extra },
    SIN_CACHE,
  );
}

/** La campanita: los avisos pendientes (una sola búsqueda). */
export async function cargarAvisosContacto(medplum: MedplumClient): Promise<AvisoWhatsApp[]> {
  return avisosPendientes(await buscarPendientes(medplum));
}

/** Una tarjeta de la pestaña WhatsApp. */
export interface ContactoNuevo {
  aviso: Task & { id: string };
  pacienteRef?: string;
  /** El lead (o la ficha, si ya se completó por otro lado). */
  paciente?: Patient;
  nombre: string;
  /** Nombre del perfil de WhatsApp. */
  perfil?: string;
  telefono?: string;
  /** Vista previa del primer mensaje (del aviso). */
  texto: string;
  /** Cuándo llegó el primer mensaje (ISO). */
  llego: string;
  /** Su conversación de Mensajes. */
  conversacion?: Communication;
  /** Los mensajes de la conversación, del más viejo al más nuevo. */
  mensajes: Communication[];
  /** Solo tiene el apodo del perfil de WhatsApp: falta completar la ficha. */
  sinFicha: boolean;
  /** Nadie de Recepción le contestó todavía lo último que escribió (el acuse no cuenta). */
  sinResponder: boolean;
  demo: boolean;
}

/**
 * La pestaña WhatsApp: los avisos pendientes con su conversación, sus mensajes y el
 * paciente (cuatro búsquedas en total, sin importar cuántos avisos haya).
 */
export async function cargarContactosNuevos(medplum: MedplumClient): Promise<ContactoNuevo[]> {
  const avisos = (await buscarPendientes(medplum)).filter(
    (t): t is Task & { id: string } => Boolean(t.id) && t.status === 'requested' && esAvisoContacto(t),
  );
  if (avisos.length === 0) {
    return [];
  }
  const unicos = (ids: Array<string | undefined>): string[] => [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const convIds = unicos(avisos.map((t) => idDe(t.focus?.reference, 'Communication')));
  const pacIds = unicos(avisos.map((t) => idDe(t.for?.reference, 'Patient')));
  const [conversaciones, mensajes, pacientes] = await Promise.all([
    convIds.length
      ? medplum.searchResources('Communication', { _id: convIds.join(','), _count: String(convIds.length) }, SIN_CACHE)
      : Promise.resolve([] as Communication[]),
    convIds.length
      ? medplum.searchResources(
          'Communication',
          { 'part-of': convIds.map((id) => `Communication/${id}`).join(','), _sort: '-sent', _count: '1000' },
          SIN_CACHE,
        )
      : Promise.resolve([] as Communication[]),
    pacIds.length
      ? medplum
          .searchResources('Patient', { _id: pacIds.join(','), _count: String(pacIds.length) }, SIN_CACHE)
          .catch(() => [] as Patient[])
      : Promise.resolve([] as Patient[]),
  ]);

  const porConversacion = new Map<string, Communication[]>();
  for (const m of mensajes) {
    const ref = m.partOf?.[0]?.reference;
    if (ref) {
      porConversacion.set(ref, [...(porConversacion.get(ref) ?? []), m]);
    }
  }

  return avisos
    .map((aviso): ContactoNuevo => {
      const pacienteRef = aviso.for?.reference;
      const paciente = pacientes.find((p) => `Patient/${p.id}` === pacienteRef);
      const conversacion = conversaciones.find((c) => `Communication/${c.id}` === aviso.focus?.reference);
      const perfil = datoAviso(aviso, 'perfil');
      const telefono = datoAviso(aviso, 'telefono');
      const sinFicha = paciente ? esSinFicha(paciente) : true;
      const suyos = [...(porConversacion.get(aviso.focus?.reference ?? '') ?? [])].sort((a, b) =>
        (a.sent ?? '').localeCompare(b.sent ?? ''),
      );
      return {
        aviso,
        ...(pacienteRef ? { pacienteRef } : {}),
        ...(paciente ? { paciente } : {}),
        // Si la ficha ya tiene nombre real (se completó por otro lado), ese nombre.
        nombre: paciente && !sinFicha ? nombreDePaciente(paciente) : perfil || formatoTelefono(telefono) || 'Contacto nuevo',
        ...(perfil ? { perfil } : {}),
        ...(telefono ? { telefono } : {}),
        texto: datoAviso(aviso, 'texto') ?? '',
        llego: aviso.authoredOn ?? aviso.meta?.lastUpdated ?? '',
        ...(conversacion ? { conversacion } : {}),
        mensajes: suyos,
        sinFicha,
        sinResponder: faltaResponder(suyos),
        demo: esDemo(aviso),
      };
    })
    .sort((a, b) => b.llego.localeCompare(a.llego));
}

function esConflicto(err: unknown): boolean {
  const e = err as { status?: number; outcome?: { issue?: Array<{ code?: string }> } };
  return e?.status === 412 || e?.status === 409 || e?.outcome?.issue?.some((i) => i.code === 'conflict') === true;
}

/**
 * Resuelve un aviso. Si ya estaba resuelto (otra recepcionista, o se completó la ficha)
 * lo deja como está: nunca pisa quién y cómo lo resolvió primero.
 */
export async function resolverContacto(
  medplum: MedplumClient,
  avisoId: string,
  como: ResolucionAviso,
  owner?: Task['owner'],
): Promise<Task> {
  for (let intento = 1; ; intento++) {
    const actual = await medplum.readResource('Task', avisoId, SIN_CACHE);
    if (actual.status !== 'requested') {
      return actual;
    }
    try {
      const version = actual.meta?.versionId;
      return await medplum.updateResource<Task>(
        resolverAviso(actual, { como, ahora: new Date().toISOString(), owner }),
        version ? { headers: { 'If-Match': `W/"${version}"` } } : undefined,
      );
    } catch (err) {
      if (!esConflicto(err) || intento >= 3) {
        throw err;
      }
    }
  }
}

/** Resuelve los avisos pendientes de un paciente (p. ej. al completarle la ficha). */
export async function resolverAvisosDelPaciente(
  medplum: MedplumClient,
  pacienteRef: string,
  como: ResolucionAviso,
  owner?: Task['owner'],
): Promise<number> {
  const pendientes = (await buscarPendientes(medplum, { patient: pacienteRef })).filter(
    (t) => t.id && t.for?.reference === pacienteRef && esAvisoContacto(t),
  );
  for (const t of pendientes) {
    await resolverContacto(medplum, t.id as string, como, owner);
  }
  return pendientes.length;
}
