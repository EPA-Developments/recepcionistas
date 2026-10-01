import { describe, it, expect } from 'vitest';
import { LIMITE_BOT_SEGUNDOS, explicarErrorClaude, lineaAnalito, veredictoTiempo } from '../src/lib/probar-claude.js';

describe('claude:probar', () => {
  it('cada error de la API dice qué hacer', () => {
    expect(explicarErrorClaude(undefined, 'Connection error.')).toMatch(/No hay conexión con api\.anthropic\.com.*firewall/);
    expect(explicarErrorClaude(undefined, 'Request timed out.')).toMatch(/No respondió a tiempo/);
    expect(explicarErrorClaude(401, 'invalid x-api-key')).toMatch(/clave es inválida.*ANTHROPIC_API_KEY en Medplum/);
    expect(explicarErrorClaude(404, 'model: claude-x')).toMatch(/no está disponible para esta cuenta/);
    expect(explicarErrorClaude(429, 'rate_limit_error')).toMatch(/Límite de uso/);
    expect(explicarErrorClaude(400, 'Your credit balance is too low')).toMatch(/credit balance.*facturación/);
    expect(explicarErrorClaude(529, 'overloaded_error')).toMatch(/status\.anthropic\.com/);
  });

  it('el tiempo de una lectura contra el límite del bot', () => {
    expect(LIMITE_BOT_SEGUNDOS).toBe(300);
    expect(veredictoTiempo(42)).toEqual({ ok: true, texto: expect.stringMatching(/42 s: entra con margen/) });
    expect(veredictoTiempo(210)).toEqual({ ok: true, texto: expect.stringMatching(/entra .* pero justo/) });
    expect(veredictoTiempo(301)).toEqual({ ok: false, texto: expect.stringMatching(/se cortaría/) });
    // Con el límite viejo de Lambda, una lectura de 42 s se cortaba.
    expect(veredictoTiempo(42, 10).ok).toBe(false);
  });

  it('cada valor leído en una línea, avisando si no tiene código del catálogo', () => {
    const base = { valorTexto: null, referencia: null };
    expect(lineaAnalito({ ...base, nombre: 'Colesterol LDL', codigo: 'http://loinc.org|13457-7', valor: 131, unidad: 'mg/dL' })).toBe(
      'Colesterol LDL: 131 mg/dL',
    );
    expect(lineaAnalito({ ...base, nombre: 'VDRL', codigo: null, valor: null, valorTexto: 'No reactiva', unidad: null })).toBe(
      'VDRL: No reactiva (sin código del catálogo)',
    );
  });
});
