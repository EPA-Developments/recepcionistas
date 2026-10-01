import { describe, it, expect } from 'vitest';
import type { ObservationDefinition } from '@medplum/fhirtypes';
import { buildSeed, claveObservationDefinition } from '../src/seed/builders.js';
import { BIOMARCADORES, PANEL_DESCRIPCION, PANEL_DISPLAY, biomarcadorPorSlug } from '../src/config/biomarcadores.js';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { LOINC_CKM } from '../src/lib/ckm-fhir.js';

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
  const deCategoria = (system: string) => od.category?.flatMap((c) => c.coding ?? []).find((c) => c.system === system)?.code;
  return {
    clave: `${coding?.system}|${coding?.code}`,
    unidad: od.quantitativeDetails?.unit?.coding?.[0]?.code,
    panel: deCategoria(SYSTEM.panelBiomarcador),
    nivel: deCategoria(SYSTEM.nivelLaboratorio),
    slug: od.identifier?.find((i) => i.system === SYSTEM.analito)?.value,
    rangos,
  };
}

const defs = buildSeed().observationDefinitions;
const porSlug = new Map(defs.map((d) => [comoLoLeeElPortal(d).slug, d]));
const leido = (slug: string) => comoLoLeeElPortal(porSlug.get(slug) as ObservationDefinition);

