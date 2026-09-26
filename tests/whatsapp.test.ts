import { describe, it, expect } from 'vitest';
import type { Communication, Patient } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import {
  aE164AR,
  avisosInicioContacto,
  CATEGORIA_WHATSAPP,
  cierreVentana,
  combinarEstadoEntrega,
  conEstadoEntrega,
  construirLeadWhatsApp,
  construirMensajeEntrante,
  contarNoLeidos,
  elegirPacientePorTelefono,
  esInicioDeContacto,
  esMediaDeTwilio,
  esSeguroParaVer,
  esSinFicha,
  esSoloNumero,
  estadoEntregaDe,
  estadoEntregaDeTwilio,
  estadoVisible,
  ETIQUETA_RESERVADO,
  etiquetaDia,
  explicarErrorTwilio,
  fechaCorta,
  formatoTelefono,
  haceCuanto,
  iniciales,
  leerWebhookTwilio,
  nombreAdjunto,
  resumirChats,
  TEXTO_RESERVADO,
  tipoAdjunto,
  ultimaActividad,
  ultimoEntrante,
  variantesTelefonoAR,
  ventanaWhatsApp,
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

describe('WhatsApp · ventana de 24 h e inicio de contacto', () => {
  const ahora = new Date('2026-09-26T15:00:00Z');

  it('Se responde texto libre solo dentro de las 24 h del último mensaje del paciente', () => {
    expect(ventanaWhatsApp(undefined, ahora)).toEqual({ abierta: false });
    expect(ventanaWhatsApp(new Date(ahora.getTime() - 23 * H).toISOString(), ahora).abierta).toBe(true);
    const cerrada = ventanaWhatsApp(new Date(ahora.getTime() - 24 * H).toISOString(), ahora);
    expect(cerrada.abierta).toBe(false);
    expect(cerrada.cierra).toBe(ahora.toISOString());
  });

  it('Abre conversación (campanita) si no hubo ningún WhatsApp con él en 24 h', () => {
    expect(esInicioDeContacto(undefined, ahora)).toBe(true);
    expect(esInicioDeContacto(new Date(ahora.getTime() - 2 * H).toISOString(), ahora)).toBe(false);
    expect(esInicioDeContacto(new Date(ahora.getTime() - 24 * H).toISOString(), ahora)).toBe(true);
  });

  it('Cuándo cierra, en palabras: hoy o mañana (hora de Argentina)', () => {
    // 15:00Z = 12:00 en Argentina.
    expect(cierreVentana('2026-09-26T20:40:00Z', ahora)).toBe('hoy a las 17:40');
    expect(cierreVentana('2026-09-27T12:15:00Z', ahora)).toBe('mañana a las 09:15');
  });
});

// ─── mensajes y chats ───

function entrante(id: string, paciente: string, sent: string, extra: Partial<Communication> = {}): Communication {
  return {
    ...construirMensajeEntrante({
      pacienteRef: paciente,
      texto: `hola ${id}`,
      adjuntos: [],
      messageSid: `SM-${id}`,
      telefono: '+5491122334455',
      inicioContacto: false,
      ahora: sent,
    }),
    id,
    ...extra,
  };
}

function saliente(id: string, paciente: string, sent: string, extra: Partial<Communication> = {}): Communication {
  return {
    resourceType: 'Communication',
    id,
    status: 'completed',
    category: [CATEGORIA_WHATSAPP],
    subject: { reference: paciente },
    recipient: [{ reference: paciente }],
    sent,
    payload: [{ contentString: `respuesta ${id}` }],
    extension: [{ url: EXT.canal, valueCode: 'whatsapp' }],
    ...extra,
  };
}

const INICIO = { url: EXT.inicioContacto, valueBoolean: true };

describe('WhatsApp · mensaje entrante y lead', () => {
  it('El entrante queda sin leer, con canal, MessageSid y número para responder', () => {
    const c = construirMensajeEntrante({
      pacienteRef: 'Patient/p1',
      texto: 'Hola',
      adjuntos: [{ contentType: 'image/jpeg', url: 'Binary/b1', title: 'whatsapp-1.jpg' }],
      messageSid: 'SM1',
      telefono: '+5491122334455',
      inicioContacto: true,
      ahora: '2026-09-26T12:00:00Z',
    });
    expect(c.status).toBe('in-progress');
    expect(c.sender?.reference).toBe('Patient/p1');
    expect(c.category?.[0]?.coding?.[0]).toMatchObject({ system: SYSTEM.canal, code: 'whatsapp' });
    expect(c.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SM1' }]);
    expect(c.payload).toHaveLength(2);
    expect(c.extension).toEqual(
      expect.arrayContaining([
        { url: EXT.telefonoWhatsapp, valueString: '+5491122334455' },
        { url: EXT.inicioContacto, valueBoolean: true },
      ]),
    );
  });

  it('Un número nuevo es un lead del CRM con el nombre del perfil como apodo (o el número)', () => {
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
    const nuevo: Patient = { resourceType: 'Patient', id: 'nuevo', meta: { lastUpdated: '2026-01-01T00:00:00Z' } };
    const inactivo: Patient = { resourceType: 'Patient', id: 'inactivo', active: false, meta: { lastUpdated: '2026-09-01T00:00:00Z' } };
    expect(elegirPacientePorTelefono([lead, viejo, inactivo, nuevo])?.id).toBe('nuevo');
    expect(elegirPacientePorTelefono([lead, inactivo])?.id).toBe('lead');
    expect(elegirPacientePorTelefono([])).toBeUndefined();
  });
});

describe('WhatsApp · chats de Recepción y campanita', () => {
  const mensajes: Communication[] = [
    // Ana: escribió por primera vez (inicio de contacto), nadie le respondió.
    entrante('a1', 'Patient/ana', '2026-09-26T13:00:00Z', { extension: [...entrante('x', 'Patient/ana', '').extension!, INICIO] }),
    entrante('a2', 'Patient/ana', '2026-09-26T13:01:00Z'),
    // Beto: inicio de contacto ya respondido; un mensaje leído.
    entrante('b1', 'Patient/beto', '2026-09-26T10:00:00Z', { status: 'completed', extension: [...entrante('x', 'Patient/beto', '').extension!, INICIO] }),
    saliente('b2', 'Patient/beto', '2026-09-26T10:05:00Z', { extension: [{ url: EXT.canal, valueCode: 'whatsapp' }, { url: EXT.estadoEntrega, valueCode: 'leido' }] }),
    // Caro: solo un recordatorio automático.
    saliente('c1', 'Patient/caro', '2026-09-25T09:00:00Z'),
    // Aviso a Recepción (sin paciente): no es un chat.
    { resourceType: 'Communication', id: 'r1', status: 'completed', category: [CATEGORIA_WHATSAPP], sent: '2026-09-26T14:00:00Z' },
  ];
  const nombres = new Map([
    ['Patient/ana', 'Ana'],
    ['Patient/beto', 'Beto'],
  ]);

  it('Un chat por paciente, del más activo al menos, con no leídos y contactos nuevos', () => {
    const chats = resumirChats(mensajes, nombres);
    expect(chats.map((c) => c.pacienteRef)).toEqual(['Patient/ana', 'Patient/beto', 'Patient/caro']);
    const [ana, beto, caro] = chats;
    expect(ana).toMatchObject({ nombre: 'Ana', sinLeer: 2, nuevoContacto: true, ultimoEntrante: '2026-09-26T13:01:00Z' });
    expect(ana!.ultimo.id).toBe('a2');
    expect(beto).toMatchObject({ sinLeer: 0, nuevoContacto: false });
    expect(caro).toMatchObject({ nombre: 'Paciente', sinLeer: 0, nuevoContacto: false, ultimoEntrante: undefined });
    expect(contarNoLeidos(mensajes)).toBe(2);
  });

  it('La campanita: inicios de contacto sin leer, uno por paciente', () => {
    const avisos = avisosInicioContacto(mensajes, nombres);
    expect(avisos).toEqual([
      { pacienteRef: 'Patient/ana', nombre: 'Ana', telefono: '+5491122334455', texto: 'hola a1', sent: '2026-09-26T13:00:00Z' },
    ]);
    // Leído el chat, se apaga.
    const leidos = mensajes.map((m) => (m.status === 'in-progress' ? { ...m, status: 'completed' as const } : m));
    expect(avisosInicioContacto(leidos, nombres)).toEqual([]);
  });

  it('Último entrante y última actividad', () => {
    const deAna = mensajes.filter((m) => m.subject?.reference === 'Patient/ana');
    expect(ultimoEntrante(deAna)?.id).toBe('a2');
    expect(ultimaActividad(mensajes)).toBe('2026-09-26T14:00:00Z');
    expect(ultimoEntrante([saliente('s', 'Patient/x', '2026-09-26T10:00:00Z')])).toBeUndefined();
  });

  it('Un aviso con información clínica nunca muestra el contenido en Recepción', () => {
    const reservado = saliente('i1', 'Patient/ana', '2026-09-26T10:00:00Z', {
      meta: { security: [ETIQUETA_RESERVADO] },
      payload: [{ contentString: 'Resumen: LDL 190 mg/dL…' }],
    });
    expect(vistaPrevia(reservado)).toBe(TEXTO_RESERVADO);
    expect(vistaPrevia(reservado)).not.toMatch(/LDL/);
  });

  it('Vista previa de un adjunto sin texto', () => {
    const foto = entrante('f1', 'Patient/ana', '2026-09-26T10:00:00Z', {
      payload: [{ contentAttachment: { contentType: 'image/jpeg', url: 'Binary/b1' } }],
    });
    expect(vistaPrevia(foto)).toBe('📷 Foto');
  });

  it('Los ✓✓ que se ven: no salió (faltan secrets), falló, o el estado de entrega', () => {
    expect(estadoVisible(saliente('s1', 'Patient/x', '', { status: 'preparation' }))).toBe('no-enviado');
    expect(estadoVisible(saliente('s2', 'Patient/x', '', { status: 'entered-in-error' }))).toBe('fallido');
    expect(estadoVisible(saliente('s3', 'Patient/x', ''))).toBe('enviado');
    expect(
      estadoVisible(saliente('s4', 'Patient/x', '', { extension: [{ url: EXT.estadoEntrega, valueCode: 'leido' }] })),
    ).toBe('leido');
  });
});

describe('WhatsApp · adjuntos', () => {
  it('Tipo, nombre del archivo y qué se puede abrir en el navegador', () => {
    expect(tipoAdjunto('image/jpeg')).toBe('imagen');
    expect(tipoAdjunto('audio/ogg; codecs=opus')).toBe('audio');
    expect(tipoAdjunto('application/pdf')).toBe('documento');
    expect(tipoAdjunto('text/vcard')).toBe('contacto');
    expect(nombreAdjunto('audio/ogg; codecs=opus', 0)).toBe('whatsapp-1.ogg');
    expect(nombreAdjunto('application/x-raro', 2)).toBe('whatsapp-3.bin');
    expect(esSeguroParaVer('image/jpeg')).toBe(true);
    expect(esSeguroParaVer('application/pdf')).toBe(true);
    expect(esSeguroParaVer('audio/ogg; codecs=opus')).toBe(true);
    // Un SVG o un HTML pueden traer código: se descargan, no se abren.
    expect(esSeguroParaVer('image/svg+xml')).toBe(false);
    expect(esSeguroParaVer('text/html')).toBe(false);
    expect(esSeguroParaVer(undefined)).toBe(false);
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
