/**
 * Plan Bienestar 100 Días® — marca registrada del Dr. Alejandro Sergio D'Alessandro.
 *
 * Interacción prefijada del plan, definida por el Dr. D'Alessandro con el Dr.
 * Alejandro Barbagelata:
 *  - Tres consultas programadas: la inicial (día 1), la del día 50 y la final (día
 *    100). Están incluidas en el plan: no se cobran aparte ni llevan seña. Hoy las
 *    atienden el Dr. Barbagelata, la Dra. Gold y el Dr. D'Alessandro.
 *  - El día 1 del plan es el de la consulta inicial: el sistema calcula las otras dos
 *    fechas desde ahí (R-20) y las recalcula si la inicial se mueve.
 *  - La del día 50 y la final se agendan dentro de ± `TOLERANCIA_CONSULTA_PB100D_DIAS`.
 *  - Cada consulta puede ser presencial o por teleconsulta (R-21).
 *  - Las consultas fuera de lo programado son las de especialidad del catálogo: con
 *    cargo y sin límite de cantidad.
 *
 * El código `plan-bienestar-100` (category del CarePlan) es el contrato con el portal:
 * no cambia aunque cambie el nombre visible.
 */
export const NOMBRE_PLAN_BIENESTAR = 'Plan Bienestar 100 Días®';

export type ClaveConsultaPlan = 'inicial' | 'mitad' | 'final';

export interface DefConsultaPlan {
  clave: ClaveConsultaPlan;
  /** Día del plan (el día 1 es el de la consulta inicial). */
  dia: number;
  titulo: string;
}

/** Consultas programadas del plan, en orden. */
export const CONSULTAS_PLAN_BIENESTAR: readonly DefConsultaPlan[] = [
  { clave: 'inicial', dia: 1, titulo: 'Consulta inicial' },
  { clave: 'mitad', dia: 50, titulo: 'Consulta del día 50' },
  { clave: 'final', dia: 100, titulo: 'Consulta final' },
];
