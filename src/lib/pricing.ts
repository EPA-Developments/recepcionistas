/**
 * Motor de precios (Documento de Requerimientos §6.4, reglas R-04..R-08, R-15..R-17).
 *
 * Principio rector: "Las Recepcionistas nunca calculan ni deciden nada que el
 * sistema pueda calcular o decidir por ellas." Acá vive todo ese cálculo.
 *
 * Funciones puras (sin FHIR ni IO) para poder testearlas de punta a punta.
 */
import type { Moneda, Servicio, Split } from '../domain/types.js';
import { getServicio } from '../config/catalogo.js';
import { getCombo } from '../config/combos.js';
import { getMembresia } from '../config/membresias.js';
import { getPaquete } from '../config/paquetes.js';
import { CASCADA_TB } from '../config/reglas.js';
import { resolverTC } from '../config/tipo-cambio.js';
import { redondearUSD, usdAArs } from './money.js';

export interface DistribucionSplit {
  somUSD: number;
  prescriptoresUSD?: number;
  terapeutaUSD?: number;
  proveedorUSD?: number;
  /** True si el neto de SOM quedó por debajo del piso de margen (R-08). */
  bajoMargenMinimo?: boolean;
}

/**
 * Precio de una sesión suelta en USD, aplicando la regla de pricing del recurso.
 * @param ocupantes cantidad de personas (HBOT biplaza/multiplaza, parejas).
 * @param fm aplica el 20% OFF de Founding Member (solo sueltas, si el servicio lo permite).
 */
export function precioSueltoUSD(
  servicio: Servicio,
  opts: { ocupantes?: number; fm?: boolean } = {},
): number {
  const ocupantes = opts.ocupantes ?? 1;
  let base: number;

  switch (servicio.reglaPricing) {
    case 'HBOT_MONO':
      base = servicio.precioUSD;
      break;
    case 'HBOT_BIPLAZA':
      // 2 personas => 100 c/u (200 total); 1 sola => precio monoplaza (165).
      base = ocupantes >= 2 ? servicio.precioUSD * ocupantes : 165;
      break;
    case 'HBOT_MULTIPLAZA':
      // USD 80/persona, mínimo 3.
      base = servicio.precioUSD * Math.max(ocupantes, 3);
      break;
    case 'RECOVERY_PRO_INDIVISIBLE':
      // USD 200 por gabinete, 1 o 2 personas. Indivisible.
      base = servicio.precioUSD;
      break;
    case 'POR_SESION':
    case 'CASCADA_TB':
      base = servicio.precioUSD * ocupantes;
      break;
    default:
      base = servicio.precioUSD * ocupantes;
  }

  // FM: 20% OFF en sueltas, solo si el servicio lo permite (no IV/TB ni combos/membresías).
  if (opts.fm && servicio.fmAplica) {
    base = base * (1 - 0.2);
  }
  return redondearUSD(base);
}

/**
 * Cascada de pricing para IV Therapy + Terapias Biológicas (R-08):
 * neto SOM = (precio − 25% costo fiscal − insumo Regenerar − USD 15 enfermería) × 85%.
 * El 15% restante es honorario de los médicos prescriptores. Piso: 25% de margen neto.
 *
 * @param precioUSD precio de lista que paga el cliente.
 * @param insumoUSD costo del insumo (lista Regenerar, sin IVA). Requerido para el neto real.
 */
export function cascadaTB(precioUSD: number, insumoUSD: number): DistribucionSplit {
  const baseImponible = precioUSD * (1 - CASCADA_TB.costoFiscal) - insumoUSD - CASCADA_TB.enfermeriaUSD;
  const somUSD = redondearUSD(baseImponible * CASCADA_TB.factorSom);
  const prescriptoresUSD = redondearUSD(baseImponible * CASCADA_TB.honorarioMedicos);
  const pisoMinimo = precioUSD * CASCADA_TB.margenNetoMin;
  return {
    somUSD,
    prescriptoresUSD,
    bajoMargenMinimo: somUSD < pisoMinimo,
  };
}

/**
 * Distribución de ingresos (split) de un monto cobrado, según el servicio (R-08).
 * Para IV/TB usa la cascada (requiere costo de insumo).
 */
export function calcularSplit(
  servicio: Servicio,
  montoUSD: number,
  opts: { insumoUSD?: number } = {},
): DistribucionSplit {
  const split: Split = servicio.split;
  switch (split.tipo) {
    case 'SOM_100':
      return { somUSD: redondearUSD(montoUSD) };
    case 'IV_TB_85_15':
      return cascadaTB(montoUSD, opts.insumoUSD ?? 0);
    case 'MASAJE_50_50':
      return {
        somUSD: redondearUSD(montoUSD * 0.5),
        terapeutaUSD: redondearUSD(montoUSD * 0.5),
      };
    case 'FOODBAR_75_25':
      return {
        somUSD: redondearUSD(montoUSD * 0.75),
        proveedorUSD: redondearUSD(montoUSD * 0.25),
      };
  }
}

export type TipoItemCobro = 'servicio' | 'combo' | 'membresia' | 'paquete';

export interface ItemCobro {
  tipo: TipoItemCobro;
  codigo: string;
  /** Para servicios: cantidad de personas. */
  ocupantes?: number;
  /** Para servicios sueltos: aplica FM. */
  fm?: boolean;
  /** Para IV/TB: costo de insumo (USD). */
  insumoUSD?: number;
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

  if (item.tipo === 'servicio') {
    const s = getServicio(item.codigo);
    // Consultas u otros servicios con precio fijo en ARS (no se convierte).
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
    const precio = precioSueltoUSD(s, { ocupantes: item.ocupantes ?? 1, fm: item.fm ?? false });
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
      split: calcularSplit(s, subtotalUSD, { insumoUSD: item.insumoUSD }),
    };
  }

  // Combos / membresías / paquetes: siempre en USD.
  let precio: number;
  let descripcion: string;
  if (item.tipo === 'combo') {
    const c = getCombo(item.codigo);
    precio = c.precioUSD;
    descripcion = c.nombre;
  } else if (item.tipo === 'membresia') {
    const m = getMembresia(item.codigo);
    precio = m.precioMesUSD;
    descripcion = `Membresía ${m.tier} ${m.intensidad} ${m.variante}`;
  } else {
    const p = getPaquete(item.codigo);
    precio = item.fm ? p.totalFMUSD : p.totalUSD;
    descripcion = `Paquete ${p.codigo}`;
  }
  const subtotalUSD = redondearUSD(precio * cantidad);
  return {
    tipo: item.tipo,
    codigo: item.codigo,
    descripcion,
    cantidad,
    moneda: 'USD',
    precioUnitarioUSD: precio,
    subtotalUSD,
    subtotalARS: usdAArs(subtotalUSD, tc),
    split: { somUSD: subtotalUSD },
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
