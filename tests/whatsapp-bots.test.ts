import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Binary, Communication, Patient } from '@medplum/fhirtypes';
import { BOT_WHATSAPP_ENTRANTE, BOT_WHATSAPP_RESPONDER, EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { BOTS_RECEPCION, POLICY_RECEPCIONISTA, POLICY_WEBHOOK_TWILIO } from '../src/fhir/access-policies.js';
import { TEXTO_ACUSE } from '../src/config/auto-respuesta.js';
import { enviarWhatsApp } from '../src/bots/_shared.js';
import { handler as entrante } from '../src/bots/whatsapp-entrante.js';
import { handler as responder } from '../src/bots/whatsapp-responder.js';
import { handler as altaPaciente } from '../src/bots/alta-paciente.js';
import {
  CATEGORIA_WHATSAPP,
  construirConversacionWhatsApp,
  construirLeadWhatsApp,
  ETIQUETA_RESERVADO,
  esInicioContacto,
  estadoEntregaDe,
  esWhatsApp,
  telefonoDe,
  tipoAutomatica,
} from '../src/lib/whatsapp.js';
import { cargarAvisos, marcarLeidos, responder as responderEnMensajes } from '../src/lib/mensajes.js';
import { fakeMedplum } from './fake-medplum.js';

const H = 3_600_000;
// Hora de Argentina = UTC-3.
const AR = (fechaHora: string): Date => new Date(`${fechaHora}:00-03:00`);
const LUNES_12 = AR('2026-09-28T12:00'); // centro abierto
const DOMINGO_10 = AR('2026-10-04T10:00'); // centro cerrado

const SECRETS = {
  TWILIO_ACCOUNT_SID: { name: 'TWILIO_ACCOUNT_SID', valueString: 'AC123' },
  TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'tok' },
  TWILIO_WHATSAPP_FROM: { name: 'TWILIO_WHATSAPP_FROM', valueString: 'whatsapp:+14155238886' },
} as unknown as BotEvent['secrets'];

function evento<T>(input: T, secrets: BotEvent['secrets'] = SECRETS): BotEvent<T> {
  return { input, secrets, bot: { reference: 'Bot/b' }, contentType: 'application/x-www-form-urlencoded' } as BotEvent<T>;
}

/** Lo que manda Twilio cuando un paciente escribe (ya parseado por Medplum). */
function mensaje(extra: Record<string, string> = {}): Record<string, string> {
  return {
    MessageSid: 'SM1',
    AccountSid: 'AC123',
    From: 'whatsapp:+5491122334455',
    To: 'whatsapp:+14155238886',
    Body: 'Hola, quiero un turno',
    ProfileName: 'Ana Pérez',
    NumMedia: '0',
    SmsStatus: 'received',
    ...extra,
  };
}

function paciente(id: string, telefono: string, extra: Partial<Patient> = {}): Patient {
  return { resourceType: 'Patient', id, name: [{ text: `Paciente ${id}` }], telecom: [{ system: 'phone', value: telefono }], ...extra };
}

/** Una conversación del portal (motivo "turnos") con un mensaje del paciente. */
function conversacionPortal(id: string, pacienteId: string, status: Communication['status'] = 'in-progress'): Communication[] {
  const ref = { reference: `Patient/${pacienteId}` };
  return [
    {
      resourceType: 'Communication',
      id,
      status,
      subject: ref,
      sender: ref,
      topic: { coding: [{ system: SYSTEM.motivoMensaje, code: 'turnos' }], text: 'turnos' },
    },
    {
      resourceType: 'Communication',
      id: `${id}-m1`,
      status: 'completed',
      partOf: [{ reference: `Communication/${id}` }],
      subject: ref,
      sender: ref,
      sent: new Date(LUNES_12.getTime() - 48 * H).toISOString(),
      payload: [{ contentString: '¿Puedo cambiar el turno?' }],
    },
  ];
}

/** Twilio acepta cada envío (y lo registra para ver qué se mandó). */
function twilioOk() {
  let n = 0;
  return vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ sid: `SMout${++n}`, status: 'queued' }), { status: 201 }));
}

function formDe(llamada: unknown[] | undefined): URLSearchParams {
  return new URLSearchParams((llamada?.[1] as RequestInit).body as URLSearchParams);
}

