/**
 * Bot · Entrar a la teleconsulta (portal de la paciente) — R-21.
 *
 * La paciente pide entrar a la videollamada de su turno. Si el turno es suyo, es una
 * teleconsulta confirmada y la sala ya abrió (`ENTRADA_TELECONSULTA_MIN` antes del inicio,
 * hasta el fin), devuelve el link de Jitsi del turno y marca la presencia: el turno pasa a
 * `arrived` y se abre el `Encounter` virtual (`VR`), igual que el check-in de Recepción
 * (`som-estado-turno`). Así el profesional ve que la paciente está en la sala.
 *
 * Reemplaza, con el modelo de SOM, a los bots de token y presencia del módulo de
 * teleconsulta de otro proyecto: el portal de SOM solo ejecuta bots `som-*` de este
 * proyecto.
 *
 * LA PACIENTE ENTRA SIN TOKEN, siempre (decisión del 29/09/2026, ver
 * `decisiones-pendientes.md`, Jitsi 2b): el Jitsi acepta invitados que esperan hasta
 * que entra el profesional, que es el único con token (`som-teleconsulta-token`) y el
 * que modera. Así el link del WhatsApp y el del portal son el mismo y funcionan igual,
 * y ningún token de paciente viaja en un link.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { evaluarEntrada, verificarTurnoDelPaciente } from '../lib/teleconsulta-portal.js';
import { handler as estadoTurno } from './estado-turno.js';

export interface EntradaTeleconsulta {
  appointmentId: string;
}

export interface ResultadoEntrada {
  ok: boolean;
  /** Link de la videollamada (Jitsi de SOM). */
  url?: string;
  /** Si todavía no abrió: desde cuándo se puede entrar (ISO). */
  abre?: string;
  /** Falta la seña: el portal ofrece pagarla (`som-teleconsulta-pago`). */
  pagar?: boolean;
  mensaje?: string;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaTeleconsulta>): Promise<ResultadoEntrada> {
  const appointmentId = event.input?.appointmentId;
  if (!appointmentId) {
    return { ok: false, mensaje: 'Falta el turno.' };
  }
  const appt = await medplum.readResource('Appointment', appointmentId).catch(() => undefined);
  if (!appt) {
    return { ok: false, mensaje: 'No encontramos ese turno.' };
  }
  const v = verificarTurnoDelPaciente(appt, event.requester?.reference);
  if (!v.ok) {
    return { ok: false, mensaje: v.error };
  }

  const r = evaluarEntrada(appt, new Date());
  if (!r.ok) {
    return { ok: false, mensaje: r.mensaje, ...(r.abre ? { abre: r.abre } : {}), ...(r.pagar ? { pagar: true } : {}) };
  }
  if (r.marcarPresencia) {
    await estadoTurno(medplum, { ...event, input: { appointmentId, estado: 'arrived' } });
  }
  return { ok: true, url: r.url };
}
