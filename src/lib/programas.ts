/**
 * Programas de seguimiento (GLP-1, Plan Bienestar 100 Días®) — piezas comunes
 * (lógica pura, sin FHIR de red).
 *
 * Ventanas para agendar, fechas de calendario en Argentina y la sincronización de los
 * recursos de un programa: crear lo nuevo, actualizar lo pendiente, cancelar lo que ya
 * no va y NUNCA pisar lo ya resuelto. Las usan `glp1-plan.ts` y `plan-bienestar.ts`.
 */
import type { Task } from '@medplum/fhirtypes';
import { TZ } from '../config/horario.js';
import { SYSTEM } from '../fhir/identifiers.js';

const DIA_MS = 86_400_000;

// ───────────────────────────── fechas y ventanas ─────────────────────────────

export interface Ventana {
  /** 'AAAA-MM-DD'. */
  desde: string;
  /** 'AAAA-MM-DD'. */
  hasta: string;
}

/** Suma días a una fecha 'AAAA-MM-DD' (aritmética de calendario, sin husos). */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function fmtDia(fecha: string): string {
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}

const fmtFechaLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Día en Argentina ('AAAA-MM-DD') de un instante (Date o ISO). */
export function diaLocal(instante: Date | string): string {
  return fmtFechaLocal.format(typeof instante === 'string' ? new Date(instante) : instante);
}

/** Hoy en Argentina, 'AAAA-MM-DD'. */
export function hoyLocal(ahora: Date = new Date()): string {
  return diaLocal(ahora);
}

export type EstadoVentana = 'proxima' | 'abierta' | 'vencida';

/** Dónde está `hoy` ('AAAA-MM-DD') respecto de la ventana. */
export function estadoVentana(v: Ventana, hoy: string): EstadoVentana {
  if (hoy < v.desde) {
    return 'proxima';
  }
  return hoy > v.hasta ? 'vencida' : 'abierta';
}

/** Primer día en que se puede agendar: el inicio de la ventana, o hoy si ya empezó. */
export function fechaSugerida(v: Ventana, hoy: string): string {
  return hoy > v.desde ? hoy : v.desde;
}

// ───────────────────────────── sincronización (recalcular) ─────────────────────────────

type ConIdentifier = { id?: string; identifier?: Array<{ system?: string; value?: string }> };
export type EstadoRecurso = 'pendiente' | 'cerrado' | 'cancelado';

/** Clave de upsert de un recurso de un programa (su identifier en `sistema`; por defecto, GLP-1). */
export function claveDe(r: ConIdentifier, sistema: string = SYSTEM.programaGlp1): string | undefined {
  return r.identifier?.find((i) => i.system === sistema)?.value;
}

export interface PlanSincronizacion<T> {
  crear: T[];
  /** Con el contenido nuevo y el id del existente (pendientes que cambian o cancelados que vuelven). */
  actualizar: T[];
  /** Pendientes que ya no corresponden. */
  cancelar: T[];
  /** Ya cerrados (p. ej. control ya agendado) que cambiaron o ya no corresponden: revisar a mano. */
  aRevisar: T[];
}

/**
 * Qué hacer para llevar lo existente a lo deseado sin duplicar ni pisar lo ya
 * resuelto: crea lo nuevo, actualiza lo pendiente que cambió, cancela lo
 * pendiente que ya no va y NUNCA toca lo cerrado (lo informa para revisar).
 */
export function sincronizar<T extends ConIdentifier>(
  deseados: T[],
  existentes: T[],
  opts: { estado: (r: T) => EstadoRecurso; mismoContenido: (a: T, b: T) => boolean; sistema?: string },
): PlanSincronizacion<T> {
  const clave = (r: T) => claveDe(r, opts.sistema);
  const porClave = new Map<string, T>();
  for (const r of existentes) {
    const k = clave(r);
    if (k) {
      porClave.set(k, r);
    }
  }
  const plan: PlanSincronizacion<T> = { crear: [], actualizar: [], cancelar: [], aRevisar: [] };
  const vistas = new Set<string>();
  for (const d of deseados) {
    const k = clave(d);
    const ex = k ? porClave.get(k) : undefined;
    if (k) {
      vistas.add(k);
    }
    if (!ex) {
      plan.crear.push(d);
      continue;
    }
    const estado = opts.estado(ex);
    if (estado === 'cancelado' || (estado === 'pendiente' && !opts.mismoContenido(ex, d))) {
      plan.actualizar.push({ ...d, id: ex.id });
    } else if (estado === 'cerrado' && !opts.mismoContenido(ex, d)) {
      plan.aRevisar.push(ex);
    }
  }
  for (const [k, ex] of porClave) {
    if (vistas.has(k)) {
      continue;
    }
    const estado = opts.estado(ex);
    if (estado === 'pendiente') {
      plan.cancelar.push(ex);
    } else if (estado === 'cerrado') {
      plan.aRevisar.push(ex);
    }
  }
  return plan;
}

export function estadoTarea(t: Task): EstadoRecurso {
  if (t.status === 'completed') {
    return 'cerrado';
  }
  return t.status === 'cancelled' || t.status === 'rejected' || t.status === 'failed' || t.status === 'entered-in-error'
    ? 'cancelado'
    : 'pendiente';
}
