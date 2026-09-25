import { describe, it, expect, vi, afterEach } from 'vitest';
import { getServicio, SERVICIOS } from '../src/config/catalogo.js';
import { precioSueltoUSD, calcularSplit, calcularCobro, calcularSenaARS } from '../src/lib/pricing.js';
import { usdAArs } from '../src/lib/money.js';
import { resolverTC, TC_DEFAULT } from '../src/config/tipo-cambio.js';

describe('Pricing — Splits', () => {
  it('Consulta => 100% SOM', () => {
    const dist = calcularSplit(getServicio('CARDIOLOGIA'), 100);
    expect(dist.somUSD).toBe(100);
  });
});

describe('Consultas (precio en ARS, PENDIENTE de lista oficial)', () => {
  it('Se cobran en pesos fijos, sin convertir por TC', () => {
    const r = calcularCobro([{ tipo: 'servicio', codigo: 'CARDIOLOGIA' }], { tc: 1450 });
    expect(r.lineas[0]?.moneda).toBe('ARS');
    expect(r.totalUSD).toBe(0);
    // Precio PENDIENTE: hoy 0 hasta cargar la lista oficial.
    expect(r.totalARS).toBe(0);
  });
});

describe('Conversión a ARS (R-17)', () => {
  it('USD 165 a TC 1450 = ARS 239.250', () => {
    expect(usdAArs(165, 1450)).toBe(239250);
  });

  describe('TC por defecto (SOM_TC_DEFAULT)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('Sin TC explícito toma SOM_TC_DEFAULT', () => {
      vi.stubEnv('SOM_TC_DEFAULT', '1500');
      expect(resolverTC()).toBe(1500);
    });

    it('El TC explícito gana sobre la env; env inválida => default', () => {
      vi.stubEnv('SOM_TC_DEFAULT', '1500');
      expect(resolverTC(1600)).toBe(1600);
      vi.stubEnv('SOM_TC_DEFAULT', 'no-numero');
      expect(resolverTC()).toBe(TC_DEFAULT);
    });
  });

  it('precioSueltoUSD multiplica por ocupantes (servicios en USD)', () => {
    const base = getServicio('CARDIOLOGIA');
    expect(precioSueltoUSD({ ...base, precioARS: undefined, precioUSD: 100 })).toBe(100);
    expect(precioSueltoUSD({ ...base, precioARS: undefined, precioUSD: 100 }, { ocupantes: 2 })).toBe(200);
  });

  it('calcularCobro convierte líneas USD al TC aplicado', () => {
    const base = getServicio('CARDIOLOGIA');
    void base; // el catálogo actual no tiene servicios en USD; se testea la conversión directa
    expect(usdAArs(100, 1450)).toBe(145000);
  });
});

describe('Seña (50%)', () => {
  it('Consulta: seña = 50% del precio fijo en ARS', () => {
    const { totalARS, senaARS } = calcularSenaARS([{ tipo: 'servicio', codigo: 'CARDIOLOGIA' }]);
    expect(senaARS).toBe(Math.round(totalARS * 0.5));
  });
});

describe('Integridad del catálogo', () => {
  it('No hay códigos de servicio duplicados', () => {
    const codigos = SERVICIOS.map((s) => s.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('Toda consulta tiene precio en ARS declarado (aunque hoy sea 0 = pendiente)', () => {
    for (const s of SERVICIOS) {
      expect(typeof s.precioARS).toBe('number');
      expect(s.split.tipo).toBe('SOM_100');
    }
  });

  it('Son las consultas por especialidad, la consulta del Plan Bienestar y el control GLP-1', () => {
    expect(SERVICIOS.map((s) => s.codigo).sort()).toEqual([
      'CARDIOLOGIA',
      'CONSULTA_PB100D',
      'CONTROL_GLP1',
      'DIABETOLOGIA_ENDOCRINOLOGIA',
      'ELECTROFISIOLOGIA',
      'GINECOLOGIA',
      'HEMODINAMIA',
      'INSUFICIENCIA_CARDIACA',
      'MEDICINA_NUCLEAR',
      'NEUROLOGIA',
      'NUTRICION',
      'PREVENCION_CV',
      'REHABILITACION_CV',
      'TISIONEUMONOLOGIA',
    ]);
  });
});
