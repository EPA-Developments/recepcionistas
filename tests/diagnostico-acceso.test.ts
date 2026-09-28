import { describe, expect, it } from 'vitest';
import type { AccessPolicy } from '@medplum/fhirtypes';
import { POLICY_PACIENTE_PORTAL } from '../src/fhir/access-policies.js';
import { RECURSOS_CLAVE_PORTAL, describirEntrada, diagnosticarPolicy, tiposConcedidos } from '../src/lib/diagnostico-acceso.js';

/** La policy tal como quedó en el servidor antes de la agenda por profesional (R-22). */
const POLICY_VIEJA: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: POLICY_PACIENTE_PORTAL.name,
  resource: (POLICY_PACIENTE_PORTAL.resource ?? []).filter(
    (r) => !['PractitionerRole', 'Schedule', 'Slot', 'Location', 'HealthcareService', 'Organization'].includes(r.resourceType ?? '')
  ),
};

describe('Diagnóstico de acceso — recursos que busca el portal', () => {
  it('Todos los recursos clave están concedidos por la policy del repo', () => {
    const tipos = tiposConcedidos(POLICY_PACIENTE_PORTAL);
    for (const r of RECURSOS_CLAVE_PORTAL) {
      expect(tipos.has(r.resourceType), `${r.resourceType} (${r.pantalla}) no está en la policy del portal`).toBe(true);
    }
  });

  it('Cubre la reserva de turnos: catálogo, profesionales, agenda y horarios', () => {
    const tipos = RECURSOS_CLAVE_PORTAL.map((r) => r.resourceType);
    expect(tipos).toEqual(expect.arrayContaining(['ActivityDefinition', 'PractitionerRole', 'Schedule', 'Slot']));
    expect(new Set(tipos).size).toBe(tipos.length);
  });

  it('La policy del repo se diagnostica sin faltantes', () => {
    expect(diagnosticarPolicy(POLICY_PACIENTE_PORTAL)).toEqual({ faltantes: [], entradasFaltantes: [] });
  });

  it('Con la policy anterior a R-22 nombra los recursos de la reserva y la pantalla que se rompe', () => {
    const d = diagnosticarPolicy(POLICY_VIEJA);
    expect(d.faltantes.map((f) => f.resourceType)).toEqual(['PractitionerRole', 'Schedule', 'Slot']);
    expect(d.faltantes[0]?.pantalla).toContain('Reservar un turno');
    // Y dice que el seed no corrió: las entradas del repo que el servidor no tiene.
    expect(d.entradasFaltantes).toEqual([
      'Schedule (solo lectura)',
      'Slot (solo lectura)',
      'HealthcareService (solo lectura)',
      'PractitionerRole (solo lectura)',
      'Location (solo lectura)',
      'Organization (solo lectura)',
    ]);
  });

  it('Detecta una policy sin ninguna concesión del portal (la del catálogo anterior)', () => {
    const d = diagnosticarPolicy({ resourceType: 'AccessPolicy', name: 'Otra', resource: [{ resourceType: 'Patient' }] });
    expect(d.faltantes).toHaveLength(RECURSOS_CLAVE_PORTAL.length);
    expect(d.entradasFaltantes.length).toBe((POLICY_PACIENTE_PORTAL.resource ?? []).length);
  });

  it('Distingue una entrada de escritura acotada de la misma de solo lectura', () => {
    // El paciente escribe el CarePlan del plan pb100d-ckm: si el servidor solo lo tiene de
    // solo lectura, el portal no puede empezar el plan. La comparación lo nota.
    const soloLectura: AccessPolicy = {
      ...POLICY_PACIENTE_PORTAL,
      resource: (POLICY_PACIENTE_PORTAL.resource ?? []).map((r) =>
        r.criteria?.includes('pb100d-ckm') ? { ...r, readonly: true } : r
      ),
    };
    const d = diagnosticarPolicy(soloLectura);
    expect(d.faltantes).toEqual([]);
    expect(d.entradasFaltantes).toEqual([
      'CarePlan?subject=%patient&instantiates-canonical=https://epa-bienestar.ar/fhir/PlanDefinition/pb100d-ckm',
    ]);
    expect(describirEntrada({ resourceType: 'Slot', readonly: true })).toBe('Slot (solo lectura)');
  });
});
