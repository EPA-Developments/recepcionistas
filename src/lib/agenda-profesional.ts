/**
 * Agenda por profesional — lógica pura (sin red).
 *
 * De la disponibilidad semanal de cada profesional (`src/config/medicos.ts`) y del
 * horario del centro salen sus horarios libres: franjas de `SLOT_GRANULARIDAD_MIN`
 * dentro de la **intersección** de las dos cosas. Un turno ocupa las franjas libres
 * que abarca; la teleconsulta no ocupa consultorio (R-21), lo presencial además ocupa
 * el suyo (R-07).
 *
 * Cada franja de la disponibilidad puede ser de una sola modalidad (p. ej. presencial
 * en el consultorio martes y jueves, teleconsulta el resto): los horarios llevan las
 * modalidades en que se pueden reservar (extensión `modalidad` del `Slot`).
 *
 * Zona horaria: Argentina (UTC-3, sin DST), como `src/lib/slots.ts`.
 */
import type { Extension } from '@medplum/fhirtypes';
import { modalidadesDeFranja, type DisponibilidadSemanal, type Medico } from '../config/medicos.js';
import { SLOT_GRANULARIDAD_MIN, type FranjaHoraria, type HorarioDia } from '../config/horario.js';
import type { Modalidad } from '../domain/types.js';
import { EXT } from '../fhir/identifiers.js';
import { OFFSET_ARG, hhmmAMin, minAHHMM, ymd, type OpcionesSlots } from './slots.js';
import { MODALIDADES, extensionModalidad, modalidadDeCoding } from './teleconsulta.js';

const OFFSET_ARG_MS = 3 * 60 * 60 * 1000;

/** Lo que hace falta de un profesional para calcular su agenda. */
export type MedicoAgenda = Pick<Medico, 'disponibilidad' | 'modalidades'>;

/** Franja de un día con las modalidades en que se puede reservar. */
export interface FranjaProfesional extends FranjaHoraria {
  modalidades: Modalidad[];
}

