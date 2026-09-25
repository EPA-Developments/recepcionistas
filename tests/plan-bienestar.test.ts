import { describe, it, expect } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { CarePlan, Task } from '@medplum/fhirtypes';
import {
  DIAS_PLAN_BIENESTAR,
  calendarioPlanBienestar,
  claveDeActividad,
  construirCarePlanBienestar,
  construirTareasPlanBienestar,
  esFechaValida,
  leerTareaConsultaPlan,
  periodoPlanBienestar,
  planTrasAgendar,
  resumenPlanBienestar,
  sumarConsultaExtra,
  sumarDias,
  tareasARecalcular,
  validarConsultaPlanSinTarea,
  validarTareaConsultaPlan,
  validarVentanaConsultaPlan,
} from '../src/lib/plan-bienestar.js';
import { handler as inscribir, type EntradaInscribirBienestar } from '../src/bots/bienestar-inscribir.js';
import { BOT_BIENESTAR_INSCRIBIR, COD, PLAN_BIENESTAR_URL, SYSTEM } from '../src/fhir/identifiers.js';
import { BOTS_RECEPCION } from '../src/fhir/access-policies.js';
import { fakeMedplum } from './fake-medplum.js';

describe('Plan Bienestar · 100 días — período', () => {
  it('fin = inicio + 100 días (cruza meses y años bisiestos)', () => {
    expect(DIAS_PLAN_BIENESTAR).toBe(100);
    expect(periodoPlanBienestar('2026-09-24')).toEqual({ start: '2026-09-24', end: '2027-01-02' });
    expect(sumarDias('2028-02-01', 100)).toBe('2028-05-11');
  });

  it('valida fechas AAAA-MM-DD reales', () => {
    expect(esFechaValida('2026-09-24')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('24/09/2026')).toBe(false);
    expect(esFechaValida(undefined)).toBe(false);
  });

  it('el CarePlan tiene el shape que detecta el portal (category care-plans|plan-bienestar-100)', () => {
    const cp = construirCarePlanBienestar('Patient/p1', '2026-09-24');
    expect(cp.status).toBe('active');
    expect(cp.subject?.reference).toBe('Patient/p1');
    expect(cp.category?.[0]?.coding?.[0]).toMatchObject({
      system: 'https://segundaopinionmedica.org/fhir/CodeSystem/care-plans',
      code: 'plan-bienestar-100',
    });
    expect(cp.period).toEqual({ start: '2026-09-24', end: '2027-01-02' });
  });
});

