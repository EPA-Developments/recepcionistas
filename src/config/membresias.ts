/**
 * Membresías — Segunda Opinión Médica.
 *
 * El modelo de segunda opinión cardiovascular no define membresías por ahora. La
 * estructura se mantiene por si más adelante se ofrecen planes; hoy queda vacía.
 * NO se inventan planes ni precios.
 */
import type { Membresia } from '../domain/types.js';

export const MEMBRESIAS: Membresia[] = [];

export const MEMBRESIAS_POR_CODIGO: ReadonlyMap<string, Membresia> = new Map(
  MEMBRESIAS.map((m) => [m.codigo, m]),
);

export function getMembresia(codigo: string): Membresia {
  const m = MEMBRESIAS_POR_CODIGO.get(codigo);
  if (!m) {
    throw new Error(`Membresía desconocida: ${codigo}`);
  }
  return m;
}
