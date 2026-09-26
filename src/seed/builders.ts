/**
 * Builders FHIR del seed: traducen el catálogo de dominio a recursos FHIR R4
 * (ActivityDefinition, PlanDefinition, Basic, Location, Schedule, ObservationDefinition).
 * Funciones puras: no hacen IO. El runner (index.ts) los persiste en Medplum.
 */
import type {
  ActivityDefinition,
  Basic,
  CodeableConcept,
  Extension,
  Location,
  ObservationDefinition,
  PlanDefinition,
  Practitioner,
  PractitionerRole,
  Schedule,
  Slot,
  StructureDefinition,
  UsageContext,
} from '@medplum/fhirtypes';
import type { Servicio } from '../domain/types.js';
import { MEDICOS, type Medico } from '../config/medicos.js';
import { BIOMARCADORES, PANEL_DISPLAY, type Biomarcador } from '../config/biomarcadores.js';
import { CODIGO_CONSULTA_PB100D, CODIGO_CONTROL_GLP1, GRUPOS_ESPECIALIDAD, SERVICIOS } from '../config/catalogo.js';
import { NOMBRE_PLAN_BIENESTAR } from '../config/plan-bienestar.js';
import { RECURSOS } from '../config/recursos.js';
import { TC_DEFAULT } from '../config/tipo-cambio.js';
import { identificadorSlotProfesional, type SlotProfesionalDescriptor } from '../lib/agenda-profesional.js';
import type { SlotDescriptor } from '../lib/slots.js';
import { EXTENSIONES } from '../fhir/extensions.js';
import { ACCESS_POLICIES } from '../fhir/access-policies.js';
import { COD, CONFIG_TC_ID, EXT, SYSTEM, urlServicio } from '../fhir/identifiers.js';
import { construirPlanDefinitionBienestar } from '../lib/plan-bienestar.js';
import { ETIQUETA_MODALIDAD, codingModalidad } from '../lib/teleconsulta.js';

const SNOMED = 'http://snomed.info/sct';
const USAGE_CONTEXT_TYPE = 'http://terminology.hl7.org/CodeSystem/usage-context-type';

/**
 * Temas del servicio (`ActivityDefinition.topic`, buscable): la especialidad (SNOMED CT
 * c80-practice-codes, si tiene) y el grupo en que la muestra el portal.
 */
function temasDe(s: Servicio): CodeableConcept[] {
  const temas: CodeableConcept[] = [];
  if (s.especialidad) {
    temas.push({
      ...(s.especialidad.snomed
        ? { coding: [{ system: SNOMED, code: s.especialidad.snomed, display: s.especialidad.snomedDisplay }] }
        : {}),
      text: s.especialidad.nombre,
    });
  }
  const grupo = GRUPOS_ESPECIALIDAD.find((g) => g.codigo === s.grupo);
  if (grupo) {
    temas.push({ coding: [{ system: SYSTEM.grupoEspecialidad, code: grupo.codigo, display: grupo.nombre }], text: grupo.nombre });
  }
  return temas.length ? temas : [{ text: s.categoria }];
}

/**
 * Contextos de uso (`ActivityDefinition.useContext`, buscable con `context`): cada
 * modalidad en que se ofrece (tipo `workflow`, v3-ActCode AMB / VR; R-21) y, si está
 * incluida en un programa, el programa (tipo `program`).
 */
function contextosDe(s: Servicio): UsageContext[] {
  const contextos: UsageContext[] = s.modalidades.map((m) => ({
    code: { system: USAGE_CONTEXT_TYPE, code: 'workflow' },
    valueCodeableConcept: { coding: [codingModalidad(m)], text: ETIQUETA_MODALIDAD[m] },
  }));
  if (s.incluidaEnPlan) {
    contextos.push({
      code: { system: USAGE_CONTEXT_TYPE, code: 'program' },
      valueCodeableConcept: {
        coding: [{ system: SYSTEM.planCuidado, code: COD.planBienestar100, display: NOMBRE_PLAN_BIENESTAR }],
        text: NOMBRE_PLAN_BIENESTAR,
      },
    });
  }
  return contextos;
}
import { construirPlanDefinitionGlp1 } from '../lib/glp1-plan.js';


