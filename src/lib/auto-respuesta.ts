/**
 * Respuestas automáticas y ventana de 24 h de WhatsApp (lógica pura, sin red).
 *
 *  - Ventana: WhatsApp deja mandar texto libre solo durante las 24 h que siguen al
 *    último mensaje del paciente; después, solo plantillas aprobadas por Meta. La
 *    bandeja muestra cuánto queda (y se pone naranja cerca del cierre).
 *  - Qué responde solo el sistema (textos en `config/auto-respuesta.ts`):
 *      · número nuevo (primer WhatsApp de alguien que no estaba en SOM) → bienvenida con
 *        el pedido de datos para el alta; con el centro cerrado, con el horario al final;
 *      · fuera de horario → aviso con el horario, una vez por cada período cerrado;
 *      · conversación nueva abierta por WhatsApp → acuse.
 *    Nunca dos juntas: el aviso de fuera de horario ya acusa recibo, y la bienvenida
 *    fuera de horario ya avisa el horario.
 *
 * Horario: el de la agenda (`config/horario.ts`), en hora de Argentina (UTC-3, sin DST).
 */
import { HORARIO_SEMANAL, type HorarioDia } from '../config/horario.js';
import {
  TEXTO_ACUSE,
  TEXTO_BIENVENIDA,
  textoBienvenidaFueraDeHorario,
  textoFueraDeHorario,
  VENTANA_AVISO_MINUTOS,
} from '../config/auto-respuesta.js';
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
  // Nunca más de 24 h: el `sent` lo pone el servidor y el reloj de la computadora de
  // Recepción puede estar un poco atrasado ("24 h 1 min").
  const restanteMin = Math.min(VENTANA_WHATSAPP_HORAS * 60, Math.max(0, Math.floor((cierra - ahora.getTime()) / MIN)));
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

/**
 * Lo que manda solo el sistema en una conversación: la bienvenida, el acuse y el aviso de
 * fuera de horario (respuestas a un WhatsApp que acaba de llegar) y `mensaje-nuevo`, el
 * aviso con plantilla de que Recepción respondió con la ventana de 24 h cerrada
 * (`som-whatsapp-responder`).
 */
export type TipoRespuestaAutomatica = 'bienvenida' | 'acuse' | 'fuera-de-horario' | 'mensaje-nuevo';

/** Cómo se nombra cada respuesta automática en las pantallas y diagnósticos. */
export const ETIQUETA_AUTOMATICA: Readonly<Record<TipoRespuestaAutomatica, string>> = {
  bienvenida: 'Bienvenida',
  acuse: 'Acuse',
  'fuera-de-horario': 'Fuera de horario',
  'mensaje-nuevo': 'Aviso de mensaje nuevo',
};

export interface RespuestaAutomatica {
  tipo: TipoRespuestaAutomatica;
  texto: string;
}

/**
 * ¿Ese mensaje automático le avisó al paciente que el centro estaba cerrado? El aviso de
 * fuera de horario, y la bienvenida que salió con el centro cerrado (lleva el horario).
 */
export function avisoDeCierre(
  tipo: TipoRespuestaAutomatica | undefined,
  sent: string | undefined,
  horario: readonly HorarioDia[] = HORARIO_SEMANAL,
): boolean {
  if (tipo === 'fuera-de-horario') {
    return true;
  }
  const cuando = sent ? Date.parse(sent) : Number.NaN;
  return tipo === 'bienvenida' && !Number.isNaN(cuando) && !estaAbierto(new Date(cuando), horario);
}

/**
 * Qué responde solo el sistema a un WhatsApp que acaba de llegar (o nada).
 * @param p.numeroNuevo - es el primer WhatsApp de un número que no estaba en SOM.
 * @param p.conversacionNueva - el mensaje abrió una conversación nueva.
 * @param p.ultimoAvisoFueraDeHorario - cuándo se le avisó por última vez en esa conversación que el centro estaba cerrado.
 */
export function respuestaAutomatica(p: {
  numeroNuevo?: boolean;
  conversacionNueva: boolean;
  ahora: Date;
  ultimoAvisoFueraDeHorario?: string;
  horario?: readonly HorarioDia[];
}): RespuestaAutomatica | undefined {
  const horario = p.horario ?? HORARIO_SEMANAL;
  // Un número nuevo recibe la bienvenida con el pedido de datos (con el centro cerrado, con
  // el horario al final: así deja sus datos y Recepción los encuentra al abrir).
  if (p.numeroNuevo) {
    return estaAbierto(p.ahora, horario)
      ? { tipo: 'bienvenida', texto: TEXTO_BIENVENIDA }
      : { tipo: 'bienvenida', texto: textoBienvenidaFueraDeHorario(describirHorario(horario)) };
  }
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
