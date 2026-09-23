/**
 * Tipos de dominio de Segunda Opinión Médica Recepción (Bloque 0).
 *
 * Describen el catálogo (consultas de segunda opinión de cardiología y
 * subespecialidades) y los recursos físicos donde se agendan. El catálogo anterior
 * (servicios/combos/membresías/paquetes/contraindicaciones, ajeno a SOM) se
 * retiró del dominio — ver docs/decisiones-pendientes.md.
 * Son agnósticos de FHIR: el seed los traduce a recursos FHIR.
 */

export type Moneda = 'USD' | 'ARS';

/**
 * Categorías de servicio de Segunda Opinión Médica: cardiología convencional y
 * sus subespecialidades. Definen dónde se agenda cada servicio.
 */
export type CategoriaServicio =
  | 'CARDIOLOGIA'
  | 'HEMODINAMIA'
  | 'ELECTROFISIOLOGIA'
  | 'MEDICINA_NUCLEAR'
  | 'PREVENCION_CV'
  | 'REHABILITACION_CV'
  | 'SEGUIMIENTO_GLP1';

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
  nombre: string;
  categoria: CategoriaServicio;
  /** Duración nominal de la sesión, en minutos. */
  duracionMin: number;
  /** Precio de lista en USD (por sesión). 0 si el precio es en ARS. */
  precioUSD: number;
  /** Precio fijo en ARS. Si está, el servicio se cobra en pesos sin convertir. */
  precioARS?: number;
  /** Para consultas: código del médico que atiende (ver src/config/medicos.ts). */
  practitionerCodigo?: string;
  /** Regla de cálculo de precio. */
  reglaPricing: ReglaPricingRecurso;
  /** Distribución de ingresos. */
  split: Split;
  /** Notas / fuente. */
  nota?: string;
}

/** Tipo de recurso físico agendable. */
export type TipoRecurso = 'CONSULTORIO' | 'SALA';

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
