import { describe, it, expect } from 'vitest';
import type { Consent } from '@medplum/fhirtypes';
import { getServicio } from '../src/config/catalogo.js';
import { COD, SYSTEM } from '../src/fhir/identifiers.js';
import {
  V3_ACT_CODE,
  codingModalidad,
  construirConsentimientoTeleconsulta,
  esConsentimientoTeleconsulta,
  modalidadDe,
  modalidadDeCoding,
  extensionModalidad,
  nombreSalaJitsi,
  urlTeleconsulta,
  validarConsentimientoTeleconsulta,
  validarModalidadServicio,
} from '../src/lib/teleconsulta.js';

const AHORA = new Date('2026-09-25T12:00:00Z');

describe('Modalidad ↔ HL7 v3 ActCode (el mismo código de Encounter.class)', () => {
  it('presencial = AMB, teleconsulta = VR, ida y vuelta', () => {
    expect(codingModalidad('presencial')).toEqual({ system: V3_ACT_CODE, code: 'AMB', display: 'ambulatory' });
    expect(codingModalidad('teleconsulta')).toEqual({ system: V3_ACT_CODE, code: 'VR', display: 'virtual' });
    expect(modalidadDeCoding(codingModalidad('teleconsulta'))).toBe('teleconsulta');
    expect(modalidadDeCoding({ system: 'otro', code: 'VR' })).toBeUndefined();
    expect(modalidadDe({ extension: [extensionModalidad('teleconsulta')] })).toBe('teleconsulta');
    expect(modalidadDe({})).toBeUndefined();
  });
});

describe('Consentimiento de teleconsulta (R-21)', () => {
  const firmado = construirConsentimientoTeleconsulta('Patient/p1', AHORA, 'Acepto la teleconsulta.');

  it('el que arma el contrato es reconocido', () => {
    expect(firmado.policyRule?.coding?.[0]).toMatchObject({ system: SYSTEM.consentimiento, code: COD.consentimientoTeleconsulta });
    expect(firmado.scope.coding?.[0]?.code).toBe('treatment');
    expect(firmado.category[0]?.coding?.[0]).toMatchObject({ system: 'http://loinc.org', code: '59284-0' });
    expect(esConsentimientoTeleconsulta(firmado, AHORA)).toBe(true);
  });

  it('no vale si está inactivo, si es otro consentimiento o si venció', () => {
    expect(esConsentimientoTeleconsulta({ ...firmado, status: 'inactive' }, AHORA)).toBe(false);
    const procesamiento: Consent = {
      ...firmado,
      policyRule: { coding: [{ system: SYSTEM.consentimiento, code: 'procesamiento-datos-salud' }] },
    };
    expect(esConsentimientoTeleconsulta(procesamiento, AHORA)).toBe(false);
    const vencido: Consent = { ...firmado, provision: { type: 'permit', period: { end: '2026-01-01' } } };
    expect(esConsentimientoTeleconsulta(vencido, AHORA)).toBe(false);
  });

  it('bloquea la teleconsulta sin consentimiento; lo presencial no lo pide', () => {
    expect(validarConsentimientoTeleconsulta('teleconsulta', false)).toMatchObject({
      ok: false,
      bloqueos: [{ regla: 'R-21' }],
    });
    expect(validarConsentimientoTeleconsulta('teleconsulta', true).ok).toBe(true);
    expect(validarConsentimientoTeleconsulta('presencial', false).ok).toBe(true);
  });

  it('bloquea una modalidad que el servicio no ofrece', () => {
    expect(validarModalidadServicio(getServicio('CONTROL_GLP1'), 'teleconsulta')).toMatchObject({ ok: false, bloqueos: [{ regla: 'R-21' }] });
    expect(validarModalidadServicio(getServicio('NUTRICION'), 'teleconsulta').ok).toBe(true);
  });
});

describe('Link de la videollamada (Jitsi)', () => {
  const aleatorio = '0123456789abcdef0123456789abcdef';

  it('sala imposible de adivinar, sin datos del paciente', () => {
    expect(nombreSalaJitsi(aleatorio)).toBe(`som-${aleatorio}`);
    expect(nombreSalaJitsi(aleatorio.toUpperCase())).toBe(`som-${aleatorio}`);
    expect(() => nombreSalaJitsi('abc123')).toThrow(/128 bits/);
  });

  it('link sobre el Jitsi de SOM (solo https)', () => {
    const sala = nombreSalaJitsi(aleatorio);
    expect(urlTeleconsulta('https://meet.ejemplo.org', sala)).toBe(`https://meet.ejemplo.org/${sala}`);
    expect(urlTeleconsulta('https://meet.ejemplo.org/salas/', sala)).toBe(`https://meet.ejemplo.org/salas/${sala}`);
    expect(urlTeleconsulta('http://meet.ejemplo.org', sala)).toBeUndefined();
    expect(urlTeleconsulta('no es una url', sala)).toBeUndefined();
    expect(urlTeleconsulta(undefined, sala)).toBeUndefined();
  });
});
