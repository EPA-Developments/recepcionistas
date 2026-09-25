/**
 * Plan Bienestar 100 Días® y teleconsulta, de punta a punta con los bots reales sobre
 * un Medplum en memoria: inscribir → agendar la inicial (fija el día 1) → las demás
 * consultas (R-20), teleconsulta con consentimiento y Jitsi (R-21), consulta extra con
 * cargo ligada al plan, check-in / cancelación, avisos del cron y solicitudes del portal.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Appointment, CarePlan, Communication, Encounter, Resource, Schedule, Task } from '@medplum/fhirtypes';
import { handler as inscribir } from '../src/bots/bienestar-inscribir.js';
import { handler as reservar, validarReserva, type ResultadoReserva } from '../src/bots/reservar-turno.js';
import { handler as cambiarEstado } from '../src/bots/estado-turno.js';
import { handler as pagarSena } from '../src/bots/pagar-sena.js';
import { handler as recordatorios } from '../src/bots/recordatorios.js';
import { handler as solicitar } from '../src/bots/solicitar-turno.js';
import { MENSAJE_SIN_SENA } from '../src/bots/_shared.js';
import { getServicio } from '../src/config/catalogo.js';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { claveDeActividad, leerTareaConsultaPlan } from '../src/lib/plan-bienestar.js';
import { construirConsentimientoTeleconsulta, modalidadDe, teleconsultaUrlDe } from '../src/lib/teleconsulta.js';
import { fakeMedplum } from './fake-medplum.js';

const JITSI = 'https://meet.segundaopinionmedica.org';
const secreto = (valueString: string) => ({ name: 'secreto', valueString });
const ev = (input: unknown, secrets: Record<string, unknown> = {}) => ({ input, secrets }) as never;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z')); // viernes 25/09, 09:00 en Buenos Aires
});
afterAll(() => {
  vi.useRealTimers();
});

function entorno(extra: Resource[] = []) {
  const schedules: Schedule[] = ['R_CONSULTORIO_1', 'R_CONSULTORIO_2', 'R_TELEMEDICINA'].map((codigo) => ({
    resourceType: 'Schedule',
    id: `sch-${codigo}`,
    actor: [{ display: codigo }],
    identifier: [{ system: SYSTEM.recursoCodigo, value: `SCH_${codigo}` }],
  }));
  const f = fakeMedplum([
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Pérez' }] },
    ...schedules,
    ...extra,
  ]);
  const tarea = (clave: string) => f.todos<Task>('Task').find((t) => leerTareaConsultaPlan(t).clave === clave)!;
  const plan = () => f.todos<CarePlan>('CarePlan')[0]!;
  const turno = (id: string | undefined) => f.todos<Appointment>('Appointment').find((a) => a.id === id)!;
  const mensajes = () => f.todos<Communication>('Communication').map((c) => c.payload?.[0]?.contentString ?? '');
  return { ...f, tarea, plan, turno, mensajes };
}

const consentimiento = () => ({ ...construirConsentimientoTeleconsulta('Patient/p1', new Date('2026-09-20T10:00:00Z')), id: 'consent-tele' });

/** Inscribe y agenda la inicial el martes 29/09 a las 10 (día 1). */
async function conInicialAgendada(e: ReturnType<typeof entorno>): Promise<ResultadoReserva> {
  await inscribir(e.medplum, ev({ pacienteRef: 'Patient/p1', inicio: '2026-09-25' }));
  return reservar(
    e.medplum,
    ev({
      pacienteRef: 'Patient/p1',
      servicioCodigo: 'CONSULTA_PB100D',
      recursoCodigo: 'R_CONSULTORIO_1',
      inicio: '2026-09-29T10:00:00-03:00',
      tareaId: e.tarea('inicial').id,
    }),
  );
}

