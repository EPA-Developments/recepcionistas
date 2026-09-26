/**
 * Agenda por profesional — lógica pura (sin red).
 *
 * De la disponibilidad semanal de cada profesional (`src/config/medicos.ts`) y del
 * horario del centro salen sus horarios libres: franjas de `SLOT_GRANULARIDAD_MIN`
 * dentro de la **intersección** de las dos cosas. Un turno ocupa las franjas libres
 * que abarca; la teleconsulta no ocupa consultorio (R-21), lo presencial además ocupa
 * el suyo (R-07).
 *
 * Zona horaria: Argentina (UTC-3, sin DST), como `src/lib/slots.ts`.
 */
import type { DisponibilidadSemanal, Medico } from '../config/medicos.js';
import { SLOT_GRANULARIDAD_MIN, type FranjaHoraria, type HorarioDia } from '../config/horario.js';
import { OFFSET_ARG, hhmmAMin, minAHHMM, ymd, type OpcionesSlots } from './slots.js';

const OFFSET_ARG_MS = 3 * 60 * 60 * 1000;

export interface SlotProfesionalDescriptor {
  medicoCodigo: string;
  /** Inicio en ISO con offset de Argentina. */
  inicio: string;
  /** Fin en ISO con offset de Argentina. */
  fin: string;
  estado: 'free';
}

interface Intervalo {
  desde: number;
  hasta: number;
}

/** Intersección de dos listas de intervalos (minutos desde las 00:00). */
function intersectar(a: Intervalo[], b: Intervalo[]): Intervalo[] {
  const out: Intervalo[] = [];
  for (const x of a) {
    for (const y of b) {
      const desde = Math.max(x.desde, y.desde);
      const hasta = Math.min(x.hasta, y.hasta);
      if (desde < hasta) {
        out.push({ desde, hasta });
      }
    }
  }
  return out.sort((p, q) => p.desde - q.desde);
}

function aIntervalos(franjas: Pick<FranjaHoraria, 'desde' | 'hasta'>[]): Intervalo[] {
  return franjas.map((f) => ({ desde: hhmmAMin(f.desde), hasta: hhmmAMin(f.hasta) })).filter((i) => i.desde < i.hasta);
}

/**
 * Franjas en que el profesional atiende un día de la semana: su disponibilidad
 * dentro del horario del centro. Vacío si ese día no atiende o el centro cierra.
 */
export function franjasDelDia(
  medico: Pick<Medico, 'disponibilidad'>,
  horario: HorarioDia[],
  dia: number,
): FranjaHoraria[] {
  const centro = horario.find((h) => h.dia === dia);
  if (!centro?.abierto) {
    return [];
  }
  const propias = medico.disponibilidad.filter((d) => d.dia === dia);
  return intersectar(aIntervalos(propias), aIntervalos(centro.franjas)).map((i) => ({
    desde: minAHHMM(i.desde),
    hasta: minAHHMM(i.hasta),
  }));
}

/**
 * Horarios libres de un profesional para `opts.dias` días desde `opts.desde`, de
 * `granularidadMin` cada uno, dentro de sus franjas de cada día.
 */
export function generarSlotsProfesional(
  medico: Pick<Medico, 'codigo' | 'disponibilidad'>,
  horario: HorarioDia[],
  opts: OpcionesSlots,
): SlotProfesionalDescriptor[] {
  const gran = opts.granularidadMin ?? SLOT_GRANULARIDAD_MIN;
  const base = new Date(Date.UTC(opts.desde.getUTCFullYear(), opts.desde.getUTCMonth(), opts.desde.getUTCDate()));
  const slots: SlotProfesionalDescriptor[] = [];
  for (let i = 0; i < opts.dias; i++) {
    const dia = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const fecha = ymd(dia);
    for (const franja of franjasDelDia(medico, horario, dia.getUTCDay())) {
      const desdeMin = hhmmAMin(franja.desde);
      const hastaMin = hhmmAMin(franja.hasta);
      for (let t = desdeMin; t + gran <= hastaMin; t += gran) {
        slots.push({
          medicoCodigo: medico.codigo,
          inicio: `${fecha}T${minAHHMM(t)}:00${OFFSET_ARG}`,
          fin: `${fecha}T${minAHHMM(t + gran)}:00${OFFSET_ARG}`,
          estado: 'free',
        });
      }
    }
  }
  return slots;
}

/** Horarios libres de todos los profesionales (para el seed y el cron de agenda). */
export function generarSlotsProfesionales(
  medicos: Pick<Medico, 'codigo' | 'disponibilidad'>[],
  horario: HorarioDia[],
  opts: OpcionesSlots,
): SlotProfesionalDescriptor[] {
  return medicos.flatMap((m) => generarSlotsProfesional(m, horario, opts));
}

/** Día de la semana y minutos desde las 00:00, en hora de Argentina. */
function enArgentina(d: Date): { dia: number; minutos: number } {
  const local = new Date(d.getTime() - OFFSET_ARG_MS);
  return { dia: local.getUTCDay(), minutos: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * ¿El intervalo [inicio, fin) cae entero dentro de una franja del profesional (y del
 * centro) ese día? Es la regla que aplica la reserva cuando no hay un `Slot` libre
 * materializado que la respalde.
 */
export function estaDisponible(medico: Pick<Medico, 'disponibilidad'>, horario: HorarioDia[], inicio: Date, fin: Date): boolean {
  const a = enArgentina(inicio);
  const b = enArgentina(new Date(fin.getTime() - 1));
  if (a.dia !== b.dia || fin.getTime() <= inicio.getTime()) {
    return false;
  }
  return franjasDelDia(medico, horario, a.dia).some((f) => hhmmAMin(f.desde) <= a.minutos && b.minutos < hhmmAMin(f.hasta));
}

/**
 * Identifier determinista de un Slot de profesional (`medico@inicio`), para el upsert
 * idempotente. Se usa `@` y no `|` porque el valor viaja dentro de un token de búsqueda
 * (`identifier=sistema|valor`) y un `|` adentro del valor es ambiguo para el servidor.
 */
export function identificadorSlotProfesional(medicoCodigo: string, inicioISO: string): string {
  return `${medicoCodigo}@${inicioISO}`;
}

export type { DisponibilidadSemanal };
