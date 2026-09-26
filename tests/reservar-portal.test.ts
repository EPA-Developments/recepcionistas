/**
 * Reserva desde el portal (R-23): la paciente elige una franja libre y el bot la reserva con
 * las reglas de Recepción; con cargo queda tentativa con el link de la seña y retención de
 * 30 min (o sin vencimiento si MercadoPago no respondió); la consulta del plan queda
 * confirmada. El cron vence las tentativas sin seña y una seña tardía no las revive.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Appointment, Communication, Consent, Invoice, Practitioner, Resource, Schedule, Slot, Task } from '@medplum/fhirtypes';
import type { Modalidad } from '../src/domain/types.js';
import { handler as inscribirBienestar } from '../src/bots/bienestar-inscribir.js';
import { handler as pagarSena } from '../src/bots/pagar-sena.js';
import { handler as reservarPortal, type EntradaReservaPortal } from '../src/bots/reservar-portal.js';
import { handler as vencerReservas } from '../src/bots/vencer-reservas.js';
import { RETENCION_RESERVA_PORTAL_MIN } from '../src/config/reglas.js';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { leerTareaConsultaPlan } from '../src/lib/plan-bienestar.js';
import { construirConsentimientoTeleconsulta, extensionModalidad } from '../src/lib/teleconsulta.js';
import { fakeMedplum } from './fake-medplum.js';

// Una cardióloga de prueba: lunes 18–20 (las dos modalidades), consultorio 1.
vi.mock('../src/config/medicos.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/config/medicos.js')>();
  const MEDICOS = [
    {
      codigo: 'MED_TEST',
      nombre: 'Dra. Prueba',
      matricula: 'MN 1',
      esDirector: false,
      especialidad: { snomed: '394579002', snomedDisplay: 'Cardiology', nombre: 'Cardiología' },
      servicios: ['CARDIOLOGIA', 'CONSULTA_PB100D'],
      modalidades: ['presencial', 'teleconsulta'],
      seguimientoPB100D: true,
      disponibilidad: [{ dia: 1, desde: '18:00', hasta: '20:00' }],
      consultorioCodigo: 'R_CONSULTORIO_1',
    },
  ];
  const porCodigo = new Map(MEDICOS.map((m) => [m.codigo, m]));
  return {
    ...real,
    MEDICOS,
    MEDICOS_POR_CODIGO: porCodigo,
    getMedico: (c: string) => porCodigo.get(c),
    medicosPara: (s: string, m: string) => MEDICOS.filter((x) => x.servicios.includes(s) && x.modalidades.includes(m)),
    medicosSeguimientoPB100D: () => MEDICOS,
  };
});

const AHORA = '2026-09-25T12:00:00Z'; // viernes 25/09, 09:00 en Buenos Aires
const LUNES_18 = '2026-09-28T18:00:00-03:00';
const LUNES_1830 = '2026-09-28T18:30:00-03:00';
const LUNES_19 = '2026-09-28T19:00:00-03:00';
const AMBAS: Modalidad[] = ['presencial', 'teleconsulta'];
const ACCESS = 'APP_USR-1234567890123456-092611-0123456789abcdef0123456789abcdef-123456789';
const LINK = 'https://mp.test/pagar/abc';

// MercadoPago de mentira: solo la creación de la preferencia de la seña.
const fetchMock = vi.fn(async (url: string | URL) => {
  if (String(url).includes('/checkout/preferences')) {
    return { ok: true, status: 200, json: async () => ({ init_point: LINK }), text: async () => '' } as unknown as Response;
  }
  throw new Error(`fetch inesperado en el test: ${String(url)}`);
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AHORA));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockClear();
  vi.setSystemTime(new Date(AHORA));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function ev<T>(input: T, opts: { secrets?: Record<string, string>; requester?: string } = {}): BotEvent<T> {
  const secrets = Object.fromEntries(Object.entries(opts.secrets ?? {}).map(([name, valueString]) => [name, { name, valueString }]));
  return {
    input,
    secrets,
    bot: { reference: 'Bot/test' },
    contentType: 'application/json',
    ...(opts.requester ? { requester: { reference: opts.requester } } : {}),
  } as BotEvent<T>;
}

const ext = (r: { extension?: Array<{ url: string; valueDateTime?: string; valueUrl?: string; valueCode?: string; valueString?: string }> }, url: string) =>
  r.extension?.find((x) => x.url === url);
const template = (c: Communication) => ext(c, EXT.templateUsado)?.valueString;
const texto = (c: Communication) => c.payload?.[0]?.contentString ?? '';

/** Una franja libre de la agenda de la Dra. Prueba, como las que deja el cron. */
function franjaLibre(inicio: string, fin: string, modalidades: Modalidad[] = AMBAS): Slot {
  return {
    resourceType: 'Slot',
    id: `slot-${inicio}`,
    identifier: [{ system: SYSTEM.medico, value: `MED_TEST@${inicio}` }],
    schedule: { reference: 'Schedule/sch-med-test' },
    status: 'free',
    start: inicio,
    end: fin,
    extension: [{ url: EXT.profesional, valueString: 'MED_TEST' }, ...modalidades.map(extensionModalidad)],
    meta: { versionId: '1' },
  };
}

