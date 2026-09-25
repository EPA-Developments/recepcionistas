import { describe, it, expect } from 'vitest';
import { estadificarCkm, etiquetaEstadio, resumenCkm, riesgoKdigo, type EntradaCkm } from '../src/lib/ckm.js';

/** Paciente sin factores CKM y con todos los datos básicos. */
const sano: EntradaCkm = {
  sexo: 'female',
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

describe('KDIGO — riesgo por eGFR y albuminuria', () => {
  it('mapa de calor G × A', () => {
    expect(riesgoKdigo(95, 10)).toEqual({ riesgo: 'bajo', completo: true });
    expect(riesgoKdigo(70, 50)).toEqual({ riesgo: 'moderado', completo: true });
    expect(riesgoKdigo(70, 400)).toEqual({ riesgo: 'alto', completo: true });
    expect(riesgoKdigo(50, 10)).toEqual({ riesgo: 'moderado', completo: true });
    expect(riesgoKdigo(40, 50)).toEqual({ riesgo: 'muy-alto', completo: true });
    expect(riesgoKdigo(20, 5)).toEqual({ riesgo: 'muy-alto', completo: true });
  });

  it('con un solo dato da el mínimo garantizado', () => {
    expect(riesgoKdigo(50, undefined)).toEqual({ riesgo: 'moderado', completo: false });
    expect(riesgoKdigo(undefined, 400)).toEqual({ riesgo: 'alto', completo: false });
    expect(riesgoKdigo(undefined, undefined)).toEqual({ completo: false });
  });
});

describe('Estadificación CKM (AHA 2023, Ndumele)', () => {
  it('Estadío 0 con todos los datos básicos', () => {
    const r = estadificarCkm(sano);
    expect(r).toMatchObject({ estadio: '0', completo: true, criterios: [], faltantes: [] });
    expect(etiquetaEstadio(r)).toBe('Estadío 0');
  });

  it('Estadío 1: IMC ≥ 25, cintura por sexo o prediabetes', () => {
    expect(estadificarCkm({ ...sano, imc: 27 }).estadio).toBe('1');
    expect(estadificarCkm({ ...sano, cintura: 90 }).estadio).toBe('1'); // mujer ≥ 88
    expect(estadificarCkm({ ...sano, sexo: 'male', cintura: 90 }).estadio).toBe('0'); // varón < 102
    expect(estadificarCkm({ ...sano, hba1c: 6.0 }).estadio).toBe('1');
    expect(estadificarCkm({ ...sano, glucemiaAyunas: 110 }).estadio).toBe('1');
  });

  it('Estadío 2: triglicéridos ≥ 135, HTA, diabetes o ERC de riesgo moderado/alto', () => {
    expect(estadificarCkm({ ...sano, trigliceridos: 140 }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, pas: 134 }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, tratamientoHta: true }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, hba1c: 6.8 }).estadio).toBe('2');
    expect(estadificarCkm({ ...sano, egfr: 50 }).criterios).toContain('ERC de riesgo moderado (KDIGO)');
  });

  it('síndrome metabólico cuenta sus componentes (≥ 3 de 5)', () => {
    const r = estadificarCkm({ ...sano, cintura: 90, hdl: 45, glucemiaAyunas: 105 });
    expect(r.estadio).toBe('2');
    expect(r.criterios).toContain('síndrome metabólico (3 de 5 componentes)');
  });

  it('Estadío 3: ERC de muy alto riesgo o riesgo PREVENT ≥ 20 % (equivalentes de riesgo)', () => {
    expect(estadificarCkm({ ...sano, egfr: 25 }).estadio).toBe('3');
    expect(estadificarCkm({ ...sano, egfr: 40, uacr: 50 }).estadio).toBe('3');
    expect(estadificarCkm({ ...sano, riesgo10a: { ascvd: 0.22 } }).estadio).toBe('3');
  });

  it('Estadío 3: ECV subclínica solo con sustrato CKM (umbrales de troponina por sexo)', () => {
    expect(estadificarCkm({ ...sano, imc: 28, ntProBnp: 180 }).estadio).toBe('3');
    expect(estadificarCkm({ ...sano, imc: 28, hsTnT: 15 }).estadio).toBe('3'); // mujer ≥ 14
    expect(estadificarCkm({ ...sano, sexo: 'male', imc: 28, hsTnT: 15 }).estadio).toBe('1'); // varón < 22
    expect(estadificarCkm({ ...sano, imc: 28, cac: 12 }).estadio).toBe('3');
    const sinSustrato = estadificarCkm({ ...sano, ntProBnp: 180 });
    expect(sinSustrato.estadio).toBe('0');
    expect(sinSustrato.observaciones.join(' ')).toMatch(/no corresponde Estadío 3/);
  });

  it('Estadío 4a / 4b: ECV clínica con sustrato; 4b con falla renal', () => {
    const a = estadificarCkm({ ...sano, hipertension: true, ecvClinica: ['coronaria'] });
    expect(a.estadio).toBe('4a');
    expect(a.criterios[0]).toBe('ECV clínica: enfermedad coronaria');
    const b = estadificarCkm({ ...sano, diabetes: true, dialisis: true, ecvClinica: ['insuficiencia-cardiaca'] });
    expect(b.estadio).toBe('4b');
  });

  it('diálisis sin ECV clínica es Estadío 3 (ERC de muy alto riesgo), no 4b', () => {
    expect(estadificarCkm({ ...sano, egfr: 10, dialisis: true }).estadio).toBe('3');
  });

  it('ECV clínica sin factores CKM documentados no se etiqueta Estadío 4 CKM', () => {
    const r = estadificarCkm({ ...sano, ecvClinica: ['fibrilacion-auricular'] });
    expect(r.estadio).toBe('0');
    expect(r.observaciones.join(' ')).toMatch(/Estadío 4 CKM requiere/);
  });

  it('con datos incompletos informa "al menos" y qué falta', () => {
    const r = estadificarCkm({ imc: 27 });
    expect(etiquetaEstadio(r)).toBe('al menos Estadío 1');
    expect(r.faltantes).toEqual(
      expect.arrayContaining(['glucemia en ayunas o HbA1c', 'triglicéridos', 'presión arterial', 'eGFR', 'albuminuria (UACR)']),
    );
    expect(r.subclinicaSinEvaluar).toEqual(['NT-proBNP o troponina us', 'calcio coronario']);
    expect(resumenCkm(r)).toMatch(/al menos Estadío 1/);
  });

  it('la ECV subclínica no evaluada no vuelve incompleto el resultado', () => {
    const r = estadificarCkm({ ...sano, imc: 27 });
    expect(r).toMatchObject({ estadio: '1', completo: true });
    expect(r.subclinicaSinEvaluar.length).toBeGreaterThan(0);
  });
});
