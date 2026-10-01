import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSeed, gruposSeed } from '../src/seed/builders.js';
import {
  BOT_GLP1_INSCRIBIR,
  BOT_GLP1_PLAN,
  EXT,
  PLAN_BIENESTAR_URL,
  PLAN_GLP1_URL,
  PLAN_LABORATORIO_RUTINA_URL,
} from '../src/fhir/identifiers.js';
import { BOTS_RECEPCION } from '../src/fhir/access-policies.js';
import { MEDICOS } from '../src/config/medicos.js';

const seed = buildSeed();

describe('Seed — composición', () => {
  it('Construye los grupos de recursos esperados', () => {
    expect(seed.structureDefinitions.length).toBeGreaterThanOrEqual(10);
    // Roles de SOM: los del catálogo anterior (prescriptor, enfermería, terapeuta) se retiraron.
    // Los especialistas atienden desde el dashboard clínico (tests/policy-especialistas.test.ts).
    expect(seed.accessPolicies.map((p) => p.name)).toEqual([
      'Recepción — Operativo',
      'Director Médico — Clínico completo',
      'Profesional SOM — Médico',
      'Profesional SOM — Nutrición',
      'Paciente SOM — Portal',
      'Webhook Twilio — WhatsApp entrante',
      'Webhook MercadoPago — pagos',
    ]);
    // 12 consultas por especialidad + 9 derivaciones del catálogo firmado del plan +
    // consulta del Plan Bienestar + control GLP-1.
    expect(seed.activityDefinitions.length).toBe(12 + 9 + 2);
    expect(seed.planDefinitions.map((p) => p.url)).toEqual([
      PLAN_GLP1_URL,
      PLAN_BIENESTAR_URL,
      PLAN_LABORATORIO_RUTINA_URL.esencial,
      PLAN_LABORATORIO_RUTINA_URL.extensivo,
    ]);
    // Instrumentos del equipo del Plan Bienestar (generados del monorepo del plan): cinco
    // Questionnaire con la URL y la versión que el menú del equipo espera en cada respuesta.
    expect(seed.questionnaires.map((q) => q.url)).toEqual([
      'https://epa-bienestar.ar/fhir/Questionnaire/pb100d-stop-bang-v1',
      'https://epa-bienestar.ar/fhir/Questionnaire/pb100d-phq2-gad2-pss4-v1',
      'https://epa-bienestar.ar/fhir/Questionnaire/pb100d-ahc-hrsn-v1',
      'https://epa-bienestar.ar/fhir/Questionnaire/pb100d-potenciadores-v1',
      'https://epa-bienestar.ar/fhir/Questionnaire/pb100d-reconciliacion-medicacion-v1',
    ]);
    expect(seed.questionnaires.every((q) => q.status === 'active' && q.version === '1.0' && (q.item?.length ?? 0) > 0)).toBe(true);
    expect(seed.locations.length).toBe(4); // 2 consultorios + agenda de teleconsulta + sala de rehabilitación
    // Una agenda por recurso físico más una por profesional (R-22).
    expect(seed.schedules.length).toBe(4 + MEDICOS.length);
    // Profesionales: uno por médico de config (el catálogo nuevo de SOM los carga), con su rol.
    expect(seed.practitioners.length).toBe(MEDICOS.length);
    expect(seed.practitionerRoles.length).toBe(MEDICOS.length);
  });

  it('El orden de carga respeta las referencias condicionales: Location y Practitioner antes que PractitionerRole y Schedule', () => {
    const grupos = gruposSeed(seed);
    const orden = grupos.map(([, arr]) => arr[0]?.resourceType);
    const pos = (tipo: string) => orden.indexOf(tipo as (typeof orden)[number]);
    expect(pos('Location')).toBeGreaterThanOrEqual(0);
    expect(pos('Practitioner')).toBeGreaterThanOrEqual(0);
    // Schedule.actor → Practitioner?identifier=… / Location?identifier=…
    expect(pos('Practitioner')).toBeLessThan(pos('Schedule'));
    expect(pos('Location')).toBeLessThan(pos('Schedule'));
    // PractitionerRole.practitioner / .location → ídem.
    expect(pos('Practitioner')).toBeLessThan(pos('PractitionerRole'));
    expect(pos('Location')).toBeLessThan(pos('PractitionerRole'));
    // Nada del seed queda fuera de los grupos.
    const total =
      seed.structureDefinitions.length +
      seed.accessPolicies.length +
      1 + // tcConfig
      seed.activityDefinitions.length +
      seed.planDefinitions.length +
      seed.questionnaires.length +
      seed.locations.length +
      seed.schedules.length +
      seed.practitioners.length +
      seed.practitionerRoles.length +
      seed.observationDefinitions.length;
    expect(grupos.reduce((n, [, arr]) => n + arr.length, 0)).toBe(total);
  });
});

