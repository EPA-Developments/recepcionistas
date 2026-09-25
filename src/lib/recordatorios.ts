/**
 * Recordatorios automáticos de turnos y avisos de los programas — lógica pura (sin
 * FHIR ni red).
 *
 * Se avisa a las 48 h y a las 2 h del turno. Como el cron no corre exactamente en
 * esos instantes, usamos ventanas "hacia abajo": un turno debe el recordatorio de
 * 2 h cuando falta ≤ 2 h, y el de 48 h cuando falta ≤ 48 h (pero > 2 h). Así, si
 * una corrida se saltea, el siguiente tick igual lo manda; la idempotencia (no
 * reenviar) la resuelve el bot al registrar la Communication.
 */
import { TZ } from '../config/horario.js';
import { HORARIO_AVISOS_PROGRAMA, RECORDATORIO_HORAS } from '../config/reglas.js';
import { sumarDias, type Ventana } from './programas.js';

export type TipoRecordatorio = '48h' | '2h';

const HORA_MS = 3_600_000;

/** Umbrales en ms, de menor a mayor antelación (2 h primero, luego 48 h). */
const UMBRALES: Array<{ tipo: TipoRecordatorio; ms: number }> = RECORDATORIO_HORAS.map((h) => ({
  tipo: `${h}h` as TipoRecordatorio,
  ms: h * HORA_MS,
})).sort((a, b) => a.ms - b.ms);

/**
 * ¿Qué recordatorio (si alguno) corresponde mandar para un turno que arranca en
 * `inicio`, evaluado en `ahora`? Devuelve el más urgente aplicable, o `undefined`
 * si el turno está en el pasado o todavía falta más que la ventana máxima.
 */
export function recordatorioDue(inicio: Date, ahora: Date): TipoRecordatorio | undefined {
  const faltaMs = inicio.getTime() - ahora.getTime();
  if (faltaMs <= 0) {
    return undefined;
  }
  for (const u of UMBRALES) {
    if (faltaMs <= u.ms) {
      return u.tipo;
    }
  }
  return undefined;
}

/** Ventana máxima de anticipación a considerar (la mayor de las configuradas), en ms. */
export const VENTANA_MAX_MS = Math.max(...UMBRALES.map((u) => u.ms));

// ───────────────────── avisos del Plan Bienestar 100 Días® (R-20) ─────────────────────

/** `apertura`: se abrió la ventana de la consulta · `mitad`: sigue sin agendar a mitad de ventana. */
export type AvisoConsultaPlan = 'apertura' | 'mitad';

/** Día del medio de una ventana ('AAAA-MM-DD'): la fecha objetivo de la consulta. */
export function mitadDeVentana(v: Ventana): string {
  const dias = Math.round((Date.parse(`${v.hasta}T00:00:00Z`) - Date.parse(`${v.desde}T00:00:00Z`)) / 86_400_000);
  return sumarDias(v.desde, Math.floor(dias / 2));
}

/**
 * ¿Qué aviso del programa toca hoy para una consulta todavía sin agendar? Dentro de la
 * ventana: `apertura` hasta la fecha objetivo y `mitad` desde ahí. Fuera: ninguno (la
 * vencida la sigue Recepción en su cola). Como el cron corre seguido, si se saltea la
 * apertura, igual sale el de mitad; la idempotencia la resuelve el bot.
 */
export function avisoConsultaPlanDue(ventana: Ventana, hoy: string): AvisoConsultaPlan | undefined {
  if (hoy < ventana.desde || hoy > ventana.hasta) {
    return undefined;
  }
  return hoy >= mitadDeVentana(ventana) ? 'mitad' : 'apertura';
}

const fmtHoraLocal = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ });

/** ¿Es horario de mandar avisos de los programas? (no salen de noche). */
export function enHorarioDeAvisos(ahora: Date): boolean {
  const hora = Number(fmtHoraLocal.format(ahora));
  return hora >= HORARIO_AVISOS_PROGRAMA.desde && hora < HORARIO_AVISOS_PROGRAMA.hasta;
}
