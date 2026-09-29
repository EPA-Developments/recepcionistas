/**
 * AccessPolicies de los especialistas (dashboard clínico): Médico y Nutrición.
 *
 * Lo que cuidan estos tests:
 *  - Que cubran lo que el dashboard lee y escribe. Una policy sin un tipo no lo
 *    "oculta": Medplum contesta 403 y esa pantalla se rompe sin avisar. Las listas
 *    son las del dashboard (`src/roles/policy-cobertura.test.ts` de
 *    `EPA-Developments/dashboard-cardiometabolismo`, 29/09/2026): si el dashboard
 *    empieza a leer un tipo nuevo, se suma acá y en la policy.
 *  - Que Nutrición no prescriba (Ley 17.132).
 *  - Que la agenda y la facturación sigan siendo de Recepción, y el informe, del bot.
 *  - Que los bots vayan por nombre, sin abrir otros por prefijo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AccessPolicy } from '@medplum/fhirtypes';
import { buildSeed } from '../src/seed/builders.js';
import {
  BOTS_MEDICO,
  BOTS_NUTRICION,
  NOMBRE_POLICY_MEDICO,
  NOMBRE_POLICY_NUTRICION,
} from '../src/fhir/access-policies.js';
import { BOT_GLP1_PLAN, BOT_TELECONSULTA_TOKEN } from '../src/fhir/identifiers.js';

const seed = buildSeed();
const policy = (nombre: string): AccessPolicy => {
  const p = seed.accessPolicies.find((x) => x.name === nombre);
  if (!p) {
    throw new Error(`El seed no trae la policy ${nombre}`);
  }
  return p;
};
const MEDICO = policy(NOMBRE_POLICY_MEDICO);
const NUTRICION = policy(NOMBRE_POLICY_NUTRICION);

type Acceso = 'escribe' | 'lee' | 'sin-acceso';

/** Qué deja hacer la policy con un tipo: si alguna entrada no es de sólo lectura, escribe. */
function acceso(p: AccessPolicy, tipo: string): Acceso {
  const entradas = (p.resource ?? []).filter((r) => r.resourceType === tipo || r.resourceType === '*');
  if (entradas.length === 0) {
    return 'sin-acceso';
  }
  return entradas.some((r) => !r.readonly) ? 'escribe' : 'lee';
}

/** Lo que busca el dashboard (sus pantallas y el PatientSummary de @medplum/react 5.1.42). */
const LEE_EL_DASHBOARD = [
  'Patient',
  'Observation',
  'Condition',
  'MedicationRequest',
  'MedicationStatement',
  'AllergyIntolerance',
  'Immunization',
  'QuestionnaireResponse',
  'Questionnaire',
  'CarePlan',
  'Goal',
  'Task',
  'ServiceRequest',
  'DiagnosticReport',
  'Encounter',
  'Appointment',
  'Coverage',
  'Consent',
  'Communication',
  'DocumentReference',
  'Provenance',
  'Practitioner',
  'ObservationDefinition',
  'NutritionOrder',
  'DicomStudy',
  'ValueSet',
  'CodeSystem',
];

/** Lo que escribe el dashboard. */
const ESCRIBE_EL_DASHBOARD = [
  'Patient',
  'Encounter',
  'ClinicalImpression',
  'Observation',
  'QuestionnaireResponse',
  'CarePlan',
  'Goal',
  'Task',
  'MedicationRequest',
  'ServiceRequest',
  'Provenance',
  'NutritionOrder',
];

/** El módulo Nutrición del dashboard: lo escriben las dos disciplinas. */
const ESCRIBE_NUTRICION = ['Observation', 'Goal', 'NutritionOrder', 'CarePlan'];

/** Lo que es prescribir o pedir (Ley 17.132): Nutrición lo lee y no lo escribe. */
const PRESCRIBIR = ['MedicationRequest', 'ServiceRequest', 'Condition', 'Provenance'];