describe('Consulta inicial (R-20)', () => {
  it('queda confirmada sin seña, fija el día 1 y recalcula las otras dos', async () => {
    const e = entorno();
    const r = await conInicialAgendada(e);
    expect(r).toMatchObject({ ok: true, creado: true, incluida: true, modalidad: 'presencial' });

    const appt = e.turno(r.appointmentId);
    expect(appt.status).toBe('booked');
    expect(appt.description).toBe('Consulta inicial del Plan Bienestar 100 Días®');
    expect(appt.serviceType?.[0]?.coding?.[0]?.code).toBe('CONSULTA_PB100D');
    expect(modalidadDe(appt)).toBe('presencial');
    expect(appt.supportingInformation?.map((s) => s.reference)).toEqual([`Task/${e.tarea('inicial').id}`, `CarePlan/${e.plan().id}`]);

    expect(e.tarea('inicial').status).toBe('completed');
    expect(e.plan().period).toEqual({ start: '2026-09-29', end: '2027-01-07' });
    expect(e.plan().activity?.find((a) => claveDeActividad(a) === 'inicial')?.detail?.status).toBe('scheduled');
    expect(e.tarea('mitad').restriction?.period).toEqual({ start: '2026-11-10', end: '2026-11-24' });
    expect(e.tarea('final').restriction?.period).toEqual({ start: '2026-12-30', end: '2027-01-13' });

    expect(e.mensajes().at(-1)).toMatch(/confirmamos tu consulta inicial del Plan Bienestar 100 Días® para el .*Está incluida en tu plan/);
    // Incluida: no se cobra seña.
    expect(await pagarSena(e.medplum, ev({ appointmentId: r.appointmentId }))).toEqual({ ok: false, mensaje: MENSAJE_SIN_SENA });
  });

  it('la del día 50 no se agenda antes que la inicial', async () => {
    const e = entorno();
    await inscribir(e.medplum, ev({ pacienteRef: 'Patient/p1', inicio: '2026-09-25' }));
    const r = await reservar(
      e.medplum,
      ev({
        pacienteRef: 'Patient/p1',
        servicioCodigo: 'CONSULTA_PB100D',
        recursoCodigo: 'R_CONSULTORIO_1',
        inicio: '2026-11-13T10:00:00-03:00',
        tareaId: e.tarea('mitad').id,
      }),
    );
    expect(r).toMatchObject({ ok: false, creado: false, bloqueos: [{ regla: 'R-20', mensaje: expect.stringMatching(/consulta inicial/) }] });
  });

  it('la consulta del plan sin su tarea se bloquea', async () => {
    const e = entorno();
    const r = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'CONSULTA_PB100D', recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-09-29T10:00:00-03:00' }),
    );
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.regla)).toContain('R-20');
  });
});

describe('Teleconsulta (R-21)', () => {
  const mitadPorTeleconsulta = (e: ReturnType<typeof entorno>, secrets: Record<string, unknown> = {}) =>
    reservar(
      e.medplum,
      ev(
        {
          pacienteRef: 'Patient/p1',
          servicioCodigo: 'CONSULTA_PB100D',
          recursoCodigo: 'R_TELEMEDICINA',
          inicio: '2026-11-18T11:00:00-03:00',
          tareaId: e.tarea('mitad').id,
        },
        secrets,
      ),
    );

  it('sin el consentimiento de teleconsulta, se bloquea', async () => {
    const e = entorno();
    await conInicialAgendada(e);
    const r = await mitadPorTeleconsulta(e, { JITSI_BASE_URL: secreto(JITSI) });
    expect(r).toMatchObject({ ok: false, creado: false, bloqueos: [{ regla: 'R-21' }] });
  });

  it('con consentimiento: link de Jitsi en el turno, en el aviso y en el recordatorio de 2 h', async () => {
    const e = entorno([consentimiento()]);
    await conInicialAgendada(e);
    const r = await mitadPorTeleconsulta(e, { JITSI_BASE_URL: secreto(JITSI) });
    expect(r).toMatchObject({ ok: true, creado: true, incluida: true, modalidad: 'teleconsulta' });
    expect(r.teleconsultaUrl).toMatch(/^https:\/\/meet\.segundaopinionmedica\.org\/som-[0-9a-f]{32}$/);

    const appt = e.turno(r.appointmentId);
    expect(appt.description).toBe('Teleconsulta del día 50 del Plan Bienestar 100 Días®');
    expect(modalidadDe(appt)).toBe('teleconsulta');
    expect(appt.extension?.find((x) => x.url === EXT.modalidad)?.valueCoding).toMatchObject({ code: 'VR' });
    expect(teleconsultaUrlDe(appt)).toBe(r.teleconsultaUrl);
    expect(e.mensajes().at(-1)).toContain(`entrá desde ${r.teleconsultaUrl}`);

    const rec = await recordatorios(e.medplum, ev({ ahora: '2026-11-18T13:00:00Z' })); // 1 h antes
    expect(rec.enviados2).toBe(1);
    expect(e.mensajes().at(-1)).toMatch(new RegExp(`teleconsulta del día 50 .* es hoy a las 11:00.*${r.teleconsultaUrl}`));
  });

  it('sin JITSI_BASE_URL se agenda igual, con advertencia', async () => {
    const e = entorno([consentimiento()]);
    await conInicialAgendada(e);
    const r = await mitadPorTeleconsulta(e);
    expect(r.creado).toBe(true);
    expect(r.teleconsultaUrl).toBeUndefined();
    expect(r.advertencias.map((a) => a.mensaje).join(' ')).toMatch(/JITSI_BASE_URL/);
  });

  it('la modalidad pedida tiene que coincidir con el recurso, y el servicio tiene que ofrecerla', async () => {
    const e = entorno([consentimiento()]);
    const r = await reservar(
      e.medplum,
      ev({
        pacienteRef: 'Patient/p1',
        servicioCodigo: 'NEUROLOGIA',
        recursoCodigo: 'R_CONSULTORIO_1',
        modalidad: 'teleconsulta',
        inicio: '2026-09-29T10:00:00-03:00',
      }),
    );
    expect(r).toMatchObject({ ok: false, bloqueos: [{ regla: 'R-21' }] });

    const glp1 = validarReserva({
      servicio: getServicio('CONTROL_GLP1'),
      inicio: new Date('2026-09-29T10:00:00-03:00'),
      fin: new Date('2026-09-29T10:45:00-03:00'),
      recursoCodigo: 'R_TELEMEDICINA',
      reservasExistentes: [],
      ahora: new Date(),
      ventanaControl: { desde: '2026-09-28', hasta: '2026-10-05' },
      consentimientoTeleconsulta: true,
    });
    expect(glp1.ok).toBe(false);
    expect(glp1.bloqueos.map((b) => b.regla)).toEqual(['R-21']);
  });
});

