/**
 * WhatsApp — lo que lee la app de Recepción (chats, conversación, campanita). Las
 * reglas (ventana de 24 h, a qué número responder, inicio de contacto) viven en
 * `whatsapp.ts` y en los bots; acá solo se consulta y se marca como leído.
 */
import type { MedplumClient, MedplumRequestOptions } from '@medplum/core';
import type { Communication, Patient } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';
import {
  avisosInicioContacto,
  contarNoLeidos,
  esInicioContacto,
  esNoLeido,
  esSinFicha,
  nombreDePaciente,
  ordenarMensajes,
  resumirChats,
  type AvisoWhatsApp,
  type ChatWhatsApp,
} from './whatsapp.js';

const CATEGORIA = `${SYSTEM.canal}|whatsapp`;

/**
 * El cliente de la app cachea las búsquedas unos segundos: el chat pide siempre lo último
 * (si no, un mensaje nuevo tardaría en aparecer).
 */
const SIN_CACHE = { cache: 'no-cache' } as MedplumRequestOptions;

/** Cuántos mensajes recientes se miran para armar la lista de chats. */
const MAX_MENSAJES_CHATS = 500;

async function pacientesDe(medplum: MedplumClient, refs: Iterable<string | undefined>): Promise<Patient[]> {
  const ids = [
    ...new Set(
      [...refs].filter((r): r is string => Boolean(r?.startsWith('Patient/'))).map((r) => r.slice('Patient/'.length)),
    ),
  ];
  if (ids.length === 0) {
    return [];
  }
  return medplum.searchResources('Patient', { _id: ids.join(','), _count: String(ids.length) }).catch(() => []);
}

/** Los chats (uno por paciente), del más activo al menos. */
export async function cargarChats(medplum: MedplumClient): Promise<ChatWhatsApp[]> {
  const mensajes = await medplum.searchResources(
    'Communication',
    { category: CATEGORIA, _sort: '-sent', _count: String(MAX_MENSAJES_CHATS) },
    SIN_CACHE,
  );
  const pacientes = await pacientesDe(
    medplum,
    mensajes.map((m) => m.subject?.reference),
  );
  const nombres = new Map(pacientes.map((p) => [`Patient/${p.id}`, nombreDePaciente(p)]));
  const telefonos = new Map(
    pacientes.map((p) => [
      `Patient/${p.id}`,
      p.telecom?.find((t) => t.system === 'phone' && t.use === 'mobile')?.value ??
        p.telecom?.find((t) => t.system === 'phone')?.value,
    ]),
  );
  const sinFicha = new Set(pacientes.filter(esSinFicha).map((p) => `Patient/${p.id}`));
  return resumirChats(mensajes, nombres).map((c) => ({
    ...c,
    // Sin número en los mensajes (p. ej. un aviso que no salió), el de la ficha.
    telefono: c.telefono ?? telefonos.get(c.pacienteRef),
    sinFicha: sinFicha.has(c.pacienteRef),
  }));
}

/** Los mensajes de un chat, del más viejo al más nuevo. */
export async function cargarChat(medplum: MedplumClient, pacienteRef: string): Promise<Communication[]> {
  const lista = await medplum.searchResources(
    'Communication',
    { subject: pacienteRef, category: CATEGORIA, _sort: '-sent', _count: '300' },
    SIN_CACHE,
  );
  return ordenarMensajes(lista);
}

/** Marca leídos los mensajes del paciente (`completed` + `received`, como en Mensajes). */
export async function marcarLeidos(medplum: MedplumClient, mensajes: Communication[]): Promise<number> {
  const ahora = new Date().toISOString();
  const pendientes = mensajes.filter(esNoLeido);
  await Promise.all(
    pendientes.map((m) => medplum.updateResource<Communication>({ ...m, status: 'completed', received: ahora })),
  );
  return pendientes.length;
}

export interface AvisosWhatsApp {
  /** Mensajes de pacientes sin leer (contador de la pestaña). */
  sinLeer: number;
  /** La campanita: conversaciones nuevas sin leer (una por contacto). */
  nuevosContactos: AvisoWhatsApp[];
}

/** Lo que revisa la app cada tanto: el contador de la pestaña y la campanita. */
export async function cargarAvisos(medplum: MedplumClient): Promise<AvisosWhatsApp> {
  const pendientes = await medplum.searchResources(
    'Communication',
    { category: CATEGORIA, status: 'in-progress', _sort: '-sent', _count: '200' },
    SIN_CACHE,
  );
  // Los nombres, solo de los que abren conversación (lo único que muestra la campanita).
  const pacientes = await pacientesDe(
    medplum,
    pendientes.filter(esInicioContacto).map((m) => m.subject?.reference),
  );
  const nombres = new Map(pacientes.map((p) => [`Patient/${p.id}`, nombreDePaciente(p)]));
  return { sinLeer: contarNoLeidos(pendientes), nuevosContactos: avisosInicioContacto(pendientes, nombres) };
}
