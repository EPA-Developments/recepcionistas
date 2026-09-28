import { describe, it, expect } from 'vitest';
import type { Communication, Patient } from '@medplum/fhirtypes';
import { TEXTO_ACUSE } from '../src/config/auto-respuesta.js';
import { RUTA_WEBHOOK_TWILIO } from '../src/config/urls.js';
import { construirAvisoContacto, resolverAviso } from '../src/lib/contactos-whatsapp.js';
import {
  alertasRelevantes,
  entrantesEnOtroPaciente,
  entrantesSinRegistrar,
  explicarAlertaTwilio,
  lineaMensajeTwilio,
  mismoRemitente,
  pasosSeguimiento,
  revisarRuteoEntrante,
  rutaDeUrl,
  textoVentana,
  ubicacionesPorSid,
  type EstadoPaso,
  type SenderTwilio,
  type ServicioTwilio,
} from '../src/lib/seguimiento-whatsapp.js';
import {
  conEnvioWhatsApp,
  conEstadoEntrega,
  construirLeadWhatsApp,
  construirMensajeEntrante,
  construirRespuestaAutomatica,
} from '../src/lib/whatsapp.js';

const TEL = '+5491122334455';
const PAC = 'Patient/ana';
const CONV = 'Communication/conv-ana';
const LLEGO = '2026-09-28T13:00:00.000Z'; // lunes 10:00 en Argentina
const AHORA = new Date('2026-09-28T13:10:00.000Z');

const lead: Patient = { ...construirLeadWhatsApp(TEL, 'Ana'), id: 'ana' };
const conFicha: Patient = { ...lead, name: [{ given: ['Ana'], family: 'Pérez' }] };

function entrante(sid = 'SMin1', sent = LLEGO, inicioContacto = true): Communication {
  return {
    ...construirMensajeEntrante({
      conversacionRef: CONV,
      pacienteRef: PAC,
      texto: 'Hola, quiero un turno',
      adjuntos: [],
      messageSid: sid,
      telefono: TEL,
      inicioContacto,
      ahora: sent,
    }),
    id: sid,
  };
}

function acuse(entrega: 'enviado' | 'entregado' | 'leido' | 'fallido' = 'entregado'): Communication {
  const base = construirRespuestaAutomatica({
    conversacionRef: CONV,
    pacienteRef: PAC,
    tipo: 'acuse',
    texto: TEXTO_ACUSE,
    ahora: '2026-09-28T13:00:01.000Z',
  });
  return { ...conEnvioWhatsApp(base, { telefono: TEL, entrega, messageSids: ['SMacuse'] }), id: 'acuse' };
}

function respuesta(p: { whatsapp?: boolean; entrega?: 'enviado' | 'entregado' | 'leido'; codigoError?: string } = {}): Communication {
  const base: Communication = {
    resourceType: 'Communication',
    id: 'resp',
    status: 'completed',
    partOf: [{ reference: CONV }],
    subject: { reference: PAC },
    sender: { reference: 'Practitioner/recepcion' },
    sent: '2026-09-28T13:05:00.000Z',
    payload: [{ contentString: '¡Hola Ana! ¿Para qué especialidad?' }],
  };
  if (p.whatsapp === false) {
    return base;
  }
  const enviado = conEnvioWhatsApp(base, { telefono: TEL, entrega: 'enviado', messageSids: ['SMresp'] });
  if (p.codigoError) {
    return conEstadoEntrega(enviado, 'fallido', p.codigoError);
  }
  return p.entrega ? conEstadoEntrega(enviado, p.entrega) : enviado;
}

const aviso = {
  ...construirAvisoContacto({ pacienteRef: PAC, conversacionRef: CONV, telefono: TEL, perfil: 'Ana', texto: 'Hola', ahora: LLEGO }),
  id: 'aviso-ana',
};

function estados(pasos: ReturnType<typeof pasosSeguimiento>): EstadoPaso[] {
  return pasos.map((p) => p.estado);
}

