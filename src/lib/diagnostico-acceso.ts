/**
 * Diagnóstico de la AccessPolicy del portal del paciente — lógica pura (sin red).
 * La usa `src/seed/diagnostico-acceso.ts`.
 *
 * Medplum responde 403 "Forbidden" a cualquier búsqueda de un tipo de recurso que la
 * policy efectiva del paciente no concede, y el portal muestra la pantalla vacía (p. ej.
 * "ningún profesional atiende esta consulta" en Reservar un turno). Acá está la lista de
 * los recursos de solo lectura que el portal busca, con la pantalla que se rompe sin cada
 * uno, y la comparación de la policy del servidor con la del repo (fuente de verdad:
 * `POLICY_PACIENTE_PORTAL`, que aplica `npm run seed`).
 */
import type { AccessPolicy, AccessPolicyResource } from '@medplum/fhirtypes';
import { POLICY_PACIENTE_PORTAL } from '../fhir/access-policies.js';

export interface RecursoClavePortal {
  resourceType: string;
  /** Pantalla del portal que deja de funcionar si la policy no concede el recurso. */
  pantalla: string;
}

/**
 * Recursos de solo lectura que el portal (EPA-Developments/app, `src/fhir/*`) busca al
 * cargar una pantalla. Si el portal empieza a buscar otro, sumarlo acá (y a la policy).
 */
export const RECURSOS_CLAVE_PORTAL: readonly RecursoClavePortal[] = [
  { resourceType: 'ObservationDefinition', pantalla: 'Mi salud: biomarcadores y sus rangos' },
  { resourceType: 'Questionnaire', pantalla: 'Cuestionarios (LE8, ingreso, Plan Bienestar)' },
  { resourceType: 'Invoice', pantalla: 'Membresía: pagos' },
  { resourceType: 'PlanDefinition', pantalla: 'Plan Bienestar: elegibilidad y plantilla del plan' },
  { resourceType: 'Practitioner', pantalla: 'Equipo de cuidado: profesionales' },
  { resourceType: 'ActivityDefinition', pantalla: 'Reservar un turno: consultas del catálogo' },
  { resourceType: 'PractitionerRole', pantalla: 'Reservar un turno: profesionales ("¿Con quién?")' },
  { resourceType: 'Schedule', pantalla: 'Reservar un turno: agenda del profesional ("¿Cuándo?")' },
  { resourceType: 'Slot', pantalla: 'Reservar un turno: horarios libres ("¿Cuándo?")' },
];

/** Tipos de recurso que la policy concede (con o sin criterio). */
export function tiposConcedidos(policy: AccessPolicy): Set<string> {
  return new Set((policy.resource ?? []).map((r) => r.resourceType).filter((t): t is string => Boolean(t)));
}

/** Una entrada de la policy, legible y única: el criterio (o el tipo) y si es de solo lectura. */
export function describirEntrada(r: AccessPolicyResource): string {
  return `${r.criteria ?? r.resourceType ?? '?'}${r.readonly ? ' (solo lectura)' : ''}`;
}

export interface DiagnosticoPolicy {
  /** Recursos clave del portal que la policy no concede, con la pantalla que se rompe. */
  faltantes: RecursoClavePortal[];
  /** Entradas de la policy del repo que la del servidor no tiene (→ `npm run seed`). */
  entradasFaltantes: string[];
}

/**
 * Compara la policy efectiva (la del servidor) con los recursos que el portal busca y con
 * la policy del repo. `faltantes` explica los 403 que ve el paciente; `entradasFaltantes`
 * dice que el seed no corrió desde el último cambio de la policy.
 */
export function diagnosticarPolicy(servidor: AccessPolicy, repo: AccessPolicy = POLICY_PACIENTE_PORTAL): DiagnosticoPolicy {
  const tipos = tiposConcedidos(servidor);
  const enServidor = new Set((servidor.resource ?? []).map(describirEntrada));
  return {
    faltantes: RECURSOS_CLAVE_PORTAL.filter((r) => !tipos.has(r.resourceType)),
    entradasFaltantes: (repo.resource ?? []).map(describirEntrada).filter((e) => !enServidor.has(e)),
  };
}
