/**
 * Plan Bienestar · 100 días — inscripción (lógica pura, sin FHIR ni red).
 *
 * El portal del paciente (`EPA-Developments/app`, `src/fhir/bienestar.ts`) muestra la
 * tarjeta de progreso (día X/100, hitos, racha semanal) calculada client-side. Detecta
 * la inscripción por un `CarePlan` activo del paciente con category
 * `care-plans|plan-bienestar-100` y `period` de 100 días: eso es lo único que arma el
 * backend al inscribir. Hitos y racha salen de lo que el paciente ya registra.
 *
 * Cobro: PENDIENTE (catálogo SOM). Inscribir no cobra ni decide precios.
 */
import type { CarePlan } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../fhir/identifiers.js';

/** Duración del plan (contrato con el portal: `period.end = start + 100 días`). */
export const DIAS_PLAN_BIENESTAR = 100;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha `YYYY-MM-DD` válida? */
export function esFechaValida(fecha: string | undefined): fecha is string {
  if (!fecha || !RE_FECHA.test(fecha)) {
    return false;
  }
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/** Suma días a una fecha `YYYY-MM-DD` (aritmética de calendario, sin husos). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Período del plan: día 1 = `inicio`; fin = inicio + 100 días. */
export function periodoPlanBienestar(inicio: string): { start: string; end: string } {
  return { start: inicio, end: sumarDias(inicio, DIAS_PLAN_BIENESTAR) };
}

/** CarePlan de inscripción al Plan Bienestar (el shape que lee el portal). */
export function construirCarePlanBienestar(pacienteRef: string, inicio: string, ahora = new Date()): CarePlan {
  return {
    resourceType: 'CarePlan',
    status: 'active',
    intent: 'plan',
    category: [
      {
        coding: [{ system: SYSTEM.planCuidado, code: COD.planBienestar100, display: 'Plan Bienestar · 100 días' }],
        text: 'Plan Bienestar · 100 días',
      },
    ],
    title: 'Plan Bienestar · 100 días',
    subject: { reference: pacienteRef },
    period: periodoPlanBienestar(inicio),
    created: ahora.toISOString(),
  };
}
