/**
 * Derivaciones del Plan Bienestar 100 Días® que decide el equipo médico y Recepción
 * agenda desde su tarea (R-20): la lógica pura (`src/lib/derivaciones-pb100d.ts`) y
 * `som-reservar-turno` con `tareaId` de una derivación sobre un Medplum en memoria.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Appointment, Resource, Schedule, Task } from '@medplum/fhirtypes';
import { handler as reservar, validarReserva } from '../src/bots/reservar-turno.js';
import { CONSULTAS_POR_ESPECIALIDAD, DERIVACIONES_PB100D, getServicio } from '../src/config/catalogo.js';
import { SYSTEM } from '../src/fhir/identifiers.js';
import {
  GRUPO_POR_RESPONSABLE,
  derivacionesPendientes,
  esTareaDerivacion,
  leerTareaDerivacion,
  validarDerivacionSinTarea,
  validarTareaDerivacion,
} from '../src/lib/derivaciones-pb100d.js';
import { fakeMedplum } from './fake-medplum.js';

const CATALOGO = 'https://epa-bienestar.ar/fhir/CodeSystem/catalogo-pb100d';
const EPA = 'https://epa-bienestar.ar/fhir/CodeSystem/plan-bienestar-100-dias';
const ev = (input: unknown, secrets: Record<string, unknown> = {}) => ({ input, secrets }) as never;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z')); // viernes 25/09, 09:00 en Buenos Aires
});
afterAll(() => {
  vi.useRealTimers();
});

/** Una derivación como la escribe el menú del equipo del monorepo. */
function derivacion(
  id: string,
  codigo: string,
  responsable: string,
  titulo: string,
  extra: Partial<Task> = {},
): Task {
  return {
    resourceType: 'Task',
    id,
    status: 'requested',
    intent: 'order',
    for: { reference: 'Patient/p1' },
    code: {
      coding: [
        { system: CATALOGO, code: codigo, display: titulo },
        { system: EPA, code: 'derivacion' },
      ],
      text: titulo,
    },
    description: 'Con eGFR < 45 o UACR ≥ 300 mg/g',
    performerType: [{ coding: [{ system: EPA, code: responsable }], text: titulo }],
    requester: { reference: 'Practitioner/dra' },
    authoredOn: '2026-09-24T15:00:00Z',
    ...extra,
  };
}

