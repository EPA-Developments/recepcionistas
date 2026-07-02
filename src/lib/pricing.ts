/**
 * Motor de precios (R-17).
 *
 * Principio rector: "Las Recepcionistas nunca calculan ni deciden nada que el
 * sistema pueda calcular o decidir por ellas." Acá vive todo ese cálculo.
 *
 * Funciones puras (sin FHIR ni IO) para poder testearlas de punta a punta.
 */
import type { Moneda, Servicio } from '../domain/types.js';
import { getServicio } from '../config/catalogo.js';
import { resolverTC } from '../config/tipo-cambio.js';
import { redondearUSD, usdAArs } from './money.js';

export interface DistribucionSplit {
  somUSD: number;
}

/** Precio de una sesión suelta en USD (las consultas con `precioARS` no pasan por acá). */
export function precioSueltoUSD(servicio: Servicio, opts: { ocupantes?: number } = {}): number {
  const ocupantes = opts.ocupantes ?? 1;
  return redondearUSD(servicio.precioUSD * ocupantes);
}

/** Distribución de ingresos (split) de un monto cobrado: hoy todo es SOM_100. */
export function calcularSplit(_servicio: Servicio, montoUSD: number): DistribucionSplit {
  return { somUSD: redondearUSD(montoUSD) };
}

export type TipoItemCobro = 'servicio';

export interface ItemCobro {
  tipo: TipoItemCobro;
  codigo: string;
  /** Para servicios: cantidad de personas. */
  ocupantes?: number;
  /** Cantidad de unidades del ítem (default 1). */
  cantidad?: number;
}

export interface LineaCobro {
  tipo: TipoItemCobro;
  codigo: string;
  descripcion: string;
  cantidad: number;
  /** Moneda de lista de la línea: USD (se convierte) o ARS (consultas, precio fijo). */
  moneda: Moneda;
  precioUnitarioUSD: number;
  subtotalUSD: number;
  /** Subtotal de la línea en ARS (lo que efectivamente se cobra). */
  subtotalARS: number;
  split: DistribucionSplit;
}

export interface ResultadoCobro {
  lineas: LineaCobro[];
  /** Total en USD de las líneas en USD (informativo). */
  totalUSD: number;
  /** Total a cobrar en ARS (todas las líneas). */
  totalARS: number;
  tcAplicado: number;
}

/** Construye una línea de cobro, manejando moneda (USD se convierte; ARS es fijo). */
function construirLinea(item: ItemCobro, tc?: number): LineaCobro {
  const cantidad = item.cantidad ?? 1;
  const s = getServicio(item.codigo);

  // Consultas: precio fijo en ARS (no se convierte).
  if (s.precioARS != null) {
    return {
      tipo: 'servicio',
      codigo: item.codigo,
      descripcion: s.nombre,
      cantidad,
      moneda: 'ARS',
      precioUnitarioUSD: 0,
      subtotalUSD: 0,
      subtotalARS: Math.round(s.precioARS * cantidad),
      split: { somUSD: 0 },
    };
  }

  const precio = precioSueltoUSD(s, { ocupantes: item.ocupantes ?? 1 });
  const subtotalUSD = redondearUSD(precio * cantidad);
  return {
    tipo: 'servicio',
    codigo: item.codigo,
    descripcion: s.nombre,
    cantidad,
    moneda: 'USD',
    precioUnitarioUSD: precio,
    subtotalUSD,
    subtotalARS: usdAArs(subtotalUSD, tc),
    split: calcularSplit(s, subtotalUSD),
  };
}

/**
 * Calcula el cobro completo de una lista de ítems. La recepción solo elige el
 * medio de pago: el sistema calcula montos, splits y conversión a ARS.
 */
export function calcularCobro(items: ItemCobro[], opts: { tc?: number } = {}): ResultadoCobro {
  const lineas = items.map((item) => construirLinea(item, opts.tc));
  const totalUSD = redondearUSD(lineas.reduce((acc, l) => acc + l.subtotalUSD, 0));
  const totalARS = lineas.reduce((acc, l) => acc + l.subtotalARS, 0);
  return {
    lineas,
    totalUSD,
    totalARS,
    tcAplicado: resolverTC(opts.tc),
  };
}

/** Fracción de seña por defecto (50%) para confirmar un turno. */
export const FRACCION_SENA = 0.5;

/** Total a cobrar y seña (50%) de una reserva, en ARS. */
export function calcularSenaARS(
  items: ItemCobro[],
  opts: { tc?: number; fraccion?: number } = {},
): { totalARS: number; senaARS: number } {
  const { totalARS } = calcularCobro(items, { tc: opts.tc });
  return { totalARS, senaARS: Math.round(totalARS * (opts.fraccion ?? FRACCION_SENA)) };
}
