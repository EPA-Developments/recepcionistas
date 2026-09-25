/**
 * Recursos agendables — Segunda Opinión Médica.
 *
 * Consultorios y salas donde se atienden las consultas presenciales, y la agenda
 * virtual de las teleconsultas (R-21: la teleconsulta no ocupa consultorio). La lista
 * es PROVISIONAL (a confirmar con la operación real): se modela un conjunto mínimo
 * para que la agenda funcione.
 *
 * La agenda virtual (`R_TELEMEDICINA`, capacidad 1) es transitoria: cuando se carguen
 * los profesionales de SOM, la teleconsulta ocupa solo la agenda de su profesional.
 */
import type { CategoriaServicio, Modalidad, RecursoFisico, Servicio, TipoRecurso } from '../domain/types.js';

export const RECURSOS: RecursoFisico[] = [
  { codigo: 'R_CONSULTORIO_1', nombre: 'Consultorio 1', tipo: 'CONSULTORIO', capacidad: 1, provisional: true },
  { codigo: 'R_CONSULTORIO_2', nombre: 'Consultorio 2', tipo: 'CONSULTORIO', capacidad: 1, provisional: true },
  {
    codigo: 'R_TELEMEDICINA',
    nombre: 'Teleconsulta (videollamada)',
    tipo: 'VIRTUAL',
    capacidad: 1,
    provisional: true,
    nota: 'Transitoria: una teleconsulta a la vez hasta tener las agendas por profesional.',
  },
  { codigo: 'R_SALA_REHAB', nombre: 'Sala de Rehabilitación Cardiovascular', tipo: 'SALA', capacidad: 6, provisional: true },
];

export const RECURSOS_POR_CODIGO: ReadonlyMap<string, RecursoFisico> = new Map(
  RECURSOS.map((r) => [r.codigo, r]),
);

/** Tipo de recurso físico donde se ejecuta cada categoría de servicio presencial. */
const CATEGORIA_A_TIPO: Record<CategoriaServicio, TipoRecurso> = {
  CARDIOLOGIA: 'CONSULTORIO',
  INSUFICIENCIA_CARDIACA: 'CONSULTORIO',
  HEMODINAMIA: 'CONSULTORIO',
  ELECTROFISIOLOGIA: 'CONSULTORIO',
  MEDICINA_NUCLEAR: 'CONSULTORIO',
  PREVENCION_CV: 'CONSULTORIO',
  REHABILITACION_CV: 'SALA',
  DIABETOLOGIA_ENDOCRINOLOGIA: 'CONSULTORIO',
  NUTRICION: 'CONSULTORIO',
  TISIONEUMONOLOGIA: 'CONSULTORIO',
  NEUROLOGIA: 'CONSULTORIO',
  GINECOLOGIA: 'CONSULTORIO',
  PLAN_BIENESTAR: 'CONSULTORIO',
  SEGUIMIENTO_GLP1: 'CONSULTORIO',
};

/** Recursos físicos (presenciales) donde se puede agendar un servicio de la categoría dada. */
export function recursosParaCategoria(categoria: CategoriaServicio): RecursoFisico[] {
  const tipo = CATEGORIA_A_TIPO[categoria];
  return RECURSOS.filter((r) => r.tipo === tipo);
}

/**
 * Dónde se agenda un servicio en una modalidad: presencial, en su consultorio o sala;
 * teleconsulta, en la agenda virtual. Vacío si el servicio no se ofrece así (R-21).
 */
export function recursosPara(servicio: Pick<Servicio, 'categoria' | 'modalidades'>, modalidad: Modalidad): RecursoFisico[] {
  if (!servicio.modalidades.includes(modalidad)) {
    return [];
  }
  return modalidad === 'teleconsulta' ? RECURSOS.filter((r) => r.tipo === 'VIRTUAL') : recursosParaCategoria(servicio.categoria);
}

/** Modalidad que implica agendar en un recurso: la agenda virtual es teleconsulta. */
export function modalidadDeRecurso(recurso: Pick<RecursoFisico, 'tipo'>): Modalidad {
  return recurso.tipo === 'VIRTUAL' ? 'teleconsulta' : 'presencial';
}
