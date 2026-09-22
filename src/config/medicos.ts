/**
 * Profesionales de Segunda Opinión Médica.
 *
 * ⚠️ PENDIENTE: el catálogo se arma de cero con los profesionales de SOM. La lista
 * queda vacía hasta cargarlos (no se inventan profesionales ni honorarios). Cada
 * profesional se siembra como `Practitioner` (identifier `SYSTEM.medico`).
 */
export interface Medico {
  codigo: string;
  nombre: string;
  /** Director Médico (honorario fijo mensual, sin split por consulta). */
  esDirector: boolean;
  /** Precio de la consulta en ARS (pesos). */
  precioConsultaARS: number;
  /** Marca de precio provisorio (pendiente de confirmar). */
  precioProvisorio?: boolean;
}

export const MEDICOS: Medico[] = [];

export const MEDICOS_POR_CODIGO: ReadonlyMap<string, Medico> = new Map(MEDICOS.map((m) => [m.codigo, m]));

/** Código de servicio de consulta para un médico (p. ej. CONSULTA_MED_PEREZ). */
export function codigoConsulta(medicoCodigo: string): string {
  return `CONSULTA_${medicoCodigo}`;
}
