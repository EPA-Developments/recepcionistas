import { describe, it, expect } from 'vitest';
import { estadificarCkm, type EntradaCkm } from '../src/lib/ckm.js';
import { planCkm, resumenPlanCkm, type RiesgosPrevent } from '../src/lib/ckm-guia.js';

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
};

const plan = (e: EntradaCkm, riesgos: RiesgosPrevent = {}, potenciadores: string[] = [], faltantesPrevent: string[] = []) => {
  const entrada = { ...e, riesgo10a: { ecvTotal: riesgos.ecv10, ascvd: riesgos.ascvd10, ic: riesgos.ic10 } };
  return planCkm(estadificarCkm(entrada), entrada, riesgos, potenciadores, faltantesPrevent);
};
const textos = (items: Array<{ texto: string }>) => items.map((i) => i.texto).join(' | ');

describe('Plan CKM — seguimiento según el estadío (Figura 3)', () => {
  it('Estadío 0: lípidos, glucemia y eGFR al menos cada 5 años; antropometría y PA anual', () => {
    const p = plan(sano, { ecv10: 0.02, ascvd10: 0.01, ic10: 0.01 });
    expect(textos(p.seguimiento)).toMatch(/IMC y circunferencia de cintura: anual/);
    expect(textos(p.seguimiento)).toMatch(/cada 5 años/);
    expect(p.seguimiento.every((i) => i.fuente.startsWith('Guía CKM 2026'))).toBe(true);
  });

  it('Estadío 1: cada 2–3 años; con prediabetes, glucemia anual', () => {
    const p = plan({ ...sano, hba1c: 6.0 });
    expect(textos(p.seguimiento)).toMatch(/cada 2–3 años/);
    expect(textos(p.seguimiento)).toMatch(/prediabetes.*cada año/);
  });

  it('Estadío ≥ 2: anual con UACR; ERC de muy alto riesgo cada 3–6 meses', () => {
    expect(textos(plan({ ...sano, trigliceridos: 200 }).seguimiento)).toMatch(/UACR\): al menos anual/);
    expect(textos(plan({ ...sano, egfr: 25 }).seguimiento)).toMatch(/cada 3–6 meses/);
  });

  it('Estadío 4: PREVENT no se usa; fuera de 30–79 años tampoco', () => {
    expect(textos(plan({ ...sano, hipertension: true, ecvClinica: ['coronaria'] }).seguimiento)).toMatch(/PREVENT no se usa con ECV clínica/);
    expect(textos(plan({ ...sano, edad: 25 }).seguimiento)).toMatch(/no aplica a esta edad/);
  });
});

describe('Plan CKM — evaluaciones que sugiere la guía', () => {
  it('UACR desde el Estadío 2 si falta', () => {
    expect(textos(plan({ ...sano, trigliceridos: 200, uacr: undefined }).evaluaciones)).toMatch(/UACR/);
    expect(textos(plan({ ...sano, uacr: undefined }).evaluaciones)).not.toMatch(/UACR/);
  });

  it('PREVENT-HF ≥ 5 % sin pre-IC evaluada → biomarcadores (Tabla 8)', () => {
    const p = plan({ ...sano, imc: 31 }, { ecv10: 0.08, ascvd10: 0.04, ic10: 0.06 });
    expect(textos(p.evaluaciones)).toMatch(/PREVENT-HF a 10 años 6,0 %.*NT-proBNP/);
    const conPeptido = plan({ ...sano, imc: 31, ntProBnp: 40 }, { ecv10: 0.08, ascvd10: 0.04, ic10: 0.06 });
    expect(textos(conPeptido.evaluaciones)).not.toMatch(/NT-proBNP/);
  });

  it('PREVENT-ASCVD 3 % a < 10 % sin CAC → considerar calcio coronario', () => {
    expect(textos(plan({ ...sano, imc: 31 }, { ecv10: 0.08, ascvd10: 0.04, ic10: 0.02 }).evaluaciones)).toMatch(/calcio coronario/);
    expect(textos(plan({ ...sano, imc: 31 }, { ecv10: 0.15, ascvd10: 0.12, ic10: 0.02 }).evaluaciones)).not.toMatch(/calcio coronario/);
  });

  it('pide completar los datos de PREVENT cuando no se pudo calcular', () => {
    const p = plan({ ...sano, egfr: undefined }, {}, [], ['ECV total a 10 años: falta eGFR']);
    expect(textos(p.evaluaciones)).toMatch(/Completar los datos para calcular PREVENT/);
  });
});

