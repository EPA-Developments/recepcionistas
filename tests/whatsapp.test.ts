import { describe, it, expect } from 'vitest';
import type { Communication, Patient } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { REMITENTE_AUTOMATICO } from '../src/config/auto-respuesta.js';
import {
  aE164AR,
  avisosInicioContacto,
  claveConversacionWhatsApp,
  combinarEstadoEntrega,
  conEnvioWhatsApp,
  conEstadoEntrega,
  construirConversacionWhatsApp,
  construirLeadWhatsApp,
  construirMensajeEntrante,
  construirRespuestaAutomatica,
  conversacionAbierta,
  decidirEnvioWhatsApp,
  elegirPacientePorTelefono,
  esConversacionAbierta,
  esInicioContacto,
  esMediaDeTwilio,
  esSinFicha,
  esSoloNumero,
  estadoEntregaDe,
  estadoEntregaDeTwilio,
  esWhatsApp,
  etiquetaDia,
  explicarErrorTwilio,
  fechaCorta,
  formatoTelefono,
  haceCuanto,
  iniciales,
  leerWebhookTwilio,
  MENSAJE_SIN_CONTENIDO,
  nombreAdjunto,
  partirTexto,
  telefonoDe,
  tipoAdjunto,
  tipoAutomatica,
  ultimoDelPaciente,
  variantesTelefonoAR,
  vistaPrevia,
} from '../src/lib/whatsapp.js';

const H = 3_600_000;

describe('WhatsApp · teléfonos argentinos a E.164', () => {
  it.each([
    ['+5491122334455', '+5491122334455'],
    ['+54 9 11 2233-4455', '+5491122334455'],
    ['+54 11 2233-4455', '+5491122334455'], // sin el 9 de celular
    ['5491122334455', '+5491122334455'],
    ['541122334455', '+5491122334455'],
    ['011 15 2233-4455', '+5491122334455'],
    ['11 2233-4455', '+5491122334455'],
    ['1122334455', '+5491122334455'],
    ['15 2233-4455', '+5491122334455'], // CABA sin característica
    ['2233-4455', '+5491122334455'],
    ['0351 15 555-1234', '+5493515551234'], // Córdoba
    ['(0351) 555-1234', '+5493515551234'],
    ['0294 15 455-1234', '+5492944551234'], // Bariloche (característica de 4)
    ['whatsapp:+5491122334455', '+5491122334455'],
    ['0054 9 11 2233 4455', '+5491122334455'],
    ['+1 415 523 8886', '+14155238886'], // otro país: se respeta
  ])('%s → %s', (entrada, e164) => {
    expect(aE164AR(entrada)).toBe(e164);
  });

  it('Lo que no es un celular válido queda undefined (no se manda)', () => {
    expect(aE164AR(undefined)).toBeUndefined();
    expect(aE164AR('')).toBeUndefined();
    expect(aE164AR('123')).toBeUndefined();
    expect(aE164AR('+54 11 123')).toBeUndefined();
  });

  it('Las variantes cubren cómo se tipea en la ficha y todas vuelven al mismo número', () => {
    const v = variantesTelefonoAR('+5491122334455');
    for (const esperado of ['+5491122334455', '1122334455', '01122334455', '111522334455', '11 2233-4455', '011 15 2233-4455', '+54 9 11 2233-4455', '22334455']) {
      expect(v).toContain(esperado);
    }
    for (const x of v) {
      expect(aE164AR(x)).toBe('+5491122334455');
    }
  });

  it('Formato para mostrar', () => {
    expect(formatoTelefono('+5491122334455')).toBe('+54 9 11 2233-4455');
    expect(formatoTelefono('+5493515551234')).toBe('+54 9 351 555-1234');
    expect(formatoTelefono('+14155238886')).toBe('+14155238886');
    expect(formatoTelefono(undefined)).toBe('');
  });
});

