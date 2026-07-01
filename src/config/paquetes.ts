/**
 * Paquetes de sesiones — Segunda Opinión Médica.
 *
 * El modelo de segunda opinión cardiovascular no define paquetes por ahora. La
 * estructura se mantiene por si más adelante se ofrecen bonos de sesiones; hoy
 * queda vacía. NO se inventan paquetes ni precios.
 */
import type { Paquete } from '../domain/types.js';

export const PAQUETES: Paquete[] = [];

export const PAQUETES_POR_CODIGO: ReadonlyMap<string, Paquete> = new Map(
  PAQUETES.map((p) => [p.codigo, p]),
);

export function getPaquete(codigo: string): Paquete {
  const p = PAQUETES_POR_CODIGO.get(codigo);
  if (!p) {
    throw new Error(`Paquete desconocido: ${codigo}`);
  }
  return p;
}
