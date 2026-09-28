import { describe, it, expect } from 'vitest';
import { ALERTAS_CATALOGO, CONDICIONES_CATALOGO, type AlertaCatalogo } from '../src/config/catalogo-pb100d.js';
import { DERIVACIONES_PB100D, SERVICIOS_POR_CODIGO, SERVICIO_POR_RESPONSABLE_PB100D, servicioDeDerivacion } from '../src/config/catalogo.js';
import { estadificarCkm, type EntradaCkm } from '../src/lib/ckm.js';
import {
  MOMENTOS_INFORME_SOM,
  alertasCatalogo,
  aplicaAlerta,
  condicionesCatalogo,
  condicionesDesdePrevent,
  estadioCatalogo,
  perfilCatalogo,
  resumenAlertasCatalogo,
  type PerfilCatalogo,
} from '../src/lib/ckm-catalogo.js';
import type { RiesgosPrevent } from '../src/lib/ckm-guia.js';

const sana: EntradaCkm = {
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

/** Estadifica con el riesgo PREVENT dado y arma el perfil del catálogo. */
function perfil(e: EntradaCkm, riesgos: RiesgosPrevent = {}, extras: string[] = []): PerfilCatalogo {
  const entrada = { ...e, riesgo10a: { ecvTotal: riesgos.ecv10, ascvd: riesgos.ascvd10, ic: riesgos.ic10 } };
  return perfilCatalogo(estadificarCkm(entrada), entrada, riesgos, extras);
}
const codigos = (alertas: AlertaCatalogo[]) => alertas.map((a) => a.codigo);

describe('Catálogo PB100D — archivo generado desde el monorepo (integridad)', () => {
  it('239 alertas y derivaciones firmadas, con código único y al menos un momento', () => {
    expect(ALERTAS_CATALOGO).toHaveLength(239);
    expect(new Set(ALERTAS_CATALOGO.map((a) => a.codigo)).size).toBe(ALERTAS_CATALOGO.length);
    for (const a of ALERTAS_CATALOGO) {
      expect(a.momentos.length).toBeGreaterThan(0);
      expect(a.estadios.length).toBeGreaterThan(0);
      expect(['alerta', 'derivacion']).toContain(a.tipo);
    }
  });

  it('toda condición que usa un ítem está declarada en el vocabulario', () => {
    const declaradas = new Set<string>(CONDICIONES_CATALOGO);
    const usadas = ALERTAS_CATALOGO.flatMap((a) => [...(a.condiciones ?? []), ...(a.algunaDe ?? []), ...(a.excluye ?? [])]);
    expect(usadas.filter((c) => !declaradas.has(c))).toEqual([]);
  });

  it('cada derivación con consulta propia apunta a un servicio del catálogo (R-20: solo desde su tarea)', () => {
    const sinConsulta = new Set(['imagen', 'equipo', 'firmantes', 'persona', 'enfermeria', 'educador', 'coordinacion']);
    for (const d of ALERTAS_CATALOGO.filter((a) => a.tipo === 'derivacion')) {
      const servicio = servicioDeDerivacion(d.responsable);
      if (sinConsulta.has(d.responsable)) {
        expect(servicio).toBeUndefined();
      } else {
        expect(servicio, `${d.codigo} → ${d.responsable}`).toBeDefined();
      }
    }
    for (const codigo of Object.values(SERVICIO_POR_RESPONSABLE_PB100D)) {
      expect(SERVICIOS_POR_CODIGO.has(codigo!)).toBe(true);
    }
    // Las especialidades nuevas están cubiertas por el mapeo, salvo Podología: el catálogo
    // firmado la deriva junto con Oftalmología (responsable "Oftalmología y podología").
    const mapeados = new Set(Object.values(SERVICIO_POR_RESPONSABLE_PB100D));
    expect(DERIVACIONES_PB100D.map((s) => s.codigo).filter((c) => !mapeados.has(c))).toEqual(['PODOLOGIA']);
    expect(servicioDeDerivacion('nefrologia')?.soloDesdeTarea).toBe(true);
    expect(servicioDeDerivacion('obstetricia')?.codigo).toBe('GINECOLOGIA');
  });
});

describe('Catálogo PB100D — condiciones del paciente', () => {
  it('4a y 4b son el estadío 4 del catálogo', () => {
    expect(estadioCatalogo('4a')).toBe('4');
    expect(estadioCatalogo('4b')).toBe('4');
    expect(estadioCatalogo('2')).toBe('2');
  });

  it('sana de 50 años: sin factores; quedan la edad y que no tiene ecocardiograma', () => {
    const p = perfil(sana, { ecv10: 0.02, ascvd10: 0.01, ic10: 0.01 });
    expect(p.estadio).toBe('0');
    expect(p.condiciones).toEqual(['sin-ecocardiograma', 'edad-30-59', 'edad-40-79', 'edad-50-79']);
  });

  it('DM2 + HTA tratada + ERC con albuminuria: factores, umbrales renales, medicación y "≥ 2 factores", en el orden del catálogo', () => {
    const p = perfil(
      { ...sana, hba1c: 7.2, diabetes: true, pas: 150, pad: 92, tratamientoHta: true, uacr: 150, egfr: 50, imc: 32 },
      { ecv10: 0.09, ascvd10: 0.06, ic10: 0.055, ascvd30: 0.2 },
      ['toma-rasi-mra', 'toma-estatina', 'condicion-inventada'],
    );
    expect(p.estadio).toBe('2');
    expect(p.condiciones).toEqual([
      'exceso-adiposidad',
      'imc-27',
      'imc-30',
      'dm2',
      'dos-o-mas-factores',
      'hta',
      'toma-antihipertensivo',
      'erc',
      'uacr-30',
      'uacr-100',
      'prevent-ascvd-5',
      'prevent-ascvd-3-10',
      'prevent-ascvd-30-10',
      'prevent-cvd-7-5',
      'prevent-hf-5',
      'sin-ecocardiograma',
      'medicacion',
      'toma-rasi-mra',
      'toma-estatina',
      'edad-30-59',
      'edad-40-79',
      'edad-50-79',
    ]);
    // eGFR 50 no es < 45; UACR 150 no llega a 200; lo que no es del catálogo se descarta.
    expect(p.condiciones).not.toContain('egfr-45');
    expect(p.condiciones).not.toContain('uacr-200');
    expect(p.condiciones).not.toContain('condicion-inventada');
  });

  it('bandas PREVENT de la Tabla 8 (probabilidades 0–1)', () => {
    expect(condicionesDesdePrevent({ ascvd10: 0.04, ecv10: 0.08, ic10: 0.06, ascvd30: 0.12 })).toEqual([
      'prevent-ascvd-3-5',
      'prevent-ascvd-3-10',
      'prevent-ascvd-30-10',
      'prevent-cvd-7-5',
      'prevent-hf-5',
    ]);
    expect(condicionesDesdePrevent({ ascvd10: 0.12, ecv10: 0.22 })).toEqual(['prevent-ascvd-5', 'prevent-cvd-7-5', 'prevent-alto']);
    expect(condicionesDesdePrevent({})).toEqual([]);
  });

  it('presión: elevada (120–129 / < 80) sin HTA; 180/110 es su propia condición', () => {
    expect(perfil({ ...sana, pas: 124, pad: 76 }).condiciones).toContain('pa-elevada');
    const hta = perfil({ ...sana, pas: 184, pad: 96 }).condiciones;
    expect(hta).toContain('hta');
    expect(hta).toContain('pa-180-110');
    expect(hta).not.toContain('pa-elevada');
  });

  it('riñón: falla renal (eGFR < 15 o diálisis) arrastra ERC de muy alto riesgo; eGFR < 45 y < 30', () => {
    const c = perfil({ ...sana, hipertension: true, egfr: 12, uacr: 400, dialisis: true }).condiciones;
    expect(c).toEqual(expect.arrayContaining(['erc', 'erc-muy-alto-riesgo', 'falla-renal', 'dialisis', 'egfr-45', 'egfr-30', 'uacr-200']));
  });

  it('estadío 3: pre-IC, aterosclerosis subclínica y calcio coronario por bandas', () => {
    const preIc = perfil({ ...sana, imc: 31, ntProBnp: 300 }).condiciones;
    expect(preIc).toContain('pre-ic');
    expect(preIc).toContain('sin-ecocardiograma');
    const cac = perfil({ ...sana, trigliceridos: 200, cac: 1200 }).condiciones;
    expect(cac).toEqual(expect.arrayContaining(['aterosclerosis-subclinica', 'cac-100', 'cac-1000']));
    expect(perfil({ ...sana, trigliceridos: 200, cac: 0 }).condiciones).toContain('cac-0');
    const hp = perfil({ ...sana, imc: 31, ecocardiograma: { psap: 40 } }).condiciones;
    expect(hp).toEqual(expect.arrayContaining(['pre-ic', 'hipertension-pulmonar']));
    expect(hp).not.toContain('sin-ecocardiograma');
  });

  it('estadío 4: ECV clínica por tipo y fenotipo de IC por FEVI', () => {
    const p = perfil(
      { ...sana, hipertension: true, ecvClinica: ['insuficiencia-cardiaca', 'coronaria'], ecocardiograma: { fevi: 35 } },
      {},
      ['toma-estatina', 'polifarmacia'],
    );
    expect(p.estadio).toBe('4');
    expect(p.condiciones).toEqual(expect.arrayContaining(['ecv', 'coronaria', 'ic', 'hfref', 'medicacion', 'toma-estatina', 'polifarmacia']));
    expect(perfil({ ...sana, hipertension: true, ecvClinica: ['insuficiencia-cardiaca'], ecocardiograma: { fevi: 45 } }).condiciones).toContain('hfmref');
    expect(perfil({ ...sana, hipertension: true, ecvClinica: ['insuficiencia-cardiaca'], ecocardiograma: { fevi: 60 } }).condiciones).toContain('hfpef');
    expect(perfil({ ...sana, hipertension: true, ecvClinica: ['fibrilacion-auricular', 'acv', 'arterial-periferica'] }).condiciones).toEqual(
      expect.arrayContaining(['fa', 'acv', 'eap']),
    );
  });

  it('con datos incompletos no inventa condiciones', () => {
    const ckm = estadificarCkm({});
    expect(condicionesCatalogo(ckm, {})).toEqual(['sin-ecocardiograma']);
  });
});

describe('Catálogo PB100D — selección de alertas y derivaciones', () => {
  const item = (extra: Partial<AlertaCatalogo>): AlertaCatalogo => ({
    codigo: 'X',
    tipo: 'alerta',
    dominio: 'test',
    estadios: ['2'],
    momentos: ['dia-0'],
    responsable: 'cardiologia',
    titulo: 't',
    texto: 'x',
    fuente: 'f',
    ...extra,
  });
  const base: PerfilCatalogo = { estadio: '2', condiciones: ['dm2', 'hta', 'erc'] };

  it('aplica: estadío incluido, todas las condiciones, alguna de algunaDe y ninguna de excluye', () => {
    expect(aplicaAlerta(item({}), base)).toBe(true);
    expect(aplicaAlerta(item({ estadios: ['3'] }), base)).toBe(false);
    expect(aplicaAlerta(item({ condiciones: ['dm2', 'hta'] }), base)).toBe(true);
    expect(aplicaAlerta(item({ condiciones: ['dm2', 'fa'] }), base)).toBe(false);
    expect(aplicaAlerta(item({ algunaDe: ['fa', 'erc'] }), base)).toBe(true);
    expect(aplicaAlerta(item({ algunaDe: ['fa', 'ic'] }), base)).toBe(false);
    expect(aplicaAlerta(item({ excluye: ['erc'] }), base)).toBe(false);
    expect(aplicaAlerta(item({ condiciones: ['dm2'], algunaDe: ['erc'], excluye: ['egfr-30'] }), base)).toBe(true);
  });

  it('sana de estadío 0: solo la alerta general del día 0', () => {
    const p = perfil(sana, { ecv10: 0.02, ascvd10: 0.01, ic10: 0.01 });
    expect(codigos(alertasCatalogo(p, { momentos: MOMENTOS_INFORME_SOM }))).toEqual(['E0-MED-01']);
  });

  it('DM2 + HTA + ERC con albuminuria (estadío 2): alertas farmacológicas de HTA, DM2 y ERC más las derivaciones del día 0', () => {
    const p = perfil(
      { ...sana, hba1c: 7.2, diabetes: true, pas: 150, pad: 92, tratamientoHta: true, uacr: 150, egfr: 50, imc: 32 },
      { ecv10: 0.09, ascvd10: 0.06, ic10: 0.055, ascvd30: 0.2 },
      ['toma-rasi-mra', 'toma-estatina'],
    );
    const alertas = alertasCatalogo(p, { momentos: MOMENTOS_INFORME_SOM });
    const c = codigos(alertas);
    expect(c).toEqual(expect.arrayContaining(['E2-HTA-MED-01', 'E2-HTA-MED-04', 'E2-DM2-MED-01', 'E2-ERC-MED-01', 'E2-ERC-MED-02', 'E2-DER-01', 'E2-DER-04']));
    // Ningún ítem de otro estadío ni del día 100.
    expect(alertas.every((a) => a.estadios.includes('2'))).toBe(true);
    expect(alertas.every((a) => a.momentos.some((m) => MOMENTOS_INFORME_SOM.includes(m)))).toBe(true);
    // Solo derivaciones, y solo del día 100.
    const der = alertasCatalogo(p, { tipos: ['derivacion'] });
    expect(der.every((a) => a.tipo === 'derivacion')).toBe(true);
    expect(alertasCatalogo(p, { momentos: ['dia-100'] }).every((a) => a.momentos.includes('dia-100'))).toBe(true);
  });

  it('la exclusión frena el ítem: ERC con eGFR < 30 no recibe E2-ERC-MED-01 (requiere eGFR ≥ 30)', () => {
    const con = perfil({ ...sana, diabetes: true, hba1c: 7.5, egfr: 50, uacr: 100 });
    const sin = perfil({ ...sana, diabetes: true, hba1c: 7.5, egfr: 25, uacr: 100 });
    expect(codigos(alertasCatalogo(con))).toContain('E2-ERC-MED-01');
    expect(codigos(alertasCatalogo(sin))).not.toContain('E2-ERC-MED-01');
  });

  it('estadío 4 con IC: los ítems del estadío 4 y los heredados del 2 que siguen vigentes (HTA)', () => {
    const p = perfil({ ...sana, hipertension: true, ecvClinica: ['insuficiencia-cardiaca', 'coronaria'], ecocardiograma: { fevi: 35 } });
    const c = codigos(alertasCatalogo(p, { momentos: MOMENTOS_INFORME_SOM }));
    expect(c).toEqual(expect.arrayContaining(['E4-IC-MED-01', 'E4-ASCVD-MED-06', 'E2-HTA-MED-01', 'E4-DER-01']));
    expect(c.some((x) => x.startsWith('E3-'))).toBe(false);
  });
});

describe('Catálogo PB100D — resumen para la nota, el prompt y el informe', () => {
  it('sin ítems lo dice; con ítems separa alertas y derivaciones con código y evidencia', () => {
    const p: PerfilCatalogo = { estadio: '1', condiciones: [] };
    expect(resumenAlertasCatalogo([], p)).toMatch(/Estadío 1 \(Exceso de adiposidad o prediabetes\): ningún ítem al médico aplica/);

    const p2 = perfil({ ...sana, hba1c: 7.2, diabetes: true, pas: 150, pad: 92, tratamientoHta: true, uacr: 150, egfr: 50 });
    const texto = resumenAlertasCatalogo(alertasCatalogo(p2, { momentos: MOMENTOS_INFORME_SOM }), p2);
    expect(texto).toMatch(/^Catálogo del Plan Bienestar 100 Días® \(firmado el 2026-09-27\), Estadío 2/);
    expect(texto).toMatch(/\d+ alerta\(s\) al médico y \d+ derivación\(es\)/);
    expect(texto).toMatch(/el sistema no prescribe/);
    expect(texto).toMatch(/\nAlertas al médico:\n- E2-HTA-MED-01 · /);
    expect(texto).toMatch(/\nDerivaciones:\n- E2-DER-01 · /);
    expect(texto).toMatch(/\[Guía CKM 2026, Tabla 35; COR 1; LOE B-R\]/);
  });
});
