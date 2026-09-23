import { describe, it, expect } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Appointment, CarePlan, Communication, Goal, Patient, Schedule, ServiceRequest, Task } from '@medplum/fhirtypes';
import { handler as inscribir, type EntradaInscribirGlp1 } from '../src/bots/glp1-inscribir.js';
import { handler as planificar } from '../src/bots/glp1-plan.js';
import { handler as reservar, type EntradaReserva } from '../src/bots/reservar-turno.js';
import { COD, SYSTEM } from '../src/fhir/identifiers.js';
import type { EntradaPlanGlp1 } from '../src/lib/glp1-plan.js';
import { fakeMedplum } from './fake-medplum.js';

const PACIENTE: Patient = { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Pérez' }] };
const SCHEDULE: Schedule = {
  resourceType: 'Schedule',
  id: 'sch1',
  actor: [{ display: 'Consultorio 1' }],
  identifier: [{ system: SYSTEM.recursoCodigo, value: 'SCH_R_CONSULTORIO_1' }],
};

/** 'AAAA-MM-DD' a N días de hoy (los turnos no pueden quedar en el pasado). */
function enDias(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

function indicacion(over: Partial<EntradaPlanGlp1> = {}): EntradaPlanGlp1 {
  return {
    pacienteRef: 'Patient/p1',
    fechaInicio: enDias(30),
    molecula: 'Semaglutida',
    indicacion: 'dm2',
    titulacion: [
      { dosis: '0,25 mg semanal', semanas: 4 },
      { dosis: '0,5 mg semanal', semanas: 4 },
      { dosis: '1 mg semanal', semanas: 0, terapeutica: true },
    ],
    ...over,
  };
}

const evento = <T>(input: T) => ({ input, secrets: {} }) as unknown as BotEvent<T>;

describe('Bot som-glp1-inscribir (Recepción)', () => {
  it('Deja la tarea de indicación al equipo médico una sola vez', async () => {
    const { medplum, todos } = fakeMedplum([PACIENTE]);
    const r1 = await inscribir(medplum, evento<EntradaInscribirGlp1>({ pacienteRef: 'Patient/p1' }));
    const r2 = await inscribir(medplum, evento<EntradaInscribirGlp1>({ pacienteRef: 'Patient/p1' }));

    expect(r1).toMatchObject({ ok: true, estado: 'indicacion-pendiente', creado: true });
    expect(r2).toMatchObject({ ok: true, estado: 'indicacion-pendiente', creado: false, taskId: r1.taskId });
    const tareas = todos<Task>('Task');
    expect(tareas).toHaveLength(1);
    expect(tareas[0]?.code?.coding?.[0]?.code).toBe(COD.indicacionGlp1);
  });

  it('Con el programa armado, informa que está activo y cuántos controles faltan agendar', async () => {
    const { medplum } = fakeMedplum([PACIENTE]);
    await planificar(medplum, evento(indicacion()));
    const r = await inscribir(medplum, evento<EntradaInscribirGlp1>({ pacienteRef: 'Patient/p1' }));
    expect(r).toMatchObject({ ok: true, estado: 'activo', controlesPorAgendar: 5 });
  });

  it('Sin paciente válido no hace nada', async () => {
    const { medplum, todos } = fakeMedplum([PACIENTE]);
    expect((await inscribir(medplum, evento<EntradaInscribirGlp1>({ pacienteRef: 'p1' }))).ok).toBe(false);
    expect(todos('Task')).toHaveLength(0);
  });
});

describe('Bot som-glp1-plan (equipo médico)', () => {
  it('Arma el programa y resuelve la indicación pendiente', async () => {
    const { medplum, todos } = fakeMedplum([PACIENTE]);
    await inscribir(medplum, evento<EntradaInscribirGlp1>({ pacienteRef: 'Patient/p1' }));
    const r = await planificar(medplum, evento(indicacion()));

    expect(r).toMatchObject({ ok: true, recalculado: false, semanaRevision: 20 });
    expect(todos<CarePlan>('CarePlan')).toHaveLength(1);
    expect(todos<Goal>('Goal')).toHaveLength(1);
    const agenda = todos<Task>('Task').filter((t) => t.code?.coding?.[0]?.code === COD.agendarControlGlp1);
    expect(agenda.map((t) => t.input?.find((i) => i.type?.text === 'semana')?.valueInteger)).toEqual([0, 4, 12, 20, 26]);
    // 12 basales + 2 (sem. 12, DM2) + 4 (revisión) + 10 (semestral).
    expect(todos<ServiceRequest>('ServiceRequest')).toHaveLength(28);
    const indicacionTask = todos<Task>('Task').find((t) => t.code?.coding?.[0]?.code === COD.indicacionGlp1);
    expect(indicacionTask?.status).toBe('completed');
    expect(indicacionTask?.output?.[0]?.valueReference?.reference).toBe(`CarePlan/${r.carePlanId}`);
  });

  it('Si cambia la titulación, recalcula en el lugar: la revisión se corre y no se duplica nada', async () => {
    const { medplum, todos } = fakeMedplum([PACIENTE]);
    const r1 = await planificar(medplum, evento(indicacion()));
    const r2 = await planificar(
      medplum,
      evento(
        indicacion({
          titulacion: [
            { dosis: '0,25 mg semanal', semanas: 4 },
            { dosis: '0,5 mg semanal', semanas: 4 },
            { dosis: '1 mg semanal', semanas: 4 },
            { dosis: '2 mg semanal', semanas: 0, terapeutica: true },
          ],
        }),
      ),
    );

    expect(r2).toMatchObject({ ok: true, recalculado: true, carePlanId: r1.carePlanId, semanaRevision: 24 });
    expect(r2.tareas).toEqual({ creadas: 1, actualizadas: 0, canceladas: 1 });
    expect(todos('CarePlan')).toHaveLength(1);
    expect(todos('Goal')).toHaveLength(1);
    const semanas = (estado: Task['status']) =>
      todos<Task>('Task')
        .filter((t) => t.status === estado)
        .map((t) => t.input?.find((i) => i.type?.text === 'semana')?.valueInteger);
    expect(semanas('requested')).toEqual([0, 4, 12, 26, 24]);
    expect(semanas('cancelled')).toEqual([20]);
  });

  it('No toca un control ya agendado: lo informa para revisar', async () => {
    const { medplum, todos } = fakeMedplum([PACIENTE]);
    await planificar(medplum, evento(indicacion()));
    const s4 = todos<Task>('Task').find((t) => t.input?.some((i) => i.type?.text === 'semana' && i.valueInteger === 4))!;
    await medplum.updateResource<Task>({ ...s4, status: 'completed' });

    const r = await planificar(medplum, evento(indicacion({ fechaInicio: enDias(37) })));

    expect(r.aRevisar).toHaveLength(1);
    expect(r.aRevisar?.[0]).toMatch(/^Control semana 4: ya agendado/);
    expect((await medplum.readResource('Task', s4.id!)).restriction).toEqual(s4.restriction);
  });

  it('Una indicación inválida no crea nada', async () => {
    const { medplum, todos } = fakeMedplum([PACIENTE]);
    const r = await planificar(medplum, evento(indicacion({ titulacion: [{ dosis: '1 mg', semanas: 4 }] })));
    expect(r.ok).toBe(false);
    expect(todos('CarePlan')).toHaveLength(0);
  });
});

describe('Bot som-reservar-turno con tarea del programa (R-19)', () => {
  async function conPrograma() {
    const f = fakeMedplum([PACIENTE, SCHEDULE]);
    await planificar(f.medplum, evento(indicacion()));
    const s4 = f.todos<Task>('Task').find((t) => t.input?.some((i) => i.type?.text === 'semana' && i.valueInteger === 4))!;
    return { ...f, s4 };
  }
  const turno = (tareaId: string, dia: string, pacienteRef = 'Patient/p1'): EntradaReserva => ({
    pacienteRef,
    servicioCodigo: 'CONTROL_GLP1',
    recursoCodigo: 'R_CONSULTORIO_1',
    inicio: `${dia}T10:00:00-03:00`,
    tareaId,
  });

  it('Dentro de la ventana: crea el turno y completa la tarea', async () => {
    const { medplum, todos, s4 } = await conPrograma();
    const r = await reservar(medplum, evento(turno(s4.id!, s4.restriction!.period!.start!)));

    expect(r).toMatchObject({ ok: true, creado: true });
    const t = await medplum.readResource('Task', s4.id!);
    expect(t.status).toBe('completed');
    expect(t.output?.[0]?.valueReference?.reference).toBe(`Appointment/${r.appointmentId}`);
    expect(todos<Appointment>('Appointment')).toHaveLength(1);
    // La semana 4 no lleva laboratorio: el aviso no lo pide.
    expect(todos<Communication>('Communication')[0]?.payload?.[0]?.contentString).not.toMatch(/laboratorio/);
  });

  it('Si el control lleva laboratorio, el aviso al paciente se lo recuerda', async () => {
    const { medplum, todos } = await conPrograma();
    const s12 = todos<Task>('Task').find((t) => t.input?.some((i) => i.type?.text === 'semana' && i.valueInteger === 12))!;
    const r = await reservar(medplum, evento(turno(s12.id!, s12.restriction!.period!.start!)));

    expect(r.creado).toBe(true);
    expect(todos<Communication>('Communication')[0]?.payload?.[0]?.contentString).toMatch(/Traé los resultados del laboratorio/);
  });

  it('Pasada la ventana: agenda igual, con advertencia (R-19)', async () => {
    const { medplum, s4 } = await conPrograma();
    const despues = new Date(Date.parse(`${s4.restriction!.period!.end!}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await reservar(medplum, evento(turno(s4.id!, despues)));

    expect(r.creado).toBe(true);
    expect(r.advertencias.map((a) => a.regla)).toContain('R-19');
  });

  it('Antes de la ventana: bloquea (R-19) y la tarea sigue pendiente', async () => {
    const { medplum, todos, s4 } = await conPrograma();
    const antes = new Date(Date.parse(`${s4.restriction!.period!.start!}T12:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await reservar(medplum, evento(turno(s4.id!, antes)));

    expect(r.creado).toBe(false);
    expect(r.bloqueos.map((b) => b.regla)).toContain('R-19');
    expect((await medplum.readResource('Task', s4.id!)).status).toBe('requested');
    expect(todos('Appointment')).toHaveLength(0);
  });

  it('Una tarea de otro paciente no se puede usar', async () => {
    const { medplum, s4 } = await conPrograma();
    const r = await reservar(medplum, evento(turno(s4.id!, s4.restriction!.period!.start!, 'Patient/otro')));
    expect(r).toMatchObject({ ok: false, creado: false });
  });
});
