import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Binary, Communication, Patient } from '@medplum/fhirtypes';
import { BOT_WHATSAPP_ADJUNTO, BOT_WHATSAPP_ENTRANTE, BOT_WHATSAPP_RESPONDER, EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { BOTS_RECEPCION, POLICY_WEBHOOK_TWILIO } from '../src/fhir/access-policies.js';
import { enviarWhatsApp } from '../src/bots/_shared.js';
import { handler as entrante } from '../src/bots/whatsapp-entrante.js';
import { handler as responder } from '../src/bots/whatsapp-responder.js';
import { handler as adjunto } from '../src/bots/whatsapp-adjunto.js';
import { handler as altaPaciente } from '../src/bots/alta-paciente.js';
import {
  CATEGORIA_WHATSAPP,
  construirLeadWhatsApp,
  ETIQUETA_RESERVADO,
  estadoEntregaDe,
  esInicioContacto,
  MAX_ADJUNTO_VISTA_BYTES,
  telefonoDe,
} from '../src/lib/whatsapp.js';
import { cargarAvisos, marcarLeidos } from '../src/lib/whatsapp-chat.js';
import { fakeMedplum } from './fake-medplum.js';

const H = 3_600_000;

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

function saliente(id: string, pacienteRef: string, sent: string, extra: Partial<Communication> = {}): Communication {
  return {
    resourceType: 'Communication',
    id,
    status: 'completed',
    category: [CATEGORIA_WHATSAPP],
    subject: { reference: pacienteRef },
    recipient: [{ reference: pacienteRef }],
    sent,
    payload: [{ contentString: 'Recordatorio' }],
    extension: [{ url: EXT.canal, valueCode: 'whatsapp' }],
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(`Bot ${BOT_WHATSAPP_ENTRANTE} · mensajes entrantes`, () => {
  it('Un número nuevo: crea el lead (origen WhatsApp) y el mensaje sin leer que avisa la campanita', async () => {
    const { medplum, todos } = fakeMedplum();
    const r = await entrante(medplum, evento(mensaje()));

    expect(r).toMatchObject({ ok: true, tipo: 'entrante', pacienteNuevo: true, inicioContacto: true });
    const [lead] = todos<Patient>('Patient');
    expect(lead?.name).toEqual([{ use: 'nickname', text: 'Ana Pérez' }]);
    expect(lead?.telecom?.[0]?.value).toBe('+5491122334455');
    expect(lead?.extension).toEqual(expect.arrayContaining([{ url: EXT.origenLead, valueString: 'whatsapp' }]));

    const [m] = todos<Communication>('Communication');
    expect(m).toMatchObject({ status: 'in-progress', subject: { reference: `Patient/${lead!.id}` }, sender: { reference: `Patient/${lead!.id}` } });
    expect(m?.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SM1' }]);
    expect(esInicioContacto(m!)).toBe(true);
    expect(telefonoDe(m!)).toBe('+5491122334455');
    expect(m?.payload).toEqual([{ contentString: 'Hola, quiero un turno' }]);
  });

  it('Twilio reintenta el mismo mensaje: no se duplica', async () => {
    const { medplum, todos } = fakeMedplum();
    await entrante(medplum, evento(mensaje()));
    const r = await entrante(medplum, evento(mensaje()));
    expect(r.motivo).toBe('ya registrado');
    expect(todos('Communication')).toHaveLength(1);
    expect(todos('Patient')).toHaveLength(1);
  });

  it('Encuentra al paciente aunque en la ficha el número esté tipeado de otra forma', async () => {
    const { medplum, todos } = fakeMedplum([paciente('p1', '011 15 2233-4455')]);
    const r = await entrante(medplum, evento(mensaje()));
    expect(r).toMatchObject({ pacienteRef: 'Patient/p1', pacienteNuevo: false, inicioContacto: true });
    expect(todos('Patient')).toHaveLength(1);
  });

  it('Dentro de una conversación (hubo WhatsApp en las últimas 24 h) no es inicio de contacto', async () => {
    const { medplum, todos } = fakeMedplum([
      paciente('p1', '+5491122334455'),
      saliente('c0', 'Patient/p1', new Date(Date.now() - 2 * H).toISOString()),
    ]);
    const r = await entrante(medplum, evento(mensaje()));
    expect(r.inicioContacto).toBe(false);
    const nuevo = todos<Communication>('Communication').find((c) => c.id !== 'c0');
    expect(esInicioContacto(nuevo!)).toBe(false);
  });

  it('Si pasaron más de 24 h desde el último WhatsApp, vuelve a ser inicio de contacto', async () => {
    const { medplum } = fakeMedplum([
      paciente('p1', '+5491122334455'),
      saliente('c0', 'Patient/p1', new Date(Date.now() - 30 * H).toISOString()),
    ]);
    const r = await entrante(medplum, evento(mensaje()));
    expect(r.inicioContacto).toBe(true);
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
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.startsWith('https://api.twilio.com/')
        ? new Response(null, { status: 307, headers: { location: 'https://s3.amazonaws.com/media/abc' } })
        : new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491122334455')]);

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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, primero] = fetchMock.mock.calls[0]!;
    expect((primero?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(fetchMock.mock.calls[1]![1]).toBeUndefined(); // al link firmado, sin el token
    const [binary] = todos<Binary>('Binary');
    expect(binary).toMatchObject({ contentType: 'image/jpeg', securityContext: { reference: 'Patient/p1' } });
    const [m] = todos<Communication>('Communication');
    expect(m?.payload).toEqual([
      {
        contentAttachment: expect.objectContaining({
          contentType: 'image/jpeg',
          url: `Binary/${binary!.id}`,
          title: 'whatsapp-1.jpg',
          size: 4,
        }),
      },
    ]);
  });

  it('Una media que no es de api.twilio.com no se descarga (el token nunca sale)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491122334455')]);
    await entrante(medplum, evento(mensaje({ NumMedia: '1', MediaUrl0: 'https://evil.example/x', MediaContentType0: 'image/png' })));
    expect(fetchMock).not.toHaveBeenCalled();
    const [m] = todos<Communication>('Communication');
    expect(m?.payload?.[1]?.contentAttachment?.title).toMatch(/no se pudo descargar/);
    expect(m?.payload?.[1]?.contentAttachment?.url).toBeUndefined();
  });
});

describe(`Bot ${BOT_WHATSAPP_ENTRANTE} · estados de entrega (✓✓)`, () => {
  const conSid = (estado?: string): Communication =>
    saliente('c1', 'Patient/p1', '2026-09-26T10:00:00Z', {
      identifier: [{ system: SYSTEM.twilioMessageSid, value: 'SMout' }],
      extension: [
        { url: EXT.canal, valueCode: 'whatsapp' },
        ...(estado ? [{ url: EXT.estadoEntrega, valueCode: estado }] : []),
      ],
    });

  it('Actualiza el estado y no retrocede si llegan desordenados', async () => {
    const { medplum, todos } = fakeMedplum([conSid('en-cola')]);
    await entrante(medplum, evento({ MessageSid: 'SMout', AccountSid: 'AC123', MessageStatus: 'read' }));
    expect(estadoEntregaDe(todos<Communication>('Communication')[0]!)).toBe('leido');
    const r = await entrante(medplum, evento({ MessageSid: 'SMout', AccountSid: 'AC123', MessageStatus: 'delivered' }));
    expect(r.estadoEntrega).toBe('leido');
    expect(estadoEntregaDe(todos<Communication>('Communication')[0]!)).toBe('leido');
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

describe(`Bot ${BOT_WHATSAPP_RESPONDER} · la ventana de 24 h la decide el sistema`, () => {
  const twilioOk = () =>
    vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ sid: 'SMresp', status: 'queued' }), { status: 201 }));

  function entranteDe(sentHaceHoras: number, telefono = '+5491199998888'): Communication {
    return {
      resourceType: 'Communication',
      id: 'in1',
      status: 'completed',
      category: [CATEGORIA_WHATSAPP],
      subject: { reference: 'Patient/p1' },
      sender: { reference: 'Patient/p1' },
      sent: new Date(Date.now() - sentHaceHoras * H).toISOString(),
      payload: [{ contentString: 'Hola' }],
      extension: [
        { url: EXT.canal, valueCode: 'whatsapp' },
        { url: EXT.telefonoWhatsapp, valueString: telefono },
      ],
    };
  }

  it('Dentro de las 24 h: responde al número desde el que escribió, como la recepcionista', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491111112222'), entranteDe(1)]);

    const r = await responder(
      medplum,
      evento({ pacienteRef: 'Patient/p1', texto: '  ¡Hola! Te ayudamos.  ', autor: { reference: 'Practitioner/ana', display: 'Ana' } }),
    );

    expect(r.ok).toBe(true);
    expect(r.ventanaCierra).toBeDefined();
    const cuerpo = fetchMock.mock.calls[0]![1] as RequestInit;
    const form = new URLSearchParams(cuerpo.body as URLSearchParams);
    expect(form.get('To')).toBe('whatsapp:+5491199998888'); // el del chat, no el de la ficha
    expect(form.get('Body')).toBe('¡Hola! Te ayudamos.');
    const enviado = todos<Communication>('Communication').find((c) => c.id !== 'in1')!;
    expect(enviado).toMatchObject({ status: 'completed', sender: { reference: 'Practitioner/ana', display: 'Ana' } });
    expect(enviado.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SMresp' }]);
    expect(estadoEntregaDe(enviado)).toBe('en-cola');
  });

  it('Pasadas las 24 h: no envía (WhatsApp solo acepta plantillas)', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491111112222'), entranteDe(25)]);
    const r = await responder(medplum, evento({ pacienteRef: 'Patient/p1', texto: 'Hola' }));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/24 h/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(todos('Communication')).toHaveLength(1);
  });

  it('Si el paciente nunca escribió, tampoco (primero hace falta una plantilla)', async () => {
    const fetchMock = twilioOk();
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', '+5491111112222')]);
    const r = await responder(medplum, evento({ pacienteRef: 'Patient/p1', texto: 'Hola' }));
    expect(r).toMatchObject({ ok: false });
    expect(r.motivo).toMatch(/todavía no escribió/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Un "autor" que no es del equipo de SOM se descarta; texto vacío o muy largo, no', async () => {
    vi.stubGlobal('fetch', twilioOk());
    const { medplum, todos } = fakeMedplum([paciente('p1', '+5491111112222'), entranteDe(1)]);
    await responder(medplum, evento({ pacienteRef: 'Patient/p1', texto: 'Hola', autor: { reference: 'Patient/p1' } }));
    expect(todos<Communication>('Communication').find((c) => c.id !== 'in1')?.sender).toBeUndefined();
    expect((await responder(medplum, evento({ pacienteRef: 'Patient/p1', texto: '   ' }))).ok).toBe(false);
    expect((await responder(medplum, evento({ pacienteRef: 'Patient/p1', texto: 'x'.repeat(1601) }))).ok).toBe(false);
    expect((await responder(medplum, evento({ pacienteRef: 'p1', texto: 'Hola' }))).ok).toBe(false);
  });

  it('Sin secrets de Twilio: queda registrado pero avisa que no salió', async () => {
    const { medplum } = fakeMedplum([paciente('p1', '+5491111112222'), entranteDe(1)]);
    const r = await responder(medplum, evento({ pacienteRef: 'Patient/p1', texto: 'Hola' }, {} as BotEvent['secrets']));
    expect(r.ok).toBe(false);
    expect(r.mensaje?.status).toBe('preparation');
    expect(r.motivo).toMatch(/secrets de Twilio/);
  });
});

describe(`Bot ${BOT_WHATSAPP_ADJUNTO} · Recepción ve solo adjuntos de WhatsApp`, () => {
  function conAdjunto(extra: Partial<Communication> = {}, size = 3): Communication {
    return {
      resourceType: 'Communication',
      id: 'm1',
      status: 'completed',
      category: [CATEGORIA_WHATSAPP],
      subject: { reference: 'Patient/p1' },
      sender: { reference: 'Patient/p1' },
      payload: [{ contentAttachment: { contentType: 'image/jpeg', url: 'Binary/b1', title: 'whatsapp-1.jpg', size } }],
      extension: [{ url: EXT.canal, valueCode: 'whatsapp' }],
      ...extra,
    };
  }

  /** El bot webhook y el archivo que guardó (Binary.meta.author = el bot). */
  const WEBHOOK = { resourceType: 'Bot', id: 'bot-entrante', name: BOT_WHATSAPP_ENTRANTE } as const;
  const binario = (autor = 'Bot/bot-entrante'): Binary => ({
    resourceType: 'Binary',
    id: 'b1',
    contentType: 'image/jpeg',
    meta: { author: { reference: autor } },
  });

  function conDescarga(
    recursos: Communication[],
    archivo: Binary = binario(),
  ): { medplum: MedplumClient; download: ReturnType<typeof vi.fn> } {
    const { medplum } = fakeMedplum([...recursos, archivo, WEBHOOK]);
    const download = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
    (medplum as unknown as { download: typeof download }).download = download;
    return { medplum, download };
  }

  it('Devuelve el archivo en base64', async () => {
    const { medplum, download } = conDescarga([conAdjunto()]);
    const r = await adjunto(medplum, evento({ communicationId: 'm1' }));
    expect(r).toEqual({ ok: true, contentType: 'image/jpeg', data: 'AQID', titulo: 'whatsapp-1.jpg' });
    expect(download).toHaveBeenCalledWith('Binary/b1');
  });

  it('Nunca el de un mensaje que no es de WhatsApp (p. ej. un estudio del portal) ni uno reservado', async () => {
    const noWhatsApp = conAdjunto({ category: undefined, extension: [] });
    const { medplum, download } = conDescarga([noWhatsApp]);
    expect((await adjunto(medplum, evento({ communicationId: 'm1' }))).ok).toBe(false);

    const reservado = conDescarga([conAdjunto({ meta: { security: [ETIQUETA_RESERVADO] } })]);
    expect((await adjunto(reservado.medplum, evento({ communicationId: 'm1' }))).ok).toBe(false);
    expect(download).not.toHaveBeenCalled();
    expect(reservado.download).not.toHaveBeenCalled();
  });

  it('Ni un archivo que no guardó el webhook (p. ej. un estudio del portal apuntado a mano)', async () => {
    const estudio = conDescarga([conAdjunto()], binario('Patient/p1'));
    const r = await adjunto(estudio.medplum, evento({ communicationId: 'm1' }));
    expect(r).toEqual({ ok: false, motivo: 'El adjunto no está disponible.' });
    expect(estudio.download).not.toHaveBeenCalled();
    const informe = conDescarga([conAdjunto()], binario('Bot/bot-som-report'));
    expect((await adjunto(informe.medplum, evento({ communicationId: 'm1' }))).ok).toBe(false);
  });

  it('Ni uno demasiado grande, ni uno inexistente', async () => {
    const grande = conDescarga([conAdjunto({}, MAX_ADJUNTO_VISTA_BYTES + 1)]);
    expect((await adjunto(grande.medplum, evento({ communicationId: 'm1' }))).motivo).toMatch(/muy grande/);
    expect((await adjunto(grande.medplum, evento({ communicationId: 'no-existe' }))).ok).toBe(false);
    expect((await adjunto(grande.medplum, evento({ communicationId: 'm1', indice: 3 }))).ok).toBe(false);
  });
});

describe('enviarWhatsApp · E.164, ✓✓ y privacidad', () => {
  it('Normaliza el teléfono de la ficha, pide los estados a Twilio y guarda el MessageSid', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ sid: 'SM9', status: 'queued' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { medplum } = fakeMedplum([paciente('p1', '011 15 5000-0000')]);
    const secrets = {
      ...SECRETS,
      TWILIO_WEBHOOK_URL: { name: 'TWILIO_WEBHOOK_URL', valueString: 'https://id:secreto@api.medplum.com.ar/fhir/R4/Bot/x/$execute' },
    } as unknown as BotEvent['secrets'];

    const c = await enviarWhatsApp(medplum, secrets, { template: 'recordatorio-48h', body: 'Hola', pacienteRef: 'Patient/p1' });

    const form = new URLSearchParams((fetchMock.mock.calls[0]![1] as RequestInit).body as URLSearchParams);
    expect(form.get('To')).toBe('whatsapp:+5491150000000');
    expect(form.get('StatusCallback')).toBe('https://id:secreto@api.medplum.com.ar/fhir/R4/Bot/x/$execute');
    expect(c.category).toEqual([CATEGORIA_WHATSAPP]);
    expect(c.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SM9' }]);
    expect(estadoEntregaDe(c)).toBe('en-cola');
    expect(telefonoDe(c)).toBe('+5491150000000');
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

  it('Si Twilio rechaza, explica el código (y el ✓ queda en error)', async () => {
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
});

describe('som-alta-paciente · un teléfono compartido no une a dos personas', () => {
  it('La madre ya tiene ese número y su DNI: el hijo (otro DNI) es una ficha nueva', async () => {
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

describe('WhatsApp · lectura de la app (campanita y leídos)', () => {
  it('Cuenta los no leídos y arma la campanita con los inicios de contacto', async () => {
    const { medplum } = fakeMedplum([
      paciente('p1', '+5491122334455', { name: [{ text: 'Ana' }] }),
      {
        resourceType: 'Communication',
        id: 'm1',
        status: 'in-progress',
        category: [CATEGORIA_WHATSAPP],
        subject: { reference: 'Patient/p1' },
        sender: { reference: 'Patient/p1' },
        sent: '2026-09-26T10:00:00Z',
        payload: [{ contentString: 'Hola' }],
        extension: [
          { url: EXT.canal, valueCode: 'whatsapp' },
          { url: EXT.inicioContacto, valueBoolean: true },
        ],
      },
      {
        resourceType: 'Communication',
        id: 'm2',
        status: 'in-progress',
        category: [CATEGORIA_WHATSAPP],
        subject: { reference: 'Patient/p1' },
        sender: { reference: 'Patient/p1' },
        sent: '2026-09-26T10:01:00Z',
        payload: [{ contentString: '¿Están?' }],
        extension: [{ url: EXT.canal, valueCode: 'whatsapp' }],
      },
    ]);
    const avisos = await cargarAvisos(medplum);
    expect(avisos.sinLeer).toBe(2);
    expect(avisos.nuevosContactos).toEqual([
      { pacienteRef: 'Patient/p1', nombre: 'Ana', texto: 'Hola', sent: '2026-09-26T10:00:00Z' },
    ]);

    const leidos = await marcarLeidos(medplum, await medplum.searchResources('Communication', {}));
    expect(leidos).toBe(2);
    expect((await cargarAvisos(medplum)).sinLeer).toBe(0);
  });
});

describe('WhatsApp · permisos', () => {
  it('Recepción responde y ve adjuntos; el webhook solo lo ejecuta la ClientApplication de Twilio', () => {
    expect(BOTS_RECEPCION as readonly string[]).toEqual(expect.arrayContaining([BOT_WHATSAPP_RESPONDER, BOT_WHATSAPP_ADJUNTO]));
    expect(BOTS_RECEPCION as readonly string[]).not.toContain(BOT_WHATSAPP_ENTRANTE);
    expect(POLICY_WEBHOOK_TWILIO.resource).toEqual([
      { resourceType: 'Bot', readonly: true, criteria: `Bot?name=${BOT_WHATSAPP_ENTRANTE}` },
    ]);
  });
});
