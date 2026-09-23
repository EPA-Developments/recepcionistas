/**
 * Recursos físicos agendables — Segunda Opinión Médica.
 *
 * Consultorios y salas donde se atienden las consultas de segunda opinión. La
 * lista es PROVISIONAL (a confirmar con la operación real): se modela un conjunto
 * mínimo para que la agenda funcione.
 */
import type { CategoriaServicio, RecursoFisico, TipoRecurso } from '../domain/types.js';

export const RECURSOS: RecursoFisico[] = [
  { codigo: 'R_CONSULTORIO_1', nombre: 'Consultorio Cardiología 1', tipo: 'CONSULTORIO', capacidad: 1, provisional: true },
  { codigo: 'R_CONSULTORIO_2', nombre: 'Consultorio Cardiología 2', tipo: 'CONSULTORIO', capacidad: 1, provisional: true },
  { codigo: 'R_TELEMEDICINA', nombre: 'Consultorio Telemedicina', tipo: 'CONSULTORIO', capacidad: 1, provisional: true },
  { codigo: 'R_SALA_REHAB', nombre: 'Sala de Rehabilitación Cardiovascular', tipo: 'SALA', capacidad: 6, provisional: true },
];

export const RECURSOS_POR_CODIGO: ReadonlyMap<string, RecursoFisico> = new Map(
  RECURSOS.map((r) => [r.codigo, r]),
);

/** Tipo de recurso físico donde se ejecuta cada categoría de servicio. */
const CATEGORIA_A_TIPO: Record<CategoriaServicio, TipoRecurso> = {
  CARDIOLOGIA: 'CONSULTORIO',
  HEMODINAMIA: 'CONSULTORIO',
  ELECTROFISIOLOGIA: 'CONSULTORIO',
  MEDICINA_NUCLEAR: 'CONSULTORIO',
  PREVENCION_CV: 'CONSULTORIO',
  REHABILITACION_CV: 'SALA',
  SEGUIMIENTO_GLP1: 'CONSULTORIO',
};

/** Recursos físicos donde se puede agendar un servicio de la categoría dada. */
export function recursosParaCategoria(categoria: CategoriaServicio): RecursoFisico[] {
  const tipo = CATEGORIA_A_TIPO[categoria];
  return RECURSOS.filter((r) => r.tipo === tipo);
}
