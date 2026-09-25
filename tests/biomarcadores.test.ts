import { describe, it, expect } from 'vitest';
import type { ObservationDefinition } from '@medplum/fhirtypes';
import { buildSeed, claveObservationDefinition } from '../src/seed/builders.js';
import { BIOMARCADORES } from '../src/config/biomarcadores.js';
import { SYSTEM } from '../src/fhir/identifiers.js';

/**
 * Lo que el portal extrae de cada ObservationDefinition (misma lógica que
 * `parseServerBiomarker` en EPA-Developments/app, src/fhir/biomarkers.ts).
 */
function comoLoLeeElPortal(od: ObservationDefinition) {
  const coding = od.code?.coding?.[0];
  const rangos: Record<string, { low?: number; high?: number }> = {};
  for (const iv of od.qualifiedInterval ?? []) {
    const tipo = iv.context?.coding?.find((c) => c.system === SYSTEM.tipoRango)?.code;
    rangos[`${iv.gender ?? 'todos'}:${tipo}`] = { low: iv.range?.low?.value, high: iv.range?.high?.value };
  }
  return {
    clave: `${coding?.system}|${coding?.code}`,
    unidad: od.quantitativeDetails?.unit?.coding?.[0]?.code,
    panel: od.category?.flatMap((c) => c.coding ?? []).find((c) => c.system === SYSTEM.panelBiomarcador)?.code,
    rangos,
  };
}

const defs = buildSeed().observationDefinitions;
const porCodigo = new Map(defs.map((d) => [d.code?.coding?.[0]?.code, comoLoLeeElPortal(d)]));

describe('Seed — biomarcadores de salud convencional (panel Cardiometabólico)', () => {
  it('solo rangos convencionales: ningún rango funcional ni biomarcador fuera de guía (LDL-P)', () => {
    const tipos = defs.flatMap((d) => d.qualifiedInterval ?? []).map((iv) => iv.context?.coding?.[0]?.code);
    expect(new Set(tipos)).toEqual(new Set(['convencional']));
    expect(JSON.stringify(defs)).not.toMatch(/funcional|ldl-p/i);
  });

  it('todos LOINC + UCUM, en el panel metabolico, con la guía citada', () => {
    for (const d of defs) {
      expect(d.code?.coding?.[0]?.system).toBe('http://loinc.org');
      expect(d.quantitativeDetails?.unit?.coding?.[0]?.system).toBe('http://unitsofmeasure.org');
    }
    expect(defs.every((d) => comoLoLeeElPortal(d).panel === 'metabolico')).toBe(true);
    expect(BIOMARCADORES.every((b) => b.fuente.length > 0)).toBe(true);
  });

  it('umbrales de las guías (AHA/ACC, NCEP, ADA), tal como los lee el portal', () => {
    expect(porCodigo.get('2093-3')?.rangos).toEqual({ 'todos:convencional': { high: 200 } });
    expect(porCodigo.get('2085-9')?.rangos).toEqual({
      'todos:convencional': { low: 40 },
      'male:convencional': { low: 40 },
      'female:convencional': { low: 50 },
    });
    expect(porCodigo.get('13457-7')?.rangos).toEqual({ 'todos:convencional': { high: 100 } });
    expect(porCodigo.get('2571-8')?.rangos).toEqual({ 'todos:convencional': { high: 150 } });
    expect(porCodigo.get('1884-6')?.rangos).toEqual({ 'todos:convencional': { high: 130 } });
    expect(porCodigo.get('10835-7')).toMatchObject({ unidad: 'nmol/L', rangos: { 'todos:convencional': { high: 125 } } });
    expect(porCodigo.get('1558-6')?.rangos).toEqual({ 'todos:convencional': { low: 70, high: 100 } });
    expect(porCodigo.get('4548-4')).toMatchObject({ unidad: '%', rangos: { 'todos:convencional': { high: 5.7 } } });
  });

  it('una clave única por biomarcador (el upsert del seed no duplica)', () => {
    const claves = defs.map(claveObservationDefinition);
    expect(new Set(claves).size).toBe(defs.length);
  });
});