describe('Consulta por especialidad de un paciente con el plan', () => {
  it('lleva seña y queda ligada al plan', async () => {
    const e = entorno();
    await conInicialAgendada(e);
    const r = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'NUTRICION', recursoCodigo: 'R_CONSULTORIO_2', inicio: '2026-10-07T10:00:00-03:00' }),
    );
    expect(r).toMatchObject({ ok: true, creado: true, incluida: false });
    const appt = e.turno(r.appointmentId);
    expect(appt.status).toBe('pending');
    expect(appt.specialty).toBeUndefined(); // Nutrición no tiene código SNOMED en c80
    expect(appt.supportingInformation).toEqual([{ reference: `CarePlan/${e.plan().id}` }]);
    expect(e.plan().activity?.at(-1)?.reference).toEqual({ reference: `Appointment/${r.appointmentId}`, display: 'Consulta de Nutrición' });
    expect(e.mensajes().at(-1)).toMatch(/reservamos tu consulta de Nutrición para el .*Aboná la seña del 50%/);
  });

  it('una consulta de especialidad con código SNOMED lo lleva en Appointment.specialty', async () => {
    const e = entorno();
    const r = await reservar(
      e.medplum,
      ev({ pacienteRef: 'Patient/p1', servicioCodigo: 'TISIONEUMONOLOGIA', recursoCodigo: 'R_CONSULTORIO_1', inicio: '2026-10-07T10:00:00-03:00' }),
    );
    expect(e.turno(r.appointmentId).specialty?.[0]).toMatchObject({
      coding: [{ system: 'http://snomed.info/sct', code: '418112009' }],
      text: 'Tisioneumonología',
    });
    expect(e.turno(r.appointmentId).supportingInformation).toBeUndefined(); // sin plan
  });
});

describe('Check-in y cancelación', () => {
  it('la teleconsulta abre un Encounter virtual (VR)', async () => {
    const e = entorno([consentimiento()]);
    const r = await reservar(
      e.medplum,
      ev(
        { pacienteRef: 'Patient/p1', servicioCodigo: 'CARDIOLOGIA', recursoCodigo: 'R_TELEMEDICINA', inicio: '2026-09-29T10:00:00-03:00' },
        { JITSI_BASE_URL: secreto(JITSI) },
      ),
    );
    await cambiarEstado(e.medplum, ev({ appointmentId: r.appointmentId, estado: 'arrived' }));
    expect(e.todos<Encounter>('Encounter')[0]?.class).toMatchObject({ code: 'VR' });
  });

  it('completar la consulta del plan la marca completada; cancelarla la deja otra vez por agendar', async () => {
    const e = entorno();
    const r = await conInicialAgendada(e);
    await cambiarEstado(e.medplum, ev({ appointmentId: r.appointmentId, estado: 'fulfilled' }));
    expect(e.plan().activity?.find((a) => claveDeActividad(a) === 'inicial')?.detail?.status).toBe('completed');

    const e2 = entorno();
    const r2 = await conInicialAgendada(e2);
    await cambiarEstado(e2.medplum, ev({ appointmentId: r2.appointmentId, estado: 'cancelled' }));
    expect(e2.tarea('inicial')).toMatchObject({ status: 'requested' });
    expect(e2.tarea('inicial').output).toBeUndefined();
    expect(e2.plan().activity?.find((a) => claveDeActividad(a) === 'inicial')?.detail?.status).toBe('not-started');
  });
});