function hijosDe(todos: Communication[], conversacionId: string): Communication[] {
  return todos
    .filter((c) => c.partOf?.[0]?.reference === `Communication/${conversacionId}`)
    .sort((a, b) => (a.sent ?? '').localeCompare(b.sent ?? ''));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(`Bot ${BOT_WHATSAPP_ENTRANTE} · el WhatsApp entra en Mensajes`, () => {
  it('Número nuevo: lead + conversación nueva («Otro motivo») + mensaje sin leer (campanita) + acuse', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum();

    const r = await entrante(medplum, evento(mensaje()));

    expect(r).toMatchObject({ ok: true, tipo: 'entrante', pacienteNuevo: true, conversacionNueva: true, respuestaAutomatica: 'acuse' });
    const [lead] = todos<Patient>('Patient');
    expect(lead?.name).toEqual([{ use: 'nickname', text: 'Ana Pérez' }]);
    expect(lead?.extension).toEqual(expect.arrayContaining([{ url: EXT.origenLead, valueString: 'whatsapp' }]));

    const comms = todos<Communication>('Communication');
    const conversacion = comms.find((c) => c.id === r.conversacionId)!;
    expect(conversacion).toMatchObject({ status: 'in-progress', subject: { reference: `Patient/${lead!.id}` } });
    expect(conversacion.topic?.coding?.[0]).toMatchObject({ system: SYSTEM.motivoMensaje, code: 'otro' });

    const [entrado, acuse] = hijosDe(comms, r.conversacionId!);
    expect(entrado).toMatchObject({ status: 'in-progress', sender: { reference: `Patient/${lead!.id}` } });
    expect(entrado!.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SM1' }]);
    expect(esInicioContacto(entrado!)).toBe(true);
    expect(telefonoDe(entrado!)).toBe('+5491122334455');

    // El acuse salió por WhatsApp y quedó en la conversación, marcado automático.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(formDe(fetchMock.mock.calls[0]).get('Body')).toBe(TEXTO_ACUSE);
    expect(formDe(fetchMock.mock.calls[0]).get('To')).toBe('whatsapp:+5491122334455');
    expect(tipoAutomatica(acuse!)).toBe('acuse');
    expect(esWhatsApp(acuse!)).toBe(true);
    expect(estadoEntregaDe(acuse!)).toBe('en-cola');
    expect(acuse!.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SMout1' }]);
  });

  it('Paciente con una conversación abierta del portal: el WhatsApp entra ahí (sin acuse ni campanita)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '011 15 2233-4455'), ...conversacionPortal('c-portal', 'p1')]);

    const r = await entrante(medplum, evento(mensaje()));

    expect(r).toMatchObject({ pacienteRef: 'Patient/p1', pacienteNuevo: false, conversacionId: 'c-portal', conversacionNueva: false });
    expect(r.respuestaAutomatica).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    const hilo = hijosDe(todos<Communication>('Communication'), 'c-portal');
    expect(hilo.map((m) => m.payload?.[0]?.contentString)).toEqual(['¿Puedo cambiar el turno?', 'Hola, quiero un turno']);
    expect(esInicioContacto(hilo[1]!)).toBe(false);
    expect(todos('Patient')).toHaveLength(1);
  });

  it('Paciente conocido sin conversación abierta (solo una cerrada): conversación nueva + acuse, sin campanita', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    vi.stubGlobal('fetch', twilioOk());
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491122334455'), ...conversacionPortal('c-vieja', 'p1', 'completed')]);

    const r = await entrante(medplum, evento(mensaje()));

    expect(r).toMatchObject({ pacienteNuevo: false, conversacionNueva: true, respuestaAutomatica: 'acuse' });
    expect(r.conversacionId).not.toBe('c-vieja');
    const [entrado] = hijosDe(todos<Communication>('Communication'), r.conversacionId!);
    expect(esInicioContacto(entrado!)).toBe(false);
  });

  it('Fuera de horario: aviso con el horario, una vez por período cerrado', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DOMINGO_10);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum();

    const r1 = await entrante(medplum, evento(mensaje()));
    expect(r1.respuestaAutomatica).toBe('fuera-de-horario');
    expect(formDe(fetchMock.mock.calls[0]).get('Body')).toMatch(/fuera del horario de atención \(lunes a viernes de 8 a 22 y sábados de 8 a 20\)/);

    // Otro mensaje el mismo domingo: ya se avisó en este cierre.
    vi.setSystemTime(new Date(DOMINGO_10.getTime() + 2 * H));
    const r2 = await entrante(medplum, evento(mensaje({ MessageSid: 'SM2', Body: '¿Hola?' })));
    expect(r2.respuestaAutomatica).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();

    // El lunes a la noche (otro cierre): se avisa de nuevo.
    vi.setSystemTime(AR('2026-10-05T23:00'));
    const r3 = await entrante(medplum, evento(mensaje({ MessageSid: 'SM3', Body: 'Sigo esperando' })));
    expect(r3.respuestaAutomatica).toBe('fuera-de-horario');
    const hilo = hijosDe(todos<Communication>('Communication'), r1.conversacionId!);
    expect(hilo.map(tipoAutomatica)).toEqual([undefined, 'fuera-de-horario', undefined, undefined, 'fuera-de-horario']);
  });

  it('Twilio reintenta el mismo mensaje: no se duplica', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    vi.stubGlobal('fetch', twilioOk());
    const { medplum, todos } = fakeMedplum();
    const r1 = await entrante(medplum, evento(mensaje()));
    const r2 = await entrante(medplum, evento(mensaje()));
    expect(r2).toMatchObject({ motivo: 'ya registrado', conversacionId: r1.conversacionId });
    // Conversación + mensaje + acuse, una sola vez.
    expect(todos('Communication')).toHaveLength(3);
    expect(todos('Patient')).toHaveLength(1);
  });

  it('Rechaza lo que no viene de la cuenta de Twilio de SOM', async () => {
    const { medplum, todos } = fakeMedplum();
    const r = await entrante(medplum, evento(mensaje({ AccountSid: 'ACotro' })));
    expect(r).toMatchObject({ ok: false, tipo: 'ignorado' });
    expect(todos('Communication')).toHaveLength(0);
    expect(todos('Patient')).toHaveLength(0);
  });

  it('El número de Recepción (el que recibe los avisos) no se vuelve paciente', async () => {
    const { medplum, todos } = fakeMedplum();
    const secrets = {
      ...SECRETS,
      RECEPCION_WHATSAPP_TO: { name: 'RECEPCION_WHATSAPP_TO', valueString: '11 2233-4455' },
    } as unknown as BotEvent['secrets'];
    const r = await entrante(medplum, evento(mensaje(), secrets));
    expect(r.tipo).toBe('ignorado');
    expect(todos('Patient')).toHaveLength(0);
  });

  it('Guarda la foto en Binary: pide la media a Twilio con credenciales y sigue el link firmado SIN ellas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.startsWith('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM1/Media')) {
        return new Response(null, { status: 307, headers: { location: 'https://s3.amazonaws.com/media/abc' } });
      }
      if (url.startsWith('https://s3.amazonaws.com/')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      }
      return new Response(JSON.stringify({ sid: 'SMacuse', status: 'queued' }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491122334455'), ...conversacionPortal('c-portal', 'p1')]);

    await entrante(
      medplum,
      evento(
        mensaje({
          Body: '',
          NumMedia: '1',
          MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM1/Media/ME1',
          MediaContentType0: 'image/jpeg',
        }),
      ),
    );

    const [, primero] = fetchMock.mock.calls[0]!;
    expect((primero?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(fetchMock.mock.calls[1]![1]).toBeUndefined(); // al link firmado, sin el token
    const [binary] = todos<Binary>('Binary');
    expect(binary).toMatchObject({ contentType: 'image/jpeg', securityContext: { reference: 'Patient/p1' } });
    const entrado = hijosDe(todos<Communication>('Communication'), 'c-portal')[1];
    expect(entrado?.payload).toEqual([
      { contentAttachment: expect.objectContaining({ contentType: 'image/jpeg', url: `Binary/${binary!.id}`, title: 'whatsapp-1.jpg', size: 4 }) },
    ]);
  });

  it('Una media que no es de api.twilio.com no se descarga (el token nunca sale)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491122334455'), ...conversacionPortal('c-portal', 'p1')]);
    await entrante(medplum, evento(mensaje({ NumMedia: '1', MediaUrl0: 'https://evil.example/x', MediaContentType0: 'image/png' })));
    expect(fetchMock).not.toHaveBeenCalled();
    const entrado = hijosDe(todos<Communication>('Communication'), 'c-portal')[1];
    expect(entrado?.payload?.[1]?.contentAttachment?.title).toMatch(/no se pudo descargar/);
    expect(entrado?.payload?.[1]?.contentAttachment?.url).toBeUndefined();
  });
});

