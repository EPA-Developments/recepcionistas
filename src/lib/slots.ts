/**
 * Generación de franjas reservables (Slot) y semáforo de salas (agenda del día).
 *
 * Funciones puras: dado el horario del centro y los recursos, producen los slots;
 * dado el momento actual y los turnos de un recurso, calculan el color del semáforo.
 *
 * Zona horaria: Argentina (UTC-3, sin DST). Los timestamps se emiten con offset
 * fijo "-03:00", coherente con `TZ` de la config de horario.
 */
import type { RecursoFisico } from '../domain/types.js';
import { SLOT_GRANULARIDAD_MIN, type HorarioDia } from '../config/horario.js';

export const OFFSET_ARG = '-03:00';

export interface SlotDescriptor {
  recursoCodigo: string;
  /** Inicio en ISO con offset de Argentina. */
  inicio: string;
  /** Fin en ISO con offset de Argentina. */
  fin: string;
  estado: 'free';
}

export interface OpcionesSlots {
  /** Día inicial (incluido). Se usa solo su fecha calendaria. */
  desde: Date;
  /** Cantidad de días a generar a partir de `desde`. */
  dias: number;
  /** Tamaño de cada slot en minutos. Default: SLOT_GRANULARIDAD_MIN (30). */
  granularidadMin?: number;
}

export function hhmmAMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minAHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ISO con offset fijo de Argentina ("2026-09-29T10:00:00-03:00"): el formato de los Slot del seed. */
export function isoArgentina(d: Date): string {
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${ymd(local)}T${minAHHMM(local.getUTCHours() * 60 + local.getUTCMinutes())}:00${OFFSET_ARG}`;
}

export function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Genera los slots libres para un conjunto de recursos según el horario semanal.
 * Cada slot dura `granularidadMin`; un turno ocupa los slots que abarque.
 */
export function generarSlots(
  recursos: RecursoFisico[],
  horario: HorarioDia[],
  opts: OpcionesSlots,
): SlotDescriptor[] {
  const gran = opts.granularidadMin ?? SLOT_GRANULARIDAD_MIN;
  const slots: SlotDescriptor[] = [];

  // Base: medianoche UTC del día de `desde` (calendario, sin arrastrar horas).
  const base = new Date(
    Date.UTC(opts.desde.getUTCFullYear(), opts.desde.getUTCMonth(), opts.desde.getUTCDate()),
  );

  for (let i = 0; i < opts.dias; i++) {
    const dia = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const weekday = dia.getUTCDay(); // 0=domingo
    const horarioDia = horario.find((h) => h.dia === weekday);
    if (!horarioDia?.abierto) {
      continue;
    }
    const fecha = ymd(dia);
    for (const franja of horarioDia.franjas) {
      const desdeMin = hhmmAMin(franja.desde);
      const hastaMin = hhmmAMin(franja.hasta);
      for (let t = desdeMin; t + gran <= hastaMin; t += gran) {
        const inicio = `${fecha}T${minAHHMM(t)}:00${OFFSET_ARG}`;
        const fin = `${fecha}T${minAHHMM(t + gran)}:00${OFFSET_ARG}`;
        for (const r of recursos) {
          slots.push({ recursoCodigo: r.codigo, inicio, fin, estado: 'free' });
        }
      }
    }
  }
  return slots;
}

// --------------------------------------------------------------------------
// Semáforo de salas (Documento de Requerimientos §6.7)
// --------------------------------------------------------------------------

export type ColorSala = 'verde' | 'amarillo' | 'rojo';

export interface TurnoVentana {
  inicio: Date;
  fin: Date;
}

/** Minutos de anticipación para el estado "amarillo" (por ocupar). */
export const SEMAFORO_AMARILLO_MIN = 15;

/**
 * Color del semáforo de una sala: rojo si está ocupada ahora, amarillo si se
 * ocupa dentro de los próximos 15 min, verde si está libre.
 */
export function estadoRecurso(ahora: Date, turnos: TurnoVentana[]): ColorSala {
  const t = ahora.getTime();
  for (const turno of turnos) {
    if (turno.inicio.getTime() <= t && t < turno.fin.getTime()) {
      return 'rojo';
    }
  }
  const limiteAmarillo = t + SEMAFORO_AMARILLO_MIN * 60 * 1000;
  for (const turno of turnos) {
    const ini = turno.inicio.getTime();
    if (ini > t && ini <= limiteAmarillo) {
      return 'amarillo';
    }
  }
  return 'verde';
}
