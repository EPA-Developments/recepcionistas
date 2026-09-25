import { describe, it, expect } from 'vitest';
import {
  calcularPrevent,
  ORDEN_PREVENT,
  PENDIENTE_VALIDACION,
  riesgoPrevent,
  type EntradaPrevent,
  type ResultadoPrevent,
} from '../src/lib/prevent.js';

/**
 * Valores de referencia: casos de prueba de la implementación de referencia de las
 * ecuaciones PREVENT (`preventr`, CRAN — tests/testthat/test-estimate_risk.R,
 * "Base model works, female/male"). Entrada: 50 años, PAS 160 mmHg tratada, CT 200,
 * HDL 45 mg/dL, sin estatina, diabetes, no fuma, eGFR 90, IMC 35.
 */
const referencia: Omit<EntradaPrevent, 'sexo'> = {
  edad: 50,
  sbp: 160,
  tratamientoHta: true,
  colesterolTotalMgDl: 200,
  hdlMgDl: 45,
  estatina: false,
  diabetes: true,
  fumador: false,
  egfr: 90,
  imc: 35,
};

const redondeo3 = (r: ResultadoPrevent, d: 'ascvd' | 'heart-failure' | 'total-cvd', h: 10 | 30) =>
  Math.round((riesgoPrevent(r, d, h) ?? NaN) * 1000) / 1000;

describe('PREVENT — modelo base contra los valores de referencia publicados', () => {
  it('mujer: ECV 0,147 · ASCVD 0,092 · IC 0,081 (10 años) y ECV 0,53 · ASCVD 0,354 · IC 0,39 (30 años)', () => {
    const r = calcularPrevent({ ...referencia, sexo: 'female' });
    expect(redondeo3(r, 'total-cvd', 10)).toBe(0.147);
    expect(redondeo3(r, 'ascvd', 10)).toBe(0.092);
    expect(redondeo3(r, 'heart-failure', 10)).toBe(0.081);
    expect(redondeo3(r, 'total-cvd', 30)).toBe(0.53);
    expect(redondeo3(r, 'ascvd', 30)).toBe(0.354);
    expect(redondeo3(r, 'heart-failure', 30)).toBe(0.39);
  });

  it('varón: ECV 0,163 · ASCVD 0,102 · IC 0,106 (10 años) y ECV 0,514 · ASCVD 0,349 · IC 0,424 (30 años)', () => {
    const r = calcularPrevent({ ...referencia, sexo: 'male' });
    expect(redondeo3(r, 'total-cvd', 10)).toBe(0.163);
    expect(redondeo3(r, 'ascvd', 10)).toBe(0.102);
    expect(redondeo3(r, 'heart-failure', 10)).toBe(0.106);
    expect(redondeo3(r, 'total-cvd', 30)).toBe(0.514);
    expect(redondeo3(r, 'ascvd', 30)).toBe(0.349);
    expect(redondeo3(r, 'heart-failure', 30)).toBe(0.424);
  });
});

describe('PREVENT — orden, rangos válidos y datos faltantes', () => {
  const base: EntradaPrevent = { ...referencia, sexo: 'male', edad: 55 };

  it('sigue marcado pendiente de la firma médica', () => {
    expect(PENDIENTE_VALIDACION).toBe(true);
    expect(calcularPrevent(base).pendienteValidacion).toBe(true);
  });

  it('devuelve los 6 desenlaces en el orden del contrato (ASCVD 10a, IC 10a, ECV 30a primero)', () => {
    expect(calcularPrevent(base).predicciones.map((p) => `${p.desenlace}/${p.horizonte}`)).toEqual(
      ORDEN_PREVENT.map((o) => `${o.desenlace}/${o.horizonte}`),
    );
    expect(ORDEN_PREVENT.slice(0, 3).map((o) => `${o.desenlace}/${o.horizonte}`)).toEqual([
      'ascvd/10',
      'heart-failure/10',
      'total-cvd/30',
    ]);
  });

  it('el riesgo a 30 años solo para 30–59 años; fuera de 30–79 no estima nada', () => {
    const r65 = calcularPrevent({ ...base, edad: 65 });
    expect(r65.predicciones.every((p) => p.horizonte === 10)).toBe(true);
    expect(r65.noEstimadas.map((n) => n.horizonte)).toEqual([30, 30, 30]);
    const r82 = calcularPrevent({ ...base, edad: 82 });
    expect(r82.predicciones).toEqual([]);
    expect(r82.faltantes[0]).toMatch(/30–79/);
  });

  it('sin IMC no estima IC; con colesterol fuera de rango no estima ECV ni ASCVD', () => {
    const sinImc = calcularPrevent({ ...base, imc: undefined });
    expect(sinImc.predicciones.some((p) => p.desenlace === 'heart-failure')).toBe(false);
    expect(sinImc.noEstimadas.find((n) => n.desenlace === 'heart-failure')?.motivo).toBe('falta IMC');
    const colAlto = calcularPrevent({ ...base, colesterolTotalMgDl: 350 });
    expect(colAlto.predicciones.map((p) => p.desenlace)).toEqual(['heart-failure', 'heart-failure']);
  });

  it('monotonía: más presión, tabaquismo, diabetes o edad ⇒ más riesgo de ECV', () => {
    const cvd = (e: EntradaPrevent) => riesgoPrevent(calcularPrevent(e), 'total-cvd', 10)!;
    const sano = { ...base, sbp: 120, tratamientoHta: false, diabetes: false };
    expect(cvd({ ...sano, sbp: 150 })).toBeGreaterThan(cvd(sano));
    expect(cvd({ ...sano, fumador: true })).toBeGreaterThan(cvd(sano));
    expect(cvd({ ...sano, diabetes: true })).toBeGreaterThan(cvd(sano));
    expect(cvd({ ...sano, edad: 70 })).toBeGreaterThan(cvd(sano));
  });
});