describe(`Bot ${BOT_WHATSAPP_ENTRANTE} · estados de entrega (✓✓)`, () => {
  const conSid = (estado?: string): Communication => ({
    resourceType: 'Communication',
    id: 'c1',
    status: 'in-progress',
    partOf: [{ reference: 'Communication/conv' }],
    identifier: [{ system: SYSTEM.twilioMessageSid, value: 'SMout' }],
    extension: [{ url: EXT.canal, valueCode: 'whatsapp' }, ...(estado ? [{ url: EXT.estadoEntrega, valueCode: estado }] : [])],
  });

  it('Actualiza el estado y no retrocede si llegan desordenados', async () => {
    const { medplum, todos } = fakeMedplum([conSid('en-cola')]);
    await entrante(medplum, evento({ MessageSid: 'SMout', AccountSid: 'AC123', MessageStatus: 'read' }));
    expect(estadoEntregaDe(todos<Communication>('Communication')[0]!)).toBe('leido');
    const r = await entrante(medplum, evento({ MessageSid: 'SMout', AccountSid: 'AC123', MessageStatus: 'delivered' }));
    expect(r.estadoEntrega).toBe('leido');
  });

  it('Si falla, queda el motivo en palabras de Recepción', async () => {
    const { medplum, todos } = fakeMedplum([conSid('enviado')]);
    await entrante(medplum, evento({ MessageSid: 'SMout', AccountSid: 'AC123', MessageStatus: 'undelivered', ErrorCode: '63016' }));
    const [c] = todos<Communication>('Communication');
    expect(estadoEntregaDe(c!)).toBe('fallido');
    expect(c?.statusReason?.text).toMatch(/24 h/);
  });

  it('El estado de un mensaje que no es de SOM se ignora sin error', async () => {
    const { medplum } = fakeMedplum();
    const r = await entrante(medplum, evento({ MessageSid: 'SMx', AccountSid: 'AC123', MessageStatus: 'sent' }));
    expect(r).toMatchObject({ ok: true, tipo: 'estado' });
  });
});

