import { describe, it, expect } from 'vitest';
import { getServicio } from '../src/config/catalogo.js';
import { validarReserva, type ContextoReserva } from '../src/bots/reservar-turno.js';
import type { ReservaRecurso } from '../src/lib/reglas-turno.js';

const AHORA = new Date('2026-06-22T08:00:00-03:00');

function ctx(over: Partial<ContextoReserva> & { servicioCodigo: string; recursoCodigo: string; inicio: Date }): ContextoReserva {
  const servicio = getServicio(over.servicioCodigo);
  const inicio = over.inicio;
  const fin = new Date(inicio.getTime() + servicio.duracionMin * 60_000);
  return {
    servicio,
    inicio,
    fin,
    recursoCodigo: over.recursoCodigo,
    contraindicacionesActivas: over.contraindicacionesActivas ?? [],
    prescripcionActiva: over.prescripcionActiva ?? false,
    autorizacionMedica: over.autorizacionMedica ?? false,
    reservasExistentes: over.reservasExistentes ?? [],
    perfil: over.perfil,
    ahora: over.ahora ?? AHORA,
  };
}

function reserva(recursoCodigo: string, desde: string, hasta: string): ReservaRecurso {
  return {
    recursoCodigo,
    inicio: new Date(`2026-06-22T${desde}:00-03:00`),
    fin: new Date(`2026-06-22T${hasta}:00-03:00`),
  };
}

describe('validarReserva', () => {
  it('Turno válido (consulta de cardiología, consultorio libre, futuro) => ok', () => {
    const r = validarReserva(ctx({ servicioCodigo: 'CARDIOLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: new Date('2026-06-22T09:00:00-03:00') }));
    expect(r.ok).toBe(true);
    expect(r.bloqueos).toHaveLength(0);
  });

  it('Turno en el pasado => bloqueo', () => {
    const r = validarReserva(ctx({ servicioCodigo: 'CARDIOLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: new Date('2026-06-22T07:00:00-03:00') }));
    expect(r.ok).toBe(false);
  });

  it('Mismo consultorio (cap 1) ya ocupado => bloqueo (R-07)', () => {
    const r = validarReserva(
      ctx({
        servicioCodigo: 'CARDIOLOGIA',
        recursoCodigo: 'R_CONSULTORIO_1',
        inicio: new Date('2026-06-22T09:00:00-03:00'),
        reservasExistentes: [reserva('R_CONSULTORIO_1', '09:00', '10:00')],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-07')).toBe(true);
  });

  it('Dos subespecialidades en consultorios distintos a la misma hora => ok', () => {
    const r = validarReserva(
      ctx({
        servicioCodigo: 'HEMODINAMIA',
        recursoCodigo: 'R_CONSULTORIO_2',
        inicio: new Date('2026-06-22T09:00:00-03:00'),
        reservasExistentes: [reserva('R_CONSULTORIO_1', '09:00', '10:00')],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('Fuera de la ventana de reserva del perfil público => bloqueo (R-13)', () => {
    const r = validarReserva(
      ctx({
        servicioCodigo: 'CARDIOLOGIA',
        recursoCodigo: 'R_CONSULTORIO_1',
        inicio: new Date('2026-06-25T09:00:00-03:00'), // > 48 h desde AHORA
        perfil: 'PUBLICO',
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-13')).toBe(true);
  });
});
