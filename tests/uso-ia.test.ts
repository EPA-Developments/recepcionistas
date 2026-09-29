import { describe, it, expect } from 'vitest';
import { SYSTEM } from '../src/fhir/identifiers.js';
import { PROCESO_IA, auditEventUsoIa, rangoMesAR, resumirUsoIa, usoDeRespuesta } from '../src/lib/uso-ia.js';

const intento = (type: string, model: string | null, input_tokens: number, output_tokens: number) => ({
  type,
  model,
  input_tokens,
  output_tokens,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
});

describe('Uso de IA — tokens y costo', () => {
  it('una llamada sin respaldo: el costo sale de la tarifa del modelo', () => {
    const uso = usoDeRespuesta(
      { model: 'claude-opus-5-5', usage: { input_tokens: 10_000, output_tokens: 5_000, cache_read_input_tokens: 2_000 } },
      'claude-opus-5-5',
    );
    // 10000 × 4 + 5000 × 20 + 2000 × 0,20 (US$ por millón)
    expect(uso).toEqual({
      modelo: 'claude-opus-5-5',
      intentos: 1,
      tokensEntrada: 10_000,
      tokensSalida: 5_000,
      tokensCacheLectura: 2_000,
      tokensCacheEscritura: 0,
      costoUsd: 0.1404,
    });
  });

  it('con respaldo suma cada intento a la tarifa de su modelo (el usage de arriba es solo el último)', () => {
    const uso = usoDeRespuesta(
      {
        model: 'claude-opus-5',
        usage: {
          input_tokens: 8_000,
          output_tokens: 3_000,
          iterations: [intento('message', null, 8_000, 200), intento('fallback_message', 'claude-opus-5', 8_000, 3_000)],
        },
      },
      'claude-opus-5-5',
    );
    expect(uso).toMatchObject({ modelo: 'claude-opus-5', intentos: 2, tokensEntrada: 16_000, tokensSalida: 3_200 });
    // Opus 5.5 (el pedido): 8000 × 4 + 200 × 20; Opus 5: 8000 × 5 + 3000 × 25.
    expect(uso.costoUsd).toBe(0.151);
  });

  it('un modelo sin precio cargado deja el costo sin estimar (no inventa)', () => {
    const uso = usoDeRespuesta({ model: 'otro-modelo', usage: { input_tokens: 100, output_tokens: 100 } }, 'otro-modelo');
    expect(uso.tokensEntrada).toBe(100);
    expect(uso.costoUsd).toBeUndefined();
  });
});

describe('Uso de IA — AuditEvent y resumen del mes', () => {
  const uso = usoDeRespuesta({ model: 'claude-opus-5-5', usage: { input_tokens: 9_000, output_tokens: 5_000 } }, 'claude-opus-5-5');

  it('el AuditEvent apunta al documento, lo firma el bot y guarda el detalle como texto (R4)', () => {
    const e = auditEventUsoIa({
      proceso: PROCESO_IA.laboratorioPdf,
      uso,
      bot: { reference: 'Bot/b1' },
      botNombre: 'som-procesar-laboratorio',
      origen: 'DocumentReference/d1',
      ok: false,
      motivo: 'refusal',
      cuando: new Date('2026-10-05T12:00:00Z'),
    });
    expect(e).toMatchObject({
      resourceType: 'AuditEvent',
      type: { system: SYSTEM.usoIa, code: 'llamada-modelo' },
      subtype: [{ system: SYSTEM.usoIa, code: 'laboratorio-pdf' }],
      action: 'E',
      recorded: '2026-10-05T12:00:00.000Z',
      outcome: '4',
      outcomeDesc: 'refusal',
      agent: [{ name: 'som-procesar-laboratorio', requestor: false }],
      source: { observer: { reference: 'Bot/b1' } },
      entity: [{ what: { reference: 'DocumentReference/d1' } }],
    });
    expect(e.entity?.[0]?.detail?.every((d) => typeof d.valueString === 'string')).toBe(true);
    // Sin paciente en el registro: el costo no necesita datos personales.
    expect(JSON.stringify(e)).not.toContain('Patient/');
  });

  it('resume por proceso: llamadas, las que pasaron al equipo, tokens y costo', () => {
    const base = { proceso: PROCESO_IA.laboratorioPdf, botNombre: 'som-procesar-laboratorio', origen: 'DocumentReference/d1' };
    const sinPrecio = usoDeRespuesta({ model: 'otro-modelo', usage: { input_tokens: 10, output_tokens: 10 } }, 'otro-modelo');
    const [r] = resumirUsoIa([
      auditEventUsoIa({ ...base, uso, ok: true }),
      auditEventUsoIa({ ...base, uso, ok: false }),
      auditEventUsoIa({ ...base, uso: sinPrecio, ok: true }),
      { resourceType: 'AuditEvent', type: { code: 'rest' }, recorded: '2026-10-01T00:00:00Z', agent: [], source: { observer: {} } },
    ]);
    expect(r).toEqual({
      proceso: 'laboratorio-pdf',
      nombre: 'Transcripción de laboratorio en PDF',
      llamadas: 3,
      sinResultado: 1,
      tokensEntrada: 18_010,
      tokensSalida: 10_010,
      costoUsd: 0.272,
      sinPrecio: 1,
    });
  });

  it('el mes se busca en hora de Argentina, y diciembre cierra en enero del año siguiente', () => {
    expect(rangoMesAR('2026-10')).toEqual({ desde: '2026-10-01T00:00:00-03:00', hasta: '2026-11-01T00:00:00-03:00' });
    expect(rangoMesAR('2026-12').hasta).toBe('2027-01-01T00:00:00-03:00');
  });
});
