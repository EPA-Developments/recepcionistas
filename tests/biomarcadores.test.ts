import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Bundle, ObservationDefinition } from '@medplum/fhirtypes';
import { buildSeed, claveObservationDefinition } from '../src/seed/builders.js';
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
    titulo: coding?.display ?? od.code?.text,
    unidad: od.quantitativeDetails?.unit?.coding?.[0]?.code ?? od.quantitativeDetails?.unit?.text,
    panel: od.category?.flatMap((c) => c.coding ?? []).find((c) => c.system === SYSTEM.panelBiomarcador)?.code,
    rangos,
  };
}

const espejo = JSON.parse(
  readFileSync(new URL('./fixtures/cardiometabolico-lipidos.json', import.meta.url), 'utf8'),
) as Bundle<ObservationDefinition>;
const delPortal = (espejo.entry ?? []).map((e) => comoLoLeeElPortal(e.resource!));
const delSeed = buildSeed().observationDefinitions.map(comoLoLeeElPortal);

describe('Seed — ObservationDefinition de lípidos (panel Cardiometabólico)', () => {
  it('publica los 7 lípidos del panel metabolico, con el mismo código, nombre y unidad que el portal', () => {
    expect(delSeed.map((b) => b.clave)).toEqual(delPortal.map((b) => b.clave));
    for (const [i, b] of delSeed.entries()) {
      expect(b).toMatchObject({ titulo: delPortal[i]!.titulo, unidad: delPortal[i]!.unidad, panel: 'metabolico' });
    }
  });

  it('mismos rangos que la tabla institucional, salvo el funcional de Colesterol total (revisión médica)', () => {
    for (const [i, b] of delSeed.entries()) {
      const esperados = { ...delPortal[i]!.rangos };
      if (b.clave === 'http://loinc.org|2093-3') {
        delete esperados['todos:funcional'];
      }
      expect(b.rangos).toEqual(esperados);
    }
  });

  it('unidades UCUM y una clave única por biomarcador (el upsert del seed no duplica)', () => {
    const defs = buildSeed().observationDefinitions;
    expect(defs.every((d) => d.quantitativeDetails?.unit?.coding?.[0]?.system === 'http://unitsofmeasure.org')).toBe(true);
    const claves = defs.map(claveObservationDefinition);
    expect(new Set(claves).size).toBe(defs.length);
    expect(claves).toContain(`${SYSTEM.biomarker}|ldl-p`);
  });
});