describe('Avisos del plan (cron som-recordatorios)', () => {
  it('apertura de la ventana y, a mitad, segundo aviso + alerta a Recepción; una sola vez cada uno y solo de día', async () => {
    const e = entorno();
    await conInicialAgendada(e); // ventana del día 50: 10/11 al 24/11 (objetivo 17/11)
    const secrets = { RECEPCION_WHATSAPP_TO: secreto('+5491100000001') };
    const mitad = e.tarea('mitad');

    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-09T13:00:00Z' }, secrets))).avisosPlan).toBe(0); // antes de la ventana
    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-10T13:00:00Z' }, secrets))).avisosPlan).toBe(1);
    expect(e.mensajes().at(-1)).toMatch(/ya podés agendar tu consulta del día 50 del Plan Bienestar 100 Días® \(entre el 10\/11\/2026 y el 24\/11\/2026\)/);
    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-11T13:00:00Z' }, secrets))).avisosPlan).toBe(0); // ya avisado

    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-18T03:00:00Z' }, secrets))).avisosPlan).toBe(0); // medianoche: no
    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-17T13:00:00Z' }, secrets))).avisosPlan).toBe(1);
    const ultimos = e.mensajes().slice(-2);
    expect(ultimos[0]).toMatch(/todavía no agendaste tu consulta del día 50/);
    expect(ultimos[1]).toMatch(/Ana Pérez tiene sin agendar la consulta del día 50/);
    expect(e.todos<Task>('Task').find((t) => t.id === mitad.id)?.priority).toBe('urgent');
    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-18T13:00:00Z' }, secrets))).avisosPlan).toBe(0);
  });

  it('sin la consulta inicial agendada no hay avisos (las ventanas son provisorias)', async () => {
    const e = entorno();
    await inscribir(e.medplum, ev({ pacienteRef: 'Patient/p1', inicio: '2026-09-25' }));
    expect((await recordatorios(e.medplum, ev({ ahora: '2026-11-10T13:00:00Z' }))).avisosPlan).toBe(0);
  });
});

describe('Solicitud desde el portal con modalidad', () => {
  it('teleconsulta sin consentimiento: se rechaza; con consentimiento: la tarea lleva la modalidad', async () => {
    const e = entorno();
    const pedido = { pacienteRef: 'Patient/p1', servicio: 'Teleconsulta de Neurología', servicioCodigo: 'NEUROLOGIA', modalidad: 'teleconsulta' };
    expect(await solicitar(e.medplum, ev(pedido))).toMatchObject({ ok: false, mensaje: expect.stringMatching(/consentimiento de teleconsulta/) });

    const e2 = entorno([consentimiento()]);
    const r = await solicitar(e2.medplum, ev(pedido));
    expect(r.ok).toBe(true);
    const t = e2.todos<Task>('Task')[0]!;
    expect(t.input?.find((i) => i.type?.text === 'modalidad')?.valueCoding).toMatchObject({ code: 'VR' });
    expect(t.description).toBe('Solicitud de turno: Teleconsulta de Neurología. Modalidad: teleconsulta.');
  });

  it('la consulta del plan se puede pedir; una modalidad inválida, no', async () => {
    const e = entorno();
    expect(
      (await solicitar(e.medplum, ev({ pacienteRef: 'Patient/p1', servicio: 'Mi consulta del día 50', servicioCodigo: 'CONSULTA_PB100D', modalidad: 'presencial' }))).ok,
    ).toBe(true);
    expect(
      (await solicitar(e.medplum, ev({ pacienteRef: 'Patient/p1', servicio: 'Cardiología', servicioCodigo: 'CARDIOLOGIA', modalidad: 'domicilio' }))).ok,
    ).toBe(false);
  });
});
