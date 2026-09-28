/**
 * Teleconsulta desde el portal de la paciente — lógica pura (sin red).
 *
 * Qué puede hacer la paciente con su teleconsulta sin pasar por Recepción, y con qué
 * reglas: entrar a la videollamada, cancelarla (R-14) y volver a abrir el pago de la
 * seña de una reserva tentativa (R-23). Lo usan los bots `som-teleconsulta-*`; los
 * textos son para la paciente (el portal los muestra tal cual).
 *
 * Todo sobre el modelo de SOM: la modalidad en la extensión `modalidad` (v3-ActCode
 * `VR`), el link de Jitsi en `teleconsulta-url` y la seña en `link-pago-sena`.
 */
import type { Appointment } from '@medplum/fhirtypes';
import { TZ } from '../config/horario.js';
import { ENTRADA_TELECONSULTA_MIN } from '../config/reglas.js';
import { EXT } from '../fhir/identifiers.js';
import { evaluarCancelacion } from './reglas-turno.js';
import { reservaVencida } from './reserva-portal.js';
import { modalidadDe, teleconsultaUrlDe } from './teleconsulta.js';

export type Verificacion = { ok: true; pacienteRef: string } | { ok: false; error: string };

const fmtHora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

/** "Patient/{id}" de la paciente del turno. */
export function pacienteDelTurno(appt: Pick<Appointment, 'participant'>): string | undefined {
  return appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
}

/** Código del ítem del turno (`CARDIOLOGIA`, `CONSULTA_PB100D`…). */
export function itemDelTurno(appt: Pick<Appointment, 'extension'>): string | undefined {
  return appt.extension?.find((e) => e.url === EXT.itemCodigo)?.valueString;
}

/**
 * El turno es una teleconsulta y quien ejecuta el bot puede tocarlo: su propia paciente
 * o alguien del equipo (`Practitioner`). Como el bot corre con su propia identidad y lee
 * cualquier turno, **sin `requester` no se hace nada**: nadie puede operar sobre el turno
 * de otra persona sabiendo solo su id.
 */
export function verificarTurnoDelPaciente(
  appt: Pick<Appointment, 'participant' | 'extension'>,
  requesterRef: string | undefined,
): Verificacion {
  const pacienteRef = pacienteDelTurno(appt);
  if (!requesterRef || !pacienteRef) {
    return { ok: false, error: 'No pudimos verificar que el turno sea tuyo.' };
  }
  if (requesterRef.startsWith('Patient/') ? requesterRef !== pacienteRef : !requesterRef.startsWith('Practitioner/')) {
    return { ok: false, error: 'Ese turno no es tuyo.' };
  }
  if (modalidadDe(appt) !== 'teleconsulta') {
    return { ok: false, error: 'Ese turno no es una teleconsulta.' };
  }
  return { ok: true, pacienteRef };
}

/** El turno ya no está vigente: por qué, en palabras de la paciente (undefined si sigue vigente). */
function motivoNoVigente(appt: Pick<Appointment, 'status' | 'end'>, ahora: Date): string | undefined {
  switch (appt.status) {
    case 'cancelled':
    case 'noshow':
    case 'entered-in-error':
      return 'Este turno está cancelado.';
    case 'fulfilled':
      return 'Esta consulta ya terminó.';
    default:
      return appt.end && Date.parse(appt.end) <= ahora.getTime() ? 'Esta consulta ya terminó.' : undefined;
  }
}

// ───────────────────────────── Entrar ─────────────────────────────

export type Entrada =
  | { ok: true; url: string; marcarPresencia: boolean }
  | { ok: false; mensaje: string; abre?: string; pagar?: boolean };

/**
 * Entrar a la videollamada. Solo con el turno confirmado (con la seña o incluido en el
 * plan), desde `ENTRADA_TELECONSULTA_MIN` antes del inicio y hasta el fin. Al entrar, un
 * turno `booked` pasa a `arrived` (la paciente está en la sala: el profesional lo ve).
 */
export function evaluarEntrada(appt: Appointment, ahora: Date): Entrada {
  const noVigente = motivoNoVigente(appt, ahora);
  if (noVigente) {
    return { ok: false, mensaje: noVigente };
  }
  if (appt.status === 'pending' || appt.status === 'proposed') {
    return { ok: false, mensaje: 'Tu turno todavía no está confirmado: pagá la seña para confirmarlo.', pagar: true };
  }
  if (appt.status === 'waitlist') {
    return { ok: false, mensaje: 'Tu turno todavía no está confirmado. Recepción te avisa.' };
  }
  if (!appt.start) {
    return { ok: false, mensaje: 'El turno no tiene horario. Escribinos por Mensajes.' };
  }
  const abre = new Date(Date.parse(appt.start) - ENTRADA_TELECONSULTA_MIN * 60_000);
  if (ahora.getTime() < abre.getTime()) {
    return {
      ok: false,
      abre: abre.toISOString(),
      mensaje: `La sala abre ${ENTRADA_TELECONSULTA_MIN} minutos antes del turno, a las ${fmtHora.format(abre)}.`,
    };
  }
  const url = teleconsultaUrlDe(appt);
  if (!url) {
    return { ok: false, mensaje: 'Todavía no tenemos el link de la videollamada. Escribinos por Mensajes y te lo pasamos.' };
  }
  return { ok: true, url, marcarPresencia: appt.status === 'booked' };
}

