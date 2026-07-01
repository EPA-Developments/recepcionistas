/**
 * Catálogo de servicios — Segunda Opinión Médica.
 *
 * Los servicios son las consultas de segunda opinión de cardiología convencional
 * y sus subespecialidades (Hemodinamia, Electrofisiología, Medicina Nuclear,
 * Prevención Cardiovascular, Rehabilitación Cardiovascular).
 *
 * ⚠️ PRECIOS PENDIENTES. La lista de precios/reglas cardiovascular todavía no está
 * definida; por eso todas las consultas quedan con `precioARS: 0` y `nota` de
 * pendiente. NO se inventan precios (principio del repo: la fuente de verdad es la
 * lista oficial). Cargar los valores reales cuando estén disponibles.
 */
import type { CategoriaServicio, Servicio, Split } from '../domain/types.js';

const SOM100: Split = { tipo: 'SOM_100' };

/** Nota estándar mientras no haya lista de precios cardiovascular. */
const PRECIO_PENDIENTE = 'Precio PENDIENTE — cargar desde la lista oficial de Segunda Opinión Médica.';

interface DefConsulta {
  codigo: string;
  nombre: string;
  categoria: CategoriaServicio;
}

/**
 * Consultas de segunda opinión, una por categoría (cardiología + subespecialidades).
 * Duración provisional de 45 min (a confirmar con la operación).
 */
const CONSULTAS: DefConsulta[] = [
  { codigo: 'CARDIOLOGIA', nombre: 'Segunda Opinión — Cardiología', categoria: 'CARDIOLOGIA' },
  { codigo: 'HEMODINAMIA', nombre: 'Segunda Opinión — Hemodinamia', categoria: 'HEMODINAMIA' },
  { codigo: 'ELECTROFISIOLOGIA', nombre: 'Segunda Opinión — Electrofisiología', categoria: 'ELECTROFISIOLOGIA' },
  { codigo: 'MEDICINA_NUCLEAR', nombre: 'Segunda Opinión — Medicina Nuclear', categoria: 'MEDICINA_NUCLEAR' },
  { codigo: 'PREVENCION_CV', nombre: 'Segunda Opinión — Prevención Cardiovascular', categoria: 'PREVENCION_CV' },
  { codigo: 'REHABILITACION_CV', nombre: 'Segunda Opinión — Rehabilitación Cardiovascular', categoria: 'REHABILITACION_CV' },
];

export const SERVICIOS: Servicio[] = CONSULTAS.map((c) => ({
  codigo: c.codigo,
  nombre: c.nombre,
  categoria: c.categoria,
  duracionMin: 45, // provisional — confirmar con la operación
  precioUSD: 0,
  precioARS: 0, // PENDIENTE — se cobra en ARS cuando haya lista de precios
  requierePrescripcion: false,
  reglaPricing: 'POR_SESION',
  split: SOM100,
  fmAplica: false,
  nota: PRECIO_PENDIENTE,
}));

/** Índice por código para lookups O(1). */
export const SERVICIOS_POR_CODIGO: ReadonlyMap<string, Servicio> = new Map(
  SERVICIOS.map((s) => [s.codigo, s]),
);

export function getServicio(codigo: string): Servicio {
  const s = SERVICIOS_POR_CODIGO.get(codigo);
  if (!s) {
    throw new Error(`Servicio desconocido: ${codigo}`);
  }
  return s;
}
