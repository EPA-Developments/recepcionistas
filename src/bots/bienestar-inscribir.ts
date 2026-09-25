/**
 * Bot · som-bienestar-inscribir — Recepción inscribe al paciente en el Plan Bienestar
 * 100 Días®.
 *
 * Crea el `CarePlan` que detecta el portal del paciente (category
 * `care-plans|plan-bienestar-100`, `period` de 100 días) con las tres consultas
 * programadas del plan, y una `Task` por consulta para que Recepción las agende
 * (`agendar-consulta-pb100d`). El día 1 es provisorio hasta agendar la consulta
 * inicial: al agendarla, el plan se corre a esa fecha (R-20, `som-reservar-turno`).
 *
 * Idempotente: si el paciente ya tiene el plan activo, no crea otro; solo suma las
 * tareas que falten (p. ej. un plan inscripto antes de que existieran) y devuelve su
 * estado. No cobra (el precio del plan está PENDIENTE en el catálogo SOM).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { CarePlan, Task } from '@medplum/fhirtypes';
import { NOMBRE_PLAN_BIENESTAR } from '../config/plan-bienestar.js';
import { COD, SYSTEM } from '../fhir/identifiers.js';
import { esPacienteRef } from '../lib/glp1-plan.js';
import {
  calendarioPlanBienestar,
  construirCarePlanBienestar,
  construirTareasPlanBienestar,
  esFechaValida,
  resumenPlanBienestar,
  tareasFaltantes,
  type ConsultaPlanVista,
} from '../lib/plan-bienestar.js';
import { hoyLocal } from '../lib/programas.js';

export interface EntradaInscribirBienestar {
  /** "Patient/123". */
  pacienteRef: string;
  /** Día 1 provisorio del plan (`YYYY-MM-DD`) hasta agendar la consulta inicial. Default: hoy en Buenos Aires. */
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
  /** Tareas de consulta creadas en esta llamada. */
  tareasCreadas?: number;
  /** Las consultas programadas del plan, con su estado (lo que ve Recepción). */
  consultas?: ConsultaPlanVista[];
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaInscribirBienestar>,
): Promise<ResultadoInscribirBienestar> {
  const pacienteRef = event.input?.pacienteRef;
  if (!esPacienteRef(pacienteRef)) {
    return { ok: false, mensaje: 'Falta el paciente (Patient/…).' };
  }
  const inicio = event.input.inicio ?? hoyLocal();
  if (!esFechaValida(inicio)) {
    return { ok: false, mensaje: 'La fecha de inicio no es válida (AAAA-MM-DD).' };
  }
  try {
    await medplum.readResource('Patient', pacienteRef.split('/')[1]!);
    const ahora = new Date().toISOString();

    const activo = await medplum.searchOne('CarePlan', {
      subject: pacienteRef,
      status: 'active',
      category: `${SYSTEM.planCuidado}|${COD.planBienestar100}`,
    });
    const plan: CarePlan = activo ?? (await medplum.createResource<CarePlan>(construirCarePlanBienestar(pacienteRef, inicio)));
    const diaUno = plan.period?.start?.slice(0, 10) ?? inicio;

    // Tareas de las consultas: se crean las que falten (no se tocan las existentes).
    const existentes = await medplum.searchResources('Task', {
      'based-on': `CarePlan/${plan.id}`,
      code: `${SYSTEM.taskTipo}|${COD.agendarConsultaPb100d}`,
    });
    const deseadas = construirTareasPlanBienestar(pacienteRef, plan.id!, calendarioPlanBienestar(diaUno), ahora);
    const creadas: Task[] = [];
    for (const t of tareasFaltantes(deseadas, existentes)) {
      creadas.push(await medplum.createResource<Task>(t));
    }

    return {
      ok: true,
      creado: !activo,
      carePlanId: plan.id,
      inicio: plan.period?.start,
      fin: plan.period?.end,
      tareasCreadas: creadas.length,
      consultas: resumenPlanBienestar([...existentes, ...creadas]).consultas,
      ...(activo ? { mensaje: `El paciente ya está inscripto en el ${NOMBRE_PLAN_BIENESTAR}.` } : {}),
    };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : `No se pudo inscribir en el ${NOMBRE_PLAN_BIENESTAR}.` };
  }
}
