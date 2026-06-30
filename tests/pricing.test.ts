import { describe, it, expect } from 'vitest';
import { getServicio, SERVICIOS } from '../src/config/catalogo.js';
import { COMBOS, getCombo } from '../src/config/combos.js';
import { getMembresia } from '../src/config/membresias.js';
import { getPaquete } from '../src/config/paquetes.js';
import {
  precioSueltoUSD,
  cascadaTB,
  calcularSplit,
  calcularCobro,
  calcularSenaARS,
} from '../src/lib/pricing.js';
import { usdAArs, redondearUSD } from '../src/lib/money.js';

describe('Pricing — HBOT', () => {
  it('Monoplaza = USD 165', () => {
    expect(precioSueltoUSD(getServicio('HBOT_MONO'))).toBe(165);
  });

  it('AC-06: FM 20% OFF en suelta => HBOT mono 165 -> 132', () => {
    expect(precioSueltoUSD(getServicio('HBOT_MONO'), { fm: true })).toBe(132);
  });

  it('Biplaza: 2 personas = 200 (100 c/u); 1 sola = 165', () => {
    const bip = getServicio('HBOT_BIPLAZA');
    expect(precioSueltoUSD(bip, { ocupantes: 2 })).toBe(200);
    expect(precioSueltoUSD(bip, { ocupantes: 1 })).toBe(165);
  });

  it('Multiplaza: 80/persona, mínimo 3', () => {
    const multi = getServicio('HBOT_MULTIPLAZA');
    expect(precioSueltoUSD(multi, { ocupantes: 3 })).toBe(240);
    expect(precioSueltoUSD(multi, { ocupantes: 6 })).toBe(480);
    // Aunque pidan 1, se cobra el mínimo de 3.
    expect(precioSueltoUSD(multi, { ocupantes: 1 })).toBe(240);
  });
});

describe('Pricing — Recovery Pro indivisible', () => {
  it('USD 200 por gabinete, 1 o 2 personas', () => {
    const rp = getServicio('RECOVERY_PRO');
    expect(precioSueltoUSD(rp, { ocupantes: 1 })).toBe(200);
    expect(precioSueltoUSD(rp, { ocupantes: 2 })).toBe(200);
  });
});

describe('Pricing — IHHT v9', () => {
  it('Express 60, Premium 120', () => {
    expect(precioSueltoUSD(getServicio('IHHT_EXPRESS'))).toBe(60);
    expect(precioSueltoUSD(getServicio('IHHT_PREMIUM'))).toBe(120);
  });
});

describe('Catálogo — Combos v9', () => {
  it('Precios v9 conocidos', () => {
    expect(getCombo('BIO_ENERGY').precioUSD).toBe(88);
    expect(getCombo('BIO_OXYGEN').precioUSD).toBe(180);
    expect(getCombo('BIO_RECOVERY').precioUSD).toBe(292);
    expect(getCombo('BIO_LONGEVITY').precioUSD).toBe(340);
    expect(getCombo('BIO_LONGEVITY_PAREJA').precioUSD).toBe(416);
  });

  it('Coherencia: precio == round(lista * (1 - descuento))', () => {
    for (const c of COMBOS) {
      expect(c.precioUSD).toBe(Math.round(c.precioListaUSD * (1 - c.descuento)));
    }
  });

  it('Los combos no reciben descuento FM (no aplica a combos)', () => {
    // Un combo se cobra a su precio fijo (sin la rama FM de sueltas).
    const r = calcularCobro([{ tipo: 'combo', codigo: 'BIO_LONGEVITY' }], { tc: 1450 });
    expect(r.totalUSD).toBe(340);
  });

  it('Un combo se cobra a su precio de combo convertido a ARS', () => {
    const r = calcularCobro([{ tipo: 'combo', codigo: 'BIO_LONGEVITY' }], { tc: 1450 });
    expect(r.totalUSD).toBe(340);
    expect(r.totalARS).toBe(340 * 1450); // 493.000
  });
});

describe('Catálogo — Membresías v9', () => {
  it('Precios v9 conocidos', () => {
    expect(getMembresia('FOCUS_STD_IND').precioMesUSD).toBe(563);
    expect(getMembresia('FOCUS_INT_IND').precioMesUSD).toBe(792);
    expect(getMembresia('HEALTHSPAN_INT_PAR').precioMesUSD).toBe(3494);
  });

  it('AC-06: la membresía no recibe el 20% FM', () => {
    const r = calcularCobro([{ tipo: 'membresia', codigo: 'FOCUS_STD_IND', fm: true }], { tc: 1450 });
    expect(r.totalUSD).toBe(563);
  });
});

