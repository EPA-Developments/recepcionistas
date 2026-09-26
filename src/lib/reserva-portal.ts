/**
 * Reserva desde el portal de la paciente (R-23) — lógica pura.
 *
 * Qué puede reservar la paciente sola, para quién, y con cuánta anticipación; y cuándo
 * una reserva tentativa venció sin seña. Los textos son para la paciente (los muestra
 * el portal tal cual).
 */
import type { Appointment } from '@medplum/fhirtypes';
import { CODIGO_CONSULTA_PB100D, SERVICIOS } from '../config/catalogo.js';
import { ANTICIPACION_MINIMA_PORTAL_MIN } from '../config/reglas.js';
import { EXT } from '../fhir/identifiers.js';
import { esModalidad } from './teleconsulta.js';

export interface PedidoPortal {
  pacienteRef?: string;
  servicioCodigo?: string;
  slotId?: string;
  modalidad?: string;
  tareaId?: string;
}

export type ValidacionPortal = { ok: true } | { ok: false; error: string };

/**
 * Validación del pedido antes de tocar la agenda: la paciente reserva para sí misma
 * (`requester`, si Medplum lo informa), elige un horario y una modalidad, y el servicio
 * es reservable desde el portal: una consulta por especialidad o la consulta del Plan
 * Bienestar con su tarea. El control GLP-1 lo agenda Recepción desde su tarea (R-19).
 */
export function validarPedidoPortal(p: PedidoPortal, requesterRef: string | undefined): ValidacionPortal {
  if (!p.pacienteRef || !/^Patient\/[^/]+$/.test(p.pacienteRef)) {
    return { ok: false, error: 'Falta el paciente.' };
  }
  if (requesterRef?.startsWith('Patient/') && requesterRef !== p.pacienteRef) {
    return { ok: false, error: 'Solo podés reservar turnos para vos.' };
  }
  if (!p.slotId?.trim()) {
    return { ok: false, error: 'Elegí un horario.' };
  }
  if (!esModalidad(p.modalidad)) {
    return { ok: false, error: 'Elegí si la consulta es presencial o por videollamada.' };
  }
  const servicio = SERVICIOS.find((s) => s.codigo === p.servicioCodigo);
  if (!servicio) {
    return { ok: false, error: 'Esa consulta no está en el catálogo.' };
  }
  if (servicio.codigo === CODIGO_CONSULTA_PB100D) {
    if (!p.tareaId?.trim()) {
      return { ok: false, error: 'La consulta del plan se reserva desde tu plan: elegí cuál (inicial, día 50 o final).' };
    }
    return { ok: true };
  }
  if (!servicio.grupo) {
    return { ok: false, error: 'Ese control lo agenda Recepción: escribinos por Mensajes.' };
  }
  return { ok: true };
}

/** Anticipación mínima (R-23): el horario tiene que empezar después de que venza la retención. */
export function validarAnticipacionPortal(ahora: Date, inicio: Date): ValidacionPortal {
  if (inicio.getTime() - ahora.getTime() < ANTICIPACION_MINIMA_PORTAL_MIN * 60_000) {
    return {
      ok: false,
      error: `Ese horario empieza muy pronto: elegí uno con al menos ${ANTICIPACION_MINIMA_PORTAL_MIN} minutos de anticipación.`,
    };
  }
  return { ok: true };
}

/** Hasta cuándo se retiene una reserva tentativa del portal (extensión `reserva-expira`). */
export function vencimientoDe(appt: Pick<Appointment, 'extension'>): Date | undefined {
  const v = appt.extension?.find((e) => e.url === EXT.reservaExpira)?.valueDateTime;
  return v ? new Date(v) : undefined;
}

/** ¿Es una reserva tentativa del portal cuya retención venció sin seña? */
export function reservaVencida(appt: Pick<Appointment, 'status' | 'extension'>, ahora: Date): boolean {
  if (appt.status !== 'pending') {
    return false;
  }
  const vence = vencimientoDe(appt);
  return vence !== undefined && vence.getTime() <= ahora.getTime();
}
