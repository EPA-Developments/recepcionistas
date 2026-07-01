import { describe, it, expect } from 'vitest';
import { generarSlots, estadoRecurso, type SlotDescriptor } from '../src/lib/slots.js';
import { buildSlot } from '../src/seed/builders.js';
import type { RecursoFisico } from '../src/domain/types.js';
import type { HorarioDia } from '../src/config/horario.js';

const recursos: RecursoFisico[] = [
  { codigo: 'R_A', nombre: 'Recurso A', tipo: 'CONSULTORIO', capacidad: 1 },
  { codigo: 'R_B', nombre: 'Recurso B', tipo: 'CONSULTORIO', capacidad: 1 },
];

// Lunes 09:00-11:00 abierto; resto cerrado.
const horario: HorarioDia[] = [
  { dia: 0, abierto: false, franjas: [] },
  { dia: 1, abierto: true, franjas: [{ desde: '09:00', hasta: '11:00' }] },
  { dia: 2, abierto: false, franjas: [] },
  { dia: 3, abierto: false, franjas: [] },
  { dia: 4, abierto: false, franjas: [] },
  { dia: 5, abierto: false, franjas: [] },
  { dia: 6, abierto: false, franjas: [] },
];

describe('generarSlots', () => {
  it('Genera franjas de 30 min por recurso solo en días/horas abiertos', () => {
    // 2026-06-22 es lunes. Generamos 1 día.
    const slots = generarSlots(recursos, horario, { desde: new Date('2026-06-22T00:00:00Z'), dias: 1 });
    // 09:00-11:00 = 4 franjas de 30 min × 2 recursos = 8 slots.
    expect(slots).toHaveLength(8);
    const horas = slots.filter((s) => s.recursoCodigo === 'R_A').map((s) => s.inicio);
    expect(horas).toEqual([
      '2026-06-22T09:00:00-03:00',
      '2026-06-22T09:30:00-03:00',
      '2026-06-22T10:00:00-03:00',
      '2026-06-22T10:30:00-03:00',
    ]);
  });

  it('No genera slots en días cerrados', () => {
    // 2026-06-21 es domingo (cerrado).
    const slots = generarSlots(recursos, horario, { desde: new Date('2026-06-21T00:00:00Z'), dias: 1 });
    expect(slots).toHaveLength(0);
  });

  it('Respeta la granularidad configurable', () => {
    const slots = generarSlots([recursos[0]!], horario, {
      desde: new Date('2026-06-22T00:00:00Z'),
      dias: 1,
      granularidadMin: 60,
    });
    // 09:00-11:00 en pasos de 60 min = 2 slots.
    expect(slots).toHaveLength(2);
    expect(slots[0]!.fin).toBe('2026-06-22T10:00:00-03:00');
  });

  it('No genera una franja que excede el cierre', () => {
    // Franja 09:00-09:40 con granularidad 30 => solo 1 slot (09:00-09:30); 09:30-10:00 excede.
    const h: HorarioDia[] = [{ dia: 1, abierto: true, franjas: [{ desde: '09:00', hasta: '09:40' }] }];
    const slots = generarSlots([recursos[0]!], h, { desde: new Date('2026-06-22T00:00:00Z'), dias: 1 });
    expect(slots).toHaveLength(1);
  });
});

describe('buildSlot', () => {
  it('Crea un Slot FHIR con identifier determinista y referencia al Schedule', () => {
    const desc: SlotDescriptor = {
      recursoCodigo: 'R_A',
      inicio: '2026-06-22T09:00:00-03:00',
      fin: '2026-06-22T09:30:00-03:00',
      estado: 'free',
    };
    const slot = buildSlot(desc, 'Schedule/abc');
    expect(slot.resourceType).toBe('Slot');
    expect(slot.status).toBe('free');
    expect(slot.schedule?.reference).toBe('Schedule/abc');
    expect(slot.identifier?.[0]?.value).toBe('R_A|2026-06-22T09:00:00-03:00');
  });
});

describe('estadoRecurso (semáforo)', () => {
  const ahora = new Date('2026-06-22T10:00:00-03:00');

  it('Rojo si está ocupado ahora', () => {
    const color = estadoRecurso(ahora, [
      { inicio: new Date('2026-06-22T09:30:00-03:00'), fin: new Date('2026-06-22T10:30:00-03:00') },
    ]);
    expect(color).toBe('rojo');
  });

  it('Amarillo si se ocupa dentro de 15 min', () => {
    const color = estadoRecurso(ahora, [
      { inicio: new Date('2026-06-22T10:10:00-03:00'), fin: new Date('2026-06-22T11:00:00-03:00') },
    ]);
    expect(color).toBe('amarillo');
  });

  it('Verde si está libre y nada arranca en 15 min', () => {
    const color = estadoRecurso(ahora, [
      { inicio: new Date('2026-06-22T10:30:00-03:00'), fin: new Date('2026-06-22T11:00:00-03:00') },
    ]);
    expect(color).toBe('verde');
  });

  it('Verde si no hay turnos', () => {
    expect(estadoRecurso(ahora, [])).toBe('verde');
  });
});
