import { describe, it, expect } from 'vitest';
import {
  categoriaA,
  estadificarCkm,
  etiquetaEstadio,
  preIcPorEcocardiograma,
  resumenCkm,
  riesgoKdigo,
  type EntradaCkm,
} from '../src/lib/ckm.js';

/** Paciente sin factores CKM y con todos los datos básicos. */
const sano: EntradaCkm = {
  sexo: 'female',
  edad: 50,
  imc: 22,
  cintura: 75,
  glucemiaAyunas: 88,
  hba1c: 5.2,
  pas: 115,
  pad: 72,
  trigliceridos: 90,
  hdl: 60,
  egfr: 100,
  uacr: 10,
  riesgo10a: { ecvTotal: 0.02, ascvd: 0.01, ic: 0.01 },
};

describe('KDIGO — riesgo por eGFR y albuminuria (Tabla 4, nota §)', () => {
  it('A1 < 30 · A2 30 a < 300 · A3 ≥ 300 mg/g', () => {
    expect(categoriaA(29)).toBe('A1');
    expect(categoriaA(30)).toBe('A2');
    expect(categoriaA(299)).toBe('A2');
    expect(categoriaA(300)).toBe('A3');
  });

  it('moderado-alto: G1–G2 con A2–A3, G3a con A1–A2, G3b con A1 · muy alto: G3a-A3, G3b-A2/A3, G4–G5', () => {
    expect(riesgoKdigo(95, 10).riesgo).toBe('bajo');
    expect(riesgoKdigo(70, 50).riesgo).toBe('moderado');
    expect(riesgoKdigo(70, 400).riesgo).toBe('alto');
    expect(riesgoKdigo(50, 10).riesgo).toBe('moderado');
    expect(riesgoKdigo(50, 100).riesgo).toBe('alto');
    expect(riesgoKdigo(40, 10).riesgo).toBe('alto');
    expect(riesgoKdigo(50, 300).riesgo).toBe('muy-alto');
    expect(riesgoKdigo(40, 50).riesgo).toBe('muy-alto');
    expect(riesgoKdigo(20, 5).riesgo).toBe('muy-alto');
  });

  it('con un solo dato da el mínimo garantizado', () => {
    expect(riesgoKdigo(50, undefined)).toEqual({ riesgo: 'moderado', completo: false });
    expect(riesgoKdigo(undefined, 400)).toEqual({ riesgo: 'alto', completo: false });
    expect(riesgoKdigo(undefined, undefined)).toEqual({ completo: false });
  });
});