describe('pasosSeguimiento: el paso a paso de la prueba de WhatsApp', () => {
  it('un número que no está en SOM: todo pendiente, empezando por escribir', () => {
    const pasos = pasosSeguimiento({ mensajes: [], ahora: AHORA });
    expect(estados(pasos)).toEqual(['pendiente', 'pendiente', 'pendiente', 'pendiente', 'pendiente', 'pendiente']);
    expect(pasos[0]!.detalle).toContain('Escribí desde el celular');
  });

  it('número nuevo que escribió: lead, aviso pendiente y acuse entregado; falta responder y la ficha', () => {
    const pasos = pasosSeguimiento({ paciente: lead, aviso, mensajes: [acuse(), entrante()], ahora: AHORA });
    expect(estados(pasos)).toEqual(['ok', 'ok', 'ok', 'ok', 'pendiente', 'pendiente']);
    expect(pasos[0]!.detalle).toContain('«Hola, quiero un turno»');
    expect(pasos[1]!.detalle).toContain('Lead nuevo');
    expect(pasos[2]!.detalle).toContain('campanita');
    expect(pasos[3]!.detalle).toContain('Acuse');
    expect(pasos[3]!.detalle).toContain('✓✓ entregado');
  });

  it('número nuevo sin aviso a Recepción: falla (el bot tenía que dejarlo)', () => {
    const pasos = pasosSeguimiento({ paciente: lead, mensajes: [entrante(), acuse()], ahora: AHORA });
    expect(pasos[2]!.estado).toBe('falla');
  });

  it('el WhatsApp abrió la conversación y no salió el acuse: falla', () => {
    const pasos = pasosSeguimiento({ paciente: lead, aviso, mensajes: [entrante()], ahora: AHORA });
    expect(pasos[3]!.estado).toBe('falla');
  });

  it('acuse que Twilio no entregó: falla con el motivo', () => {
    const fallido = conEstadoEntrega(acuse('enviado'), 'fallido', '63016');
    const pasos = pasosSeguimiento({ paciente: lead, aviso, mensajes: [entrante(), fallido], ahora: AHORA });
    expect(pasos[3]!.estado).toBe('falla');
    expect(pasos[3]!.detalle).toContain('63016');
  });

  it('acuse con solo ✓ (enviado): pendiente, esperando los ✓✓', () => {
    const pasos = pasosSeguimiento({ paciente: lead, aviso, mensajes: [entrante(), acuse('enviado')], ahora: AHORA });
    expect(pasos[3]!.estado).toBe('pendiente');
    expect(pasos[3]!.detalle).toContain('esperando los ✓✓');
  });

  it('respuesta de Recepción leída y ficha completa con el aviso resuelto: todo ✓', () => {
    const resuelto = resolverAviso(aviso, { como: 'ficha-completada', ahora: '2026-09-28T13:08:00.000Z' });
    const pasos = pasosSeguimiento({
      paciente: conFicha,
      aviso: resuelto,
      mensajes: [entrante(), acuse(), respuesta({ entrega: 'leido' })],
      ahora: AHORA,
    });
    expect(estados(pasos)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(pasos[2]!.detalle).toContain('Resuelto: Ficha completada');
    expect(pasos[4]!.detalle).toContain('✓✓ leído');
  });

  it('respuesta de Recepción que quedó solo en el portal: falla', () => {
    const pasos = pasosSeguimiento({ paciente: lead, aviso, mensajes: [entrante(), acuse(), respuesta({ whatsapp: false })], ahora: AHORA });
    expect(pasos[4]!.estado).toBe('falla');
    expect(pasos[4]!.detalle).toContain('solo en el portal');
  });

  it('respuesta de Recepción rechazada por Twilio: falla con el error explicado', () => {
    const pasos = pasosSeguimiento({ paciente: lead, aviso, mensajes: [entrante(), acuse(), respuesta({ codigoError: '63016' })], ahora: AHORA });
    expect(pasos[4]!.estado).toBe('falla');
    expect(pasos[4]!.detalle).toContain('24 h');
  });

  it('ficha completa pero el aviso sigue pendiente: falla', () => {
    const pasos = pasosSeguimiento({ paciente: conFicha, aviso, mensajes: [entrante(), acuse()], ahora: AHORA });
    expect(pasos[5]!.estado).toBe('falla');
  });

  it('un paciente que ya estaba en SOM: sin aviso ni ficha que completar (no aplica)', () => {
    const existente: Patient = { resourceType: 'Patient', id: 'ana', name: [{ given: ['Ana'], family: 'Pérez' }] };
    const pasos = pasosSeguimiento({
      paciente: existente,
      mensajes: [entrante('SMin1', LLEGO, false), acuse()],
      ahora: AHORA,
    });
    expect(estados(pasos)).toEqual(['ok', 'ok', 'no-aplica', 'ok', 'pendiente', 'no-aplica']);
    expect(pasos[1]!.detalle).toContain('usá un celular que no esté en SOM');
  });
});

describe('textoVentana', () => {
  it('abierta con lo que queda; cerrada sin mensajes o pasadas 24 h', () => {
    expect(textoVentana([entrante()], AHORA)).toContain('quedan 23 h 50 min');
    expect(textoVentana([], AHORA)).toContain('63016');
    expect(textoVentana([entrante()], new Date('2026-09-29T14:00:00.000Z'))).toContain('cerrada');
  });
});

describe('cruce con Twilio', () => {
  const ubicaciones = ubicacionesPorSid([entrante(), acuse(), respuesta({ entrega: 'entregado' })]);

  it('dónde registró SOM cada MessageSid (entrantes y salientes)', () => {
    expect([...ubicaciones.keys()].sort()).toEqual(['SMacuse', 'SMin1', 'SMresp']);
    expect(ubicaciones.get('SMin1')).toBe(PAC);
  });

  it('un entrante que Twilio recibió y SOM no: el webhook no llegó', () => {
    const twilio = [
      { sid: 'SMin1', direction: 'inbound', status: 'received' },
      { sid: 'SMin2', direction: 'inbound', status: 'received' },
      { sid: 'SMaviso', direction: 'outbound-api', status: 'failed', error_code: 63016 },
    ];
    expect(entrantesSinRegistrar(twilio, ubicaciones).map((m) => m.sid)).toEqual(['SMin2']);
    expect(lineaMensajeTwilio(twilio[1]!, ubicaciones, PAC, AHORA)).toContain('NO llegó a SOM');
    const saliente = lineaMensajeTwilio(twilio[2]!, ubicaciones, PAC, AHORA);
    expect(saliente).toContain('24 h');
    expect(saliente).toContain('sin registro en SOM');
  });

  it('un entrante que quedó en otro paciente con el mismo número: está en SOM, y dice en cuál', () => {
    const enOtro = ubicacionesPorSid([{ ...entrante('SMotro'), subject: { reference: 'Patient/prueba-mp' } }, entrante()]);
    const twilio = [
      { sid: 'SMotro', direction: 'inbound', status: 'received' },
      { sid: 'SMin1', direction: 'inbound', status: 'received' },
    ];
    expect(entrantesSinRegistrar(twilio, enOtro)).toEqual([]);
    expect(lineaMensajeTwilio(twilio[0]!, enOtro, PAC, AHORA)).toContain('en Patient/prueba-mp, otro paciente');
    expect(lineaMensajeTwilio(twilio[1]!, enOtro, PAC, AHORA)).toMatch(/en SOM ✓$/);
    expect([...entrantesEnOtroPaciente(twilio, enOtro, PAC)]).toEqual([['Patient/prueba-mp', 1]]);
  });

  it('fechas de Twilio en RFC 2822 (y sin fecha no revienta)', () => {
    const linea = lineaMensajeTwilio(
      { sid: 'SMin1', direction: 'inbound', status: 'received', date_created: 'Mon, 28 Sep 2026 13:00:00 +0000' },
      ubicaciones,
      PAC,
      AHORA,
    );
    expect(linea).toContain('hoy 10:00');
    expect(linea).toContain('en SOM ✓');
    expect(lineaMensajeTwilio({ sid: 'SMx', direction: 'inbound', date_created: 'no es fecha' }, ubicaciones, PAC, AHORA)).toContain(
      '¿cuándo?',
    );
  });

  it('alertas: solo las del webhook de SOM o de los mensajes del celular', () => {
    const alertas = [
      { sid: 'NO1', error_code: '11200', request_url: `https://api.medplum.com.ar${RUTA_WEBHOOK_TWILIO}` },
      { sid: 'NO2', error_code: '63016', resource_sid: 'SMaviso' },
      { sid: 'NO3', error_code: '11200', request_url: 'https://otro.example.com/voz' },
    ];
    expect(alertasRelevantes(alertas, new Set(['SMaviso']), RUTA_WEBHOOK_TWILIO).map((a) => a.sid)).toEqual(['NO1', 'NO2']);
    expect(explicarAlertaTwilio('11200')).toContain('npm run webhooks');
    expect(explicarAlertaTwilio(12300)).toContain('inofensiva');
    expect(explicarAlertaTwilio('63016')).toContain('24 h');
  });

  it('de una URL solo se muestra la ruta (nunca usuario ni clave)', () => {
    expect(rutaDeUrl('https://id:clave@api.medplum.com.ar/fhir/R4/Bot/x/$execute')).toBe('/fhir/R4/Bot/x/$execute');
    expect(rutaDeUrl('no es url')).toBeUndefined();
    expect(rutaDeUrl(undefined)).toBeUndefined();
  });
});

describe('revisarRuteoEntrante: paso 1, a dónde manda Twilio los mensajes que llegan', () => {
  const URL_SOM = `https://api.medplum.com.ar${RUTA_WEBHOOK_TWILIO}`;
  const FROM = 'whatsapp:+5491155556666';
  function sender(webhook: SenderTwilio['webhook'], status = 'ONLINE'): SenderTwilio {
    return { sid: 'XE1', sender_id: 'whatsapp:+5491155556666', status, webhook };
  }
  function servicio(extra: Partial<ServicioTwilio>): ServicioTwilio {
    return { sid: 'MG1', friendly_name: 'SOM', remitentes: [FROM], ...extra };
  }
  function revisar(senders: SenderTwilio[], servicios: ServicioTwilio[] = [], from: string | undefined = FROM) {
    return revisarRuteoEntrante({ from, urlEsperada: URL_SOM, senders, servicios });
  }

  it('el número manda a la URL pública de SOM por POST: todo ✓', () => {
    const h = revisar([sender({ callback_url: URL_SOM, callback_method: 'POST' })]);
    expect(h.map((x) => x.estado)).toEqual(['ok', 'ok']);
    expect(h[1]!.texto).toContain('Webhook URL for incoming messages');
  });

  it('sin URL, otra URL o GET: falla y dice cuál poner', () => {
    expect(revisar([sender({})])[1]).toMatchObject({ estado: 'falla' });
    expect(revisar([sender({})])[1]!.texto).toContain(URL_SOM);
    const otra = revisar([sender({ callback_url: 'https://demo.twilio.com/welcome/sms/', callback_method: 'POST' })])[1]!;
    expect(otra.estado).toBe('falla');
    expect(otra.texto).toContain('demo.twilio.com');
    expect(revisar([sender({ callback_url: URL_SOM, callback_method: 'GET' })])[1]!.texto).toContain('POST');
  });

  it('casi igual (barra final): falla porque la firma no validaría', () => {
    const h = revisar([sender({ callback_url: `${URL_SOM}/`, callback_method: 'POST' })])[1]!;
    expect(h.estado).toBe('falla');
    expect(h.texto).toContain('EXACTAMENTE');
  });

  it('una URL con clave se muestra sin la clave', () => {
    const h = revisar([sender({ callback_url: 'https://id:secreto@api.medplum.com.ar/fhir/R4/Bot/x/$execute' })])[1]!;
    expect(h.texto).not.toContain('secreto');
  });

  it('el sender que no está ONLINE: falla', () => {
    expect(revisar([sender({ callback_url: URL_SOM }, 'OFFLINE')])[0]!.estado).toBe('falla');
    expect(revisar([sender({ callback_url: URL_SOM }, 'ONLINE:UPDATING')])[0]!.estado).toBe('ok');
  });

  it('un Messaging Service con "Send a webhook" manda sobre el número', () => {
    const bien = revisar(
      [sender({ callback_url: 'https://otra.example.com' })],
      [servicio({ inbound_request_url: URL_SOM, inbound_method: 'POST' })],
    );
    expect(bien[1]).toMatchObject({ estado: 'ok' });
    expect(bien[1]!.texto).toContain('Messaging Service «SOM»');
    const mal = revisar([sender({ callback_url: URL_SOM })], [servicio({ inbound_request_url: 'https://otra.example.com/in' })]);
    expect(mal[1]!.estado).toBe('falla');
  });

  it('un Messaging Service que no reenvía (sin webhook ni "Defer"): falla', () => {
    const h = revisar([sender({ callback_url: URL_SOM })], [servicio({ inbound_request_url: null })]);
    expect(h[1]!.estado).toBe('falla');
    expect(h[1]!.texto).toContain("Defer to sender's webhook");
  });

  it('un Messaging Service que cede el webhook al número ("Defer"): vale la del número', () => {
    const h = revisar(
      [sender({ callback_url: URL_SOM, callback_method: 'POST' })],
      [servicio({ use_inbound_webhook_on_number: true, inbound_request_url: 'https://otra.example.com' })],
    );
    expect(h[1]).toMatchObject({ estado: 'ok' });
  });

  it('sin FROM, con un FROM que no está en la cuenta, o el sandbox', () => {
    expect(revisar([], [], undefined)[0]!.estado).toBe('falla');
    const ajeno = revisar([sender({ callback_url: URL_SOM })], [], 'whatsapp:+5491100000000')[0]!;
    expect(ajeno.estado).toBe('falla');
    expect(ajeno.texto).toContain('TWILIO_WHATSAPP_FROM');
    expect(revisar([], [], 'whatsapp:+14155238886')[0]!.texto).toContain('Sandbox settings');
  });

  it('un Status callback del número a otro lado no molesta', () => {
    const h = revisar([sender({ callback_url: URL_SOM, callback_method: 'POST', status_callback_url: 'https://otra.example.com/st' })]);
    expect(h.map((x) => x.estado)).toEqual(['ok', 'ok', 'ok']);
  });

  it('mismoRemitente: con o sin "whatsapp:", espacios o guiones', () => {
    expect(mismoRemitente('whatsapp:+54 9 11 5555-6666', '+5491155556666')).toBe(true);
    expect(mismoRemitente('whatsapp:+5491155556666', 'whatsapp:+5491155556667')).toBe(false);
    expect(mismoRemitente(undefined, '')).toBe(false);
  });
});