export function buildActivityDefinition(s: Servicio): ActivityDefinition {
  const ext: Extension[] = [
    { url: EXT.precioUsd, valueDecimal: s.precioUSD },
    { url: EXT.reglaPricingRecurso, valueCode: s.reglaPricing },
    { url: EXT.splitSom, valueCode: s.split.tipo },
  ];
  if (s.precioARS != null) {
    ext.push({ url: EXT.precioArs, valueDecimal: s.precioARS });
  }
  if (s.valorReferenciaARS != null) {
    ext.push({ url: EXT.valorReferenciaArs, valueDecimal: s.valorReferenciaARS });
  }
  const ad: ActivityDefinition = {
    resourceType: 'ActivityDefinition',
    url: urlServicio(s.codigo),
    name: s.codigo,
    title: s.nombre,
    status: 'active',
    kind: 'ServiceRequest',
    identifier: [{ system: SYSTEM.servicioCodigo, value: s.codigo }],
    topic: temasDe(s),
    useContext: contextosDe(s),
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
    identifier: [
      { system: SYSTEM.medico, value: m.codigo },
      ...(m.matricula ? [{ system: SYSTEM.matricula, value: m.matricula }] : []),
      ...(m.matriculaProvincial ? [{ system: SYSTEM.matricula, value: m.matriculaProvincial }] : []),
    ],
    name: [{ text: m.nombre }],
    active: true,
    ...(m.especialidad.snomed || m.especialidad.nombre
      ? {
          qualification: [
            {
              code: {
                ...(m.especialidad.snomed
                  ? { coding: [{ system: SNOMED, code: m.especialidad.snomed, display: m.especialidad.snomedDisplay }] }
                  : {}),
                text: m.especialidad.nombre,
              },
            },
          ],
        }
      : {}),
    extension: [{ url: EXT.tipoContrato, valueCode: m.esDirector ? 'director-medico' : 'prescriptor' }],
  };
}

/** Referencia condicional al Practitioner de un profesional (por identifier). */
export function refPractitioner(m: Pick<Medico, 'codigo' | 'nombre'>): { reference: string; display: string } {
  return { reference: `Practitioner?identifier=${SYSTEM.medico}|${m.codigo}`, display: m.nombre };
}

const DIAS_FHIR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Rol del profesional en SOM: su especialidad (SNOMED, buscable con `specialty`), qué
 * hace (`code`: atiende consultas / seguimiento del Plan Bienestar), en qué modalidades
 * (extensión `modalidad`, v3-ActCode), qué consultas atiende (`healthcareService` no:
 * el catálogo es ActivityDefinition, así que van como `code` con `SYSTEM.servicioCodigo`),
 * su disponibilidad semanal (`availableTime`) y su consultorio (`location`). El portal
 * arma "Especialidad → Profesional" leyendo esto.
 */
export function buildPractitionerRole(codigo: string): PractitionerRole {
  const m = MEDICOS.find((x) => x.codigo === codigo)!;
  const rol: PractitionerRole = {
    resourceType: 'PractitionerRole',
    identifier: [{ system: SYSTEM.medico, value: `ROL_${m.codigo}` }],
    active: true,
    practitioner: refPractitioner(m),
    code: [
      ...(m.servicios.some((s) => s !== CODIGO_CONSULTA_PB100D)
        ? [{ coding: [{ system: SYSTEM.rolProfesional, code: COD.rolAtiendeConsultas, display: 'Atiende consultas' }] }]
        : []),
      ...(m.seguimientoPB100D
        ? [{ coding: [{ system: SYSTEM.rolProfesional, code: COD.rolSeguimientoPb100d, display: `Seguimiento del ${NOMBRE_PLAN_BIENESTAR}` }] }]
        : []),
      ...m.servicios.map((s) => ({ coding: [{ system: SYSTEM.servicioCodigo, code: s }] })),
    ],
    specialty: [
      {
        ...(m.especialidad.snomed
          ? { coding: [{ system: SNOMED, code: m.especialidad.snomed, display: m.especialidad.snomedDisplay }] }
          : {}),
        text: m.especialidad.nombre,
      },
    ],
    ...(m.consultorioCodigo
      ? { location: [{ reference: `Location?identifier=${SYSTEM.recursoCodigo}|${m.consultorioCodigo}` }] }
      : {}),
    ...(m.disponibilidad.length
      ? {
          availableTime: m.disponibilidad.map((d) => ({
            daysOfWeek: [DIAS_FHIR[d.dia]!],
            availableStartTime: `${d.desde}:00`,
            availableEndTime: `${d.hasta}:00`,
          })),
        }
      : {}),
    extension: m.modalidades.map((mod) => ({ url: EXT.modalidad, valueCoding: codingModalidad(mod) })),
  };
  return rol;
}

/** Agenda propia del profesional: los turnos ocupan sus franjas, no las de un consultorio. */
export function buildScheduleProfesional(codigo: string): Schedule {
  const m = MEDICOS.find((x) => x.codigo === codigo)!;
  return {
    resourceType: 'Schedule',
    identifier: [{ system: SYSTEM.medico, value: `SCH_${m.codigo}` }],
    active: true,
    actor: [refPractitioner(m)],
    extension: [{ url: EXT.profesional, valueString: m.codigo }],
  };
}