// ───────────────────────────── Cancelar (R-14) ─────────────────────────────

export type Cancelacion =
  | {
      ok: true;
      /** Tenía la seña pagada (confirmado con cargo). */
      conSena: boolean;
      /** Consulta incluida en el Plan Bienestar: vuelve a quedar por agendar (R-20). */
      incluida: boolean;
      /** R-14: con menos de 24 h la sesión se consume (la seña no vuelve). */
      consumeSesion: boolean;
      devuelveSaldo: boolean;
      /** Qué pasa si cancela (antes de confirmar) o qué pasó (después). */
      mensaje: string;
    }
  | { ok: false; mensaje: string };

/**
 * Qué pasa si la paciente cancela su teleconsulta ahora (R-14). Se puede cancelar un turno
 * tentativo o confirmado que todavía no empezó; lo que ya empezó o terminó se habla con
 * Recepción. La fuerza mayor médica (R-14) no la decide la paciente: la autoriza un médico
 * desde Recepción.
 */
export function evaluarCancelacionPortal(appt: Appointment, ahora: Date, incluida: boolean): Cancelacion {
  const noVigente = motivoNoVigente(appt, ahora);
  if (noVigente) {
    return { ok: false, mensaje: noVigente };
  }
  if (!appt.start) {
    return { ok: false, mensaje: 'El turno no tiene horario. Escribinos por Mensajes.' };
  }
  if (appt.status !== 'pending' && appt.status !== 'proposed' && appt.status !== 'booked') {
    return { ok: false, mensaje: 'La consulta ya empezó: si necesitás algo, escribinos por Mensajes.' };
  }
  const inicio = new Date(appt.start);
  if (inicio.getTime() <= ahora.getTime()) {
    return { ok: false, mensaje: 'La consulta ya empezó: si necesitás algo, escribinos por Mensajes.' };
  }
  const r14 = evaluarCancelacion(ahora, inicio);
  const conSena = appt.status === 'booked' && !incluida;
  const base = { ok: true as const, conSena, incluida, consumeSesion: r14.consumeSesion, devuelveSaldo: r14.devuelveSaldo };

  if (incluida) {
    return { ...base, mensaje: 'La consulta sigue incluida en tu plan: vuelve a quedar para agendar.' };
  }
  if (!conSena) {
    return { ...base, mensaje: 'El horario queda libre. No abonaste seña, así que no hay nada que devolver.' };
  }
  if (r14.consumeSesion) {
    return {
      ...base,
      mensaje:
        'Faltan menos de 24 horas: la sesión se considera consumida y la seña no se devuelve. ' +
        'Si es por un motivo médico de fuerza mayor, escribinos por Mensajes antes de cancelar.',
    };
  }
  return { ...base, mensaje: 'Faltan más de 24 horas: la seña no se pierde. Recepción te contacta para devolverla o usarla en otro turno.' };
}

// ───────────────────────────── Pagar la seña (R-23) ─────────────────────────────

export type Pago =
  | { ok: true; url?: string; expira?: string }
  | { ok: false; mensaje: string };

/**
 * Volver a abrir el pago de la seña de una reserva tentativa (p. ej. la paciente cerró
 * MercadoPago). Devuelve el link guardado en el turno (`link-pago-sena`) si lo hay; si no,
 * `ok` sin `url` indica que hay que generarlo. Una reserva vencida no revive (R-23).
 */
export function evaluarPago(appt: Appointment, ahora: Date, incluida: boolean): Pago {
  const noVigente = motivoNoVigente(appt, ahora);
  if (noVigente) {
    return { ok: false, mensaje: noVigente };
  }
  if (incluida) {
    return { ok: false, mensaje: 'La consulta está incluida en tu plan: no lleva seña.' };
  }
  if (appt.status === 'booked' || appt.status === 'arrived' || appt.status === 'checked-in') {
    return { ok: false, mensaje: 'La seña ya está paga: tu turno está confirmado.' };
  }
  if (appt.status !== 'pending' && appt.status !== 'proposed') {
    return { ok: false, mensaje: 'Este turno no tiene una seña pendiente.' };
  }
  if (reservaVencida(appt, ahora)) {
    return { ok: false, mensaje: 'Venció la reserva y el horario se liberó: elegí otro desde "Reservar un turno".' };
  }
  const expira = appt.extension?.find((e) => e.url === EXT.reservaExpira)?.valueDateTime;
  const url = appt.extension?.find((e) => e.url === EXT.linkPagoSena)?.valueUrl;
  return { ok: true, ...(url ? { url } : {}), ...(expira ? { expira } : {}) };
}