describe('Lectura de la tarea de derivación', () => {
  it('reconoce la derivación del plan por el catálogo firmado y el tipo; no confunde otras tareas', () => {
    expect(esTareaDerivacion(derivacion('d1', 'E3-DER-01', 'nefrologia', 'Nefrología'))).toBe(true);
    // Paso del plan clínico (mismo CodeSystem EPA, otro tipo) y tarea de Recepción.
    expect(
      esTareaDerivacion({ resourceType: 'Task', status: 'requested', intent: 'plan', code: { coding: [{ system: EPA, code: 'conducta' }] } }),
    ).toBe(false);
    expect(
      esTareaDerivacion({ resourceType: 'Task', status: 'requested', intent: 'order', code: { coding: [{ system: SYSTEM.taskTipo, code: 'agendar-consulta-pb100d' }] } }),
    ).toBe(false);
  });

  it('lee sólo lo operativo y resuelve la consulta del catálogo de SOM por el responsable', () => {
    const d = leerTareaDerivacion(derivacion('d1', 'E3-DER-01', 'nefrologia', 'Nefrología'));
    expect(d).toEqual({
      taskId: 'd1',
      codigo: 'E3-DER-01',
      titulo: 'Nefrología',
      texto: 'Con eGFR < 45 o UACR ≥ 300 mg/g',
      responsable: 'nefrologia',
      grupo: 'nefrologia',
      servicios: ['NEFROLOGIA'],
      estado: 'pendiente',
      decididaPor: 'Practitioner/dra',
      fecha: '2026-09-24',
    });
    // Neumonología va al grupo de Tisioneumonología; Obstetricia a Ginecología.
    expect(leerTareaDerivacion(derivacion('d2', 'E2-DER-03', 'neumonologia', 'Neumonología')).servicios).toEqual(['TISIONEUMONOLOGIA']);
    expect(leerTareaDerivacion(derivacion('d3', 'E1-DER-09', 'obstetricia', 'Obstetricia')).grupo).toBe('ginecologia');
    // Sin consulta en SOM (enfermería): queda como tarea del equipo, sin servicios.
    const enf = leerTareaDerivacion(derivacion('d4', 'E2-DER-07', 'enfermeria', 'Enfermería'));
    expect(enf.grupo).toBeUndefined();
    expect(enf.servicios).toEqual([]);
    // Ya agendada: trae el turno.
    const hecha = leerTareaDerivacion(
      derivacion('d5', 'E3-DER-01', 'nefrologia', 'Nefrología', {
        status: 'completed',
        output: [{ type: { text: 'turno' }, valueReference: { reference: 'Appointment/a9' } }],
      }),
    );
    expect(hecha).toMatchObject({ estado: 'cerrado', appointmentRef: 'Appointment/a9' });
  });

  it('todo grupo al que va un responsable tiene consulta en el catálogo de SOM, y toda derivación del catálogo se agenda desde tarea', () => {
    for (const grupo of Object.values(GRUPO_POR_RESPONSABLE)) {
      expect(CONSULTAS_POR_ESPECIALIDAD.some((s) => s.grupo === grupo), grupo).toBe(true);
    }
    expect(DERIVACIONES_PB100D.every((s) => s.soloDesdeTarea)).toBe(true);
  });

  it('derivacionesPendientes: sólo las pendientes con intent order, la más reciente primero', () => {
    const lista = derivacionesPendientes([
      derivacion('d1', 'E3-DER-01', 'nefrologia', 'Nefrología', { authoredOn: '2026-09-20T10:00:00Z' }),
      derivacion('d2', 'E2-DER-03', 'neumonologia', 'Neumonología', { authoredOn: '2026-09-24T10:00:00Z' }),
      derivacion('d3', 'E3-DER-01', 'nefrologia', 'Nefrología', { status: 'completed' }),
      derivacion('d4', 'E3-DER-01', 'nefrologia', 'Nefrología', { status: 'cancelled' }),
      derivacion('d5', 'E3-DER-01', 'nefrologia', 'Nefrología', { intent: 'proposal' }),
    ]);
    expect(lista.map((d) => d.taskId)).toEqual(['d2', 'd1']);
  });
});

describe('Validaciones R-20', () => {
  const t = derivacion('d1', 'E3-DER-01', 'nefrologia', 'Nefrología');

  it('validarTareaDerivacion: paciente, estado, consulta del grupo', () => {
    expect(validarTareaDerivacion(t, { pacienteRef: 'Patient/p1', servicioCodigo: 'NEFROLOGIA' })).toMatchObject({ ok: true, datos: { taskId: 'd1' } });
    expect(validarTareaDerivacion(t, { pacienteRef: 'Patient/otro', servicioCodigo: 'NEFROLOGIA' })).toEqual({ ok: false, error: 'La tarea es de otro paciente.' });
    expect(validarTareaDerivacion(t, { pacienteRef: 'Patient/p1', servicioCodigo: 'CARDIOLOGIA' })).toEqual({
      ok: false,
      error: 'La derivación a Nefrología se agenda con una consulta de nefrologia: NEFROLOGIA.',
    });
    expect(validarTareaDerivacion({ ...t, status: 'completed' }, { pacienteRef: 'Patient/p1', servicioCodigo: 'NEFROLOGIA' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ya no está pendiente/),
    });
    expect(
      validarTareaDerivacion(derivacion('d4', 'E2-DER-07', 'enfermeria', 'Enfermería'), { pacienteRef: 'Patient/p1', servicioCodigo: 'NEFROLOGIA' }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/no tiene consulta en el catálogo de SOM/) });
    expect(validarTareaDerivacion({ ...t, code: { text: 'x' } }, { pacienteRef: 'Patient/p1', servicioCodigo: 'NEFROLOGIA' })).toMatchObject({ ok: false });
  });

  it('validarDerivacionSinTarea bloquea las consultas de derivación sueltas y deja pasar el resto', () => {
    expect(validarDerivacionSinTarea('NEFROLOGIA')).toMatchObject({ ok: false, bloqueos: [{ regla: 'R-20', mensaje: expect.stringMatching(/derivación del Plan Bienestar/) }] });
    expect(validarDerivacionSinTarea('PSICOLOGIA').ok).toBe(false);
    expect(validarDerivacionSinTarea('CARDIOLOGIA')).toEqual({ ok: true, bloqueos: [], advertencias: [] });
    expect(validarDerivacionSinTarea('CONSULTA_PB100D').ok).toBe(true);
  });

  it('validarReserva: la derivación con su tarea pasa; sin ella, R-20', () => {
    const base = {
      servicio: getServicio('NEFROLOGIA'),
      inicio: new Date('2026-09-29T10:00:00-03:00'),
      fin: new Date('2026-09-29T10:30:00-03:00'),
      recursoCodigo: 'R_CONSULTORIO_1',
      reservasExistentes: [],
      ahora: new Date(),
    };
    expect(validarReserva(base).bloqueos.map((b) => b.regla)).toEqual(['R-20']);
    expect(validarReserva({ ...base, derivacion: { titulo: 'Nefrología', codigo: 'E3-DER-01' } }).ok).toBe(true);
  });
});

