import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Communication, Patient } from '@medplum/fhirtypes';
import { BOT_WHATSAPP_ENTRANTE, BOT_WHATSAPP_RESPONDER, EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { TEXTO_ACUSE, TEXTO_BIENVENIDA, TEXTO_MENSAJE_NUEVO } from '../src/config/auto-respuesta.js';
import { handler as entrante } from '../src/bots/whatsapp-entrante.js';
import { handler as responder } from '../src/bots/whatsapp-responder.js';
import { firmaTwilio } from '../src/lib/firma-twilio.js';
import {
  camposTwilio,
  conPendienteWhatsApp,
  construirConversacionWhatsApp,
  esPendienteWhatsApp,
  estadoEntregaDe,
  esWhatsApp,
  tipoAutomatica,
} from '../src/lib/whatsapp.js';
import { fakeMedplum } from './fake-medplum.js';

const H = 3_600_000;
const LUNES_12 = new Date('2026-09-28T12:00:00-03:00'); // centro abierto
const URL_WEBHOOK = 'https://api.medplum.com.ar/webhooks/som/twilio-whatsapp';
const TELEFONO = '+5491122334455';
const REF = { reference: 'Patient/p1' };
const RECEPCION = { reference: 'Practitioner/ana', display: 'Ana' };

const SECRETS = {
  TWILIO_ACCOUNT_SID: { name: 'TWILIO_ACCOUNT_SID', valueString: 'AC123' },
  TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'tok' },
  TWILIO_WHATSAPP_FROM: { name: 'TWILIO_WHATSAPP_FROM', valueString: 'whatsapp:+14155238886' },
  TWILIO_WEBHOOK_URL: { name: 'TWILIO_WEBHOOK_URL', valueString: URL_WEBHOOK },
} as unknown as BotEvent['secrets'];

/** Los secrets de Twilio más los ContentSid de las plantillas aprobadas. */
function conPlantillas(aprobadas: Record<string, string>): BotEvent['secrets'] {
  return {
    ...SECRETS,
    ...Object.fromEntries(Object.entries(aprobadas).map(([name, valueString]) => [name, { name, valueString }])),
  } as unknown as BotEvent['secrets'];
}

function evento<T>(input: T, secrets: BotEvent['secrets'] = SECRETS): BotEvent<T> {
  const token = secrets['TWILIO_AUTH_TOKEN']?.valueString;
  const headers = token ? { 'x-twilio-signature': firmaTwilio(token, URL_WEBHOOK, camposTwilio(input)) } : {};
  return { input, secrets, headers, bot: { reference: 'Bot/b' }, contentType: 'application/x-www-form-urlencoded' } as BotEvent<T>;
}

/** Lo que manda Twilio cuando el paciente escribe. */
function mensaje(extra: Record<string, string> = {}): Record<string, string> {
  return {
    MessageSid: 'SM1',
    AccountSid: 'AC123',
    From: `whatsapp:${TELEFONO}`,
    To: 'whatsapp:+14155238886',
    Body: 'Hola, ¿me respondieron?',
    ProfileName: 'Ana Pérez',
    NumMedia: '0',
    SmsStatus: 'received',
    ...extra,
  };
}

function paciente(id: string, telefono: string): Patient {
  return { resourceType: 'Patient', id, name: [{ text: `Paciente ${id}` }], telecom: [{ system: 'phone', value: telefono }] };
}

/** Un WhatsApp del paciente en la conversación `conv`, de hace `horas`. */
function delPacienteHace(id: string, horas: number): Communication {
  return {
    resourceType: 'Communication',
    id,
    status: 'completed',
    partOf: [{ reference: 'Communication/conv' }],
    subject: REF,
    sender: REF,
    sent: new Date(Date.now() - horas * H).toISOString(),
    payload: [{ contentString: 'Hola' }],
    extension: [
      { url: EXT.canal, valueCode: 'whatsapp' },
      { url: EXT.telefonoWhatsapp, valueString: TELEFONO },
    ],
  };
}

