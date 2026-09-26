import { describe, it, expect } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import { validarEntrada } from '../src/bots/validar-turno.js';
import { handler as cobroHandler, type EntradaCobro } from '../src/bots/calcular-cobro.js';

describe('Bot validar-turno (lógica pura)', () => {
  it('Sin reservas ni ventana => ok', () => {
    const r = validarEntrada({});
    expect(r.ok).toBe(true);
  });

  it('Capacidad excedida en el consultorio => bloqueo (R-07)', () => {
    const r = validarEntrada({
      reservas: [
        { recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-06-22T09:00:00-03:00', fin: '2026-06-22T10:00:00-03:00' },
        { recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-06-22T09:30:00-03:00', fin: '2026-06-22T10:30:00-03:00' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-07')).toBe(true);
  });

  it('Fuera de la ventana de reserva => bloqueo (R-13)', () => {
    const r = validarEntrada({
      perfil: 'PUBLICO',
      ahora: '2026-06-22T09:00:00-03:00',
      inicioTurno: '2026-06-25T09:00:00-03:00', // > 48 h
    });
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-13')).toBe(true);
  });

  it('Combina varias reglas y acumula bloqueos', () => {
    const r = validarEntrada({
      reservas: [
        { recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-06-22T09:00:00-03:00', fin: '2026-06-22T10:00:00-03:00' },
        { recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-06-22T09:30:00-03:00', fin: '2026-06-22T10:30:00-03:00' },
      ],
      perfil: 'PUBLICO',
      ahora: '2026-06-22T09:00:00-03:00',
      inicioTurno: '2026-06-25T09:00:00-03:00',
    });
    expect(r.ok).toBe(false);
    expect(r.bloqueos.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Bot calcular-cobro', () => {
  const medplumStub = {} as unknown as MedplumClient;

  it('Calcula Invoice en ARS (consulta: precio fijo de lista) con TC aplicado', async () => {
    const event = {
      input: {
        items: [{ tipo: 'servicio', codigo: 'CARDIOLOGIA' }],
        tc: 1450,
        persistir: false,
      } satisfies EntradaCobro,
    } as BotEvent<EntradaCobro>;

    const invoice = await cobroHandler(medplumStub, event);
    expect(invoice.resourceType).toBe('Invoice');
    expect(invoice.totalGross?.value).toBe(150_000);
    expect(invoice.totalGross?.currency).toBe('ARS');
    const tcExt = invoice.extension?.find((e) => e.url.endsWith('tc-aplicado'));
    expect(tcExt?.valueDecimal).toBe(1450);
  });
});
