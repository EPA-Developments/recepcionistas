import { describe, it, expect } from 'vitest';
import { buildSeed } from '../src/seed/builders.js';
import { EXT } from '../src/fhir/identifiers.js';

const seed = buildSeed();

describe('Seed — composición', () => {
  it('Construye los grupos de recursos esperados', () => {
    expect(seed.structureDefinitions.length).toBeGreaterThanOrEqual(28);
    expect(seed.accessPolicies.length).toBe(6); // 5 roles internos + Paciente — Portal
    expect(seed.activityDefinitions.length).toBe(6); // cardiología + 5 subespecialidades
    expect(seed.combos.length).toBe(0); // sin combos por ahora
    expect(seed.membresias.length).toBe(0); // sin membresías por ahora
    expect(seed.paquetes.length).toBe(0); // sin paquetes por ahora
    expect(seed.locations.length).toBe(4); // consultorios + sala de rehabilitación
    expect(seed.schedules.length).toBe(4);
    expect(seed.practitioners.length).toBe(3);
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

describe('Seed — Combos (PlanDefinition)', () => {
  it('Tienen secuencia ordenada y orden-protocolo en cada acción', () => {
    for (const combo of seed.combos) {
      const sec = combo.extension?.find((e) => e.url === EXT.secuenciaOrdenada);
      expect(sec?.valueBoolean).toBe(true);
      for (const action of combo.action ?? []) {
        const orden = action.extension?.find((e) => e.url === EXT.ordenProtocolo);
        expect(typeof orden?.valueInteger).toBe('number');
      }
    }
  });
});

describe('Seed — Contraindicaciones', () => {
  it('CodeSystem en estado draft con las propiedades declaradas (tabla vacía por ahora)', () => {
    const cs = seed.contraindicaciones;
    expect(cs.status).toBe('draft');
    expect(cs.property?.some((p) => p.code === 'severidad')).toBe(true);
    // La tabla clínica cardiovascular está pendiente: no se inventan contraindicaciones.
    expect(cs.concept?.length ?? 0).toBe(0);
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