/** Una respuesta de Recepción en `conv`, de hace `horas`, que todavía no salió por WhatsApp. */
function respuesta(id: string, texto: string, horas: number, opts: { pendiente?: boolean; adjunto?: string } = {}): Communication {
  const m: Communication = {
    resourceType: 'Communication',
    id,
    status: 'in-progress',
    partOf: [{ reference: 'Communication/conv' }],
    subject: REF,
    sender: RECEPCION,
    recipient: [REF],
    sent: new Date(Date.now() - horas * H).toISOString(),
    payload: [
      { contentString: texto },
      ...(opts.adjunto ? [{ contentAttachment: { contentType: 'application/pdf', url: opts.adjunto, title: 'indicaciones.pdf' } }] : []),
    ],
  };
  return conPendienteWhatsApp(m, opts.pendiente === true);
}

function conversacion(): Communication {
  return { ...construirConversacionWhatsApp('Patient/p1'), id: 'conv' };
}

/** Twilio acepta cada envío (y lo registra para ver qué se mandó). */
function twilioOk() {
  let n = 0;
  return vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ sid: `SMout${++n}`, status: 'queued' }), { status: 201 }));
}

function formDe(llamada: unknown[] | undefined): URLSearchParams {
  return new URLSearchParams((llamada?.[1] as RequestInit).body as URLSearchParams);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(`Bot ${BOT_WHATSAPP_RESPONDER} · ventana de 24 h cerrada: aviso con plantilla y respuesta pendiente`, () => {
  it('Con la plantilla "mensaje nuevo" aprobada: avisa una vez, deja la respuesta pendiente y lo explica', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([
      paciente('p1', TELEFONO),
      conversacion(),
      delPacienteHace('in1', 25),
      respuesta('out1', '¡Hola! Te ayudamos.', 0),
      respuesta('out2', 'Y una cosa más.', 0),
    ]);
    const secrets = conPlantillas({ TWILIO_CONTENT_SID_MENSAJE_NUEVO: 'HXnuevo', TWILIO_CONTENT_SID_AVISO: 'HXaviso' });

    const r1 = await responder(medplum, evento({ mensajeId: 'out1' }, secrets));

    expect(r1).toMatchObject({ ok: true, canal: 'whatsapp', enviado: false, avisado: true });
    expect(r1.motivo).toMatch(/cuando conteste/);
    expect(fetchMock).toHaveBeenCalledOnce();
    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('To')).toBe(`whatsapp:${TELEFONO}`);
    expect(form.get('ContentSid')).toBe('HXnuevo'); // la propia, no la genérica
    expect(form.get('ContentVariables')).toBe('{}');
    expect(form.has('Body')).toBe(false);
    const comms = todos<Communication>('Communication');
    const out1 = comms.find((c) => c.id === 'out1')!;
    expect(esPendienteWhatsApp(out1)).toBe(true);
    expect(esWhatsApp(out1)).toBe(false); // la respuesta en sí no salió
    expect(esPendienteWhatsApp(r1.mensaje!)).toBe(true);
    const aviso = comms.find((c) => tipoAutomatica(c) === 'mensaje-nuevo')!;
    expect(aviso.partOf?.[0]?.reference).toBe('Communication/conv');
    expect(aviso.payload?.[0]?.contentString).toBe(TEXTO_MENSAJE_NUEVO);
    expect(aviso.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SMout1' }]);
    expect(estadoEntregaDe(aviso)).toBe('en-cola');

    // Otra respuesta en el mismo período cerrado: queda pendiente sin repetir el aviso.
    const r2 = await responder(medplum, evento({ mensajeId: 'out2' }, secrets));
    expect(r2).toMatchObject({ ok: true, canal: 'whatsapp', enviado: false, avisado: true });
    expect(r2.motivo).toMatch(/ya le avisamos/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(esPendienteWhatsApp(todos<Communication>('Communication').find((c) => c.id === 'out2')!)).toBe(true);
  });

  it('Con solo la genérica aprobada, el aviso sale con ella', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', TELEFONO), conversacion(), delPacienteHace('in1', 25), respuesta('out1', 'Hola', 0)]);

    const r = await responder(medplum, evento({ mensajeId: 'out1' }, conPlantillas({ TWILIO_CONTENT_SID_AVISO: 'HXaviso' })));

    expect(r).toMatchObject({ ok: true, avisado: true, enviado: false });
    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('ContentSid')).toBe('HXaviso');
    expect(JSON.parse(form.get('ContentVariables')!)).toEqual({
      '1': 'Recepción te respondió en Mensajes. Podés leerlo en el portal o respondé este mensaje y te lo reenviamos por acá.',
    });
  });

  it('Sin ninguna plantilla aprobada: no sale, no queda pendiente y dice que falta la plantilla', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', TELEFONO), conversacion(), delPacienteHace('in1', 25), respuesta('out1', 'Hola', 0)]);

    const r = await responder(medplum, evento({ mensajeId: 'out1' }));

    expect(r).toMatchObject({ ok: false, canal: 'whatsapp', enviado: false });
    expect(r.avisado).toBeUndefined();
    expect(r.motivo).toMatch(/24 h/);
    expect(r.motivo).toMatch(/plantilla/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(esPendienteWhatsApp(todos<Communication>('Communication').find((c) => c.id === 'out1')!)).toBe(false);
  });

  it('Si Twilio rechaza el aviso: la respuesta queda pendiente igual (sale cuando conteste) y el error se ve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 63016, message: 'no' }), { status: 400 })),
    );
    const { medplum, todos } = fakeMedplum([paciente('p1', TELEFONO), conversacion(), delPacienteHace('in1', 25), respuesta('out1', 'Hola', 0)]);

    const r = await responder(medplum, evento({ mensajeId: 'out1' }, conPlantillas({ TWILIO_CONTENT_SID_MENSAJE_NUEVO: 'HXnuevo' })));

    expect(r).toMatchObject({ ok: false, enviado: false });
    expect(r.motivo).toMatch(/Tampoco salió el aviso/);
    const comms = todos<Communication>('Communication');
    expect(esPendienteWhatsApp(comms.find((c) => c.id === 'out1')!)).toBe(true);
    expect(estadoEntregaDe(comms.find((c) => tipoAutomatica(c) === 'mensaje-nuevo')!)).toBe('fallido');
  });
});