export interface SlotProfesionalDescriptor {
  medicoCodigo: string;
  /** Inicio en ISO con offset de Argentina. */
  inicio: string;
  /** Fin en ISO con offset de Argentina. */
  fin: string;
  estado: 'free';
  /** Modalidades en que se puede reservar esa franja. */
  modalidades: Modalidad[];
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

/** Unión de modalidades, en el orden canónico. */
function unirModalidades(a: Modalidad[], b: Modalidad[]): Modalidad[] {
  return MODALIDADES.filter((m) => a.includes(m) || b.includes(m));
}

/**
 * Franjas en que el profesional atiende un día de la semana: su disponibilidad
 * dentro del horario del centro, cada una con sus modalidades. Con `modalidad`, solo
 * las franjas que la admiten. Vacío si ese día no atiende o el centro cierra.
 */
export function franjasDelDia(medico: MedicoAgenda, horario: HorarioDia[], dia: number, modalidad?: Modalidad): FranjaProfesional[] {
  const centro = horario.find((h) => h.dia === dia);
  if (!centro?.abierto) {
    return [];
  }
  const out: FranjaProfesional[] = [];
  for (const d of medico.disponibilidad) {
    if (d.dia !== dia) {
      continue;
    }
    const modalidades = modalidadesDeFranja(medico, d);
    if (modalidad && !modalidades.includes(modalidad)) {
      continue;
    }
    for (const i of intersectar(aIntervalos([d]), aIntervalos(centro.franjas))) {
      out.push({ desde: minAHHMM(i.desde), hasta: minAHHMM(i.hasta), modalidades });
    }
  }
  return out.sort((p, q) => hhmmAMin(p.desde) - hhmmAMin(q.desde));
}

/**
 * Horarios libres de un profesional para `opts.dias` días desde `opts.desde`, de
 * `granularidadMin` cada uno, dentro de sus franjas de cada día. Si dos franjas se
 * superponen, el horario queda una sola vez con la unión de sus modalidades.
 */
export function generarSlotsProfesional(
  medico: Pick<Medico, 'codigo'> & MedicoAgenda,
  horario: HorarioDia[],
  opts: OpcionesSlots,
): SlotProfesionalDescriptor[] {
  const gran = opts.granularidadMin ?? SLOT_GRANULARIDAD_MIN;
  const base = new Date(Date.UTC(opts.desde.getUTCFullYear(), opts.desde.getUTCMonth(), opts.desde.getUTCDate()));
  const porInicio = new Map<string, SlotProfesionalDescriptor>();
  for (let i = 0; i < opts.dias; i++) {
    const dia = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const fecha = ymd(dia);
    for (const franja of franjasDelDia(medico, horario, dia.getUTCDay())) {
      const desdeMin = hhmmAMin(franja.desde);
      const hastaMin = hhmmAMin(franja.hasta);
      for (let t = desdeMin; t + gran <= hastaMin; t += gran) {
        const inicio = `${fecha}T${minAHHMM(t)}:00${OFFSET_ARG}`;
        const previo = porInicio.get(inicio);
        if (previo) {
          previo.modalidades = unirModalidades(previo.modalidades, franja.modalidades);
          continue;
        }
        porInicio.set(inicio, {
          medicoCodigo: medico.codigo,
          inicio,
          fin: `${fecha}T${minAHHMM(t + gran)}:00${OFFSET_ARG}`,
          estado: 'free',
          modalidades: [...franja.modalidades],
        });
      }
    }
  }
  return [...porInicio.values()];
}

/** Horarios libres de todos los profesionales (para el seed y el cron de agenda). */
export function generarSlotsProfesionales(
  medicos: Array<Pick<Medico, 'codigo'> & MedicoAgenda>,
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
 * Modalidades en que el profesional puede atender el intervalo [inicio, fin): las de
 * las franjas suyas (y del centro) que lo cubren entero ese día. Vacío si no atiende.
 */
export function modalidadesDisponibles(medico: MedicoAgenda, horario: HorarioDia[], inicio: Date, fin: Date): Modalidad[] {
  const a = enArgentina(inicio);
  const b = enArgentina(new Date(fin.getTime() - 1));
  if (a.dia !== b.dia || fin.getTime() <= inicio.getTime()) {
    return [];
  }
  const cubre = (f: FranjaProfesional): boolean => hhmmAMin(f.desde) <= a.minutos && b.minutos < hhmmAMin(f.hasta);
  return MODALIDADES.filter((m) => franjasDelDia(medico, horario, a.dia, m).some(cubre));
}

/**
 * ¿El intervalo [inicio, fin) cae entero dentro de una franja del profesional (y del
 * centro) ese día, en esa modalidad (o en alguna, si no se indica)? Es la regla que
 * aplica la reserva cuando no hay un `Slot` libre materializado que la respalde.
 */
export function estaDisponible(medico: MedicoAgenda, horario: HorarioDia[], inicio: Date, fin: Date, modalidad?: Modalidad): boolean {
  const modalidades = modalidadesDisponibles(medico, horario, inicio, fin);
  return modalidad ? modalidades.includes(modalidad) : modalidades.length > 0;
}

/**
 * Identifier determinista de un Slot de profesional (`medico@inicio`), para el upsert
 * idempotente. Se usa `@` y no `|` porque el valor viaja dentro de un token de búsqueda
 * (`identifier=sistema|valor`) y un `|` adentro del valor es ambiguo para el servidor.
 */
export function identificadorSlotProfesional(medicoCodigo: string, inicioISO: string): string {
  return `${medicoCodigo}@${inicioISO}`;
}

/** Extensiones de una franja de profesional: a quién pertenece y en qué modalidades se reserva. */
export function extensionesSlotProfesional(medicoCodigo: string, modalidades: Modalidad[]): Extension[] {
  return [{ url: EXT.profesional, valueString: medicoCodigo }, ...modalidades.map(extensionModalidad)];
}

/** Modalidades marcadas en una franja (extensión `modalidad`); vacío = sin marca. */
export function modalidadesDeSlot(s: { extension?: Extension[] }): Modalidad[] {
  return (s.extension ?? [])
    .filter((e) => e.url === EXT.modalidad)
    .map((e) => modalidadDeCoding(e.valueCoding))
    .filter((m): m is Modalidad => m !== undefined);
}

/** ¿La franja admite esa modalidad? Una franja sin marca (anterior a R-22) admite todas. */
export function permiteModalidad(s: { extension?: Extension[] }, modalidad: Modalidad): boolean {
  const marcadas = modalidadesDeSlot(s);
  return marcadas.length === 0 || marcadas.includes(modalidad);
}

/** ¿Dos listas de modalidades son la misma (sin importar el orden)? */
export function mismasModalidades(a: Modalidad[], b: Modalidad[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}

export type { DisponibilidadSemanal };
