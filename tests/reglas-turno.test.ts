import { describe, it, expect } from 'vitest';
import {
  validarCapacidadRecurso,
  validarVentanaReserva,
  evaluarCancelacion,
  type ReservaRecurso,
} from '../src/lib/reglas-turno.js';

/** Helper: arma un Date a partir de "HH:mm" del 2026-06-22 (lunes). */
function h(hhmm: string): Date {
  return new Date(`2026-06-22T${hhmm}:00-03:00`);
}

function reserva(recursoCodigo: string, desde: string, hasta: string): ReservaRecurso {
  return { recursoCodigo, inicio: h(desde), fin: h(hasta) };
}

describe('R-07 · Capacidad de recursos', () => {
  it('Mismo consultorio (cap 1) solapado => excede capacidad', () => {
    const r = validarCapacidadRecurso([
      reserva('R_CONSULTORIO_1', '09:00', '10:00'),
      reserva('R_CONSULTORIO_1', '09:30', '10:30'),
    ]);
    expect(r.ok).toBe(false);
  });

  it('Turnos contiguos en el mismo consultorio (uno termina cuando arranca el otro) => OK', () => {
    const r = validarCapacidadRecurso([
      reserva('R_CONSULTORIO_1', '09:00', '10:00'),
      reserva('R_CONSULTORIO_1', '10:00', '11:00'),
    ]);
    expect(r.ok).toBe(true);
  });

  it('Sala de rehabilitación (cap 6) admite varias reservas simultáneas', () => {
    const r = validarCapacidadRecurso([
      reserva('R_SALA_REHAB', '09:00', '10:00'),
      reserva('R_SALA_REHAB', '09:00', '10:00'),
      reserva('R_SALA_REHAB', '09:00', '10:00'),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('R-13 · Ventana de reserva', () => {
  it('Público: 48 h máximo', () => {
    const ahora = h('09:00');
    const dentro = new Date(ahora.getTime() + 47 * 3600 * 1000);
    const fuera = new Date(ahora.getTime() + 49 * 3600 * 1000);
    expect(validarVentanaReserva('PUBLICO', ahora, dentro).ok).toBe(true);
    expect(validarVentanaReserva('PUBLICO', ahora, fuera).ok).toBe(false);
  });
});

describe('R-14 · Cancelación', () => {
  it('Menos de 24 h => sesión consumida', () => {
    const ahora = h('09:00');
    const turno = new Date(ahora.getTime() + 12 * 3600 * 1000);
    const r = evaluarCancelacion(ahora, turno);
    expect(r.consumeSesion).toBe(true);
    expect(r.devuelveSaldo).toBe(false);
  });

  it('24 h o más => devuelve saldo', () => {
    const ahora = h('09:00');
    const turno = new Date(ahora.getTime() + 48 * 3600 * 1000);
    const r = evaluarCancelacion(ahora, turno);
    expect(r.devuelveSaldo).toBe(true);
  });

  it('Fuerza mayor médica con < 24 h => no consume', () => {
    const ahora = h('09:00');
    const turno = new Date(ahora.getTime() + 2 * 3600 * 1000);
    const r = evaluarCancelacion(ahora, turno, { fuerzaMayorMedica: true });
    expect(r.consumeSesion).toBe(false);
  });
});