describe('Bot som-bienestar-inscribir', () => {
  const evento = (input: EntradaInscribirBienestar) =>
    ({ input, secrets: {} }) as unknown as BotEvent<EntradaInscribirBienestar>;

  it('crea el plan una sola vez (idempotente) y devuelve el período', async () => {
    const { medplum, todos } = fakeMedplum([{ resourceType: 'Patient', id: 'p1' }]);
    const r1 = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-10-01' }));
    expect(r1).toMatchObject({ ok: true, creado: true, inicio: '2026-10-01', fin: '2027-01-09' });
    const r2 = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-11-01' }));
    expect(r2).toMatchObject({ ok: true, creado: false, carePlanId: r1.carePlanId, inicio: '2026-10-01' });
    const planes = todos<CarePlan>('CarePlan').filter((c) =>
      c.category?.some((cc) => cc.coding?.some((x) => x.system === SYSTEM.planCuidado && x.code === COD.planBienestar100)),
    );
    expect(planes).toHaveLength(1);
  });

  it('rechaza paciente inexistente o fecha inválida', async () => {
    const { medplum } = fakeMedplum([]);
    expect((await inscribir(medplum, evento({ pacienteRef: 'Patient/nadie' }))).ok).toBe(false);
    expect((await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-13-01' }))).ok).toBe(false);
    expect((await inscribir(medplum, evento({ pacienteRef: 'nadie' }))).ok).toBe(false);
  });

  it('Recepción puede ejecutarlo', () => {
    expect(BOTS_RECEPCION as readonly string[]).toContain(BOT_BIENESTAR_INSCRIBIR);
  });
});

const enBsAs = (fechaHora: string) => new Date(`${fechaHora}:00-03:00`);

describe('Plan Bienestar 100 Días® — calendario (R-20)', () => {
  it('día 1 = consulta inicial; día 50 y día 100 con ± 7 días', () => {
    expect(calendarioPlanBienestar('2026-10-01')).toEqual([
      { clave: 'inicial', dia: 1, titulo: 'Consulta inicial', fecha: '2026-10-01' },
      { clave: 'mitad', dia: 50, titulo: 'Consulta del día 50', fecha: '2026-11-19', ventana: { desde: '2026-11-12', hasta: '2026-11-26' } },
      { clave: 'final', dia: 100, titulo: 'Consulta final', fecha: '2027-01-08', ventana: { desde: '2027-01-01', hasta: '2027-01-15' } },
    ]);
  });

  it('el CarePlan conserva el contrato del portal y suma las tres consultas', () => {
    const cp = construirCarePlanBienestar('Patient/p1', '2026-10-01');
    expect(cp.title).toBe('Plan Bienestar 100 Días®');
    expect(cp.instantiatesCanonical).toEqual([`${PLAN_BIENESTAR_URL}|1`]);
    expect(cp.activity?.map(claveDeActividad)).toEqual(['inicial', 'mitad', 'final']);
    expect(cp.activity?.[1]?.detail).toMatchObject({
      kind: 'Appointment',
      status: 'not-started',
      scheduledPeriod: { start: '2026-11-12', end: '2026-11-26' },
    });
    expect(cp.activity?.[0]?.detail?.scheduledPeriod).toEqual({ start: '2026-10-01' });
  });

  it('una tarea por consulta, sin datos clínicos, con su ventana', () => {
    const tareas = construirTareasPlanBienestar('Patient/p1', 'cp1', calendarioPlanBienestar('2026-10-01'), '2026-09-25T12:00:00Z');
    expect(tareas).toHaveLength(3);
    expect(tareas.map((t) => t.identifier?.[0]?.value)).toEqual(['cp1:inicial', 'cp1:mitad', 'cp1:final']);
    expect(tareas[1]?.description).toBe('Plan Bienestar 100 Días® · Consulta del día 50 (día 50) · agendar entre el 12/11/2026 y el 26/11/2026');
    expect(tareas[0]?.description).toMatch(/su fecha marca el día 1 del plan/);
    expect(leerTareaConsultaPlan(tareas[2]!)).toMatchObject({
      clave: 'final',
      dia: 100,
      servicio: 'CONSULTA_PB100D',
      carePlanRef: 'CarePlan/cp1',
      ventana: { desde: '2027-01-01', hasta: '2027-01-15' },
    });
  });
});

describe('Plan Bienestar 100 Días® — agenda (R-20)', () => {
  const tareas = construirTareasPlanBienestar('Patient/p1', 'cp1', calendarioPlanBienestar('2026-10-01'), '2026-09-25T12:00:00Z').map(
    (t, i) => ({ ...t, id: `t${i}` }),
  );
  const [inicial, mitad] = tareas as [Task, Task, Task];

  it('antes de la ventana bloquea, dentro está ok y después advierte; la inicial no tiene ventana', () => {
    const datos = leerTareaConsultaPlan(mitad);
    expect(validarVentanaConsultaPlan(enBsAs('2026-11-11T10:00'), datos)).toMatchObject({ ok: false, bloqueos: [{ regla: 'R-20' }] });
    expect(validarVentanaConsultaPlan(enBsAs('2026-11-12T10:00'), datos).ok).toBe(true);
    expect(validarVentanaConsultaPlan(enBsAs('2026-11-27T10:00'), datos)).toMatchObject({ ok: true, advertencias: [{ regla: 'R-20' }] });
    expect(validarVentanaConsultaPlan(enBsAs('2026-12-30T10:00'), leerTareaConsultaPlan(inicial)).ok).toBe(true);
  });

  it('la consulta del plan sin su tarea se bloquea', () => {
    expect(validarConsultaPlanSinTarea('CONSULTA_PB100D')).toMatchObject({ ok: false, bloqueos: [{ regla: 'R-20' }] });
    expect(validarConsultaPlanSinTarea('CARDIOLOGIA').ok).toBe(true);
  });

  it('la del día 50 espera a que esté agendada la inicial', () => {
    const base = { pacienteRef: 'Patient/p1', servicioCodigo: 'CONSULTA_PB100D' };
    expect(validarTareaConsultaPlan(mitad, { ...base, inicialAgendada: false })).toMatchObject({ ok: false, error: expect.stringMatching(/consulta inicial/) });
    expect(validarTareaConsultaPlan(mitad, { ...base, inicialAgendada: true }).ok).toBe(true);
    expect(validarTareaConsultaPlan(inicial, { ...base, inicialAgendada: false }).ok).toBe(true);
    expect(validarTareaConsultaPlan(mitad, { ...base, pacienteRef: 'Patient/otro', inicialAgendada: true }).ok).toBe(false);
    expect(validarTareaConsultaPlan(mitad, { ...base, servicioCodigo: 'CARDIOLOGIA', inicialAgendada: true }).ok).toBe(false);
    expect(validarTareaConsultaPlan({ ...mitad, status: 'completed' }, { ...base, inicialAgendada: true }).ok).toBe(false);
  });

  it('agendar la inicial corre el plan a su fecha y recalcula las otras dos (conserva estados y consultas extra)', () => {
    let cp = construirCarePlanBienestar('Patient/p1', '2026-10-01');
    cp = sumarConsultaExtra(cp, 'a9', 'Consulta de Nutrición');
    expect(sumarConsultaExtra(cp, 'a9', 'Consulta de Nutrición').activity).toHaveLength(4); // no duplica
    const movido = planTrasAgendar(cp, 'inicial', '2026-10-06');
    expect(movido.period).toEqual({ start: '2026-10-06', end: '2027-01-14' });
    expect(movido.activity?.[0]?.detail).toMatchObject({ status: 'scheduled', scheduledPeriod: { start: '2026-10-06' } });
    expect(movido.activity?.[1]?.detail?.scheduledPeriod).toEqual({ start: '2026-11-17', end: '2026-12-01' });
    expect(movido.activity?.[3]?.reference?.reference).toBe('Appointment/a9');
    // Agendar la del día 50 no mueve el plan.
    const conMitad = planTrasAgendar(movido, 'mitad', '2026-11-20');
    expect(conMitad.period?.start).toBe('2026-10-06');
    expect(conMitad.activity?.map((a) => a.detail?.status)).toEqual(['scheduled', 'scheduled', 'not-started', undefined]);
  });

  it('solo se recalculan las tareas pendientes del día 50 y la final', () => {
    const nuevas = construirTareasPlanBienestar('Patient/p1', 'cp1', calendarioPlanBienestar('2026-10-06'), '2026-10-02T12:00:00Z');
    const existentes = [{ ...inicial, status: 'completed' as const }, mitad, { ...tareas[2]!, status: 'completed' as const }];
    const cambios = tareasARecalcular(existentes, nuevas);
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({ id: 't1', restriction: { period: { start: '2026-11-17', end: '2026-12-01' } } });
  });

  it('resumen para Recepción: las tres consultas en orden, con estado', () => {
    const r = resumenPlanBienestar([{ ...inicial, status: 'completed' }, mitad, tareas[2]!]);
    expect(r.estado).toBe('por-agendar');
    expect(r.consultas.map((c) => [c.clave, c.estado])).toEqual([
      ['inicial', 'cerrado'],
      ['mitad', 'pendiente'],
      ['final', 'pendiente'],
    ]);
    expect(resumenPlanBienestar([]).estado).toBe('sin-plan');
  });
});

describe('Bot som-bienestar-inscribir — consultas del plan', () => {
  const evento = (input: EntradaInscribirBienestar) =>
    ({ input, secrets: {} }) as unknown as BotEvent<EntradaInscribirBienestar>;

  it('crea el plan con sus tres tareas y, si se repite, no las duplica', async () => {
    const { medplum, todos } = fakeMedplum([{ resourceType: 'Patient', id: 'p1' }]);
    const r1 = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-10-01' }));
    expect(r1).toMatchObject({ ok: true, creado: true, tareasCreadas: 3 });
    expect(r1.consultas?.map((c) => c.clave)).toEqual(['inicial', 'mitad', 'final']);
    const r2 = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1' }));
    expect(r2).toMatchObject({ ok: true, creado: false, tareasCreadas: 0 });
    expect(todos<Task>('Task')).toHaveLength(3);
  });

  it('a un plan inscripto antes (sin tareas) le suma las tres', async () => {
    const viejo = { ...construirCarePlanBienestar('Patient/p1', '2026-09-01'), id: 'cp-viejo', activity: undefined };
    const { medplum, todos } = fakeMedplum([{ resourceType: 'Patient', id: 'p1' }, viejo]);
    const r = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1' }));
    expect(r).toMatchObject({ ok: true, creado: false, carePlanId: 'cp-viejo', tareasCreadas: 3 });
    expect(todos<Task>('Task').map((t) => t.identifier?.[0]?.value)).toEqual(['cp-viejo:inicial', 'cp-viejo:mitad', 'cp-viejo:final']);
  });
});