function entorno(extra: Resource[] = [], opts: { sinConsentimiento?: boolean } = {}) {
  const consultorio: Schedule = {
    resourceType: 'Schedule',
    id: 'sch-consultorio-1',
    identifier: [{ system: SYSTEM.recursoCodigo, value: 'SCH_R_CONSULTORIO_1' }],
    actor: [{ display: 'Consultorio 1' }],
  };
  const agenda: Schedule = {
    resourceType: 'Schedule',
    id: 'sch-med-test',
    identifier: [{ system: SYSTEM.medico, value: 'SCH_MED_TEST' }],
    actor: [{ display: 'Dra. Prueba' }],
    extension: [{ url: EXT.profesional, valueString: 'MED_TEST' }],
  };
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: 'pract-test',
    identifier: [{ system: SYSTEM.medico, value: 'MED_TEST' }],
    name: [{ text: 'Dra. Prueba' }],
  };
  const consentimiento: Consent = { ...construirConsentimientoTeleconsulta('Patient/p1', new Date('2026-09-20T10:00:00Z')), id: 'consent-tele' };
  const f = fakeMedplum([
    {
      resourceType: 'Patient',
      id: 'p1',
      name: [{ given: ['Ana'], family: 'Pérez' }],
      telecom: [{ system: 'phone', use: 'mobile', value: '+5491155550000' }],
    },
    consultorio,
    agenda,
    practitioner,
    ...(opts.sinConsentimiento ? [] : [consentimiento]),
    ...extra,
  ]);
  const slot = (inicio: string) => f.todos<Slot>('Slot').find((s) => s.id === `slot-${inicio}`)!;
  const turno = (id: string | undefined) => f.todos<Appointment>('Appointment').find((a) => a.id === id)!;
  const avisos = () => f.todos<Communication>('Communication');
  return { ...f, slot, turno, avisos };
}

const base: EntradaReservaPortal = {
  pacienteRef: 'Patient/p1',
  servicioCodigo: 'CARDIOLOGIA',
  slotId: `slot-${LUNES_18}`,
  modalidad: 'teleconsulta',
};
const conMP = { secrets: { MERCADOPAGO_ACCESS_TOKEN: ACCESS }, requester: 'Patient/p1' };

describe('som-reservar-portal · quién y qué puede reservar', () => {
  it('solo reserva para sí misma: otro paciente como requester se rechaza', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const r = await reservarPortal(e.medplum, ev(base, { ...conMP, requester: 'Patient/otra' }));
    expect(r).toEqual({ ok: false, mensaje: 'Solo podés reservar turnos para vos.' });
    expect(e.todos<Appointment>('Appointment')).toEqual([]);
    expect(e.slot(LUNES_18).status).toBe('free');
  });

  it('el control GLP-1 no se reserva desde el portal; la consulta del plan exige su tarea', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const glp1 = await reservarPortal(e.medplum, ev({ ...base, servicioCodigo: 'CONTROL_GLP1' }, conMP));
    expect(glp1.ok).toBe(false);
    expect(glp1.mensaje).toMatch(/lo agenda Recepción/);
    const plan = await reservarPortal(e.medplum, ev({ ...base, servicioCodigo: 'CONSULTA_PB100D' }, conMP));
    expect(plan.ok).toBe(false);
    expect(plan.mensaje).toMatch(/elegí cuál/);
    const otra = await reservarPortal(e.medplum, ev({ ...base, servicioCodigo: 'NO_EXISTE' }, conMP));
    expect(otra.ok).toBe(false);
    expect(otra.mensaje).toMatch(/no está en el catálogo/);
    expect(e.todos<Appointment>('Appointment')).toEqual([]);
  });

  it('un horario que empieza antes de que venza la retención se rechaza', async () => {
    const pronto = '2026-09-25T09:15:00-03:00'; // dentro de 15 min
    const e = entorno([franjaLibre(pronto, '2026-09-25T09:45:00-03:00')]);
    const r = await reservarPortal(e.medplum, ev({ ...base, slotId: `slot-${pronto}` }, conMP));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(new RegExp(`al menos ${RETENCION_RESERVA_PORTAL_MIN} minutos`));
    expect(e.slot(pronto).status).toBe('free');
  });

  it('un horario que ya no existe o ya está ocupado se rechaza', async () => {
    const e = entorno([{ ...franjaLibre(LUNES_18, LUNES_1830), status: 'busy' }]);
    expect(await reservarPortal(e.medplum, ev({ ...base, slotId: 'slot-nada' }, conMP))).toEqual({ ok: false, mensaje: 'Ese horario ya no existe. Elegí otro.' });
    const ocupado = await reservarPortal(e.medplum, ev(base, conMP));
    expect(ocupado).toMatchObject({ ok: false, mensaje: 'Ese horario ya está ocupado. Elegí otro.' });
  });

  it('teleconsulta sin el consentimiento firmado => bloqueo R-21 (la franja sigue libre)', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)], { sinConsentimiento: true });
    const r = await reservarPortal(e.medplum, ev(base, conMP));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/consentimiento/i);
    expect(e.slot(LUNES_18).status).toBe('free');
  });
});

