/**
 * Profesionales de Segunda Opinión Médica y su agenda.
 *
 * Cada profesional se siembra como `Practitioner` (identifier `SYSTEM.medico`) más un
 * `PractitionerRole` (especialidad SNOMED, modalidades, si hace el seguimiento del Plan
 * Bienestar 100 Días®, consultorio) y un `Schedule` propio: **la agenda es por
 * profesional**. Los horarios libres (`Slot`) se generan solos desde su
 * `disponibilidad` semanal, dentro del horario del centro (`src/lib/agenda-profesional.ts`).
 *
 * Precio: el de la consulta del catálogo (R-17), igual para todos los profesionales;
 * acá no hay honorarios.
 *
 * Cargados (26/09/2026) los tres profesionales que hoy atienden las consultas del Plan
 * Bienestar: nombre, matrícula, especialidad, disponibilidad semanal y consultorio. Cada
 * franja puede ser de una sola modalidad (`modalidad`): la Dra. Gold y el Dr. D'Alessandro
 * atienden presencial martes y jueves de 9 a 12 y teleconsulta en el resto de sus horarios.
 * No se inventan datos: un profesional sin `disponibilidad` no genera horarios y no es
 * reservable; sin `consultorioCodigo`, lo presencial exige que Recepción elija el
 * consultorio al reservar (R-22). Los DNI no van en el código.
 */
import type { Especialidad, Modalidad } from '../domain/types.js';
import { CODIGO_CONSULTA_PB100D } from './catalogo.js';

/**
 * Franja semanal en que atiende (hora de Argentina). `dia`: 0=domingo … 6=sábado
 * (`Date.getDay()`), como `HORARIO_SEMANAL`.
 */
export interface DisponibilidadSemanal {
  dia: number;
  /** "HH:mm" (24 h). */
  desde: string;
  /** "HH:mm" (24 h). */
  hasta: string;
  /** Si la franja es de una sola modalidad; si falta, vale para todas las del profesional. */
  modalidad?: Modalidad;
}

export interface Medico {
  /** Código de negocio estable (p. ej. "MED_BARBAGELATA"). */
  codigo: string;
  /** Nombre visible, con su tratamiento (p. ej. "Dr. Alejandro Barbagelata"). */
  nombre: string;
  /** Matrícula nacional (p. ej. "MN 123456"). */
  matricula?: string;
  /** Matrícula provincial, si además la tiene (p. ej. "MP 446172 (Distrito IV)"). */
  matriculaProvincial?: string;
  /** Director Médico (honorario fijo mensual, sin split por consulta). */
  esDirector: boolean;
  /** Especialidad principal (SNOMED CT `c80-practice-codes` si tiene código). */
  especialidad: Especialidad;
  /** Consultas del catálogo que atiende (códigos de `SERVICIOS`). */
  servicios: string[];
  /** Modalidades en que atiende (R-21). */
  modalidades: Modalidad[];
  /** Atiende las tres consultas programadas del Plan Bienestar 100 Días® (días 1, 50 y 100). */
  seguimientoPB100D?: boolean;
  /** Disponibilidad semanal; de acá salen sus horarios libres. */
  disponibilidad: DisponibilidadSemanal[];
  /** Consultorio donde atiende lo presencial (código de `RECURSOS`). */
  consultorioCodigo?: string;
  /** Marca de datos provisorios (pendientes de confirmar). */
  provisional?: boolean;
}

const AMBAS: Modalidad[] = ['presencial', 'teleconsulta'];

