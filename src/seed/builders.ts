/**
 * Builders FHIR del seed: traducen el catálogo de dominio a recursos FHIR R4
 * (ActivityDefinition, Basic, Location, Schedule). Funciones puras: no hacen
 * IO. El runner (index.ts) los persiste en Medplum.
 */
import type {
  ActivityDefinition,
  Basic,
  Extension,
  Location,
  PlanDefinition,
  Practitioner,
  Schedule,
  Slot,
  StructureDefinition,
} from '@medplum/fhirtypes';
import type { Servicio } from '../domain/types.js';
import { MEDICOS } from '../config/medicos.js';
import { CODIGO_CONTROL_GLP1, SERVICIOS } from '../config/catalogo.js';
import { RECURSOS } from '../config/recursos.js';
import { TC_DEFAULT } from '../config/tipo-cambio.js';
import type { SlotDescriptor } from '../lib/slots.js';
import { EXTENSIONES } from '../fhir/extensions.js';
import { ACCESS_POLICIES } from '../fhir/access-policies.js';
import { CONFIG_TC_ID, EXT, SYSTEM } from '../fhir/identifiers.js';
import { construirPlanDefinitionGlp1 } from '../lib/glp1-plan.js';

const BASE = 'https://segundaopinionmedica.org/fhir';

function canonical(tipo: string, codigo: string): string {
  return `${BASE}/${tipo}/${codigo}`;
}

export function buildActivityDefinition(s: Servicio): ActivityDefinition {
  const ext: Extension[] = [
    { url: EXT.precioUsd, valueDecimal: s.precioUSD },
    { url: EXT.reglaPricingRecurso, valueCode: s.reglaPricing },
    { url: EXT.splitSom, valueCode: s.split.tipo },
  ];
  if (s.precioARS != null) {
    ext.push({ url: EXT.precioArs, valueDecimal: s.precioARS });
  }
  const ad: ActivityDefinition = {
    resourceType: 'ActivityDefinition',
    url: canonical('ActivityDefinition', s.codigo),
    name: s.codigo,
    title: s.nombre,
    status: 'active',
    kind: 'ServiceRequest',
    identifier: [{ system: SYSTEM.servicioCodigo, value: s.codigo }],
    topic: [{ text: s.categoria }],
    extension: ext,
  };
  if (s.duracionMin > 0) {
    ad.timingTiming = { repeat: { duration: s.duracionMin, durationUnit: 'min' } };
  }
  return ad;
}

export function buildTcConfig(): Basic {
  return {
    resourceType: 'Basic',
    identifier: [{ system: SYSTEM.config, value: CONFIG_TC_ID }],
    code: { text: CONFIG_TC_ID },
    extension: [{ url: EXT.tcAplicado, valueDecimal: TC_DEFAULT }],
  };
}

export function buildLocation(codigo: string): Location {
  const r = RECURSOS.find((x) => x.codigo === codigo)!;
  return {
    resourceType: 'Location',
    identifier: [{ system: SYSTEM.recursoCodigo, value: r.codigo }],
    name: r.nombre,
    status: 'active',
    mode: 'instance',
  };
}

export function buildSchedule(codigo: string): Schedule {
  const r = RECURSOS.find((x) => x.codigo === codigo)!;
  return {
    resourceType: 'Schedule',
    identifier: [{ system: SYSTEM.recursoCodigo, value: `SCH_${r.codigo}` }],
    active: true,
    actor: [{ reference: `Location?identifier=${SYSTEM.recursoCodigo}|${r.codigo}`, display: r.nombre }],
    extension: [{ url: EXT.recursoFisico, valueString: r.codigo }],
  };
}

/**
 * Slot FHIR a partir de un descriptor. Con identifier determinista
 * (recurso|inicio) para que el seed sea idempotente al regenerar la agenda.
 */
export function buildSlot(descriptor: SlotDescriptor, scheduleRef: string): Slot {
  return {
    resourceType: 'Slot',
    identifier: [
      { system: SYSTEM.recursoCodigo, value: `${descriptor.recursoCodigo}|${descriptor.inicio}` },
    ],
    schedule: { reference: scheduleRef },
    status: 'free',
    start: descriptor.inicio,
    end: descriptor.fin,
    extension: [{ url: EXT.recursoFisico, valueString: descriptor.recursoCodigo }],
  };
}

export function buildPractitioner(codigo: string): Practitioner {
  const m = MEDICOS.find((x) => x.codigo === codigo)!;
  return {
    resourceType: 'Practitioner',
    identifier: [{ system: SYSTEM.medico, value: m.codigo }],
    name: [{ text: m.nombre }],
    extension: [{ url: EXT.tipoContrato, valueCode: m.esDirector ? 'director-medico' : 'prescriptor' }],
  };
}

/** Programa de seguimiento GLP-1 (plantilla del catálogo; sus visitas usan el control GLP-1). */
export function buildPlanDefinitionGlp1(): PlanDefinition {
  return construirPlanDefinitionGlp1(canonical('ActivityDefinition', CODIGO_CONTROL_GLP1));
}

export interface RecursosSeed {
  structureDefinitions: StructureDefinition[];
  accessPolicies: typeof ACCESS_POLICIES;
  tcConfig: Basic;
  activityDefinitions: ActivityDefinition[];
  planDefinitions: PlanDefinition[];
  locations: Location[];
  schedules: Schedule[];
  practitioners: Practitioner[];
}

/** Construye TODOS los recursos del seed (sin IO). */
export function buildSeed(): RecursosSeed {
  return {
    structureDefinitions: EXTENSIONES,
    accessPolicies: ACCESS_POLICIES,
    tcConfig: buildTcConfig(),
    activityDefinitions: SERVICIOS.map(buildActivityDefinition),
    planDefinitions: [buildPlanDefinitionGlp1()],
    locations: RECURSOS.map((r) => buildLocation(r.codigo)),
    schedules: RECURSOS.map((r) => buildSchedule(r.codigo)),
    practitioners: MEDICOS.map((m) => buildPractitioner(m.codigo)),
  };
}
