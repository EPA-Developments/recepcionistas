import { describe, it, expect } from 'vitest';
import { calcularPrevent, PENDIENTE_VALIDACION, type EntradaPrevent } from '../src/lib/prevent.js';

/**
 * Tests ESTRUCTURALES de PREVENT (no de valor exacto): los coeficientes están
 * pendientes de validación clínica, así que verificamos invariantes del modelo
 * (rango, monotonía, ramas por sexo, requisitos de datos) y no porcentajes fijos.
 */
const base: EntradaPrevent = {
  sexo: 'male',
  edad: 55,
  colesterolTotalMgDl: 200,
  hdlMgDl: 50,
  sbp: 120,
  tratamientoHta: false,
  diabetes: false,
  fumador: false,
  egfr: 90,
  estatina: false,
  imc: 27,
};

describe('PREVENT — invariantes', () => {
  it('marca que está pendiente de validación', () => {
    expect(PENDIENTE_VALIDACION).toBe(true);
    expect(calcularPrevent(base).pendienteValidacion).toBe(true);
  });

  it('produce las 3 predicciones del contrato (ASCVD 10a, IC 10a, ECV 30a)', () => {
    const r = calcularPrevent(base);
    expect(r.predicciones.map((p) => `${p.desenlace}/${p.horizonte}`).sort()).toEqual([
      'ascvd/10',
      'heart-failure/10',
      'total-cvd/30',
    ]);
  });

  it('todas las probabilidades quedan en [0,1]', () => {
    for (const p of calcularPrevent(base).predicciones) {
      expect(p.probabilidad).toBeGreaterThanOrEqual(0);
      expect(p.probabilidad).toBeLessThanOrEqual(1);
    }
  });

  it('monotonía: más presión, tabaquismo y diabetes ⇒ más riesgo ASCVD', () => {
    const riesgo = (e: EntradaPrevent) =>
      calcularPrevent(e).predicciones.find((p) => p.desenlace === 'ascvd')!.probabilidad;
    expect(riesgo({ ...base, sbp: 160 })).toBeGreaterThan(riesgo(base));
    expect(riesgo({ ...base, fumador: true })).toBeGreaterThan(riesgo(base));
    expect(riesgo({ ...base, diabetes: true })).toBeGreaterThan(riesgo(base));
    expect(riesgo({ ...base, edad: 70 })).toBeGreaterThan(riesgo(base));
  });

  it('distingue por sexo', () => {
    const f = calcularPrevent({ ...base, sexo: 'female' }).predicciones.find((p) => p.desenlace === 'ascvd')!.probabilidad;
    const m = calcularPrevent({ ...base, sexo: 'male' }).predicciones.find((p) => p.desenlace === 'ascvd')!.probabilidad;
    expect(f).not.toBe(m);
  });

  it('sin IMC no calcula IC, pero sí ASCVD y ECV', () => {
    const r = calcularPrevent({ ...base, imc: undefined });
    expect(r.predicciones.some((p) => p.desenlace === 'heart-failure')).toBe(false);
    expect(r.predicciones.some((p) => p.desenlace === 'ascvd')).toBe(true);
    expect(r.faltantes.join(' ')).toMatch(/IMC/);
  });
});