describe(`Bot ${BOT_WHATSAPP_ENTRANTE} · el paciente contesta y salen las respuestas que esperaban`, () => {
  it('Reenvía las pendientes en orden (texto y adjuntos), las desmarca y no responde solo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([
      paciente('p1', TELEFONO),
      conversacion(),
      delPacienteHace('in1', 30),
      respuesta('out2', 'Segunda respuesta.', 25, { pendiente: true }),
      respuesta('out1', 'Primera respuesta.', 26, { pendiente: true, adjunto: 'https://storage.example/a.pdf?sig=1' }),
      respuesta('out0', 'Ya había salido.', 29),
    ]);

    const r = await entrante(medplum, evento(mensaje()));

    expect(r).toMatchObject({ ok: true, tipo: 'entrante', pacienteRef: 'Patient/p1', conversacionId: 'conv', conversacionNueva: false, reenviados: 2 });
    expect(r.respuestaAutomatica).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(formDe(fetchMock.mock.calls[0]))).toMatchObject({
      To: `whatsapp:${TELEFONO}`,
      Body: 'Primera respuesta.',
      MediaUrl: 'https://storage.example/a.pdf?sig=1',
    });
    expect(formDe(fetchMock.mock.calls[1]).get('Body')).toBe('Segunda respuesta.');
    const comms = todos<Communication>('Communication');
    for (const id of ['out1', 'out2']) {
      const m = comms.find((c) => c.id === id)!;
      expect(esPendienteWhatsApp(m)).toBe(false);
      expect(esWhatsApp(m)).toBe(true);
      expect(estadoEntregaDe(m)).toBe('en-cola');
      expect(m.identifier?.[0]?.system).toBe(SYSTEM.twilioMessageSid);
    }
    expect(esWhatsApp(comms.find((c) => c.id === 'out0')!)).toBe(false);
  });

  it('Sin pendientes no reenvía nada; una conversación nueva tampoco', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', TELEFONO), conversacion(), delPacienteHace('in1', 30), respuesta('out0', 'Ya había salido.', 29)]);

    const r = await entrante(medplum, evento(mensaje()));

    expect(r.reenviados).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('El acuse con su plantilla aprobada: sale con ContentSid y el paciente recibe el mismo texto', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    // Un paciente que ya está en SOM y abre una conversación nueva (a un número nuevo le toca la bienvenida).
    const { medplum, todos } = fakeMedplum([paciente('p1', TELEFONO)]);

    const r = await entrante(medplum, evento(mensaje(), conPlantillas({ TWILIO_CONTENT_SID_ACUSE: 'HXacuse', TWILIO_CONTENT_SID_AVISO: 'HXaviso' })));

    expect(r).toMatchObject({ ok: true, pacienteNuevo: false, respuestaAutomatica: 'acuse' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('ContentSid')).toBe('HXacuse');
    expect(form.get('ContentVariables')).toBe('{}');
    expect(form.has('Body')).toBe(false);
    const acuse = todos<Communication>('Communication').find((c) => tipoAutomatica(c) === 'acuse')!;
    expect(acuse.payload?.[0]?.contentString).toBe(TEXTO_ACUSE);
    expect(acuse.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SMout1' }]);
  });

  it('Sin la plantilla del acuse (aunque esté la genérica), el acuse sale como texto libre', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', TELEFONO)]);

    await entrante(medplum, evento(mensaje(), conPlantillas({ TWILIO_CONTENT_SID_AVISO: 'HXaviso' })));

    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.has('ContentSid')).toBe(false);
    expect(form.get('Body')).toBe(TEXTO_ACUSE);
  });

  it('La bienvenida de un número nuevo sale con su plantilla aprobada (no con la del acuse)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LUNES_12);
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([]);

    const r = await entrante(
      medplum,
      evento(mensaje(), conPlantillas({ TWILIO_CONTENT_SID_BIENVENIDA: 'HXbienvenida', TWILIO_CONTENT_SID_ACUSE: 'HXacuse' })),
    );

    expect(r).toMatchObject({ ok: true, pacienteNuevo: true, respuestaAutomatica: 'bienvenida' });
    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('ContentSid')).toBe('HXbienvenida');
    expect(form.get('ContentVariables')).toBe('{}');
    const bienvenida = todos<Communication>('Communication').find((c) => tipoAutomatica(c) === 'bienvenida')!;
    expect(bienvenida.payload?.[0]?.contentString).toBe(TEXTO_BIENVENIDA);
  });

  it('Con el centro cerrado, la bienvenida sale con la plantilla de fuera de horario y el horario como variable', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T10:00:00-03:00')); // domingo
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([]);

    await entrante(
      medplum,
      evento(
        mensaje(),
        conPlantillas({ TWILIO_CONTENT_SID_BIENVENIDA: 'HXbienvenida', TWILIO_CONTENT_SID_BIENVENIDA_FUERA_DE_HORARIO: 'HXbienvenidaCerrado' }),
      ),
    );

    const form = formDe(fetchMock.mock.calls[0]);
    expect(form.get('ContentSid')).toBe('HXbienvenidaCerrado');
    expect(JSON.parse(form.get('ContentVariables')!)).toEqual({ '1': 'lunes a viernes de 8 a 22 y sábados de 8 a 20' });
  });
});