describe('som-reservar-portal · consulta con cargo (seña 50 %)', () => {
  it('queda tentativa con el link de MercadoPago, retenida 30 min, la franja ocupada y el WhatsApp con el link', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const r = await reservarPortal(e.medplum, ev(base, conMP));
    const expira = new Date(new Date(AHORA).getTime() + RETENCION_RESERVA_PORTAL_MIN * 60_000).toISOString();
    expect(r).toMatchObject({
      ok: true,
      estado: 'tentativo',
      incluida: false,
      modalidad: 'teleconsulta',
      medicoCodigo: 'MED_TEST',
      descripcion: 'Teleconsulta de Cardiología',
      senaARS: 75_000,
      linkPago: LINK,
      expira,
    });
    expect(r).not.toHaveProperty('teleconsultaUrl'); // el link de la videollamada, recién con la seña
    expect(new Date(r.inicio!).toISOString()).toBe(new Date(LUNES_18).toISOString());

    const appt = e.turno(r.appointmentId);
    expect(appt.status).toBe('pending');
    expect(ext(appt, EXT.reservaExpira)?.valueDateTime).toBe(expira);
    expect(ext(appt, EXT.linkPagoSena)?.valueUrl).toBe(LINK);
    expect(ext(appt, EXT.origenReserva)?.valueCode).toBe('portal');
    expect(e.slot(LUNES_18).status).toBe('busy');

    // Un solo WhatsApp a la paciente, con el link, el monto y hasta qué hora se retiene (09:30 ART).
    const avisos = e.avisos();
    expect(avisos.map(template)).toEqual(['reserva-portal-sena']);
    expect(texto(avisos[0]!)).toContain(LINK);
    expect(texto(avisos[0]!)).toContain('$75.000');
    expect(texto(avisos[0]!)).toContain('hasta las 09:30');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/checkout/preferences');
  });

  it('presencial: ocupa también el consultorio de la profesional', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const r = await reservarPortal(e.medplum, ev({ ...base, modalidad: 'presencial' }, conMP));
    expect(r.ok).toBe(true);
    expect(r.modalidad).toBe('presencial');
    expect(e.turno(r.appointmentId).slot).toHaveLength(2);
    expect(e.todos<Slot>('Slot').filter((s) => s.status === 'busy')).toHaveLength(2);
  });

  it('sin MercadoPago configurado: queda tentativa SIN vencimiento y avisa a Recepción', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const r = await reservarPortal(e.medplum, ev(base, { secrets: { RECEPCION_WHATSAPP_TO: '+5491144440000' }, requester: 'Patient/p1' }));
    expect(r).toMatchObject({ ok: true, estado: 'tentativo', sinLink: true });
    expect(r.linkPago).toBeUndefined();
    expect(r.expira).toBeUndefined();
    const appt = e.turno(r.appointmentId);
    expect(appt.status).toBe('pending');
    expect(ext(appt, EXT.reservaExpira)).toBeUndefined();
    expect(ext(appt, EXT.linkPagoSena)).toBeUndefined();
    expect(e.avisos().map(template).sort()).toEqual(['reserva-portal-sin-link', 'reserva-tentativa']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('som-reservar-portal · consulta del Plan Bienestar', () => {
  it('con su tarea queda confirmada: sin seña, sin link y sin vencimiento', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const ins = await inscribirBienestar(e.medplum, ev({ pacienteRef: 'Patient/p1' }));
    expect(ins.ok).toBe(true);
    const inicial = e.todos<Task>('Task').find((t) => leerTareaConsultaPlan(t).clave === 'inicial')!;
    expect(inicial?.id).toBeTruthy();

    const r = await reservarPortal(e.medplum, ev({ ...base, servicioCodigo: 'CONSULTA_PB100D', tareaId: inicial.id }, conMP));
    expect(r).toMatchObject({ ok: true, estado: 'confirmado', incluida: true, modalidad: 'teleconsulta' });
    expect(r.linkPago).toBeUndefined();
    expect(r.expira).toBeUndefined();
    const appt = e.turno(r.appointmentId);
    expect(appt.status).toBe('booked');
    expect(ext(appt, EXT.reservaExpira)).toBeUndefined();
    expect(ext(appt, EXT.origenReserva)?.valueCode).toBe('portal');
    expect(e.todos<Task>('Task').find((t) => t.id === inicial.id)?.status).toBe('completed');
    expect(e.avisos().map(template)).toEqual(['consulta-plan-confirmada']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la tarea de otro paciente no sirve', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830), { resourceType: 'Patient', id: 'p2', name: [{ text: 'Otra' }] }]);
    await inscribirBienestar(e.medplum, ev({ pacienteRef: 'Patient/p2' }));
    const ajena = e.todos<Task>('Task').find((t) => t.for?.reference === 'Patient/p2')!;
    const r = await reservarPortal(e.medplum, ev({ ...base, servicioCodigo: 'CONSULTA_PB100D', tareaId: ajena.id }, conMP));
    expect(r.ok).toBe(false);
    expect(e.slot(LUNES_18).status).toBe('free');
  });
});

describe('som-vencer-reservas (cron, R-23)', () => {
  it('vence la tentativa sin seña: la cancela, libera la franja y avisa; no toca las de Recepción; una seña tardía no la revive', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830), franjaLibre(LUNES_1830, LUNES_19)]);
    const r = await reservarPortal(e.medplum, ev(base, conMP));
    expect(r.ok).toBe(true);
    // Un tentativo de Recepción (sin vencimiento) sobre la franja siguiente.
    await e.medplum.updateResource<Slot>({ ...e.slot(LUNES_1830), status: 'busy' });
    const deRecepcion = await e.medplum.createResource<Appointment>({
      resourceType: 'Appointment',
      status: 'pending',
      start: new Date(LUNES_1830).toISOString(),
      end: new Date(LUNES_19).toISOString(),
      participant: [{ actor: { reference: 'Patient/p1' }, status: 'accepted' }],
      slot: [{ reference: `Slot/slot-${LUNES_1830}` }],
    });

    // Todavía no venció: nada.
    expect(await vencerReservas(e.medplum, ev({}))).toEqual({ revisados: 2, vencidos: 0, omitidos: 0 });
    expect(e.turno(r.appointmentId).status).toBe('pending');

    // 31 minutos después.
    vi.setSystemTime(new Date(new Date(AHORA).getTime() + (RETENCION_RESERVA_PORTAL_MIN + 1) * 60_000));
    expect(await vencerReservas(e.medplum, ev({}))).toEqual({ revisados: 2, vencidos: 1, omitidos: 0 });
    expect(e.turno(r.appointmentId).status).toBe('cancelled');
    expect(e.slot(LUNES_18).status).toBe('free');
    expect(e.turno(deRecepcion.id).status).toBe('pending');
    expect(e.slot(LUNES_1830).status).toBe('busy');
    expect(e.avisos().map(template)).toContain('reserva-vencida');

    // Una seña tardía (MercadoPago o manual) no confirma un turno cancelado: sin Invoice y alerta a Recepción.
    const pago = await pagarSena(e.medplum, ev({ appointmentId: r.appointmentId!, medioPago: 'mercadopago' }, { secrets: { RECEPCION_WHATSAPP_TO: '+5491144440000' } }));
    expect(pago.ok).toBe(false);
    expect(pago.mensaje).toMatch(/ya está cancelado/);
    expect(e.todos<Invoice>('Invoice')).toEqual([]);
    expect(e.turno(r.appointmentId).status).toBe('cancelled');
    expect(e.avisos().map(template)).toContain('sena-turno-cancelado');
  });

  it('si el turno cambió en el medio (escritura condicional), lo omite y lo reintenta en la próxima', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const r = await reservarPortal(e.medplum, ev(base, conMP));
    vi.setSystemTime(new Date(new Date(AHORA).getTime() + (RETENCION_RESERVA_PORTAL_MIN + 1) * 60_000));
    vi.spyOn(e.medplum, 'updateResource').mockRejectedValueOnce(new Error('412 Precondition Failed'));
    expect(await vencerReservas(e.medplum, ev({}))).toEqual({ revisados: 1, vencidos: 0, omitidos: 1 });
    expect(e.turno(r.appointmentId).status).toBe('pending');
    expect(e.slot(LUNES_18).status).toBe('busy');
    expect(await vencerReservas(e.medplum, ev({}))).toEqual({ revisados: 1, vencidos: 1, omitidos: 0 });
  });
});
