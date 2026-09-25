/**
 * Textos de los avisos al paciente y a Recepción (WhatsApp) sobre turnos y consultas
 * del Plan Bienestar 100 Días® — lógica pura: arma el texto, no envía nada.
 *
 * En teleconsulta, el aviso lleva el link de la videollamada (Jitsi) cuando el turno
 * ya lo tiene. Nunca incluyen datos clínicos.
 */
import type { Modalidad } from '../domain/types.js';
import { NOMBRE_PLAN_BIENESTAR } from '../config/plan-bienestar.js';
import { TZ } from '../config/horario.js';
import { fmtDia, type Ventana } from './programas.js';

const FIRMA = 'Segunda Opinión Médica';

const fmtFechaHora = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
});
const fmtHora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

/** "Consulta de Cardiología" → "consulta de Cardiología" (en medio de una frase). */
export function enFrase(nombre: string): string {
  return /^(Consulta|Teleconsulta)\b/.test(nombre) ? nombre.charAt(0).toLowerCase() + nombre.slice(1) : nombre;
}

/** Cómo entrar a la teleconsulta (o que el link llega después). */
function lineaTeleconsulta(url: string | undefined, cuando: 'ahora' | 'despues'): string {
  if (url) {
    return ` Es por videollamada: entrá desde ${url} unos minutos antes.`;
  }
  return cuando === 'despues'
    ? ' Es por videollamada: te mandamos el link antes del turno.'
    : ' Es por videollamada: te mandamos el link por este medio.';
}

export interface DatosAvisoReserva {
  /** Nombre visible del turno (p. ej. "Teleconsulta de Cardiología"). */
  nombre: string;
  inicio: Date;
  modalidad: Modalidad;
  /** Incluida en el Plan Bienestar: queda confirmada, sin seña. */
  incluida?: boolean;
  teleconsultaUrl?: string;
  traerLaboratorio?: boolean;
}

/** Aviso al reservar: confirmado si está incluido en el plan; si no, tentativo hasta la seña. */
export function avisoReserva(d: DatosAvisoReserva): string {
  const cuando = fmtFechaHora.format(d.inicio);
  const cabeza = d.incluida
    ? `${FIRMA}: confirmamos tu ${enFrase(d.nombre)} para el ${cuando}. Está incluida en tu plan.`
    : `${FIRMA}: reservamos tu ${enFrase(d.nombre)} para el ${cuando} (tentativo). Aboná la seña del 50% para confirmarlo.`;
  const tele = d.modalidad === 'teleconsulta' ? lineaTeleconsulta(d.incluida ? d.teleconsultaUrl : undefined, 'despues') : '';
  const lab = d.traerLaboratorio ? ' Traé los resultados del laboratorio del control.' : '';
  return `${cabeza}${tele}${lab} 💙`;
}

/** Aviso al confirmarse el turno con la seña (manual o MercadoPago). */
export function avisoConfirmacion(d: { descripcion: string; senaARS: number; modalidad?: Modalidad; teleconsultaUrl?: string }): string {
  const tele = d.modalidad === 'teleconsulta' ? lineaTeleconsulta(d.teleconsultaUrl, 'despues') : ' ¡Te esperamos!';
  return `${FIRMA}: ¡tu turno quedó confirmado! ${d.descripcion}. Recibimos la seña de $${d.senaARS.toLocaleString('es-AR')}.${tele} 💙`;
}

/** Recordatorio de un turno confirmado (48 h / 2 h). */
export function avisoRecordatorio(d: {
  tipo: '48h' | '2h';
  descripcion: string;
  inicio: Date;
  modalidad?: Modalidad;
  teleconsultaUrl?: string;
}): string {
  const tele = d.modalidad === 'teleconsulta';
  if (d.tipo === '2h') {
    return tele
      ? `${FIRMA}: ¡tu ${enFrase(d.descripcion)} es hoy a las ${fmtHora.format(d.inicio)}!${lineaTeleconsulta(d.teleconsultaUrl, 'ahora')} 💙`
      : `${FIRMA}: ¡tu turno de ${enFrase(d.descripcion)} es hoy a las ${fmtHora.format(d.inicio)}! Te esperamos en un rato. 💙`;
  }
  return tele
    ? `${FIRMA}: te recordamos tu ${enFrase(d.descripcion)} el ${fmtFechaHora.format(d.inicio)}.${lineaTeleconsulta(d.teleconsultaUrl, 'despues')} 💙`
    : `${FIRMA}: te recordamos tu turno de ${enFrase(d.descripcion)} el ${fmtFechaHora.format(d.inicio)}. ¡Te esperamos! 💙`;
}

/** Aviso del programa al paciente: se abrió la ventana de una consulta o sigue sin agendar. */
export function avisoConsultaPlan(d: { aviso: 'apertura' | 'mitad'; titulo: string; ventana: Ventana }): string {
  const rango = `entre el ${fmtDia(d.ventana.desde)} y el ${fmtDia(d.ventana.hasta)}`;
  const cuerpo =
    d.aviso === 'apertura'
      ? `ya podés agendar tu ${enFrase(d.titulo)} del ${NOMBRE_PLAN_BIENESTAR} (${rango}).`
      : `todavía no agendaste tu ${enFrase(d.titulo)} del ${NOMBRE_PLAN_BIENESTAR}: se hace ${rango}.`;
  return `${FIRMA}: ${cuerpo} Está incluida en tu plan y puede ser presencial o por videollamada. Pedila desde el portal o respondé este mensaje. 💙`;
}

/** Alerta a Recepción: una consulta del plan sigue sin agendar a mitad de su ventana. */
export function alertaRecepcionConsultaPlan(d: { paciente?: string; titulo: string; ventana: Ventana }): string {
  return (
    `${FIRMA} · ${NOMBRE_PLAN_BIENESTAR}: ${d.paciente?.trim() || 'Un paciente'} tiene sin agendar la ${enFrase(d.titulo)} ` +
    `(ventana hasta el ${fmtDia(d.ventana.hasta)}). Contactalo desde la app de Recepción.`
  );
}