describe(`Bot ${BOT_WHATSAPP_RESPONDER} · la respuesta sale por donde escribió el paciente`, () => {
  const RECEPCION = { reference: 'Practitioner/ana', display: 'Ana' };

  /** Conversación con un WhatsApp del paciente de hace `horas` y la respuesta de Recepción. */
  function escenario(horas: number, porWhatsApp = true, adjuntos: string[] = []) {
    const ref = { reference: 'Patient/p1' };
    const t = { ...construirConversacionWhatsApp('Patient/p1'), id: 'conv' };
    const delPaciente: Communication = {
      resourceType: 'Communication',
      id: 'in1',
      status: 'completed',
      partOf: [{ reference: 'Communication/conv' }],
      subject: ref,
      sender: ref,
      sent: new Date(Date.now() - horas * H).toISOString(),
      payload: [{ contentString: 'Hola' }],
      ...(porWhatsApp
        ? { extension: [{ url: EXT.canal, valueCode: 'whatsapp' }, { url: EXT.telefonoWhatsapp, valueString: '+5491199998888' }] }
        : {}),
    };
    const respuesta: Communication = {
      resourceType: 'Communication',
      id: 'out1',
      status: 'in-progress',
      partOf: [{ reference: 'Communication/conv' }],
      subject: ref,
      sender: RECEPCION,
      recipient: [ref],
      sent: new Date().toISOString(),
      payload: [
        { contentString: '¡Hola! Te ayudamos.' },
        ...adjuntos.map((url) => ({ contentAttachment: { contentType: 'application/pdf', url, title: 'indicaciones.pdf' } })),
      ],
    };
    return fakeMedplum([paciente('p1', '+5491111112222'), t, delPaciente, respuesta]);
  }

  it('Escribió por WhatsApp hace 1 h: sale por WhatsApp a su número y la burbuja queda marcada', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = escenario(1);

    const r = await responder(medplum, evento({ mensajeId: 'out1' }));

    expect(r).toMatchObject({ ok: true, canal: 'whatsapp', enviado: true });
    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('To')).toBe('whatsapp:+5491199998888'); // el del chat, no el de la ficha
    expect(form.get('Body')).toBe('¡Hola! Te ayudamos.');
    const enviado = todos<Communication>('Communication').find((c) => c.id === 'out1')!;
    expect(esWhatsApp(enviado)).toBe(true);
    expect(estadoEntregaDe(enviado)).toBe('en-cola');
    expect(enviado.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SMout1' }]);
    expect(enviado.sender).toEqual(RECEPCION);
  });

  it('Con adjuntos: el texto va con el primero y cada archivo más, en otro mensaje', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = escenario(1, true, ['https://storage.example/a.pdf?sig=1', 'https://storage.example/b.pdf?sig=2']);
    await responder(medplum, evento({ mensajeId: 'out1' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(formDe(fetchMock.mock.calls[0]))).toMatchObject({ Body: '¡Hola! Te ayudamos.', MediaUrl: 'https://storage.example/a.pdf?sig=1' });
    expect(formDe(fetchMock.mock.calls[1]).get('Body')).toBeNull();
    expect(formDe(fetchMock.mock.calls[1]).get('MediaUrl')).toBe('https://storage.example/b.pdf?sig=2');
    expect(todos<Communication>('Communication').find((c) => c.id === 'out1')?.identifier).toHaveLength(2);
  });

  it('Una respuesta de más de 1600 caracteres sale en varias partes', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = escenario(1);
    const largo = 'Indicaciones para el estudio. '.repeat(80).trim(); // ~2400 caracteres
    const m = todos<Communication>('Communication').find((c) => c.id === 'out1')!;
    await medplum.updateResource<Communication>({ ...m, payload: [{ contentString: largo }] });
    await responder(medplum, evento({ mensajeId: 'out1' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const cuerpos = fetchMock.mock.calls.map((c) => formDe(c).get('Body') ?? '');
    expect(cuerpos.every((b) => b.length <= 1600)).toBe(true);
    expect(cuerpos.join(' ')).toBe(largo);
  });

  it('Escribió por el portal: queda solo en el portal (no es un error)', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = escenario(1, false);
    const r = await responder(medplum, evento({ mensajeId: 'out1' }));
    expect(r).toMatchObject({ ok: true, canal: 'portal', enviado: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(esWhatsApp(todos<Communication>('Communication').find((c) => c.id === 'out1')!)).toBe(false);
  });

  it('Pasadas las 24 h: no sale por WhatsApp y dice por qué', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = escenario(25);
    const r = await responder(medplum, evento({ mensajeId: 'out1' }));
    expect(r).toMatchObject({ ok: false, canal: 'whatsapp', enviado: false });
    expect(r.motivo).toMatch(/24 h/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Un mensaje que ya salió no se vuelve a mandar; uno del paciente no se manda', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = escenario(1);
    await responder(medplum, evento({ mensajeId: 'out1' }));
    const r2 = await responder(medplum, evento({ mensajeId: 'out1' }));
    expect(r2).toMatchObject({ ok: true, enviado: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await responder(medplum, evento({ mensajeId: 'in1' }))).ok).toBe(false);
    expect((await responder(medplum, evento({ mensajeId: 'no-existe' }))).ok).toBe(false);
  });

  it('Sin secrets de Twilio: no se intenta y el mensaje queda como estaba', async () => {
    const { medplum, todos } = escenario(1);
    const r = await responder(medplum, evento({ mensajeId: 'out1' }, {} as BotEvent['secrets']));
    expect(r).toMatchObject({ ok: false, canal: 'whatsapp', enviado: false });
    expect(r.motivo).toMatch(/secrets de Twilio/);
    expect(esWhatsApp(todos<Communication>('Communication').find((c) => c.id === 'out1')!)).toBe(false);
  });

  it('Si Twilio lo rechaza, la burbuja queda con el error y el motivo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 63003, message: 'Channel could not find To address' }), { status: 400 })),
    );
    const { medplum, todos } = escenario(1);
    const r = await responder(medplum, evento({ mensajeId: 'out1' }));
    expect(r).toMatchObject({ ok: false, canal: 'whatsapp', enviado: false });
    const m = todos<Communication>('Communication').find((c) => c.id === 'out1')!;
    expect(estadoEntregaDe(m)).toBe('fallido');
    expect(m.statusReason?.text).toMatch(/no tiene WhatsApp/);
  });
});

describe('enviarWhatsApp · avisos automáticos (confirmación, recordatorios, …)', () => {
  it('Normaliza el teléfono de la ficha, pide los ✓✓ a Twilio y guarda el MessageSid', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', '011 15 5000-0000')]);
    const secrets = {
      ...SECRETS,
      TWILIO_WEBHOOK_URL: { name: 'TWILIO_WEBHOOK_URL', valueString: 'https://id:secreto@api.medplum.com.ar/fhir/R4/Bot/x/$execute' },
    } as unknown as BotEvent['secrets'];

    const c = await enviarWhatsApp(medplum, secrets, { template: 'recordatorio-48h', body: 'Hola', pacienteRef: 'Patient/p1' });

    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('To')).toBe('whatsapp:+5491150000000');
    expect(form.get('StatusCallback')).toBe('https://id:secreto@api.medplum.com.ar/fhir/R4/Bot/x/$execute');
    expect(c.category).toEqual([CATEGORIA_WHATSAPP]);
    expect(c.partOf).toBeUndefined(); // un aviso suelto, no una conversación
    expect(c.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SMout1' }]);
    expect(estadoEntregaDe(c)).toBe('en-cola');
  });

  it('Un teléfono que no es un celular válido no se manda y queda el motivo', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', '123')]);
    const c = await enviarWhatsApp(medplum, SECRETS, { template: 't', body: 'Hola', pacienteRef: 'Patient/p1' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(c.status).toBe('preparation');
    expect(c.statusReason?.text).toMatch(/no es un celular válido/);
  });

  it('Si Twilio rechaza, explica el código', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 63016, message: 'Failed to send freeform message' }), { status: 400 })),
    );
    const { medplum } = fakeMedplum([paciente('p1', '+5491150000000')]);
    const c = await enviarWhatsApp(medplum, SECRETS, { template: 't', body: 'Hola', pacienteRef: 'Patient/p1' });
    expect(c.status).toBe('entered-in-error');
    expect(estadoEntregaDe(c)).toBe('fallido');
    expect(c.statusReason?.text).toMatch(/24 h/);
  });

  it('Un aviso con información clínica queda con la etiqueta de confidencialidad', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    const { medplum } = fakeMedplum([paciente('p1', '+5491150000000')]);
    const c = await enviarWhatsApp(medplum, SECRETS, { template: 'som-informe-listo', body: 'Resumen…', pacienteRef: 'Patient/p1', reservado: true });
    expect(c.meta?.security).toEqual([ETIQUETA_RESERVADO]);
  });
});