describe('Policies de los especialistas', () => {
  it('ninguna es un comodín: eso es el Director Médico', () => {
    for (const p of [MEDICO, NUTRICION]) {
      expect((p.resource ?? []).map((r) => r.resourceType)).not.toContain('*');
    }
  });

  it('las dos leen todo lo que busca el dashboard', () => {
    for (const p of [MEDICO, NUTRICION]) {
      const faltan = LEE_EL_DASHBOARD.filter((t) => acceso(p, t) === 'sin-acceso');
      expect(faltan, p.name).toEqual([]);
    }
  });

  it('el médico escribe todo lo que escribe el dashboard', () => {
    expect(ESCRIBE_EL_DASHBOARD.filter((t) => acceso(MEDICO, t) !== 'escribe')).toEqual([]);
  });

  it('Nutrición escribe su módulo y no prescribe ni pide', () => {
    expect(ESCRIBE_NUTRICION.filter((t) => acceso(NUTRICION, t) !== 'escribe')).toEqual([]);
    for (const tipo of PRESCRIBIR) {
      expect(acceso(NUTRICION, tipo), tipo).toBe('lee');
    }
  });

  it('Nutrición no cambia la identidad de la paciente', () => {
    const paciente = (NUTRICION.resource ?? []).find((r) => r.resourceType === 'Patient');
    expect(paciente?.readonlyFields).toEqual(expect.arrayContaining(['identifier']));
  });

  // Entrar y cerrar van por som-estado-turno: escribir el turno a mano lo cerraría
  // con el Plan Bienestar sin marcar.
  it('la agenda se lee, no se escribe', () => {
    for (const p of [MEDICO, NUTRICION]) {
      for (const tipo of ['Appointment', 'Slot', 'Schedule']) {
        expect(acceso(p, tipo), `${p.name}: ${tipo}`).toBe('lee');
      }
    }
  });

  it('nada de facturación', () => {
    for (const p of [MEDICO, NUTRICION]) {
      for (const tipo of ['Invoice', 'ChargeItem', 'PaymentReconciliation', 'Account']) {
        expect(acceso(p, tipo), `${p.name}: ${tipo}`).toBe('sin-acceso');
      }
    }
  });

  it('el informe de segunda opinión y el riesgo los escribe el bot: se leen', () => {
    for (const p of [MEDICO, NUTRICION]) {
      expect(acceso(p, 'DiagnosticReport')).toBe('lee');
      expect(acceso(p, 'RiskAssessment')).toBe('lee');
    }
  });
});

describe('Los bots de los especialistas', () => {
  const botsDe = (p: AccessPolicy) => (p.resource ?? []).filter((r) => r.resourceType === 'Bot');

  it('van por nombre: ninguna entrada de Bot sin criterio', () => {
    for (const p of [MEDICO, NUTRICION]) {
      expect(botsDe(p).every((b) => b.criteria?.startsWith('Bot?name='))).toBe(true);
    }
  });

  it('el médico entra como moderador, cierra la consulta y arma el GLP-1', () => {
    const nombres = botsDe(MEDICO).map((b) => b.criteria!.slice('Bot?name='.length));
    expect(nombres).toEqual([...BOTS_MEDICO]);
    expect(nombres).toEqual(expect.arrayContaining([BOT_TELECONSULTA_TOKEN, 'som-estado-turno', BOT_GLP1_PLAN]));
  });

  it('Nutrición entra y cierra, pero no arma el GLP-1 ni verifica recetas', () => {
    const nombres = botsDe(NUTRICION).map((b) => b.criteria!.slice('Bot?name='.length));
    expect(nombres).toEqual([...BOTS_NUTRICION]);
    expect(nombres).not.toContain(BOT_GLP1_PLAN);
    expect(nombres).not.toContain('refeps-verify');
  });

  // `Bot?name=` compara por prefijo: un nombre habilitado no puede abrir otro bot.
  it('ningún bot habilitado es prefijo de otro bot del proyecto', () => {
    const config = JSON.parse(readFileSync(new URL('../medplum.config.json', import.meta.url), 'utf8')) as {
      bots: Array<{ name: string }>;
    };
    const todos = config.bots.map((b) => b.name);
    for (const h of new Set<string>([...BOTS_MEDICO, ...BOTS_NUTRICION])) {
      expect(todos.filter((o) => o !== h && o.startsWith(h)), h).toEqual([]);
    }
  });
});
