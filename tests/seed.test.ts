import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSeed } from '../src/seed/builders.js';
import { BOT_GLP1_INSCRIBIR, BOT_GLP1_PLAN, EXT, PLAN_GLP1_URL } from '../src/fhir/identifiers.js';
import { BOTS_RECEPCION } from '../src/fhir/access-policies.js';
import { MEDICOS } from '../src/config/medicos.js';

const seed = buildSeed();

describe('Seed — composición', () => {
  it('Construye los grupos de recursos esperados', () => {
    expect(seed.structureDefinitions.length).toBeGreaterThanOrEqual(10);
    // Roles de SOM: los del catálogo anterior (prescriptor, enfermería, terapeuta) se retiraron.
    expect(seed.accessPolicies.map((p) => p.name)).toEqual([
      'Recepción — Operativo',
      'Director Médico — Clínico completo',
      'Paciente SOM — Portal',
    ]);
    expect(seed.activityDefinitions.length).toBe(7); // cardiología + 5 subespecialidades + control GLP-1
    expect(seed.planDefinitions.map((p) => p.url)).toEqual([PLAN_GLP1_URL]);
    expect(seed.locations.length).toBe(4); // consultorios + sala de rehabilitación
    expect(seed.schedules.length).toBe(4);
    // Profesionales: uno por médico de config (el catálogo nuevo de SOM los carga).
    expect(seed.practitioners.length).toBe(MEDICOS.length);
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

  it('Cubre todos los bots que llama la app de recepción', () => {
    const fuente = readFileSync(new URL('../app/src/lib/bots.ts', import.meta.url), 'utf8');
    const llamados = [...fuente.matchAll(/botIdPorNombre\('([^']+)'\)/g)].map((m) => m[1]);
    expect(llamados.length).toBeGreaterThan(0);
    for (const nombre of llamados) {
      expect(BOTS_RECEPCION as readonly string[]).toContain(nombre);
    }
  });
});

describe('Seed — AccessPolicy del portal del paciente', () => {
  it('El paciente lee su meta del programa (Goal), solo la suya', () => {
    const portal = seed.accessPolicies.find((p) => p.name === 'Paciente SOM — Portal')!;
    const goal = portal.resource?.find((r) => r.resourceType === 'Goal');
    expect(goal).toMatchObject({ readonly: true, criteria: 'Goal?subject=%patient' });
  });
});