describe('Mensajes · WhatsApp en la bandeja', () => {
  function unNumeroNuevo() {
    const lead = { ...construirLeadWhatsApp('+5491122334455', 'Ana'), id: 'ana' };
    return fakeMedplum([
      lead,
      { ...construirConversacionWhatsApp('Patient/ana'), id: 'conv' },
      {
        resourceType: 'Communication',
        id: 'm1',
        status: 'in-progress',
        partOf: [{ reference: 'Communication/conv' }],
        subject: { reference: 'Patient/ana' },
        sender: { reference: 'Patient/ana' },
        sent: '2026-09-26T10:00:00Z',
        payload: [{ contentString: 'Hola' }],
        extension: [
          { url: EXT.canal, valueCode: 'whatsapp' },
          { url: EXT.telefonoWhatsapp, valueString: '+5491122334455' },
          { url: EXT.inicioContacto, valueBoolean: true },
        ],
      },
      {
        resourceType: 'Communication',
        id: 'm2',
        status: 'in-progress',
        partOf: [{ reference: 'Communication/conv' }],
        subject: { reference: 'Patient/ana' },
        sender: { display: 'Segunda Opinión Médica · respuesta automática' },
        sent: '2026-09-26T10:00:01Z',
        payload: [{ contentString: TEXTO_ACUSE }],
        extension: [{ url: EXT.autoRespuesta, valueCode: 'acuse' }],
      },
    ]);
  }

  it('Contador y campanita en una sola consulta; se apagan al leer', async () => {
    const { medplum } = unNumeroNuevo();
    const avisos = await cargarAvisos(medplum);
    expect(avisos.sinLeer).toBe(1); // el acuse automático no es del paciente
    expect(avisos.nuevosContactos).toEqual([
      { pacienteRef: 'Patient/ana', conversacionId: 'conv', nombre: 'Ana', telefono: '+5491122334455', texto: 'Hola', sent: '2026-09-26T10:00:00Z' },
    ]);
    await marcarLeidos(medplum, await medplum.searchResources('Communication', { 'part-of': 'Communication/conv' }));
    expect(await cargarAvisos(medplum)).toEqual({ sinLeer: 0, nuevosContactos: [] });
  });

  it('La primera respuesta de una persona igual avisa en el portal, aunque antes haya salido el acuse', async () => {
    const { medplum, todos } = unNumeroNuevo();
    const conv = todos<Communication>('Communication').find((c) => c.id === 'conv')!;
    const anteriores = todos<Communication>('Communication').filter((c) => c.partOf);
    const { mensaje, aviso } = await responderEnMensajes(medplum, { reference: 'Practitioner/ana' }, conv, 'Hola Ana', anteriores);
    expect(aviso).toBeDefined();
    expect(mensaje.payload).toEqual([{ contentString: 'Hola Ana' }]);
  });

  it('Una respuesta puede llevar solo adjuntos', async () => {
    const { medplum, todos } = unNumeroNuevo();
    const conv = todos<Communication>('Communication').find((c) => c.id === 'conv')!;
    const pdf = { contentType: 'application/pdf', url: 'Binary/b1', title: 'indicaciones.pdf' };
    const { mensaje } = await responderEnMensajes(medplum, { reference: 'Practitioner/ana' }, conv, '  ', [], undefined, [pdf]);
    expect(mensaje.payload).toEqual([{ contentAttachment: pdf }]);
    await expect(responderEnMensajes(medplum, { reference: 'Practitioner/ana' }, conv, '  ', [])).rejects.toThrow();
  });
});

