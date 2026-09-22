import { describe, it, expect } from 'vitest';
import { buildSeed } from '../src/seed/builders.js';
import { EXT } from '../src/fhir/identifiers.js';
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
    expect(seed.activityDefinitions.length).toBe(6); // cardiología + 5 subespecialidades
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
  it('No otorga acceso a recursos clínicos sensibles', () => {
    const recep = seed.accessPolicies.find((p) => p.name === 'Recepción — Operativo')!;
    const tipos = (recep.resource ?? []).map((r) => r.resourceType);
    for (const clinico of ['Observation', 'Condition', 'DiagnosticReport', 'DocumentReference', 'CarePlan', 'MedicationRequest']) {
      expect(tipos).not.toContain(clinico);
    }
    // Sí da acceso a lo operativo.
    expect(tipos).toContain('Appointment');
    expect(tipos).toContain('Invoice');
  });
});
