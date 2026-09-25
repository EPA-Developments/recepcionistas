import { describe, it, expect } from 'vitest';
import type { ObservationDefinition } from '@medplum/fhirtypes';
import { quitarRangosFuncionales } from '../src/lib/rangos-convencionales.js';
import { SYSTEM } from '../src/fhir/identifiers.js';

const iv = (tipo: string, high: number, gender?: 'male' | 'female') => ({
  context: { coding: [{ system: SYSTEM.tipoRango, code: tipo }] },
  range: { high: { value: high } },
  ...(gender ? { gender } : {}),
});

describe('Salud convencional — quitar rangos funcionales del servidor', () => {
  it('quita solo los funcionales y conserva los convencionales (también por sexo)', () => {
    const od: ObservationDefinition = {
      resourceType: 'ObservationDefinition',
      id: 'od1',
      code: { coding: [{ system: 'http://loinc.org', code: '1558-6' }] },
      qualifiedInterval: [iv('convencional', 100), iv('funcional', 85), iv('convencional', 100, 'female')],
    };
    const r = quitarRangosFuncionales(od);
    expect(r).toMatchObject({ quitados: 1, sinRangos: false });
    expect(r.definicion.id).toBe('od1');
    expect(r.definicion.qualifiedInterval?.map((x) => x.context?.coding?.[0]?.code)).toEqual(['convencional', 'convencional']);
  });

  it('avisa si la definición solo tenía rangos funcionales', () => {
    const od: ObservationDefinition = {
      resourceType: 'ObservationDefinition',
      code: { text: 'HOMA-IR' },
      qualifiedInterval: [iv('funcional', 1.5)],
    };
    const r = quitarRangosFuncionales(od);
    expect(r).toMatchObject({ quitados: 1, sinRangos: true });
    expect(r.definicion.qualifiedInterval).toBeUndefined();
  });

  it('sin rangos funcionales no cambia nada', () => {
    const od: ObservationDefinition = { resourceType: 'ObservationDefinition', code: { text: 'x' }, qualifiedInterval: [iv('convencional', 1)] };
    expect(quitarRangosFuncionales(od).quitados).toBe(0);
  });
});
