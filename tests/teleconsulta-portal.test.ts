/**
 * Teleconsulta desde el portal (bots `som-teleconsulta-*`): entrar a la videollamada (R-21),
 * cancelar (R-14, R-22) y volver a abrir el pago de la seña (R-23). Cada bot opera solo
 * sobre el turno de quien lo ejecuta y solo sobre teleconsultas.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Appointment, Communication, Encounter, Resource, Slot } from '@medplum/fhirtypes';
import { handler as cancelar } from '../src/bots/teleconsulta-cancelar.js';
import { handler as entrar } from '../src/bots/teleconsulta-entrar.js';
import { handler as pago } from '../src/bots/teleconsulta-pago.js';
import { ENTRADA_TELECONSULTA_MIN } from '../src/config/reglas.js';
import { EXT } from '../src/fhir/identifiers.js';
import { extensionModalidad, V3_ACT_CODE } from '../src/lib/teleconsulta.js';
import { verificarTurnoDelPaciente } from '../src/lib/teleconsulta-portal.js';
import { fakeMedplum } from './fake-medplum.js';

const AHORA = '2026-09-25T12:00:00Z'; // viernes 25/09, 09:00 en Buenos Aires
const JITSI = 'https://meet.segundaopinionmedica.org/som-0123456789abcdef0123456789abcdef';
const ACCESS = 'APP_USR-1234567890123456-092611-0123456789abcdef0123456789abcdef-123456789';
const LINK = 'https://mp.test/pagar/abc';
const RECEPCION = '+5491100000000';
const TWILIO = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_FROM: '+14155550000' };

// Twilio y MercadoPago de mentira.
const fetchMock = vi.fn(async (url: string | URL) => {
  const u = String(url);
  if (u.includes('/checkout/preferences')) {
    return { ok: true, status: 200, json: async () => ({ init_point: LINK }), text: async () => '' } as unknown as Response;
  }
  if (u.includes('api.twilio.com')) {
    return { ok: true, status: 201, json: async () => ({ sid: 'SM1', status: 'queued' }), text: async () => '' } as unknown as Response;
  }
  throw new Error(`fetch inesperado en el test: ${u}`);
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

function ev<T>(input: T, requester: string | null = 'Patient/p1', secrets: Record<string, string> = {}): BotEvent<T> {
  return {
    input,
    secrets: Object.fromEntries(Object.entries(secrets).map(([name, valueString]) => [name, { name, valueString }])),
    bot: { reference: 'Bot/test' },
    contentType: 'application/json',
    ...(requester ? { requester: { reference: requester } } : {}),
  } as BotEvent<T>;
}

/** Una teleconsulta de Cardiología de la paciente p1, con su franja ocupada. */
function turno(o: { inicio: string; status?: Appointment['status']; extra?: Appointment['extension']; presencial?: boolean; item?: string }): Appointment {
  const fin = new Date(Date.parse(o.inicio) + 30 * 60_000).toISOString();
  return {
    resourceType: 'Appointment',
    id: 'a1',
    status: o.status ?? 'booked',
    description: 'Teleconsulta de Cardiología',
    start: new Date(o.inicio).toISOString(),
    end: fin,
    slot: [{ reference: 'Slot/s1' }],
    participant: [
      { actor: { reference: 'Patient/p1' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/pract-test' }, status: 'accepted' },
    ],
    extension: [
      extensionModalidad(o.presencial ? 'presencial' : 'teleconsulta'),
      { url: EXT.itemTipo, valueCode: 'servicio' },
      { url: EXT.itemCodigo, valueString: o.item ?? 'CARDIOLOGIA' },
      ...(o.presencial ? [] : [{ url: EXT.teleconsultaUrl, valueUrl: JITSI }]),
      ...(o.extra ?? []),
    ],
  };
}

function entorno(appt: Appointment, extra: Resource[] = []) {
  const f = fakeMedplum([
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Pérez' }] },
    { resourceType: 'Slot', id: 's1', status: 'busy', schedule: { reference: 'Schedule/x' }, start: appt.start!, end: appt.end! } as Slot,
    appt,
    ...extra,
  ]);
  const actual = () => f.todos<Appointment>('Appointment')[0]!;
  const avisos = () => f.todos<Communication>('Communication');
  return { ...f, actual, avisos };
}

const LUNES_18 = '2026-09-28T18:00:00-03:00'; // faltan más de 24 h
const VIERNES_18 = '2026-09-25T18:00:00-03:00'; // mismo día: faltan menos de 24 h

describe('Quién puede operar sobre el turno', () => {
  const t = turno({ inicio: LUNES_18 });

  it('su paciente y el equipo (Practitioner) sí; otra paciente o sin requester, no', () => {
    expect(verificarTurnoDelPaciente(t, 'Patient/p1')).toEqual({ ok: true, pacienteRef: 'Patient/p1' });
    expect(verificarTurnoDelPaciente(t, 'Practitioner/pract-test').ok).toBe(true);
    expect(verificarTurnoDelPaciente(t, 'Patient/otra')).toEqual({ ok: false, error: 'Ese turno no es tuyo.' });
    expect(verificarTurnoDelPaciente(t, undefined).ok).toBe(false);
    expect(verificarTurnoDelPaciente(t, 'RelatedPerson/x').ok).toBe(false);
  });

  it('solo teleconsultas: un turno presencial se rechaza', () => {
    expect(verificarTurnoDelPaciente(turno({ inicio: LUNES_18, presencial: true }), 'Patient/p1')).toEqual({
      ok: false,
      error: 'Ese turno no es una teleconsulta.',
    });
  });

  it.each([
    ['som-teleconsulta-entrar', entrar],
    ['som-teleconsulta-cancelar', cancelar],
    ['som-teleconsulta-pago', pago],
  ] as const)('%s no toca el turno de otra paciente', async (_nombre, bot) => {
    const e = entorno(turno({ inicio: VIERNES_18, status: 'booked' }));
    const r = await bot(e.medplum, ev({ appointmentId: 'a1', confirmar: true }, 'Patient/otra'));
    expect(r).toEqual({ ok: false, mensaje: 'Ese turno no es tuyo.' });
    expect(e.actual().status).toBe('booked');
    expect(e.todos('Encounter')).toEqual([]);
  });
});

describe('som-teleconsulta-entrar', () => {
  it(`antes de la sala (${ENTRADA_TELECONSULTA_MIN} min antes): no da el link y dice cuándo abre`, async () => {
    const e = entorno(turno({ inicio: VIERNES_18 }));
    const r = await entrar(e.medplum, ev({ appointmentId: 'a1' }));
    expect(r.ok).toBe(false);
    expect(r.url).toBeUndefined();
    expect(r.abre).toBe('2026-09-25T20:45:00.000Z');
    expect(r.mensaje).toBe(`La sala abre ${ENTRADA_TELECONSULTA_MIN} minutos antes del turno, a las 17:45.`);
    expect(e.actual().status).toBe('booked');
  });

  it('con la sala abierta: devuelve el link, el turno pasa a arrived y se abre el Encounter virtual', async () => {
    vi.setSystemTime(new Date('2026-09-25T20:50:00Z')); // 17:50 en Buenos Aires
    const e = entorno(turno({ inicio: VIERNES_18 }));
    const r = await entrar(e.medplum, ev({ appointmentId: 'a1' }));
    expect(r).toEqual({ ok: true, url: JITSI });
    expect(e.actual().status).toBe('arrived');
    const [enc] = e.todos<Encounter>('Encounter');
    expect(enc?.status).toBe('in-progress');
    expect(enc?.class).toMatchObject({ system: V3_ACT_CODE, code: 'VR' });
    expect(enc?.subject?.reference).toBe('Patient/p1');

    // Volver a entrar (se cortó la llamada): mismo link, sin otro Encounter.
    const otra = await entrar(e.medplum, ev({ appointmentId: 'a1' }));
    expect(otra).toEqual({ ok: true, url: JITSI });
    expect(e.todos('Encounter')).toHaveLength(1);
  });

  it('tentativo (sin seña): no entra y ofrece pagar', async () => {
    vi.setSystemTime(new Date('2026-09-25T20:50:00Z'));
    const e = entorno(turno({ inicio: VIERNES_18, status: 'pending' }));
    const r = await entrar(e.medplum, ev({ appointmentId: 'a1' }));
    expect(r).toMatchObject({ ok: false, pagar: true });
    expect(r.url).toBeUndefined();
  });

  it('terminado, cancelado o sin link: no entra', async () => {
    vi.setSystemTime(new Date('2026-09-25T21:40:00Z')); // 18:40: ya terminó
    expect((await entrar(entorno(turno({ inicio: VIERNES_18 })).medplum, ev({ appointmentId: 'a1' }))).mensaje).toBe(
      'Esta consulta ya terminó.',
    );
    vi.setSystemTime(new Date('2026-09-25T20:50:00Z'));
    expect(
      (await entrar(entorno(turno({ inicio: VIERNES_18, status: 'cancelled' })).medplum, ev({ appointmentId: 'a1' }))).mensaje,
    ).toBe('Este turno está cancelado.');
    const sinLink = turno({ inicio: VIERNES_18 });
    sinLink.extension = sinLink.extension?.filter((x) => x.url !== EXT.teleconsultaUrl);
    const r = await entrar(entorno(sinLink).medplum, ev({ appointmentId: 'a1' }));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain('Todavía no tenemos el link');
  });

  // Decisión del 29/09/2026 (Jitsi 2b): la paciente entra como invitada y espera al
  // profesional, que es el único con token. Aunque el proyecto tenga los secretos del
  // Jitsi, a ella le llega el mismo link que en el WhatsApp.
  it('con los secretos del Jitsi, la paciente recibe el link sin token', async () => {
    vi.setSystemTime(new Date('2026-09-25T20:50:00Z'));
    const e = entorno(turno({ inicio: VIERNES_18 }));
    const secretos = {
      JITSI_BASE_URL: 'https://meet.segundaopinionmedica.org',
      JITSI_APP_ID: 'som',
      JITSI_APP_SECRET: 'secreto-de-prueba',
    };
    const r = await entrar(e.medplum, ev({ appointmentId: 'a1' }, 'Patient/p1', secretos));
    expect(r).toEqual({ ok: true, url: JITSI });
  });

  it('sin requester no hace nada (el bot lee cualquier turno)', async () => {
    vi.setSystemTime(new Date('2026-09-25T20:50:00Z'));
    const e = entorno(turno({ inicio: VIERNES_18 }));
    const r = await entrar(e.medplum, ev({ appointmentId: 'a1' }, null));
    expect(r.ok).toBe(false);
    expect(r.url).toBeUndefined();
    expect(e.actual().status).toBe('booked');
  });
});

describe('som-teleconsulta-cancelar (R-14)', () => {
  const secrets = { ...TWILIO, RECEPCION_WHATSAPP_TO: RECEPCION };

  it('sin confirmar: dice qué pasaría y no cambia nada', async () => {
    const e = entorno(turno({ inicio: LUNES_18 }));
    const r = await cancelar(e.medplum, ev({ appointmentId: 'a1' }, 'Patient/p1', secrets));
    expect(r).toMatchObject({ ok: true, cancelado: false, conSena: true, consumeSesion: false, devuelveSaldo: true });
    expect(r.mensaje).toContain('la seña no se pierde');
    expect(e.actual().status).toBe('booked');
    expect(e.todos<Slot>('Slot')[0]?.status).toBe('busy');
    expect(e.avisos()).toEqual([]);
  });

  it('con 24 h o más: cancela (motivo pat), libera la franja y avisa a Recepción para devolver la seña', async () => {
    const e = entorno(turno({ inicio: LUNES_18 }));
    const r = await cancelar(e.medplum, ev({ appointmentId: 'a1', confirmar: true }, 'Patient/p1', secrets));
    expect(r).toMatchObject({ ok: true, cancelado: true, conSena: true, consumeSesion: false, devuelveSaldo: true });
    expect(r.mensaje).toMatch(/^Cancelamos tu teleconsulta\./);
    const a = e.actual();
    expect(a.status).toBe('cancelled');
    expect(a.cancelationReason?.coding?.[0]).toMatchObject({ code: 'pat' });
    expect(e.todos<Slot>('Slot')[0]?.status).toBe('free');
    const avisos = e.avisos();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.extension?.find((x) => x.url === EXT.templateUsado)?.valueString).toBe('teleconsulta-cancelada-portal');
    expect(avisos[0]?.payload?.[0]?.contentString).toContain('la seña no se pierde');
  });

  it('con menos de 24 h: la sesión se consume (la seña no vuelve) y Recepción queda avisada', async () => {
    const e = entorno(turno({ inicio: VIERNES_18 }));
    const previa = await cancelar(e.medplum, ev({ appointmentId: 'a1' }, 'Patient/p1', secrets));
    expect(previa).toMatchObject({ ok: true, cancelado: false, consumeSesion: true, devuelveSaldo: false });
    expect(previa.mensaje).toContain('la seña no se devuelve');
    const r = await cancelar(e.medplum, ev({ appointmentId: 'a1', confirmar: true }, 'Patient/p1', secrets));
    expect(r).toMatchObject({ ok: true, cancelado: true, consumeSesion: true });
    expect(e.avisos()[0]?.payload?.[0]?.contentString).toContain('sesión consumida');
  });

  it('tentativa sin seña: cancela sin avisar a Recepción (no hay nada que devolver)', async () => {
    const e = entorno(turno({ inicio: LUNES_18, status: 'pending' }));
    const r = await cancelar(e.medplum, ev({ appointmentId: 'a1', confirmar: true }, 'Patient/p1', secrets));
    expect(r).toMatchObject({ ok: true, cancelado: true, conSena: false });
    expect(e.actual().status).toBe('cancelled');
    expect(e.avisos()).toEqual([]);
  });

  it('consulta incluida en el plan: vuelve a quedar para agendar, sin seña', async () => {
    const e = entorno(turno({ inicio: LUNES_18, item: 'CONSULTA_PB100D' }));
    const r = await cancelar(e.medplum, ev({ appointmentId: 'a1' }, 'Patient/p1', secrets));
    expect(r).toMatchObject({ ok: true, incluida: true, conSena: false });
    expect(r.mensaje).toContain('sigue incluida en tu plan');
  });

  it('ya empezada o cancelada: no se cancela desde el portal', async () => {
    vi.setSystemTime(new Date('2026-09-25T21:05:00Z')); // 18:05, ya empezó
    const e = entorno(turno({ inicio: VIERNES_18 }));
    const r = await cancelar(e.medplum, ev({ appointmentId: 'a1', confirmar: true }, 'Patient/p1', secrets));
    expect(r).toEqual({ ok: false, mensaje: 'La consulta ya empezó: si necesitás algo, escribinos por Mensajes.' });
    expect(e.actual().status).toBe('booked');

    vi.setSystemTime(new Date(AHORA));
    const c = entorno(turno({ inicio: LUNES_18, status: 'cancelled' }));
    expect(await cancelar(c.medplum, ev({ appointmentId: 'a1', confirmar: true }))).toEqual({
      ok: false,
      mensaje: 'Este turno está cancelado.',
    });
  });
});

describe('som-teleconsulta-pago (R-23)', () => {
  const expira = { url: EXT.reservaExpira, valueDateTime: '2026-09-25T12:30:00Z' };

  it('reserva tentativa con link guardado: lo devuelve sin llamar a MercadoPago', async () => {
    const e = entorno(turno({ inicio: LUNES_18, status: 'pending', extra: [expira, { url: EXT.linkPagoSena, valueUrl: LINK }] }));
    const r = await pago(e.medplum, ev({ appointmentId: 'a1' }, 'Patient/p1', { MERCADOPAGO_ACCESS_TOKEN: ACCESS }));
    expect(r).toEqual({ ok: true, url: LINK, expira: '2026-09-25T12:30:00Z' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin link guardado: lo genera con MercadoPago y lo deja en el turno', async () => {
    const e = entorno(turno({ inicio: LUNES_18, status: 'pending' }));
    const r = await pago(e.medplum, ev({ appointmentId: 'a1' }, 'Patient/p1', { MERCADOPAGO_ACCESS_TOKEN: ACCESS }));
    expect(r).toMatchObject({ ok: true, url: LINK });
    expect(e.actual().extension?.find((x) => x.url === EXT.linkPagoSena)?.valueUrl).toBe(LINK);
  });

  it('sin MercadoPago: no inventa un link, Recepción cobra', async () => {
    const e = entorno(turno({ inicio: LUNES_18, status: 'pending' }));
    const r = await pago(e.medplum, ev({ appointmentId: 'a1' }));
    expect(r).toEqual({ ok: false, mensaje: 'No pudimos abrir el pago. Recepción te contacta para cobrar la seña.' });
  });

  it('vencida, ya paga o incluida en el plan: no hay pago que abrir', async () => {
    vi.setSystemTime(new Date('2026-09-25T13:00:00Z'));
    const vencida = entorno(turno({ inicio: LUNES_18, status: 'pending', extra: [expira, { url: EXT.linkPagoSena, valueUrl: LINK }] }));
    expect((await pago(vencida.medplum, ev({ appointmentId: 'a1' }))).mensaje).toContain('Venció la reserva');
    const paga = entorno(turno({ inicio: LUNES_18 }));
    expect((await pago(paga.medplum, ev({ appointmentId: 'a1' }))).mensaje).toBe('La seña ya está paga: tu turno está confirmado.');
    const plan = entorno(turno({ inicio: LUNES_18, status: 'pending', item: 'CONSULTA_PB100D' }));
    expect((await pago(plan.medplum, ev({ appointmentId: 'a1' }))).mensaje).toContain('incluida en tu plan');
  });
});
