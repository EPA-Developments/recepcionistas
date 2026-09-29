/**
 * Bot · som-bienestar-dia0 — Plan Bienestar 100 Días®: lo operativo del plan para
 * Recepción, **sin valores clínicos**.
 *
 * La policy de Recepción no lee lo clínico (Observation, Condition, CarePlan, …). Este
 * bot lo lee con su identidad y devuelve sólo lo que Recepción necesita para coordinar:
 *  - el **día 0**: qué datos pide el catálogo firmado para el estadío de la persona y si
 *    están cargados, a medias, vencidos o faltan, y quién los carga (consultorio,
 *    laboratorio, la persona desde el portal, el equipo, el sistema). Nunca el valor.
 *  - el **plan clínico** (`pb100d-ckm`): si está activo, desde cuándo, en qué día va y
 *    cuántos pasos completó la persona.
 *  - el **material** para el paciente: los títulos de sus pasos por momento y el aviso
 *    por WhatsApp con los próximos, para copiar, mandar o imprimir.
 *
 * El estadío es el validado por el equipo médico si lo hay (`estadio-ckm-validado`); si
 * no, el que estima Recepción (`ckm.ts`, sin PREVENT: el riesgo lo calcula el informe
 * SOM). Sólo lectura: no escribe nada.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { CarePlan, Condition, MedicationRequest, Observation, Patient, QuestionnaireResponse, Task } from '@medplum/fhirtypes';
import { UMBRALES_PREVENT_GUIA } from '../config/ckm.js';
import { PORTAL_BASE_URL_DEFAULT, urlBase } from '../config/urls.js';
import { estadificarCkm } from '../lib/ckm.js';
import { perfilCatalogo, type PerfilCatalogo } from '../lib/ckm-catalogo.js';
import { condicionesExtrasDesdeFhir, entradaCkmDesdeFhir, potenciadoresCkm } from '../lib/ckm-fhir.js';
import {
  estadioValidadoDesdeFhir,
  evaluarDia0Operativo,
  materialOperativo,
  pasosDelPlanClinico,
  planClinicoActivo,
  planClinicoOperativo,
  type MaterialOperativo,
  type PlanClinicoOperativo,
  type ResumenDia0,
} from '../lib/dia0-pb100d.js';
import { esPacienteRef } from '../lib/glp1-plan.js';
import { hoyLocal } from '../lib/programas.js';

export interface EntradaDia0Bienestar {
  /** "Patient/123". */
  pacienteRef: string;
  /** Momento del plan a evaluar (`dia-0` por defecto; `dia-30`, `dia-60`, `dia-100`). */
  momento?: string;
}

export interface ResultadoDia0Bienestar {
  ok: boolean;
  mensaje?: string;
  /** De dónde sale el estadío con que se armó la lista (el número no viaja: es clínico). */
  origenEstadio?: 'validado' | 'estimado';
  dia0?: ResumenDia0;
  planClinico?: PlanClinicoOperativo;
  /** Sólo con plan clínico activo. */
  material?: MaterialOperativo;
}

function nombreDe(p: Patient): string {
  const n = p.name?.[0];
  return n?.text ?? [n?.given?.join(' '), n?.family].filter(Boolean).join(' ') ?? 'Paciente';
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaDia0Bienestar>): Promise<ResultadoDia0Bienestar> {
  const pacienteRef = event.input?.pacienteRef;
  if (!esPacienteRef(pacienteRef)) {
    return { ok: false, mensaje: 'Falta el paciente (Patient/…).' };
  }
  try {
    const paciente = await medplum.readResource('Patient', pacienteRef.split('/')[1]!);
    const [condiciones, observaciones, medicacion, respuestas, planes, tareas] = await Promise.all([
      medplum.searchResources('Condition', `subject=${pacienteRef}&_count=200`).catch(() => [] as Condition[]),
      medplum.searchResources('Observation', `subject=${pacienteRef}&_count=500`).catch(() => [] as Observation[]),
      medplum.searchResources('MedicationRequest', `subject=${pacienteRef}&_count=100`).catch(() => [] as MedicationRequest[]),
      medplum.searchResources('QuestionnaireResponse', `subject=${pacienteRef}&_count=200`).catch(() => [] as QuestionnaireResponse[]),
      medplum.searchResources('CarePlan', `subject=${pacienteRef}&status=active&_count=50`).catch(() => [] as CarePlan[]),
      medplum.searchResources('Task', `patient=${pacienteRef}&_count=500`).catch(() => [] as Task[]),
    ]);
    const hoy = hoyLocal();

    const datosCkm = entradaCkmDesdeFhir({ paciente, condiciones, observaciones, medicacion });
    const ckm = estadificarCkm(datosCkm);
    const potenciadores = potenciadoresCkm(condiciones, observaciones, UMBRALES_PREVENT_GUIA.pcrUs);
    const extras = condicionesExtrasDesdeFhir({ condiciones, observaciones, medicacion, potenciadores, edad: datosCkm.edad });
    const estimado = perfilCatalogo(ckm, datosCkm, {}, extras);
    const validado = estadioValidadoDesdeFhir(observaciones);
    const perfil: PerfilCatalogo = validado ? { ...estimado, estadio: validado as PerfilCatalogo['estadio'] } : estimado;

    const dia0 = evaluarDia0Operativo({
      perfil,
      observaciones,
      respuestas,
      ...(validado ? { estadioValidado: validado } : {}),
      ...(datosCkm.edad !== undefined ? { edad: datosCkm.edad } : {}),
      hoy,
      ...(event.input.momento ? { momento: event.input.momento } : {}),
    });
    const planClinico = planClinicoOperativo(planes, tareas, hoy);
    const plan = planClinicoActivo(planes);
    const material = plan
      ? materialOperativo({
          nombre: nombreDe(paciente),
          pasos: pasosDelPlanClinico(plan, tareas),
          ...(planClinico.dia !== undefined ? { dia: planClinico.dia } : {}),
          urlPortal: urlBase(event.secrets['PORTAL_BASE_URL']?.valueString, PORTAL_BASE_URL_DEFAULT),
        })
      : undefined;

    return { ok: true, origenEstadio: validado ? 'validado' : 'estimado', dia0, planClinico, ...(material ? { material } : {}) };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo evaluar el día 0.' };
  }
}