describe('Seed — laboratorio de rutina (7 grupos + Menopausia)', () => {
  it('solo rangos convencionales: ningún rango funcional ni biomarcador fuera de guía (LDL-P)', () => {
    const tipos = defs.flatMap((d) => d.qualifiedInterval ?? []).map((iv) => iv.context?.coding?.[0]?.code);
    expect(new Set(tipos)).toEqual(new Set(['convencional']));
    expect(JSON.stringify(defs)).not.toMatch(/funcional|ldl-p/i);
  });

  it('los 8 paneles publicados, cada uno con título y descripción para la paciente', () => {
    const paneles = new Set(defs.map((d) => comoLoLeeElPortal(d).panel));
    expect(paneles).toEqual(
      new Set(['metabolico', 'renal', 'electrolitos', 'cardiaco', 'inflamatorios', 'hematologia', 'endocrinologia', 'menopausia']),
    );
    for (const p of paneles) {
      expect(PANEL_DISPLAY[p as keyof typeof PANEL_DISPLAY]).toBeTruthy();
      expect(PANEL_DESCRIPCION[p as keyof typeof PANEL_DESCRIPCION]).toBeTruthy();
    }
  });

  it('esenciales: perfil básico, renal y electrolitos; el resto, extensivo', () => {
    const esenciales = new Set(defs.filter((d) => comoLoLeeElPortal(d).nivel === 'esencial').map((d) => comoLoLeeElPortal(d).panel));
    expect(esenciales).toEqual(new Set(['metabolico', 'renal', 'electrolitos']));
    expect(defs.every((d) => ['esencial', 'extensivo'].includes(comoLoLeeElPortal(d).nivel ?? ''))).toBe(true);
    expect(leido('e_gfr').nivel).toBe('esencial');
    expect(leido('creatinina_serica').nivel).toBe('esencial');
    expect(leido('nt_probnp').nivel).toBe('extensivo');
  });

  it('LOINC + UCUM; solo el HOMA-IR (sin LOINC estándar) lleva código local de SOM', () => {
    for (const d of defs) {
      expect(d.quantitativeDetails?.unit?.coding?.[0]?.system).toBe('http://unitsofmeasure.org');
      expect(d.code?.coding?.slice(1).every((c) => c.system === 'http://loinc.org')).toBe(true);
    }
    const locales = defs.filter((d) => d.code?.coding?.[0]?.system !== 'http://loinc.org');
    expect(locales.map((d) => d.code?.coding?.[0])).toEqual([{ system: SYSTEM.biomarker, code: 'homa-ir', display: 'Índice HOMA-IR' }]);
    expect(BIOMARCADORES.every((b) => b.fuente.length > 0)).toBe(true);
  });

  it('cada analito con su slug (identifier) y su código, únicos (el upsert del seed no duplica)', () => {
    const slugs = defs.map((d) => comoLoLeeElPortal(d).slug);
    expect(slugs.every((s) => s && /^[a-z0-9_]+$/.test(s))).toBe(true);
    expect(new Set(slugs).size).toBe(defs.length);
    const claves = defs.map(claveObservationDefinition);
    expect(new Set(claves).size).toBe(defs.length);
    // Ningún código aparece en dos analitos (el bot no sabría cuál elegir).
    const codigos = defs.flatMap((d) => d.code?.coding?.map((c) => `${c.system}|${c.code}`) ?? []);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(biomarcadorPorSlug('e_gfr')?.codigo).toBe('62238-1');
  });

  it('eGFR: 62238-1 (hGraph) + 33914-3 (portal, Plan Bienestar), en mL/min/1,73 m², < 60 de la guía CKM', () => {
    const egfr = porSlug.get('e_gfr') as ObservationDefinition;
    expect(egfr.code?.coding?.map((c) => c.code)).toEqual(['62238-1', '33914-3']);
    // Todos son códigos que Recepción ya reconoce como eGFR (estadificación CKM).
    expect(egfr.code?.coding?.every((c) => (LOINC_CKM.egfr as readonly string[]).includes(c.code as string))).toBe(true);
    expect(egfr.quantitativeDetails?.unit).toEqual({
      coding: [{ system: 'http://unitsofmeasure.org', code: 'mL/min/{1.73_m2}' }],
      text: 'mL/min/1,73 m²',
    });
    expect(leido('e_gfr').rangos).toEqual({ 'todos:convencional': { low: 60 } });
    expect(biomarcadorPorSlug('e_gfr')?.fuente).toMatch(/Ndumele/);
    expect(leido('acr_urinaria').rangos).toEqual({ 'todos:convencional': { high: 30 } });
  });

  it('umbrales de las guías (AHA/ACC, NCEP, ADA), tal como los lee el portal', () => {
    expect(leido('colesterol_total').rangos).toEqual({ 'todos:convencional': { high: 200 } });
    expect(leido('colesterol_hdl').rangos).toEqual({
      'todos:convencional': { low: 40 },
      'male:convencional': { low: 40 },
      'female:convencional': { low: 50 },
    });
    expect(leido('colesterol_ldl').rangos).toEqual({ 'todos:convencional': { high: 100 } });
    expect(leido('trigliceridos').rangos).toEqual({ 'todos:convencional': { high: 150 } });
    expect(leido('apo_b').rangos).toEqual({ 'todos:convencional': { high: 130 } });
    expect(leido('hs_pcr')).toMatchObject({ unidad: 'mg/L', rangos: { 'todos:convencional': { high: 2 } } });
    expect(leido('glucemia_ayunas').rangos).toEqual({ 'todos:convencional': { low: 70, high: 100 } });
    expect(leido('hba1c')).toMatchObject({ unidad: '%', rangos: { 'todos:convencional': { high: 5.7 } } });
  });

  it('Lp(a): en nmol/L (43583-4) y en mg/dL (10835-7), cada una con su corte y su unidad', () => {
    expect(leido('lp_a')).toMatchObject({ clave: 'http://loinc.org|43583-4', unidad: 'nmol/L', rangos: { 'todos:convencional': { high: 125 } } });
    expect(leido('lp_a_masa')).toMatchObject({ clave: 'http://loinc.org|10835-7', unidad: 'mg/dL', rangos: { 'todos:convencional': { high: 50 } } });
  });

  it('troponinas de alta sensibilidad: percentil 99 por sexo', () => {
    expect(leido('hs_tnt').rangos).toEqual({ 'female:convencional': { high: 14 }, 'male:convencional': { high: 22 } });
    expect(leido('hs_tni').rangos).toEqual({ 'female:convencional': { high: 10 }, 'male:convencional': { high: 12 } });
  });

  it('sin rango de guía no se publica rango: vale el del laboratorio de cada informe', () => {
    for (const slug of ['creatinina_serica', 'potasio_serico', 'tsh', 'fsh', 'estradiol', 'homa_ir']) {
      expect(porSlug.get(slug)?.qualifiedInterval).toBeUndefined();
      expect(biomarcadorPorSlug(slug)?.fuente).toMatch(/rango del laboratorio/);
    }
  });

  it('sinónimos para leer los informes y "cuenta como" para los esenciales', () => {
    const extension = (slug: string, url: string) =>
      (porSlug.get(slug)?.extension ?? []).filter((e) => e.url === url).map((e) => e.valueString);
    expect(extension('e_gfr', EXT.sinonimoAnalito)).toEqual(expect.arrayContaining(['Filtrado glomerular estimado']));
    expect(extension('bun', EXT.cuentaComo)).toEqual(['urea_serica']);
    expect(extension('colesterol_ldl_directo', EXT.cuentaComo)).toEqual(['colesterol_ldl']);
    expect(extension('calcio_ionico', EXT.cuentaComo)).toEqual(['calcio_serico']);
    // Lo que "cuenta como" otro apunta siempre a un analito del mismo nivel que existe.
    for (const b of BIOMARCADORES.filter((x) => x.cuentaComo)) {
      expect(biomarcadorPorSlug(b.cuentaComo as string)?.nivel).toBe(b.nivel);
    }
  });
});
