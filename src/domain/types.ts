/**
 * Tipos de dominio de Segunda Opinión Médica Recepción (Bloque 0).
 *
 * Describen el catálogo (consultas por especialidad y las consultas del Plan
 * Bienestar 100 Días®) y los recursos donde se agendan. El catálogo anterior
 * (servicios/combos/membresías/paquetes/contraindicaciones, ajeno a SOM) se
 * retiró del dominio — ver docs/decisiones-pendientes.md.
 * Son agnósticos de FHIR: el seed los traduce a recursos FHIR.
 */

export type Moneda = 'USD' | 'ARS';

/**
 * Modalidad de atención (R-21). Es un atributo del turno, no un servicio aparte:
 * la misma consulta se da en el consultorio o por videollamada.
 */
export type Modalidad = 'presencial' | 'teleconsulta';

/**
 * Categorías de servicio de Segunda Opinión Médica: cardiología y sus
 * subespecialidades, las demás especialidades del Plan Bienestar 100 Días® y los
 * programas de seguimiento. Definen dónde se agenda cada servicio presencial.
 */
export type CategoriaServicio =
  | 'CARDIOLOGIA'
  | 'INSUFICIENCIA_CARDIACA'
  | 'HEMODINAMIA'
  | 'ELECTROFISIOLOGIA'
  | 'MEDICINA_NUCLEAR'
  | 'PREVENCION_CV'
  | 'REHABILITACION_CV'
  | 'DIABETOLOGIA_ENDOCRINOLOGIA'
  | 'NUTRICION'
  | 'TISIONEUMONOLOGIA'
  | 'NEUROLOGIA'
  | 'GINECOLOGIA'
  | 'PLAN_BIENESTAR'
  | 'SEGUIMIENTO_GLP1';

/** Especialidad codificada (SNOMED CT, value set FHIR `c80-practice-codes`). */
export interface Especialidad {
  /** Código SNOMED CT; ausente si la especialidad no tiene código en ese value set. */
  snomed?: string;
  /** Nombre en inglés del concepto SNOMED (display). */
  snomedDisplay?: string;
  /** Nombre en español que ve el paciente. */
  nombre: string;
}

/**
 * Distribución de ingresos (split) por servicio.
 * Las consultas de Segunda Opinión Médica quedan 100% para el centro (SOM_100).
 * El esquema de honorarios profesionales queda PENDIENTE de definir.
 */
export type Split = { tipo: 'SOM_100' };

/** Regla de cálculo de precio del servicio. Las consultas se cobran por sesión. */
export type ReglaPricingRecurso = 'POR_SESION';

export interface Servicio {
  /** Código de negocio estable (p. ej. "CARDIOLOGIA"). */
  codigo: string;
  /** Nombre de la consulta presencial (p. ej. "Consulta de Cardiología"). */
  nombre: string;
  categoria: CategoriaServicio;
  /** Modalidades en que se ofrece (R-21). */
  modalidades: Modalidad[];
  /** Especialidad (para `ActivityDefinition.topic` y `Appointment.specialty`). */
  especialidad?: Especialidad;
  /** Grupo en que la muestra el portal (ver `GRUPOS_ESPECIALIDAD`). */
  grupo?: string;
  /** Incluida en un programa (Plan Bienestar 100 Días®): no se cobra aparte ni lleva seña. */
  incluidaEnPlan?: boolean;
  /** Se agenda solo desde la tarea de su programa (R-19 GLP-1, R-20 Plan Bienestar). */
  soloDesdeTarea?: boolean;
  /** Duración nominal de la sesión, en minutos. */
  duracionMin: number;
  /** Precio de lista en USD (por sesión). 0 si el precio es en ARS. */
  precioUSD: number;
  /** Precio fijo en ARS. Si está, el servicio se cobra en pesos sin convertir. */
  precioARS?: number;
  /**
   * Valor de referencia interno en ARS de una consulta incluida en un programa (lo que
   * el programa presupuesta por ella). Informativo: no se cobra ni lleva seña.
   */
  valorReferenciaARS?: number;
  /** Para consultas: código del médico que atiende (ver src/config/medicos.ts). */
  practitionerCodigo?: string;
  /** Regla de cálculo de precio. */
  reglaPricing: ReglaPricingRecurso;
  /** Distribución de ingresos. */
  split: Split;
  /** Notas / fuente. */
  nota?: string;
}

/**
 * Tipo de recurso agendable. `VIRTUAL` es la agenda de las teleconsultas (no ocupa
 * consultorio).
 */
export type TipoRecurso = 'CONSULTORIO' | 'SALA' | 'VIRTUAL';

export interface RecursoFisico {
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  /** Capacidad máxima de personas en simultáneo. */
  capacidad: number;
  /** Provisional hasta confirmación de la operación real. */
  provisional?: boolean;
  nota?: string;
}