describe('WhatsApp · webhook de Twilio', () => {
  it('Mensaje entrante (form-urlencoded, como lo manda Twilio)', () => {
    const w = leerWebhookTwilio(
      'MessageSid=SM1&AccountSid=AC1&From=whatsapp%3A%2B5491122334455&To=whatsapp%3A%2B14155238886&Body=Hola%21+&ProfileName=Ana&NumMedia=0&SmsStatus=received&WaId=5491122334455',
    );
    expect(w).toEqual({
      tipo: 'entrante',
      accountSid: 'AC1',
      messageSid: 'SM1',
      desde: '+5491122334455',
      texto: 'Hola!',
      nombrePerfil: 'Ana',
      media: [],
    });
  });

  it('Entrante ya parseado (Medplum convierte el form en objeto), con media y ubicación', () => {
    const w = leerWebhookTwilio({
      MessageSid: 'SM2',
      From: 'whatsapp:+5491122334455',
      Body: '',
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM2/Media/ME1',
      MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM2/Media/ME2',
      MediaContentType1: 'audio/ogg',
      Latitude: '-34.6037',
      Longitude: '-58.3816',
      Label: 'Obelisco',
      SmsStatus: 'received',
    });
    expect(w.tipo).toBe('entrante');
    if (w.tipo !== 'entrante') return;
    expect(w.media.map((m) => m.contentType)).toEqual(['image/jpeg', 'audio/ogg']);
    expect(w.texto).toBe('📍 Obelisco: https://maps.google.com/?q=-34.6037,-58.3816');
  });

  it('Estado de entrega (StatusCallback) y los que no se entienden', () => {
    expect(leerWebhookTwilio({ MessageSid: 'SM3', MessageStatus: 'delivered', AccountSid: 'AC1' })).toEqual({
      tipo: 'estado',
      accountSid: 'AC1',
      messageSid: 'SM3',
      estado: 'entregado',
    });
    expect(leerWebhookTwilio({ MessageSid: 'SM4', MessageStatus: 'undelivered', ErrorCode: '63016' })).toMatchObject({
      tipo: 'estado',
      estado: 'fallido',
      codigoError: '63016',
    });
    expect(leerWebhookTwilio({}).tipo).toBe('desconocido');
    expect(leerWebhookTwilio({ MessageSid: 'SM5', MessageStatus: 'rarísimo' }).tipo).toBe('desconocido');
  });

  it('Los ✓✓ nunca retroceden (Twilio puede mandar el "leído" antes del "entregado") y el fallo queda', () => {
    expect(estadoEntregaDeTwilio('queued')).toBe('en-cola');
    expect(estadoEntregaDeTwilio('read')).toBe('leido');
    expect(combinarEstadoEntrega(undefined, 'enviado')).toBe('enviado');
    expect(combinarEstadoEntrega('leido', 'entregado')).toBe('leido');
    expect(combinarEstadoEntrega('entregado', 'leido')).toBe('leido');
    expect(combinarEstadoEntrega('leido', 'fallido')).toBe('fallido');
  });

  it('Estado fallido: explica el error de Twilio en palabras de Recepción', () => {
    const c: Communication = {
      resourceType: 'Communication',
      status: 'completed',
      extension: [{ url: EXT.estadoEntrega, valueCode: 'enviado' }],
    };
    const fallido = conEstadoEntrega(c, 'fallido', '63016');
    expect(estadoEntregaDe(fallido)).toBe('fallido');
    expect(fallido.extension?.filter((e) => e.url === EXT.estadoEntrega)).toHaveLength(1);
    expect(fallido.statusReason?.text).toMatch(/24 h/);
    expect(explicarErrorTwilio('99999')).toMatch(/twilio\.com\/docs\/api\/errors\/99999/);
    expect(explicarErrorTwilio(undefined)).toBeUndefined();
  });

  it('La media solo se descarga de la API de Twilio (el token no sale a otro host)', () => {
    expect(esMediaDeTwilio('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/SM1/Media/ME1')).toBe(true);
    expect(esMediaDeTwilio('http://api.twilio.com/x')).toBe(false);
    expect(esMediaDeTwilio('https://api.twilio.com.evil.com/x')).toBe(false);
    expect(esMediaDeTwilio('https://evil.com/?u=api.twilio.com')).toBe(false);
    expect(esMediaDeTwilio('no-es-url')).toBe(false);
  });
});