describe('Seed — ActivityDefinition (servicios)', () => {
  it('Cada servicio tiene url, identifier y extensión precio-usd', () => {
    for (const ad of seed.activityDefinitions) {
      expect(ad.url).toMatch(/ActivityDefinition\//);
      expect(ad.identifier?.[0]?.value).toBeTruthy();
      const precio = ad.extension?.find((e) => e.url === EXT.precioUsd);
      expect(typeof precio?.valueDecimal).toBe('number');
    }
  });
});

describe('Seed — AccessPolicy de recepción (privacidad por diseño)', () => {
  const recep = seed.accessPolicies.find((p) => p.name === 'Recepción — Operativo')!;

  it('No otorga acceso a recursos clínicos sensibles', () => {
    const tipos = (recep.resource ?? []).map((r) => r.resourceType);
    for (const clinico of [
      'Observation',
      'Condition',
      'DiagnosticReport',
      'DocumentReference',
      'CarePlan',
      'MedicationRequest',
      // Programa GLP-1: la meta y los pedidos de laboratorio son clínicos.
      'Goal',
      'ServiceRequest',
    ]) {
      expect(tipos).not.toContain(clinico);
    }
    // Sí da acceso a lo operativo.
    expect(tipos).toContain('Appointment');
    expect(tipos).toContain('Invoice');
  });

  it('Solo puede ejecutar los bots de Recepción (no el que arma el plan GLP-1)', () => {
    const bots = (recep.resource ?? []).filter((r) => r.resourceType === 'Bot');
    // Ninguna entrada de Bot sin criterio: eso habilitaría cualquier bot.
    expect(bots.every((b) => b.criteria?.startsWith('Bot?name='))).toBe(true);
    const permitidos = bots.map((b) => b.criteria!.slice('Bot?name='.length));
    expect(permitidos).toEqual([...BOTS_RECEPCION]);
    expect(permitidos).toContain(BOT_GLP1_INSCRIBIR);
    expect(permitidos).not.toContain(BOT_GLP1_PLAN);
  });

  // Los criterios `Bot?name=` son por PREFIJO: un nombre habilitado no puede ser el
  // comienzo del nombre de un bot que Recepción no debe ejecutar.
  it('Ningún bot habilitado es prefijo de un bot no habilitado', () => {
    const config = JSON.parse(readFileSync(new URL('../medplum.config.json', import.meta.url), 'utf8')) as {
      bots: Array<{ name: string }>;
    };
    const habilitados = new Set<string>(BOTS_RECEPCION);
    const otros = config.bots.map((b) => b.name).filter((n) => !habilitados.has(n));
    expect(otros).toContain(BOT_GLP1_PLAN);
    for (const h of habilitados) {
      expect(otros.filter((o) => o.startsWith(h))).toEqual([]);
    }
  });

  it('Cubre todos los bots que llama la app de recepción', () => {
    const fuente = readFileSync(new URL('../app/src/lib/bots.ts', import.meta.url), 'utf8');
    const llamados = [...fuente.matchAll(/botIdPorNombre\('([^']+)'\)/g)].map((m) => m[1]);
    expect(llamados.length).toBeGreaterThan(0);
    for (const nombre of llamados) {
      expect(BOTS_RECEPCION as readonly string[]).toContain(nombre);
    }
  });
});

// `npm run deploy:bots` deploya su propia lista (`src/seed/deploy-bots.ts`): un bot que está en
// medplum.config.json pero no en esa lista nunca llega al servidor (le pasó a som-reservar-portal:
// el portal decía "La reserva online todavía no está disponible").
describe('Deploy de bots', () => {
  it('Deploya todos los bots de medplum.config.json', () => {
    const config = JSON.parse(readFileSync(new URL('../medplum.config.json', import.meta.url), 'utf8')) as {
      bots: Array<{ name: string; source: string }>;
    };
    const deploy = readFileSync(new URL('../src/seed/deploy-bots.ts', import.meta.url), 'utf8');
    const faltan = config.bots.filter((b) => !deploy.includes(`source: '${b.source}'`)).map((b) => b.name);
    expect(faltan).toEqual([]);
  });
});

describe('Seed — AccessPolicy del portal del paciente', () => {
  const portal = seed.accessPolicies.find((p) => p.name === 'Paciente SOM — Portal')!;
  const entradas = (portal.resource ?? []).map((r) => `${r.resourceType}${r.readonly ? ' (lectura)' : ''} ${r.criteria ?? ''}`.trim());

  it('Lee su seguimiento GLP-1: plan, meta, controles, pedidos y turnos (solo lo suyo)', () => {
    expect(entradas).toEqual(
      expect.arrayContaining([
        'CarePlan (lectura) CarePlan?subject=%patient',
        'Goal Goal?subject=%patient',
        'Task (lectura) Task?patient=%patient',
        'ServiceRequest (lectura) ServiceRequest?subject=%patient',
        'Appointment (lectura) Appointment?actor=%patient',
      ]),
    );
  });

  // `npm run seed` pisa la policy del servidor: si faltan estas entradas, se rompe el
  // Plan Bienestar del portal (espejo en EPA-Developments/app, docs/medplum/).
  it('Conserva lo que necesita el Plan Bienestar del portal (escritura acotada)', () => {
    expect(entradas).toEqual(
      expect.arrayContaining([
        'CarePlan CarePlan?subject=%patient&instantiates-canonical=https://epa-bienestar.ar/fhir/PlanDefinition/menopausia-cardiovascular',
        // La PlanDefinition única por estadío CKM 0–4 del catálogo firmado (fase 3).
        'CarePlan CarePlan?subject=%patient&instantiates-canonical=https://epa-bienestar.ar/fhir/PlanDefinition/pb100d-ckm',
        'Task Task?patient=%patient&intent=plan',
        'CareTeam CareTeam?subject=%patient',
        'Condition (lectura) Condition?subject=%patient',
        'PlanDefinition (lectura)',
        'Coverage (lectura) Coverage?beneficiary=%patient',
      ]),
    );
    // Escribe Condition solo con los hallazgos SNOMED del plan, nunca en general.
    expect(entradas.filter((e) => e.startsWith('Condition Condition?') && !e.includes('&code='))).toEqual([]);
  });

  it('Es idéntica al espejo del portal (EPA-Developments/app, docs/medplum/)', () => {
    const espejo = JSON.parse(
      readFileSync(new URL('./fixtures/access-policy-paciente-portal.json', import.meta.url), 'utf8'),
    ) as { name: string; resource: unknown[] };
    expect(portal.name).toBe(espejo.name);
    expect(portal.resource).toEqual(espejo.resource);
  });

  it('Escribe su Consent, el Binary de su PDF y solo su obra social (Coverage HIP)', () => {
    expect(entradas).toEqual(
      expect.arrayContaining([
        'Consent Consent?patient=%patient',
        'Binary Binary?_compartment=%patient',
        'Coverage Coverage?beneficiary=%patient&type=http://terminology.hl7.org/CodeSystem/v3-ActCode|HIP',
      ]),
    );
    // Ninguna otra escritura de Coverage (membresías y paquetes siguen de solo lectura).
    expect(entradas.filter((e) => e.startsWith('Coverage Coverage?') && !e.includes('|HIP'))).toEqual([]);
  });

  it('Solo ejecuta sus bots: reservar (R-23), solicitar turno, solicitar SOM y los de su teleconsulta', () => {
    expect(entradas.filter((e) => e.startsWith('Bot'))).toEqual([
      'Bot (lectura) Bot?name=som-reservar-portal',
      'Bot (lectura) Bot?name=som-solicitar-turno',
      'Bot (lectura) Bot?name=som-solicitar',
      'Bot (lectura) Bot?name=som-teleconsulta-entrar',
      'Bot (lectura) Bot?name=som-teleconsulta-cancelar',
      'Bot (lectura) Bot?name=som-teleconsulta-pago',
    ]);
  });

  // Los criterios `Bot?name=` son por PREFIJO: ninguno de los bots del portal puede ser el
  // comienzo del nombre de otro bot del proyecto (p. ej. `som-solicitar` y `som-solicitar-turno`,
  // que el portal ejecuta los dos).
  it('Ningún bot del portal es prefijo de un bot que el portal no ejecuta', () => {
    const config = JSON.parse(readFileSync(new URL('../medplum.config.json', import.meta.url), 'utf8')) as {
      bots: Array<{ name: string }>;
    };
    const delPortal = entradas.filter((e) => e.startsWith('Bot')).map((e) => e.split('Bot?name=')[1]!);
    const otros = config.bots.map((b) => b.name).filter((n) => !delPortal.includes(n));
    for (const h of delPortal) {
      expect(otros.filter((o) => o.startsWith(h))).toEqual([]);
    }
  });
});