export const MEDICOS: Medico[] = [
  {
    codigo: 'MED_BARBAGELATA',
    nombre: 'Dr. Alejandro Barbagelata',
    matricula: 'MN 64737',
    matriculaProvincial: 'MP 446172 (Distrito IV)',
    esDirector: false,
    especialidad: { snomed: '394579002', snomedDisplay: 'Cardiology', nombre: 'Cardiología' },
    servicios: ['CARDIOLOGIA', CODIGO_CONSULTA_PB100D],
    modalidades: AMBAS,
    seguimientoPB100D: true,
    disponibilidad: [
      { dia: 2, desde: '14:00', hasta: '18:00' }, // martes
      { dia: 4, desde: '14:00', hasta: '18:00' }, // jueves
    ],
    consultorioCodigo: 'R_CONSULTORIO_1',
  },
  {
    codigo: 'MED_GOLD',
    nombre: 'Dra. Mariana Andrea Gold',
    matricula: 'Matrícula 105459 (CABA)',
    esDirector: false,
    especialidad: { snomed: '394802001', snomedDisplay: 'General medicine', nombre: 'Clínica Médica' },
    servicios: [CODIGO_CONSULTA_PB100D],
    modalidades: AMBAS,
    seguimientoPB100D: true,
    disponibilidad: [
      { dia: 2, desde: '09:00', hasta: '12:00', modalidad: 'presencial' }, // martes, Consultorio 1
      { dia: 3, desde: '08:00', hasta: '12:00', modalidad: 'teleconsulta' }, // miércoles
      { dia: 4, desde: '09:00', hasta: '12:00', modalidad: 'presencial' }, // jueves, Consultorio 1
      { dia: 5, desde: '08:00', hasta: '12:00', modalidad: 'teleconsulta' }, // viernes
    ],
    consultorioCodigo: 'R_CONSULTORIO_1',
  },
  {
    codigo: 'MED_DALESSANDRO',
    nombre: "Dr. Alejandro Sergio D'Alessandro",
    matricula: 'MN 91279',
    esDirector: false,
    especialidad: { snomed: '394579002', snomedDisplay: 'Cardiology', nombre: 'Cardiología' },
    servicios: ['CARDIOLOGIA', CODIGO_CONSULTA_PB100D],
    modalidades: AMBAS,
    seguimientoPB100D: true,
    disponibilidad: [
      { dia: 1, desde: '16:00', hasta: '20:00', modalidad: 'teleconsulta' }, // lunes
      { dia: 2, desde: '09:00', hasta: '12:00', modalidad: 'presencial' }, // martes, Consultorio 2
      { dia: 3, desde: '16:00', hasta: '20:00', modalidad: 'teleconsulta' }, // miércoles
      { dia: 4, desde: '09:00', hasta: '12:00', modalidad: 'presencial' }, // jueves, Consultorio 2
      { dia: 5, desde: '16:00', hasta: '20:00', modalidad: 'teleconsulta' }, // viernes
    ],
    consultorioCodigo: 'R_CONSULTORIO_2',
  },
];

/** Modalidades en que vale una franja: la suya si es de una sola, si no todas las del profesional. */
export function modalidadesDeFranja(m: Pick<Medico, 'modalidades'>, d: Pick<DisponibilidadSemanal, 'modalidad'>): Modalidad[] {
  return d.modalidad ? [d.modalidad] : m.modalidades;
}

export const MEDICOS_POR_CODIGO: ReadonlyMap<string, Medico> = new Map(MEDICOS.map((m) => [m.codigo, m]));

export function getMedico(codigo: string): Medico | undefined {
  return MEDICOS_POR_CODIGO.get(codigo);
}

/** ¿El profesional atiende esa consulta en esa modalidad? */
export function medicoAtiende(m: Pick<Medico, 'servicios' | 'modalidades'>, servicioCodigo: string, modalidad: Modalidad): boolean {
  return m.servicios.includes(servicioCodigo) && m.modalidades.includes(modalidad);
}

/** Profesionales que atienden una consulta en una modalidad, en el orden de la lista. */
export function medicosPara(servicioCodigo: string, modalidad: Modalidad): Medico[] {
  return MEDICOS.filter((m) => medicoAtiende(m, servicioCodigo, modalidad));
}

/** Profesionales que hacen el seguimiento del Plan Bienestar 100 Días®. */
export function medicosSeguimientoPB100D(): Medico[] {
  return MEDICOS.filter((m) => m.seguimientoPB100D);
}