describe('Catálogo — Paquetes', () => {
  it('HBOT mono x5 = 784; FM = 627 (AC-06: FM sí aplica a paquetes)', () => {
    const p = getPaquete('PAQ_HBOT_MONO_X5');
    expect(p.totalUSD).toBe(784);
    expect(p.totalFMUSD).toBe(627);
  });
});

describe('Pricing — Cascada TB / IV (R-08)', () => {
  it('AC-08: IV NAD+ 250, neto SOM = (250×0.75 − insumo − 15) × 0.85', () => {
    const insumo = 30;
    const dist = cascadaTB(250, insumo);
    const base = 250 * 0.75 - insumo - 15; // 142.5
    expect(dist.somUSD).toBe(redondearUSD(base * 0.85)); // 121.13
    expect(dist.prescriptoresUSD).toBe(redondearUSD(base * 0.15)); // 21.38
  });

  it('Marca cuando el neto SOM cae bajo el piso de 25% de margen', () => {
    // Insumo alto fuerza el neto por debajo del piso.
    const dist = cascadaTB(250, 200);
    expect(dist.bajoMargenMinimo).toBe(true);
  });
});

describe('Pricing — Splits (R-08)', () => {
  it('HBOT => 100% SOM', () => {
    const dist = calcularSplit(getServicio('HBOT_MONO'), 165);
    expect(dist.somUSD).toBe(165);
    expect(dist.terapeutaUSD).toBeUndefined();
  });

  it('Masaje => 50/50 con el terapeuta', () => {
    const dist = calcularSplit(getServicio('MASAJE_DEPORTIVO'), 90);
    expect(dist.somUSD).toBe(45);
    expect(dist.terapeutaUSD).toBe(45);
  });
});

describe('Consultas médicas (precio en ARS)', () => {
  it('Se cobran en pesos fijos, sin convertir por TC', () => {
    const r = calcularCobro([{ tipo: 'servicio', codigo: 'CONSULTA_MED_DALESSANDRO' }], { tc: 1450 });
    expect(r.totalARS).toBe(120000);
    expect(r.totalUSD).toBe(0);
    expect(r.lineas[0]?.moneda).toBe('ARS');
  });

  it('Cobro mixto USD + consulta ARS suma en ARS', () => {
    const r = calcularCobro(
      [
        { tipo: 'servicio', codigo: 'HBOT_MONO' },
        { tipo: 'servicio', codigo: 'CONSULTA_MED_DOS_SANTOS' },
      ],
      { tc: 1450 },
    );
    expect(r.totalARS).toBe(239250 + 120000);
  });
});

describe('Conversión a ARS (R-17)', () => {
  it('AC-13: USD 165 a TC 1450 = ARS 239.250', () => {
    expect(usdAArs(165, 1450)).toBe(239250);
  });

  it('calcularCobro devuelve total en USD y ARS con el TC aplicado', () => {
    const r = calcularCobro([{ tipo: 'servicio', codigo: 'HBOT_MONO' }], { tc: 1450 });
    expect(r.totalUSD).toBe(165);
    expect(r.totalARS).toBe(239250);
    expect(r.tcAplicado).toBe(1450);
  });
});

describe('Seña (50%)', () => {
  it('Servicio en USD: seña = 50% del total en ARS', () => {
    const { totalARS, senaARS } = calcularSenaARS([{ tipo: 'servicio', codigo: 'HBOT_MONO' }], { tc: 1450 });
    expect(totalARS).toBe(239250);
    expect(senaARS).toBe(119625);
  });

  it('Combo: seña = 50% del precio de combo en ARS', () => {
    const { totalARS, senaARS } = calcularSenaARS([{ tipo: 'combo', codigo: 'BIO_LONGEVITY' }], { tc: 1450 });
    expect(totalARS).toBe(340 * 1450);
    expect(senaARS).toBe((340 * 1450) / 2);
  });

  it('Consulta en ARS: seña = 50% del precio fijo', () => {
    const { totalARS, senaARS } = calcularSenaARS([{ tipo: 'servicio', codigo: 'CONSULTA_MED_DALESSANDRO' }]);
    expect(totalARS).toBe(120000);
    expect(senaARS).toBe(60000);
  });
});

describe('Integridad del catálogo', () => {
  it('No hay códigos de servicio duplicados', () => {
    const codigos = SERVICIOS.map((s) => s.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('Todo servicio IV/TB requiere prescripción', () => {
    for (const s of SERVICIOS) {
      if (s.categoria === 'IV_THERAPY' || s.categoria === 'TERAPIA_BIOLOGICA') {
        expect(s.requierePrescripcion).toBe(true);
      }
    }
  });
});