describe('Bot som-reservar-turno con una derivación', () => {
  function entorno(extra: Resource[] = []) {
    const schedules: Schedule[] = ['R_CONSULTORIO_1', 'R_TELEMEDICINA'].map((codigo) => ({
      resourceType: 'Schedule',
      id: `sch-${codigo}`,
      actor: [{ display: codigo }],
      identifier: [{ system: SYSTEM.recursoCodigo, value: `SCH_${codigo}` }],
    }));
    const f = fakeMedplum([{ resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Pérez' }] }, ...schedules, ...extra]);
    return {
      ...f,
      tarea: (id: string) => f.todos<Task>('Task').find((t) => t.id === id)!,
      turno: (id: string | undefined) => f.todos<Appointment>('Appointment').find((a) => a.id === id)!,
    };
  }

  it('agenda la derivación desde su tarea: turno con cargo (tentativo), la tarea queda completada y ligada al turno', async () => {
    const e = entorno([derivacion('d1', 'E3-DER-01', 'nefrologia', 'Nefrología')]);
    const r = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'NEFROLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-09-29T10:00:00-03:00', tareaId: 'd1' }),
    );
    expect(r).toMatchObject({ ok: true, creado: true, incluida: false, modalidad: 'presencial' });
    const appt = e.turno(r.appointmentId);
    expect(appt.status).toBe('pending'); // con cargo: tentativo hasta la seña
    expect(appt.description).toBe('Consulta de Nefrología');
    expect(appt.supportingInformation).toEqual([{ reference: 'Task/d1' }]);
    expect(appt.specialty?.[0]?.coding?.[0]).toMatchObject({ code: '394589003' });
    expect(e.tarea('d1')).toMatchObject({ status: 'completed', output: [{ valueReference: { reference: `Appointment/${r.appointmentId}` } }] });
    expect(derivacionesPendientes(e.todos<Task>('Task'))).toEqual([]);
  });

  it('sin tarea, la consulta de derivación se bloquea (R-20); con la tarea de otra especialidad, también', async () => {
    const e = entorno([derivacion('d1', 'E3-DER-01', 'nefrologia', 'Nefrología')]);
    const suelta = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'NEFROLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-09-29T10:00:00-03:00' }),
    );
    expect(suelta).toMatchObject({ ok: false, creado: false, bloqueos: [{ regla: 'R-20' }] });

    const otra = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'CARDIOLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-09-29T10:00:00-03:00', tareaId: 'd1' }),
    );
    expect(otra).toMatchObject({ ok: false, creado: false, bloqueos: [{ regla: 'R-20', mensaje: expect.stringMatching(/se agenda con una consulta de nefrologia/) }] });
    expect(e.tarea('d1').status).toBe('requested');
    expect(e.todos<Appointment>('Appointment')).toEqual([]);
  });

  it('una consulta de la lista oficial sigue reservándose sin tarea', async () => {
    const e = entorno();
    const r = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'CARDIOLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-09-29T10:00:00-03:00' }),
    );
    expect(r).toMatchObject({ ok: true, creado: true });
  });
});
