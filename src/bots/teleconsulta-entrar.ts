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
 * CON TOKEN, CUANDO EL JITSI LO PIDE. Si el proyecto tiene los secretos del Jitsi
 * (`JITSI_APP_ID` / `JITSI_APP_SECRET`, ver `_jitsi.ts`), el link vuelve con el token
 * de la paciente (`?jwt=`, no moderadora): cuando el Jitsi empiece a exigir token, el
 * link pelado deja de alcanzar y ella quedaría afuera de su propia consulta. El token
 * es sólo para ella —con `requester` = la paciente del turno— y vence con la sala.
 * Sin los secretos, el link sale como siempre.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { salaDelLink } from '../lib/teleconsulta.js';
import { evaluarEntrada, verificarTurnoDelPaciente } from '../lib/teleconsulta-portal.js';
import { configJitsi, linkConToken, nombreVisible, tokenDeSala } from './_jitsi.js';
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

  const cfg = configJitsi(event.secrets);
  if (!cfg || event.requester?.reference !== v.pacienteRef) {
    return { ok: true, url: r.url };
  }
  const sala = salaDelLink(r.url, cfg.dominio);
  if (!sala || !appt.start || !appt.end) {
    // El link apunta a otro servidor que el de JITSI_BASE_URL: un token de este
    // Jitsi no sirve ahí. Va el link como está, y queda el aviso para quien configura.
    console.error('som-teleconsulta-entrar: el link del turno no es del Jitsi de JITSI_BASE_URL; va sin token.');
    return { ok: true, url: r.url };
  }
  const { jwt } = tokenDeSala(cfg, {
    sala,
    nombre: await nombreVisible(medplum, v.pacienteRef),
    rol: 'paciente',
    inicio: new Date(appt.start),
    fin: new Date(appt.end),
  });
  return { ok: true, url: linkConToken(r.url, jwt) };
}
