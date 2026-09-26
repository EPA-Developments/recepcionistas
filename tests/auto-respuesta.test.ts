import { describe, it, expect } from 'vitest';
import type { HorarioDia } from '../src/config/horario.js';
import { TEXTO_ACUSE, textoFueraDeHorario } from '../src/config/auto-respuesta.js';
import {
  describirHorario,
  estaAbierto,
  respuestaAutomatica,
  textoRestante,
  ultimoCierre,
  ventana24h,
} from '../src/lib/auto-respuesta.js';

// Hora de Argentina = UTC-3. Semana del lunes 28/09/2026.
const AR = (fechaHora: string): Date => new Date(`${fechaHora}:00-03:00`);

describe('Ventana de 24 h de WhatsApp', () => {
  const ahora = AR('2026-09-28T12:00');

  it('Abierta 24 h desde el último mensaje del paciente, con lo que queda', () => {
    const v = ventana24h(AR('2026-09-28T11:00').toISOString(), ahora);
    expect(v).toEqual({ abierta: true, cierra: AR('2026-09-29T11:00').toISOString(), restanteMin: 23 * 60, porCerrar: false });
    expect(textoRestante(v.restanteMin)).toBe('23 h');
  });

  it('Naranja cuando quedan menos de 2 h; cerrada después', () => {
    expect(ventana24h(AR('2026-09-27T13:30').toISOString(), ahora)).toMatchObject({ abierta: true, restanteMin: 90, porCerrar: true });
    expect(ventana24h(AR('2026-09-27T12:00').toISOString(), ahora)).toMatchObject({ abierta: false, restanteMin: 0, porCerrar: false });
    expect(ventana24h(undefined, ahora)).toEqual({ abierta: false, restanteMin: 0, porCerrar: false });
  });

  it('El tiempo que queda, en palabras', () => {
    expect(textoRestante(23 * 60 + 10)).toBe('23 h 10 min');
    expect(textoRestante(45)).toBe('45 min');
    expect(textoRestante(0)).toBe('menos de 1 min');
  });
});

describe('Horario de atención (el de la agenda, hora de Argentina)', () => {
  it('Abierto de lunes a viernes de 8 a 22 y sábados de 8 a 20; domingo cerrado', () => {
    expect(estaAbierto(AR('2026-09-28T07:59'))).toBe(false); // lunes
    expect(estaAbierto(AR('2026-09-28T08:00'))).toBe(true);
    expect(estaAbierto(AR('2026-09-28T21:59'))).toBe(true);
    expect(estaAbierto(AR('2026-09-28T22:00'))).toBe(false);
    expect(estaAbierto(AR('2026-10-03T19:59'))).toBe(true); // sábado
    expect(estaAbierto(AR('2026-10-03T20:00'))).toBe(false);
    expect(estaAbierto(AR('2026-10-04T12:00'))).toBe(false); // domingo
  });

  it('El último cierre marca el período cerrado actual', () => {
    expect(ultimoCierre(AR('2026-10-04T10:00'))).toEqual(AR('2026-10-03T20:00')); // domingo → sábado 20
    expect(ultimoCierre(AR('2026-10-05T07:00'))).toEqual(AR('2026-10-03T20:00')); // lunes temprano → sábado 20
    expect(ultimoCierre(AR('2026-09-29T03:00'))).toEqual(AR('2026-09-28T22:00')); // martes de madrugada → lunes 22
  });

  it('El horario en palabras es el del texto aprobado', () => {
    expect(describirHorario()).toBe('lunes a viernes de 8 a 22 y sábados de 8 a 20');
  });

  it('Otros horarios: días sueltos, medias horas y doble turno', () => {
    const franja = (desde: string, hasta: string) => ({ desde, hasta });
    const horario: HorarioDia[] = [
      { dia: 1, abierto: true, franjas: [franja('09:00', '13:00'), franja('14:00', '18:30')] },
      { dia: 2, abierto: true, franjas: [franja('09:00', '13:00'), franja('14:00', '18:30')] },
      { dia: 3, abierto: true, franjas: [franja('09:00', '13:00')] },
      { dia: 5, abierto: true, franjas: [franja('09:00', '13:00')] },
      { dia: 6, abierto: false, franjas: [] },
    ];
    expect(describirHorario(horario)).toBe(
      'lunes a martes de 9 a 13 y de 14 a 18:30, miércoles de 9 a 13 y viernes de 9 a 13',
    );
    expect(estaAbierto(AR('2026-09-28T13:30'), horario)).toBe(false); // lunes, al mediodía
    expect(ultimoCierre(AR('2026-09-28T13:30'), horario)).toEqual(AR('2026-09-28T13:00'));
  });
});

describe('Qué responde solo el sistema', () => {
  const abierto = AR('2026-09-28T12:00'); // lunes 12 h
  const cerrado = AR('2026-10-04T10:00'); // domingo 10 h

  it('En horario: acuse solo cuando el WhatsApp abre una conversación nueva', () => {
    expect(respuestaAutomatica({ conversacionNueva: true, ahora: abierto })).toEqual({ tipo: 'acuse', texto: TEXTO_ACUSE });
    expect(respuestaAutomatica({ conversacionNueva: false, ahora: abierto })).toBeUndefined();
  });

  it('Los textos son los aprobados', () => {
    expect(TEXTO_ACUSE).toBe(
      '¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. En breve te responde alguien de Recepción.',
    );
    expect(textoFueraDeHorario(describirHorario())).toBe(
      '¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. Ahora estamos fuera del horario de atención (lunes a viernes de 8 a 22 y sábados de 8 a 20). Te respondemos apenas abramos.',
    );
  });

  it('Fuera de horario: el aviso (que ya acusa recibo), una sola vez por período cerrado', () => {
    const aviso = { tipo: 'fuera-de-horario', texto: textoFueraDeHorario(describirHorario()) };
    expect(respuestaAutomatica({ conversacionNueva: true, ahora: cerrado })).toEqual(aviso);
    expect(respuestaAutomatica({ conversacionNueva: false, ahora: cerrado })).toEqual(aviso);
    // Ya avisado en este cierre (el sábado a las 21): no se repite.
    const yaAvisado = AR('2026-10-03T21:00').toISOString();
    expect(respuestaAutomatica({ conversacionNueva: false, ahora: cerrado, ultimoAvisoFueraDeHorario: yaAvisado })).toBeUndefined();
    // Avisado en un cierre anterior (el viernes a la noche): se avisa de nuevo.
    const cierreAnterior = AR('2026-10-02T23:00').toISOString();
    expect(respuestaAutomatica({ conversacionNueva: false, ahora: cerrado, ultimoAvisoFueraDeHorario: cierreAnterior })).toEqual(aviso);
  });
});
