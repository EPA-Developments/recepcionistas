/**
 * Combos — Segunda Opinión Médica.
 *
 * El modelo de segunda opinión cardiovascular no define combos (paquetes de
 * servicios encadenados) por ahora. La estructura se mantiene por si más adelante
 * se ofrecen combinaciones de consultas/estudios; hoy queda vacía. NO se inventan
 * combos ni precios.
 */
import type { Combo } from '../domain/types.js';

export const COMBOS: Combo[] = [];

export const COMBOS_POR_CODIGO: ReadonlyMap<string, Combo> = new Map(COMBOS.map((c) => [c.codigo, c]));

export function getCombo(codigo: string): Combo {
  const c = COMBOS_POR_CODIGO.get(codigo);
  if (!c) {
    throw new Error(`Combo desconocido: ${codigo}`);
  }
  return c;
}
