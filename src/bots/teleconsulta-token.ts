/**
 * Bot · Token de moderador para la sala de la teleconsulta (lo usa el dashboard).
 *
 * El profesional entra a la videollamada como moderador: abre la sala, admite a la
 * paciente y puede cerrarla. Jitsi lo sabe por un token firmado (JWT) que emite
 * este bot, de vida corta, que no se guarda en ningún recurso: se pide cada vez que
 * se entra.
 *
 * QUIÉN PIDE LO DICE `event.requester`, NO EL INPUT. El bot corre con su propia
 * identidad y lee cualquier turno; si le creyera a un `practitionerRef` del input,
 * cualquiera con permiso de ejecutarlo sacaría un token de moderador para el turno
 * de otro sabiendo sólo los ids. Por eso, como los demás `som-teleconsulta-*`, sin
 * `requester` no se hace nada, y el token es sólo para un `Practitioner` que sea
 * `participant` del turno. La paciente entra con `som-teleconsulta-entrar`.
 *
 * El bot no decide nada por su cuenta. La ventana, el nombre de la sala y la forma
 * del token están en `src/lib/teleconsulta.ts`, que es puro y está testeado; la
 * firma, en `_jitsi.ts`.
 *
 * `sinConfigurar` avisa que faltan los secretos del Jitsi: el dashboard entra
 * entonces con el link del turno, como hasta ahora, y dice que no es moderador.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { ESTADOS_CON_SALA, motivoSinAcceso, salaDelLink, teleconsultaUrlDe } from '../lib/teleconsulta.js';
import { configJitsi, nombreVisible, tokenDeSala } from './_jitsi.js';

export interface EntradaToken {
  appointmentId: string;
}

export interface ResultadoToken {
  ok: boolean;
  /** El host del Jitsi, para armar la sala embebida. */
  dominio?: string;
  sala?: string;
  /** JWT firmado. Vence cuando cierra la sala. */
  jwt?: string;
  /** ISO en que el token deja de servir. */
  venceISO?: string;
  /** Faltan los secretos del Jitsi: no hay tokens en este proyecto todavía. */
  sinConfigurar?: boolean;
  /** Si no se pudo, por qué, escrito para quien lo va a leer. */
  mensaje?: string;
}

/** Mismo mensaje para "no existe", "no es tuyo" y "no sos profesional": no confirma qué turnos hay. */
const NO_ENCONTRADA = 'No encontramos esa videollamada en tu cuenta.';

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaToken>,
  ahora: Date = new Date(),
): Promise<ResultadoToken> {
  const appointmentId = event.input?.appointmentId;
  if (!appointmentId) {
    return { ok: false, mensaje: 'Falta el turno.' };
  }
  const quien = event.requester?.reference;
  if (!quien?.startsWith('Practitioner/')) {
    return { ok: false, mensaje: NO_ENCONTRADA };
  }

  const cfg = configJitsi(event.secrets);
  if (!cfg) {
    // Falla cerrado. El aviso queda en el log de la ejecución del bot, que es donde
    // lo va a buscar quien configura.
    console.error('som-teleconsulta-token: faltan JITSI_BASE_URL (https) / JITSI_APP_ID / JITSI_APP_SECRET.');
    return { ok: false, sinConfigurar: true, mensaje: 'La videollamada todavía no tiene moderador configurado.' };
  }

  const appt = await medplum.readResource('Appointment', appointmentId).catch(() => undefined);
  const esParticipante = (appt?.participant ?? []).some((p) => p.actor?.reference === quien);
  if (!appt || !esParticipante) {
    return { ok: false, mensaje: NO_ENCONTRADA };
  }

  const sala = salaDelLink(teleconsultaUrlDe(appt), cfg.dominio);
  if (!sala) {
    // O el turno no es una teleconsulta, o su link apunta a otro servidor: la
    // paciente entraría por el link a un Jitsi y el profesional con el token a
    // otro, y los dos esperarían solos sin ver un error.
    return { ok: false, mensaje: 'Ese turno no tiene una sala de videollamada válida. Avisá a Recepción.' };
  }

  if (!ESTADOS_CON_SALA.has(appt.status)) {
    return {
      ok: false,
      mensaje:
        appt.status === 'pending'
          ? 'Esta videollamada todavía no está confirmada: falta el pago de la seña.'
          : 'Esta videollamada no está activa. Escribinos y la resolvemos.',
    };
  }
  if (!appt.start || !appt.end) {
    return { ok: false, mensaje: 'El turno no tiene horario. Avisá a Recepción.' };
  }

  const inicio = new Date(appt.start);
  const fin = new Date(appt.end);
  const fueraDeVentana = motivoSinAcceso(inicio, fin, ahora);
  if (fueraDeVentana) {
    return { ok: false, mensaje: fueraDeVentana };
  }

  const token = tokenDeSala(cfg, {
    sala,
    nombre: await nombreVisible(medplum, quien),
    rol: 'profesional',
    inicio,
    fin,
  });
  return { ok: true, dominio: cfg.dominio, sala, ...token };
}