describe('Plan CKM — umbrales de la Tabla 8 y potenciadores (Tabla 9)', () => {
  it('DM2 con PREVENT-CVD ≥ 7,5 % → SGLT2i o GLP-1 priorizados', () => {
    const p = plan({ ...sano, hba1c: 7.1 }, { ecv10: 0.09, ascvd10: 0.05, ic10: 0.04 });
    expect(textos(p.consideraciones)).toMatch(/≥ 7,5 %\) con DM2.*SGLT2i o terapia basada en GLP-1/);
  });

  it('hipolipemiantes por PREVENT-ASCVD: ≥ 5 % iniciar; 3 % a < 5 % considerar; 30 años ≥ 10 % considerar', () => {
    expect(textos(plan(sano, { ecv10: 0.08, ascvd10: 0.06 }).consideraciones)).toMatch(/≥ 5 %\).*iniciar tratamiento hipolipemiante/);
    expect(textos(plan(sano, { ecv10: 0.05, ascvd10: 0.04 }).consideraciones)).toMatch(/3 % a < 5 %\): considerar/);
    expect(textos(plan(sano, { ecv10: 0.02, ascvd10: 0.01, ascvd30: 0.12 }).consideraciones)).toMatch(/30 años 12,0 %/);
  });

  it('HTA: ≥ 140/90, o ≥ 130/80 con PREVENT-CVD ≥ 7,5 % → fármacos; tratada → meta < 130/80', () => {
    expect(textos(plan({ ...sano, pas: 145, pad: 85 }).consideraciones)).toMatch(/PA ≥ 140\/90/);
    expect(textos(plan({ ...sano, pas: 134, pad: 78 }, { ecv10: 0.03 }).consideraciones)).not.toMatch(/tratamiento farmacológico/);
    expect(textos(plan({ ...sano, pas: 134, pad: 78 }, { ecv10: 0.08 }).consideraciones)).toMatch(/PREVENT-CVD ≥ 7,5 %/);
    expect(textos(plan({ ...sano, pas: 134, pad: 78, tratamientoHta: true }).consideraciones)).toMatch(/meta de la guía es < 130\/80/);
  });

  it('ERC con DM2 o albuminuria → RASi y SGLT2i de primera línea', () => {
    expect(textos(plan({ ...sano, egfr: 70, uacr: 60 }).consideraciones)).toMatch(/RASi y SGLT2i/);
  });

  it('en Estadío 4 no usa los umbrales de PREVENT', () => {
    const p = plan({ ...sano, hipertension: true, ecvClinica: ['coronaria'] }, { ecv10: 0.3, ascvd10: 0.2 });
    expect(textos(p.consideraciones)).not.toMatch(/PREVENT/);
  });

  it('resume seguimiento, evaluaciones, umbrales y potenciadores con su fuente', () => {
    const texto = resumenPlanCkm(plan({ ...sano, hba1c: 7.1 }, { ecv10: 0.09, ascvd10: 0.05 }, ['apnea obstructiva del sueño']));
    expect(texto).toMatch(/Seguimiento según la guía:/);
    expect(texto).toMatch(/\[Guía CKM 2026, Tabla 8/);
    expect(texto).toMatch(/Potenciadores de riesgo CKM \(Tabla 9\): apnea obstructiva del sueño\./);
  });
});