describe('Estadificación CKM — Guía AHA/ACC/ADA/ASN 2026, Tabla 4', () => {
  it('Estadío 0 con todos los datos básicos', () => {
    const r = estadificarCkm(sano);
    expect(r).toMatchObject({ estadio: '0', completo: true, criterios: [], faltantes: [] });
    expect(etiquetaEstadio(r)).toBe('Estadío 0');
    expect(resumenCkm(r)).toMatch(/Guía AHA\/ACC\/ADA\/ASN 2026.*sin factores de riesgo CKM/);
  });

  it('Estadío 1: IMC ≥ 25, cintura ≥ 88/102 cm o prediabetes', () => {
    expect(estadificarCkm({ ...sano, imc: 27 }).estadio).toBe('1');
    expect(estadificarCkm({ ...sano, cintura: 90 }).estadio).toBe('1'); // mujer ≥ 88
    expect(estadificarCkm({ ...sano, sexo: 'male', cintura: 90 }).estadio).toBe('0'); // varón < 102
    expect(estadificarCkm({ ...sano, hba1c: 6.0 }).estadio).toBe('1');
    expect(estadificarCkm({ ...sano, glucemiaAyunas: 110 }).estadio).toBe('1');
  });

  it('Estadío 2: triglicéridos ≥ 150 (no 135), HTA ≥ 130/80 o tratamiento, DM2, ERC moderada-alta', () => {
    expect(estadificarCkm({ ...sano, trigliceridos: 140 }).estadio).toBe('0');
    expect(estadificarCkm({ ...sano, trigliceridos: 150 }).criterios).toContain('hipertrigliceridemia (150 mg/dL, ≥ 150)');
    expect(estadificarCkm({ ...sano, pas: 134 }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, pad: 82 }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, tratamientoHta: true }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, hba1c: 6.8 }).criterios).toContain('diabetes tipo 2');
    expect(estadificarCkm({ ...sano, egfr: 50 }).criterios).toContain('ERC de riesgo moderado (KDIGO)');
  });

  it('síndrome metabólico AHA/NHLBI: ≥ 3 de 5 (cintura, HDL, TG ≥ 150, PA ≥ 130/80, glucemia ≥ 100)', () => {
    const r = estadificarCkm({ ...sano, cintura: 90, hdl: 45, glucemiaAyunas: 105 });
    expect(r.estadio).toBe('2');
    expect(r.criterios).toContain('síndrome metabólico (3 de 5 componentes, AHA/NHLBI)');
    // Con cintura alta y glucemia ≥ 100 pero sin HDL, falta el dato que define el síndrome.
    expect(estadificarCkm({ ...sano, cintura: 90, hdl: undefined, glucemiaAyunas: 105 }).faltantes).toContain('HDL (síndrome metabólico)');
  });

  it('Estadío 3 por equivalentes de riesgo: ERC de muy alto riesgo o PREVENT-CVD a 10 años ≥ 20 %', () => {
    expect(estadificarCkm({ ...sano, egfr: 25 }).estadio).toBe('3');
    expect(estadificarCkm({ ...sano, egfr: 50, uacr: 300 }).estadio).toBe('3');
    const prevent = estadificarCkm({ ...sano, riesgo10a: { ecvTotal: 0.21 } });
    expect(prevent.estadio).toBe('3');
    expect(prevent.criterios).toContain('PREVENT-CVD a 10 años 21,0 % (≥ 20 %)');
    expect(estadificarCkm({ ...sano, riesgo10a: { ecvTotal: 0.19 } }).estadio).toBe('0');
  });

  it('Estadío 3 por aterosclerosis subclínica: CAC ≥ 100 (no > 0), documentada o ITB ≤ 0,90 sin claudicación', () => {
    const conSustrato = { ...sano, imc: 28 };
    expect(estadificarCkm({ ...conSustrato, cac: 12 }).estadio).toBe('1');
    expect(estadificarCkm({ ...conSustrato, cac: 100 }).estadio).toBe('3');
    expect(estadificarCkm({ ...conSustrato, aterosclerosisSubclinica: true }).estadio).toBe('3');
    expect(estadificarCkm({ ...conSustrato, itb: 0.85 }).estadio).toBe('3');
    expect(estadificarCkm({ ...conSustrato, itb: 0.85, claudicacion: true }).estadio).toBe('1');
  });

  it('Estadío 3 por pre-IC: NT-proBNP ≥ 125, BNP ≥ 35, troponinas por sexo o ecocardiograma (Tabla 16)', () => {
    const conSustrato = { ...sano, imc: 28 };
    expect(estadificarCkm({ ...conSustrato, ntProBnp: 180 }).estadio).toBe('3');
    expect(estadificarCkm({ ...conSustrato, bnp: 40 }).estadio).toBe('3');
    expect(estadificarCkm({ ...conSustrato, hsTnT: 15 }).estadio).toBe('3'); // mujer ≥ 14
    expect(estadificarCkm({ ...conSustrato, sexo: 'male', hsTnT: 15 }).estadio).toBe('1'); // varón < 22
    expect(estadificarCkm({ ...conSustrato, ecocardiograma: { lavi: 31 } }).estadio).toBe('3');
    expect(estadificarCkm({ ...conSustrato, ecocardiograma: { fevi: 60, eSobreEPrima: 10 } }).estadio).toBe('1');
    const ambos = estadificarCkm({ ...conSustrato, ntProBnp: 180, ecocardiograma: { eSobreEPrima: 16 } });
    expect(ambos.observaciones.join(' ')).toMatch(/mayor riesgo de IC/);
  });

  it('la ECV subclínica sin factores CKM no es Estadío 3 (se informa)', () => {
    const r = estadificarCkm({ ...sano, ntProBnp: 180 });
    expect(r.estadio).toBe('0');
    expect(r.observaciones.join(' ')).toMatch(/no corresponde Estadío 3/);
  });

  it('Estadío 4a / 4b: ECV clínica con factores CKM; 4b con falla renal', () => {
    const a = estadificarCkm({ ...sano, hipertension: true, ecvClinica: ['coronaria'] });
    expect(a.estadio).toBe('4a');
    expect(a.criterios[0]).toBe('ECV clínica: enfermedad coronaria');
    const b = estadificarCkm({ ...sano, diabetes: true, dialisis: true, ecvClinica: ['insuficiencia-cardiaca'] });
    expect(b.estadio).toBe('4b');
    expect(estadificarCkm({ ...sano, egfr: 10, dialisis: true }).estadio).toBe('3'); // sin ECV clínica
    expect(estadificarCkm({ ...sano, ecvClinica: ['fibrilacion-auricular'] }).observaciones.join(' ')).toMatch(
      /Estadío 4 CKM requiere/,
    );
  });

  it('con datos incompletos informa "al menos" y qué falta (UACR recién desde el Estadío 2)', () => {
    const r = estadificarCkm({ imc: 27, edad: 50 });
    expect(etiquetaEstadio(r)).toBe('al menos Estadío 1');
    expect(r.faltantes).toEqual(
      expect.arrayContaining(['glucemia en ayunas o HbA1c', 'triglicéridos', 'presión arterial', 'eGFR', 'PREVENT-CVD a 10 años']),
    );
    expect(r.faltantes).not.toContain('albuminuria (UACR)');
    expect(estadificarCkm({ ...sano, tratamientoHta: true, uacr: undefined }).faltantes).toContain('albuminuria (UACR)');
  });

  it('advierte diagnósticos basados en una sola medición', () => {
    const hta = estadificarCkm({ ...sano, pas: 138, lecturasPa: 1 });
    expect(hta.observaciones.join(' ')).toMatch(/≥ 2 lecturas en ≥ 2 ocasiones/);
    const erc = estadificarCkm({ ...sano, egfr: 55, ercPersistente: false });
    expect(erc.observaciones.join(' ')).toMatch(/≥ 2 mediciones separadas ≥ 3 meses/);
  });

  it('fuera de 30–79 años no usa PREVENT como criterio ni lo marca faltante', () => {
    const r = estadificarCkm({ ...sano, edad: 82, riesgo10a: undefined });
    expect(r.faltantes).not.toContain('PREVENT-CVD a 10 años');
    expect(r.observaciones.join(' ')).toMatch(/30–79 años/);
  });
});

describe('Pre-IC por ecocardiograma (Tabla 16)', () => {
  it('aplica cada umbral (masa del VI por sexo; GLS en valor absoluto)', () => {
    const todos = preIcPorEcocardiograma(
      { lavi: 29, lvmi: 100, rwt: 0.43, espesorPared: 12, fevi: 45, gls: -15, eSeptal: 6, velocidadIt: 2.9, psap: 36, eSobreEPrima: 15 },
      'female',
    );
    expect(todos).toHaveLength(10);
    expect(preIcPorEcocardiograma({ lvmi: 100 }, 'male')).toEqual([]); // varón > 116
    expect(preIcPorEcocardiograma({ lavi: 28, rwt: 0.42, fevi: 50, gls: -18 }, 'female')).toEqual([]);
  });
});