describe('som-alta-paciente · completa el contacto que llegó por WhatsApp', () => {
  it('Lo encuentra por el número (tipeado distinto), pone el nombre real primero y no duplica el teléfono', async () => {
    const lead = { ...construirLeadWhatsApp('+5491122334455', 'Caro ✨'), id: 'lead1' };
    const { medplum, todos } = fakeMedplum([lead]);
    const r = await altaPaciente(
      medplum,
      evento({ nombre: 'Carolina Gómez', dni: '30111222', telefono: '11 2233-4455' }, {} as BotEvent['secrets']),
    );
    expect(r).toMatchObject({ ok: true, patientId: 'lead1', creado: false });
    const [p] = todos<Patient>('Patient');
    expect(p?.name?.[0]).toMatchObject({ use: 'official', text: 'Carolina Gómez', given: ['Carolina'], family: 'Gómez' });
    expect(p?.name?.[1]).toEqual({ use: 'nickname', text: 'Caro ✨' });
    expect(p?.telecom?.filter((t) => t.system === 'phone')).toHaveLength(1);
    expect(p?.identifier).toEqual([{ system: SYSTEM.dni, value: '30111222' }]);
  });

  it('Un teléfono compartido (la madre ya lo tiene, con su DNI) no une al hijo con otro DNI', async () => {
    const madre = paciente('madre', '+5491122334455', { identifier: [{ system: SYSTEM.dni, value: '20111222' }] });
    const { medplum, todos } = fakeMedplum([madre]);
    const r = await altaPaciente(
      medplum,
      evento({ nombre: 'Tomás Ruiz', dni: '50111222', telefono: '11 2233-4455' }, {} as BotEvent['secrets']),
    );
    expect(r.creado).toBe(true);
    expect(todos<Patient>('Patient').find((p) => p.id === 'madre')?.identifier).toEqual([{ system: SYSTEM.dni, value: '20111222' }]);
    expect(todos('Patient')).toHaveLength(2);
  });
});

describe('WhatsApp · permisos', () => {
  it('Recepción responde por WhatsApp y maneja archivos; el webhook solo lo ejecuta la ClientApplication de Twilio', () => {
    expect(BOTS_RECEPCION as readonly string[]).toContain(BOT_WHATSAPP_RESPONDER);
    expect(BOTS_RECEPCION as readonly string[]).not.toContain(BOT_WHATSAPP_ENTRANTE);
    expect(POLICY_RECEPCIONISTA.resource).toEqual(expect.arrayContaining([{ resourceType: 'Binary' }]));
    expect(POLICY_WEBHOOK_TWILIO.resource).toEqual([
      { resourceType: 'Bot', readonly: true, criteria: `Bot?name=${BOT_WHATSAPP_ENTRANTE}` },
    ]);
  });
});
