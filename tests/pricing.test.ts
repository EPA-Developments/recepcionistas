import { describe, it, expect } from 'vitest';
import { getServicio, SERVICIOS } from '../src/config/catalogo.js';
import { precioSueltoUSD, calcularSplit, calcularCobro, calcularSenaARS } from '../src/lib/pricing.js';
import { usdAArs, redondearUSD } from '../src/lib/money.js';
import type { Servicio } from '../src/domain/types.js';

/** Servicio de prueba con precio explícito (los del catálogo están PENDIENTE = 0). */
function servicioUSD(precioUSD: number, over: Partial<Servicio> = {}): Servicio {
  return {
    codigo: 'TEST',
    nombre: 'Servicio de prueba',
    categoria: 'CARDIOLOGIA',
    duracionMin: 45,
    precioUSD,
    requierePrescripcion: false,
    reglaPricing: 'POR_SESION',
    split: { tipo: 'SOM_100' },
    fmAplica: false,
    ...over,
  };
}

describe('Pricing — sesión suelta (POR_SESION)', () => {
  it('Precio por sesión = precioUSD × ocupantes', () => {
    expect(precioSueltoUSD(servicioUSD(150))).toBe(150);
    expect(precioSueltoUSD(servicioUSD(150), { ocupantes: 2 })).toBe(300);
  });

  it('FM aplica 20% OFF solo si el servicio lo permite', () => {
    expect(precioSueltoUSD(servicioUSD(150, { fmAplica: true }), { fm: true })).toBe(120);
    expect(precioSueltoUSD(servicioUSD(150, { fmAplica: false }), { fm: true })).toBe(150);
  });
});

describe('Pricing — split', () => {
  it('Consulta de segunda opinión => 100% para el centro (SOM_100)', () => {
    const dist = calcularSplit(servicioUSD(150), 150);
    expect(dist.somUSD).toBe(150);
    expect(dist.prescriptoresUSD).toBeUndefined();
  });
});

describe('Catálogo — servicios cardiovasculares', () => {
  it('Cubre cardiología y sus subespecialidades', () => {
    const categorias = SERVICIOS.map((s) => s.categoria);
    for (const cat of [
      'CARDIOLOGIA',
      'HEMODINAMIA',
      'ELECTROFISIOLOGIA',
      'MEDICINA_NUCLEAR',
      'PREVENCION_CV',
      'REHABILITACION_CV',
    ] as const) {
      expect(categorias).toContain(cat);
    }
  });

  it('Todas las consultas quedan con precio PENDIENTE (0) y sin prescripción', () => {
    for (const s of SERVICIOS) {
      expect(s.precioARS).toBe(0);
      expect(s.requierePrescripcion).toBe(false);
      expect(s.split.tipo).toBe('SOM_100');
    }
  });

  it('No hay códigos de servicio duplicados', () => {
    const codigos = SERVICIOS.map((s) => s.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});

describe('Cobro — servicio en ARS (precio fijo, sin convertir por TC)', () => {
  it('Un servicio con precioARS se cobra en pesos sin aplicar TC', () => {
    // Precio PENDIENTE del catálogo => 0.
    const r = calcularCobro([{ tipo: 'servicio', codigo: 'CARDIOLOGIA' }], { tc: 1450 });
    expect(r.lineas[0]?.moneda).toBe('ARS');
    expect(r.totalARS).toBe(0);
    expect(r.totalUSD).toBe(0);
    expect(getServicio('CARDIOLOGIA').categoria).toBe('CARDIOLOGIA');
  });
});

describe('Conversión a ARS (R-17)', () => {
  it('USD 165 a TC 1450 = ARS 239.250', () => {
    expect(usdAArs(165, 1450)).toBe(239250);
  });

  it('redondearUSD redondea a 2 decimales', () => {
    expect(redondearUSD(121.126)).toBe(121.13);
  });
});

describe('Seña (50%)', () => {
  it('Seña = 50% del total en ARS', () => {
    const { totalARS, senaARS } = calcularSenaARS([{ tipo: 'servicio', codigo: 'CARDIOLOGIA' }], { tc: 1450 });
    expect(totalARS).toBe(0);
    expect(senaARS).toBe(0);
  });
});
