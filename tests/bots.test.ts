import { describe, it, expect } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import { validarEntrada } from '../src/bots/validar-turno.js';
import { handler as cobroHandler, type EntradaCobro } from '../src/bots/calcular-cobro.js';

describe('Bot validar-turno (lógica pura)', () => {
  it('Consulta de cardiología sin objeciones => OK', () => {
    const r = validarEntrada({ servicioCodigo: 'CARDIOLOGIA', prescripcionActiva: false });
    expect(r.ok).toBe(true);
  });

  it('Saldo de membresía agotado => bloqueo (R-10)', () => {
    const r = validarEntrada({ sesionesUsadas: 8, sesionesMes: 8 });
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-10')).toBe(true);
  });

  it('Combina varias reglas y acumula bloqueos', () => {
    const r = validarEntrada({
      reservas: [
        { recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-06-22T09:00:00-03:00', fin: '2026-06-22T10:00:00-03:00' },
        { recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-06-22T09:30:00-03:00', fin: '2026-06-22T10:30:00-03:00' }, // R-07
      ],
      sesionesUsadas: 8,
      sesionesMes: 8, // R-10
    });
    expect(r.ok).toBe(false);
    expect(r.bloqueos.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Bot calcular-cobro', () => {
  const medplumStub = {} as unknown as MedplumClient;

  it('Calcula Invoice en ARS con TC aplicado (precio PENDIENTE => 0, sin persistir)', async () => {
    const event = {
      input: {
        items: [{ tipo: 'servicio', codigo: 'CARDIOLOGIA' }],
        tc: 1450,
        persistir: false,
      } satisfies EntradaCobro,
    } as BotEvent<EntradaCobro>;

    const invoice = await cobroHandler(medplumStub, event);
    expect(invoice.resourceType).toBe('Invoice');
    expect(invoice.totalGross?.value).toBe(0); // precio PENDIENTE del catálogo
    expect(invoice.totalGross?.currency).toBe('ARS');
    const tcExt = invoice.extension?.find((e) => e.url.endsWith('tc-aplicado'));
    expect(tcExt?.valueDecimal).toBe(1450);
  });
});