/** Franja libre de un profesional (identifier `medico@inicio`: el seed y el cron son idempotentes). */
export function buildSlotProfesional(descriptor: SlotProfesionalDescriptor, scheduleRef: string): Slot {
  return {
    resourceType: 'Slot',
    identifier: [{ system: SYSTEM.medico, value: identificadorSlotProfesional(descriptor.medicoCodigo, descriptor.inicio) }],
    schedule: { reference: scheduleRef },
    status: 'free',
    start: descriptor.inicio,
    end: descriptor.fin,
    extension: [{ url: EXT.profesional, valueString: descriptor.medicoCodigo }],
  };
}

/** Plan Bienestar 100 Días® (plantilla con sus tres consultas programadas). */
export function buildPlanDefinitionBienestar(): PlanDefinition {
  return construirPlanDefinitionBienestar();
}

/** Programa de seguimiento GLP-1 (plantilla del catálogo; sus visitas usan el control GLP-1). */
export function buildPlanDefinitionGlp1(): PlanDefinition {
  return construirPlanDefinitionGlp1(urlServicio(CODIGO_CONTROL_GLP1));
}

const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';

/**
 * ObservationDefinition de un biomarcador, con el shape que parsea el portal
 * (`app/src/fhir/biomarkers.ts`): `code` LOINC, `category` panel-biomarcador,
 * `quantitativeDetails.unit` (UCUM) y `qualifiedInterval` convencional (con `gender`
 * si es por sexo). Solo rangos de salud convencional: nunca `funcional`.
 */
export function buildObservationDefinition(b: Biomarcador): ObservationDefinition {
  return {
    resourceType: 'ObservationDefinition',
    code: { coding: [{ system: LOINC, code: b.codigo, display: b.nombre }], text: b.nombre },
    category: [{ coding: [{ system: SYSTEM.panelBiomarcador, code: b.panel, display: PANEL_DISPLAY[b.panel] }] }],
    permittedDataType: ['Quantity'],
    quantitativeDetails: { unit: { coding: [{ system: UCUM, code: b.unidad }], text: b.unidad } },
    qualifiedInterval: b.rangos.map((r) => ({
      category: 'reference' as const,
      context: { coding: [{ system: SYSTEM.tipoRango, code: r.tipo }] },
      range: {
        ...(r.bajo !== undefined ? { low: { value: r.bajo, unit: b.unidad, system: UCUM, code: b.unidad } } : {}),
        ...(r.alto !== undefined ? { high: { value: r.alto, unit: b.unidad, system: UCUM, code: b.unidad } } : {}),
      },
      ...(r.sexo ? { gender: r.sexo } : {}),
    })),
  };
}

/**
 * Clave de una ObservationDefinition para el upsert del seed (`system|code`). R4 no
 * define search params para ObservationDefinition, así que el seed las trae todas y
 * matchea por esta clave: correr el seed dos veces no duplica.
 */
export function claveObservationDefinition(od: ObservationDefinition): string | undefined {
  const c = od.code?.coding?.[0];
  return c?.code ? `${c.system ?? ''}|${c.code}` : undefined;
}

export interface RecursosSeed {
  structureDefinitions: StructureDefinition[];
  accessPolicies: typeof ACCESS_POLICIES;
  tcConfig: Basic;
  activityDefinitions: ActivityDefinition[];
  planDefinitions: PlanDefinition[];
  locations: Location[];
  /** Agendas de los recursos físicos y de cada profesional. */
  schedules: Schedule[];
  practitioners: Practitioner[];
  practitionerRoles: PractitionerRole[];
  observationDefinitions: ObservationDefinition[];
}

/** Construye TODOS los recursos del seed (sin IO). */
export function buildSeed(): RecursosSeed {
  return {
    structureDefinitions: EXTENSIONES,
    accessPolicies: ACCESS_POLICIES,
    tcConfig: buildTcConfig(),
    activityDefinitions: SERVICIOS.map(buildActivityDefinition),
    planDefinitions: [buildPlanDefinitionGlp1(), buildPlanDefinitionBienestar()],
    locations: RECURSOS.map((r) => buildLocation(r.codigo)),
    schedules: [...RECURSOS.map((r) => buildSchedule(r.codigo)), ...MEDICOS.map((m) => buildScheduleProfesional(m.codigo))],
    practitioners: MEDICOS.map((m) => buildPractitioner(m.codigo)),
    practitionerRoles: MEDICOS.map((m) => buildPractitionerRole(m.codigo)),
    observationDefinitions: BIOMARCADORES.map(buildObservationDefinition),
  };
}
