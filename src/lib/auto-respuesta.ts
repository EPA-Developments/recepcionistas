/**
 * Respuestas automáticas y ventana de 24 h de WhatsApp (lógica pura, sin red).
 *
 *  - Ventana: WhatsApp deja mandar texto libre solo durante las 24 h que siguen al
 *    último mensaje del paciente; después, solo plantillas aprobadas por Meta. La
 *    bandeja muestra cuánto queda (y se pone naranja cerca del cierre).
 *  - Qué responde solo el sistema (textos en `config/auto-respuesta.ts`):
 *      · fuera de horario → aviso con el horario, una vez por cada período cerrado;
 *      · conversación nueva abierta por WhatsApp → acuse.
 *    Nunca las dos juntas: el aviso de fuera de horario ya acusa recibo.
 *
 * Horario: el de la agenda (`config/horario.ts`), en hora de Argentina (UTC-3, sin DST).
 */
import { HORARIO_SEMANAL, type HorarioDia } from '../config/horario.js';
import { TEXTO_ACUSE, textoFueraDeHorario, VENTANA_AVISO_MINUTOS } from '../config/auto-respuesta.js';
import { diaLocal } from './programas.js';

const OFFSET_ARG = '-03:00';
const MIN = 60_000;

// ───────────────────────────── ventana de 24 h ─────────────────────────────

/** Horas en que WhatsApp deja responder texto libre después del último mensaje del paciente. */
export const VENTANA_WHATSAPP_HORAS = 24;

export interface Ventana24h {
  abierta: boolean;
  /** Hasta cuándo se puede responder (ISO), si el paciente escribió por WhatsApp. */
  cierra?: string;
  /** Minutos que quedan (0 si está cerrada). */
  restanteMin: number;
  /** Queda poco (menos de `VENTANA_AVISO_MINUTOS`): el aviso se pone naranja. */
  porCerrar: boolean;
}

export function ventana24h(ultimoEntrante: string | undefined, ahora: Date = new Date()): Ventana24h {
  const desde = ultimoEntrante ? Date.parse(ultimoEntrante) : Number.NaN;
  if (Number.isNaN(desde)) {
    return { abierta: false, restanteMin: 0, porCerrar: false };
  }
  const cierra = desde + VENTANA_WHATSAPP_HORAS * 60 * MIN;
  const restanteMin = Math.max(0, Math.floor((cierra - ahora.getTime()) / MIN));
  const abierta = cierra > ahora.getTime();
  return {
    abierta,
    cierra: new Date(cierra).toISOString(),
    restanteMin,
    porCerrar: abierta && restanteMin < VENTANA_AVISO_MINUTOS,
  };
}

/** "23 h 10 min", "3 h", "45 min", "menos de 1 min". */
export function textoRestante(restanteMin: number): string {
  if (restanteMin < 1) {
    return 'menos de 1 min';
  }
  const h = Math.floor(restanteMin / 60);
  const m = restanteMin % 60;
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// ───────────────────────────── horario de atención ─────────────────────────────

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Día de la semana (0 = domingo) de una fecha 'AAAA-MM-DD' de Argentina. */
function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00${OFFSET_ARG}`).getUTCDay();
}

function horarioDe(dia: number, horario: readonly HorarioDia[]): HorarioDia | undefined {
  return horario.find((h) => h.dia === dia && h.abierto);
}

/** ¿El centro está abierto en este instante? */
export function estaAbierto(ahora: Date, horario: readonly HorarioDia[] = HORARIO_SEMANAL): boolean {
  const fecha = diaLocal(ahora);
  const minutos = (ahora.getTime() - Date.parse(`${fecha}T00:00:00${OFFSET_ARG}`)) / MIN;
  return (horarioDe(diaSemana(fecha), horario)?.franjas ?? []).some(
    (f) => minutos >= aMinutos(f.desde) && minutos < aMinutos(f.hasta),
  );
}

/** El último cierre del centro antes de `ahora` (inicio del período cerrado actual). */
export function ultimoCierre(ahora: Date, horario: readonly HorarioDia[] = HORARIO_SEMANAL): Date | undefined {
  for (let d = 0; d <= 7; d++) {
    const fecha = diaLocal(new Date(ahora.getTime() - d * 24 * 60 * MIN));
    const franjas = [...(horarioDe(diaSemana(fecha), horario)?.franjas ?? [])].sort(
      (a, b) => aMinutos(b.hasta) - aMinutos(a.hasta),
    );
    for (const f of franjas) {
      const cierre = new Date(`${fecha}T${f.hasta}:00${OFFSET_ARG}`);
      if (cierre.getTime() <= ahora.getTime()) {
        return cierre;
      }
    }
  }
  return undefined;
}

const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const PLURAL_DIA = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

function hora(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
}

function listar(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** El horario en palabras: "lunes a viernes de 8 a 22 y sábados de 8 a 20". */
export function describirHorario(horario: readonly HorarioDia[] = HORARIO_SEMANAL): string {
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const firma = (dia: number): string =>
    (horarioDe(dia, horario)?.franjas ?? []).map((f) => `de ${hora(f.desde)} a ${hora(f.hasta)}`).join(' y ');
  const grupos: Array<{ desde: number; hasta: number; franjas: string }> = [];
  for (const dia of orden) {
    const franjas = firma(dia);
    const ultimo = grupos[grupos.length - 1];
    if (franjas && ultimo && ultimo.franjas === franjas && orden.indexOf(dia) === orden.indexOf(ultimo.hasta) + 1) {
      ultimo.hasta = dia;
    } else if (franjas) {
      grupos.push({ desde: dia, hasta: dia, franjas });
    }
  }
  return listar(
    grupos.map((g) =>
      g.desde === g.hasta
        ? `${PLURAL_DIA[g.desde]} ${g.franjas}`
        : `${NOMBRE_DIA[g.desde]} a ${NOMBRE_DIA[g.hasta]} ${g.franjas}`,
    ),
  );
}

// ───────────────────────────── qué responde solo el sistema ─────────────────────────────

export type TipoRespuestaAutomatica = 'acuse' | 'fuera-de-horario';

export interface RespuestaAutomatica {
  tipo: TipoRespuestaAutomatica;
  texto: string;
}

/**
 * Qué responde solo el sistema a un WhatsApp que acaba de llegar (o nada).
 * @param p.conversacionNueva - el mensaje abrió una conversación nueva.
 * @param p.ultimoAvisoFueraDeHorario - cuándo salió el último aviso de fuera de horario en esa conversación.
 */
export function respuestaAutomatica(p: {
  conversacionNueva: boolean;
  ahora: Date;
  ultimoAvisoFueraDeHorario?: string;
  horario?: readonly HorarioDia[];
}): RespuestaAutomatica | undefined {
  const horario = p.horario ?? HORARIO_SEMANAL;
  if (!estaAbierto(p.ahora, horario)) {
    const cierre = ultimoCierre(p.ahora, horario);
    const yaAvisado =
      p.ultimoAvisoFueraDeHorario !== undefined &&
      (!cierre || Date.parse(p.ultimoAvisoFueraDeHorario) >= cierre.getTime());
    if (!yaAvisado) {
      return { tipo: 'fuera-de-horario', texto: textoFueraDeHorario(describirHorario(horario)) };
    }
  }
  return p.conversacionNueva ? { tipo: 'acuse', texto: TEXTO_ACUSE } : undefined;
}