// ─── conversaciones (hilos de Mensajes) ───

const CONV = 'Communication/conv-1';
const ANA = 'Patient/ana';

function delPaciente(id: string, sent: string, porWhatsApp: boolean, extra: Partial<Communication> = {}): Communication {
  return {
    resourceType: 'Communication',
    id,
    status: 'completed',
    partOf: [{ reference: CONV }],
    subject: { reference: ANA },
    sender: { reference: ANA },
    sent,
    payload: [{ contentString: `hola ${id}` }],
    ...(porWhatsApp
      ? {
          extension: [
            { url: EXT.canal, valueCode: 'whatsapp' },
            { url: EXT.telefonoWhatsapp, valueString: '+5491122334455' },
          ],
        }
      : {}),
    ...extra,
  };
}

function deRecepcion(id: string, sent: string): Communication {
  return {
    resourceType: 'Communication',
    id,
    status: 'in-progress',
    partOf: [{ reference: CONV }],
    subject: { reference: ANA },
    sender: { reference: 'Practitioner/recepcion', display: 'Recepción' },
    sent,
    payload: [{ contentString: `respuesta ${id}` }],
  };
}

describe('WhatsApp · el mensaje entra en una conversación de Mensajes', () => {
  it('El entrante es un mensaje de la conversación: sin leer, con canal, MessageSid y número para responder', () => {
    const c = construirMensajeEntrante({
      conversacionRef: CONV,
      pacienteRef: ANA,
      texto: 'Hola',
      adjuntos: [{ contentType: 'image/jpeg', url: 'Binary/b1', title: 'whatsapp-1.jpg' }],
      messageSid: 'SM1',
      telefono: '+5491122334455',
      inicioContacto: true,
      ahora: '2026-09-26T12:00:00Z',
    });
    expect(c).toMatchObject({ status: 'in-progress', partOf: [{ reference: CONV }], sender: { reference: ANA }, subject: { reference: ANA } });
    // Sin categoría: para el portal es un mensaje más de la conversación.
    expect(c.category).toBeUndefined();
    expect(c.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SM1' }]);
    expect(c.payload).toHaveLength(2);
    expect(esWhatsApp(c)).toBe(true);
    expect(esInicioContacto(c)).toBe(true);
    expect(telefonoDe(c)).toBe('+5491122334455');
  });

  it('Un WhatsApp sin texto ni archivo igual se ve', () => {
    const c = construirMensajeEntrante({
      conversacionRef: CONV,
      pacienteRef: ANA,
      texto: '',
      adjuntos: [],
      messageSid: 'SM2',
      telefono: '+5491122334455',
      inicioContacto: false,
      ahora: '2026-09-26T12:00:00Z',
    });
    expect(c.payload).toEqual([{ contentString: MENSAJE_SIN_CONTENIDO }]);
    expect(esInicioContacto(c)).toBe(false);
  });

  it('Sin conversación abierta: una nueva con motivo «Otro motivo» (la ve también el portal)', () => {
    const t = construirConversacionWhatsApp(ANA);
    expect(t).toMatchObject({
      status: 'in-progress',
      subject: { reference: ANA },
      sender: { reference: ANA },
      topic: { coding: [{ system: SYSTEM.motivoMensaje, code: 'otro', display: 'Otro motivo' }], text: 'Otro motivo' },
    });
    expect(t.partOf).toBeUndefined();
    expect(t.identifier).toEqual([{ system: SYSTEM.communication, value: claveConversacionWhatsApp(ANA) }]);
    expect(esWhatsApp(t)).toBe(true);
  });

  it('Entra en la conversación abierta del paciente: no en una cerrada, un mensaje suelto ni una Novedad', () => {
    const abierta = { ...construirConversacionWhatsApp(ANA), id: 'abierta', meta: { lastUpdated: '2026-09-20T10:00:00Z' } };
    const masNueva = { ...abierta, id: 'mas-nueva', meta: { lastUpdated: '2026-09-25T10:00:00Z' } };
    const cerrada = { ...abierta, id: 'cerrada', status: 'completed' as const, meta: { lastUpdated: '2026-09-26T10:00:00Z' } };
    const novedad: Communication = {
      resourceType: 'Communication',
      id: 'novedad',
      status: 'in-progress',
      subject: { reference: ANA },
      topic: { text: 'Aviso' },
      category: [{ coding: [{ system: SYSTEM.notificacion, code: 'general' }] }],
    };
    const aviso: Communication = { resourceType: 'Communication', id: 'aviso', status: 'in-progress', subject: { reference: ANA } };
    expect(esConversacionAbierta(abierta)).toBe(true);
    expect([cerrada, novedad, aviso, delPaciente('m', '', true)].some(esConversacionAbierta)).toBe(false);
    expect(conversacionAbierta([cerrada, novedad, aviso, abierta, masNueva])?.id).toBe('mas-nueva');
    expect(conversacionAbierta([cerrada, novedad])).toBeUndefined();
  });

  it('La respuesta automática la firma el sistema y se ve «🤖 Automática»', () => {
    const r = construirRespuestaAutomatica({ conversacionRef: CONV, pacienteRef: ANA, tipo: 'acuse', texto: 'Recibimos tu mensaje', ahora: '2026-09-26T12:00:01Z' });
    expect(r).toMatchObject({
      status: 'in-progress',
      partOf: [{ reference: CONV }],
      sender: { display: REMITENTE_AUTOMATICO },
      recipient: [{ reference: ANA }],
      payload: [{ contentString: 'Recibimos tu mensaje' }],
    });
    expect(tipoAutomatica(r)).toBe('acuse');
    expect(tipoAutomatica(deRecepcion('x', ''))).toBeUndefined();
  });

  it('Los datos del envío por WhatsApp: canal, número, ✓, MessageSid y el motivo si falló', () => {
    const m = { ...deRecepcion('r1', '2026-09-26T12:00:00Z'), identifier: [{ system: 'otro', value: 'x' }] };
    const enviado = conEnvioWhatsApp(m, { telefono: '+5491122334455', entrega: 'en-cola', messageSids: ['SMa', 'SMb'] });
    expect(esWhatsApp(enviado)).toBe(true);
    expect(estadoEntregaDe(enviado)).toBe('en-cola');
    expect(telefonoDe(enviado)).toBe('+5491122334455');
    expect(enviado.identifier).toEqual([
      { system: 'otro', value: 'x' },
      { system: SYSTEM.twilioMessageSid, value: 'SMa' },
      { system: SYSTEM.twilioMessageSid, value: 'SMb' },
    ]);
    const fallido = conEnvioWhatsApp(enviado, { entrega: 'fallido', messageSids: [], motivo: 'no tiene WhatsApp' });
    expect(fallido.extension?.filter((e) => e.url === EXT.estadoEntrega)).toEqual([{ url: EXT.estadoEntrega, valueCode: 'fallido' }]);
    expect(fallido.statusReason?.text).toBe('no tiene WhatsApp');
  });
});

describe('WhatsApp · ¿la respuesta de Recepción sale también por WhatsApp?', () => {
  const ahora = new Date('2026-09-26T15:00:00Z');
  const haceHoras = (h: number): string => new Date(ahora.getTime() - h * H).toISOString();

  it('Si el último mensaje del paciente llegó por WhatsApp y la ventana sigue abierta: sí, a su número', () => {
    const hilo = [delPaciente('a', haceHoras(3), false), deRecepcion('b', haceHoras(2)), delPaciente('c', haceHoras(1), true)];
    expect(ultimoDelPaciente(hilo)?.id).toBe('c');
    expect(decidirEnvioWhatsApp(hilo, ahora)).toEqual({ enviar: true, telefono: '+5491122334455' });
  });

  it('Si escribió último por el portal: queda solo en el portal (aunque antes haya usado WhatsApp)', () => {
    const hilo = [delPaciente('a', haceHoras(3), true), delPaciente('b', haceHoras(1), false)];
    expect(decidirEnvioWhatsApp(hilo, ahora)).toEqual({ enviar: false, canal: 'portal' });
    expect(decidirEnvioWhatsApp([deRecepcion('r', haceHoras(1))], ahora)).toEqual({ enviar: false, canal: 'portal' });
  });

  it('Pasadas las 24 h: no sale (WhatsApp solo acepta plantillas) y lo explica', () => {
    const r = decidirEnvioWhatsApp([delPaciente('a', haceHoras(25), true)], ahora);
    expect(r).toMatchObject({ enviar: false, canal: 'whatsapp' });
    expect(r.enviar === false && r.canal === 'whatsapp' ? r.motivo : '').toMatch(/24 h/);
  });
});

describe('WhatsApp · campanita: solo números nuevos', () => {
  const nuevo = (id: string, paciente: string, sent: string, status: Communication['status'] = 'in-progress'): Communication => ({
    ...construirMensajeEntrante({
      conversacionRef: `Communication/c-${paciente}`,
      pacienteRef: `Patient/${paciente}`,
      texto: `hola ${id}`,
      adjuntos: [],
      messageSid: `SM-${id}`,
      telefono: '+5491122334455',
      inicioContacto: true,
      ahora: sent,
    }),
    id,
    status,
  });

  it('El primer WhatsApp de cada número nuevo, sin leer, con la conversación a abrir', () => {
    const mensajes = [
      nuevo('a1', 'ana', '2026-09-26T13:00:00Z'),
      nuevo('b1', 'beto', '2026-09-26T14:00:00Z'),
      nuevo('c1', 'caro', '2026-09-26T15:00:00Z', 'completed'), // ya leído
      delPaciente('d1', '2026-09-26T16:00:00Z', true, { status: 'in-progress' }), // conocido: no suena
    ];
    const avisos = avisosInicioContacto(mensajes, new Map([['Patient/ana', 'Ana']]));
    expect(avisos).toEqual([
      { pacienteRef: 'Patient/beto', conversacionId: 'c-beto', nombre: 'Contacto nuevo', telefono: '+5491122334455', texto: 'hola b1', sent: '2026-09-26T14:00:00Z' },
      { pacienteRef: 'Patient/ana', conversacionId: 'c-ana', nombre: 'Ana', telefono: '+5491122334455', texto: 'hola a1', sent: '2026-09-26T13:00:00Z' },
    ]);
  });

  it('Vista previa: el texto o qué adjunto es', () => {
    expect(vistaPrevia(delPaciente('x', '', true, { payload: [{ contentString: 'Hola\n  ¿están?' }] }))).toBe('Hola ¿están?');
    expect(vistaPrevia(delPaciente('y', '', true, { payload: [{ contentAttachment: { contentType: 'audio/ogg' } }] }))).toBe('🎤 Audio');
  });
});

describe('WhatsApp · el número nuevo es un lead', () => {
  it('Lead del CRM con el nombre del perfil como apodo (o el número)', () => {
    const lead = construirLeadWhatsApp('+5491122334455', '  Ana   Pérez ');
    expect(lead.name).toEqual([{ use: 'nickname', text: 'Ana Pérez' }]);
    expect(lead.telecom).toEqual([{ system: 'phone', value: '+5491122334455', use: 'mobile' }]);
    expect(lead.extension).toEqual([
      { url: EXT.origenLead, valueString: 'whatsapp' },
      { url: EXT.cicloVidaCliente, valueCode: 'lead' },
    ]);
    expect(construirLeadWhatsApp('+5491122334455').name?.[0]?.text).toBe('+54 9 11 2233-4455');
    expect(esSinFicha(lead)).toBe(true);
    expect(esSinFicha({ resourceType: 'Patient', name: [{ use: 'official', text: 'Ana Pérez' }, ...lead.name!] })).toBe(false);
  });

  it('Si varios pacientes tienen el número: activo y ya paciente (no lead), el más reciente', () => {
    const lead = { ...construirLeadWhatsApp('+5491122334455'), id: 'lead', meta: { lastUpdated: '2026-09-26T00:00:00Z' } };
    const viejo: Patient = { resourceType: 'Patient', id: 'viejo', meta: { lastUpdated: '2025-01-01T00:00:00Z' } };
    const reciente: Patient = { resourceType: 'Patient', id: 'reciente', meta: { lastUpdated: '2026-01-01T00:00:00Z' } };
    const inactivo: Patient = { resourceType: 'Patient', id: 'inactivo', active: false, meta: { lastUpdated: '2026-09-01T00:00:00Z' } };
    expect(elegirPacientePorTelefono([lead, viejo, inactivo, reciente])?.id).toBe('reciente');
    expect(elegirPacientePorTelefono([lead, inactivo])?.id).toBe('lead');
    expect(elegirPacientePorTelefono([])).toBeUndefined();
  });
});

describe('WhatsApp · textos largos', () => {
  it('Más de 1600 caracteres: en partes que Twilio acepta, sin cortar palabras', () => {
    const parrafo = 'Tomá la medicación con el desayuno. '.repeat(30).trim(); // ~1070 caracteres
    const texto = `${parrafo}\n${parrafo}`;
    const partes = partirTexto(texto);
    expect(partes).toEqual([parrafo, parrafo]);
    expect(partirTexto('x'.repeat(3500)).map((p) => p.length)).toEqual([1600, 1600, 300]);
    expect(partirTexto('  hola  ')).toEqual(['hola']);
    expect(partirTexto('   ')).toEqual([]);
  });
});

describe('WhatsApp · adjuntos', () => {
  it('Tipo y nombre del archivo que se guarda', () => {
    expect(tipoAdjunto('image/jpeg')).toBe('imagen');
    expect(tipoAdjunto('audio/ogg; codecs=opus')).toBe('audio');
    expect(tipoAdjunto('application/pdf')).toBe('documento');
    expect(tipoAdjunto('text/vcard')).toBe('contacto');
    expect(nombreAdjunto('audio/ogg; codecs=opus', 0)).toBe('whatsapp-1.ogg');
    expect(nombreAdjunto('application/x-raro', 2)).toBe('whatsapp-3.bin');
  });
});

describe('WhatsApp · fechas e iniciales (hora de Argentina)', () => {
  const ahora = new Date('2026-09-26T15:00:00Z'); // sábado 12:00 en Argentina

  it('Hora de la lista de chats y separadores de día', () => {
    expect(fechaCorta('2026-09-26T13:30:00Z', ahora)).toBe('10:30');
    expect(fechaCorta('2026-09-25T13:30:00Z', ahora)).toBe('Ayer');
    expect(fechaCorta('2026-09-23T13:30:00Z', ahora)).toBe('miércoles');
    expect(fechaCorta('2026-09-10T13:30:00Z', ahora)).toBe('10/09/26');
    expect(etiquetaDia('2026-09-26T03:30:00Z', ahora)).toBe('Hoy'); // 00:30 del sábado en Argentina
    expect(etiquetaDia('2026-09-26T02:30:00Z', ahora)).toBe('Ayer'); // 23:30 del viernes en Argentina
  });

  it('Hace cuánto (campanita)', () => {
    expect(haceCuanto('2026-09-26T14:59:40Z', ahora)).toBe('recién');
    expect(haceCuanto('2026-09-26T14:55:00Z', ahora)).toBe('hace 5 min');
    expect(haceCuanto('2026-09-26T12:00:00Z', ahora)).toBe('hace 3 h');
  });

  it('Iniciales del avatar (un contacto sin nombre muestra un ícono)', () => {
    expect(iniciales('María González')).toBe('MG');
    expect(iniciales('Carla ✨')).toBe('C');
    expect(iniciales('+54 9 11 2233-4455')).toBe('');
    expect(esSoloNumero('+54 9 11 2233-4455')).toBe(true);
    expect(esSoloNumero('Ana')).toBe(false);
  });
});
