/**
 * Bot · som-bienestar-inscribir — Recepción inscribe al paciente en el Plan
 * Bienestar de 100 días.
 *
 * Crea el `CarePlan` que detecta el portal del paciente (category
 * `care-plans|plan-bienestar-100`, `period` de 100 días). El portal calcula el día,
 * los hitos y la racha con lo que el paciente ya registra: no hace falta nada más.
 *
 * Idempotente: si el paciente ya tiene el plan activo, no crea otro y devuelve su
 * período. No cobra (el precio del plan está PENDIENTE en el catálogo SOM).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { CarePlan } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../fhir/identifiers.js';
import { esPacienteRef } from '../lib/glp1-plan.js';
import { construirCarePlanBienestar, esFechaValida } from '../lib/plan-bienestar.js';

export interface EntradaInscribirBienestar {
  /** "Patient/123". */
  pacienteRef: string;
  /** Día 1 del plan (`YYYY-MM-DD`). Default: hoy en Buenos Aires. */
  inicio?: string;
}

export interface ResultadoInscribirBienestar {
  ok: boolean;
  mensaje?: string;
  /** true si en esta llamada se creó el plan; false si ya estaba inscripto. */
  creado?: boolean;
  carePlanId?: string;
  inicio?: string;
  fin?: string;
}

const hoyBsAs = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaInscribirBienestar>,
): Promise<ResultadoInscribirBienestar> {
  const pacienteRef = event.input?.pacienteRef;
  if (!esPacienteRef(pacienteRef)) {
    return { ok: false, mensaje: 'Falta el paciente (Patient/…).' };
  }
  const inicio = event.input.inicio ?? hoyBsAs();
  if (!esFechaValida(inicio)) {
    return { ok: false, mensaje: 'La fecha de inicio no es válida (AAAA-MM-DD).' };
  }
  try {
    await medplum.readResource('Patient', pacienteRef.split('/')[1]!);

    const activo = await medplum.searchOne('CarePlan', {
      subject: pacienteRef,
      status: 'active',
      category: `${SYSTEM.planCuidado}|${COD.planBienestar100}`,
    });
    if (activo?.id) {
      return {
        ok: true,
        creado: false,
        carePlanId: activo.id,
        inicio: activo.period?.start,
        fin: activo.period?.end,
        mensaje: 'El paciente ya está inscripto en el Plan Bienestar.',
      };
    }

    const plan = await medplum.createResource<CarePlan>(construirCarePlanBienestar(pacienteRef, inicio));
    return { ok: true, creado: true, carePlanId: plan.id, inicio: plan.period?.start, fin: plan.period?.end };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo inscribir en el Plan Bienestar.' };
  }
}
