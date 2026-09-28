import { describe, it, expect } from 'vitest';
import { PLANTILLA_AVISO, PLANTILLAS_WHATSAPP, type PlantillaWhatsApp } from '../src/config/plantillas-whatsapp.js';
import { TEXTO_ACUSE, TEXTO_MENSAJE_NUEVO, textoFueraDeHorario } from '../src/config/auto-respuesta.js';
import {
  alertaRecepcionSinLink,
  avisoConfirmacion,
  avisoConsultaPlan,
  avisoRecordatorio,
  avisoReserva,
  avisoReservaPortal,
  avisoReservaVencida,
} from '../src/lib/avisos.js';
import { mensajeInvitacion } from '../src/lib/onboarding.js';
import {
  contenidoTwilio,
  elegirPlantilla,
  paramsPlantilla,
  plantillasDeAviso,
  problemasPlantilla,
  textoPlantilla,
  variablesAviso,
  variablesDe,
  variablesSegunPlantilla,
} from '../src/lib/plantillas-whatsapp.js';

const LUNES_10 = new Date('2026-09-28T10:00:00-03:00');
const EXPIRA = new Date('2026-09-27T12:30:00-03:00');
const SALA = 'https://meet.example/sala';
const LINK_PAGO = 'https://mpago.la/abc';
const LINK_ACCESO = 'https://app.segundaopinionmedica.org/setpassword/abc/def';
const PORTAL = 'https://app.segundaopinionmedica.org';
const VENTANA = { desde: '2026-10-25', hasta: '2026-11-05' };
const HORARIO = 'lunes a viernes de 8 a 22 y sábados de 8 a 20';

/** Los secrets de los bots: todas aprobadas / solo la genérica / ninguna. */
const todasAprobadas = (secret: string): string => `HX_${secret}`;
const soloGenerica = (secret: string): string | undefined => (secret === PLANTILLA_AVISO.secret ? 'HXaviso' : undefined);
const ninguna = (): undefined => undefined;

/** Cada aviso que mandan los bots, en todas sus variantes, con la clave `template` con que sale. */
const AVISOS: Array<[clave: string, texto: string]> = [
  ['turno-confirmado', avisoConfirmacion({ descripcion: 'Consulta de Cardiología, lunes 28/09 a las 10:00', senaARS: 75000 })],
  [
    'turno-confirmado',
    avisoConfirmacion({ descripcion: 'Teleconsulta de Cardiología, lunes 28/09 a las 10:00', senaARS: 75000, modalidad: 'teleconsulta', teleconsultaUrl: SALA }),
  ],
  ['turno-confirmado', avisoConfirmacion({ descripcion: 'Teleconsulta de Cardiología', senaARS: 75000, modalidad: 'teleconsulta' })],
  ['recordatorio-48h', avisoRecordatorio({ tipo: '48h', descripcion: 'Consulta de Cardiología', inicio: LUNES_10 })],
  ['recordatorio-48h', avisoRecordatorio({ tipo: '48h', descripcion: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta', teleconsultaUrl: SALA })],
  ['recordatorio-48h', avisoRecordatorio({ tipo: '48h', descripcion: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta' })],
  ['recordatorio-2h', avisoRecordatorio({ tipo: '2h', descripcion: 'Consulta de Cardiología', inicio: LUNES_10 })],
  ['recordatorio-2h', avisoRecordatorio({ tipo: '2h', descripcion: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta', teleconsultaUrl: SALA })],
  ['recordatorio-2h', avisoRecordatorio({ tipo: '2h', descripcion: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta' })],
  ['reserva-tentativa', avisoReserva({ nombre: 'Consulta de Cardiología', inicio: LUNES_10, modalidad: 'presencial' })],
  ['reserva-tentativa', avisoReserva({ nombre: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta' })],
  ['reserva-tentativa', avisoReserva({ nombre: 'Consulta de Cardiología', inicio: LUNES_10, modalidad: 'presencial', traerLaboratorio: true })],
  ['reserva-tentativa', avisoReserva({ nombre: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta', traerLaboratorio: true })],
  ['consulta-plan-confirmada', avisoReserva({ nombre: 'Consulta del Plan Bienestar 100 Días (día 30)', inicio: LUNES_10, modalidad: 'presencial', incluida: true })],
  [
    'consulta-plan-confirmada',
    avisoReserva({ nombre: 'Teleconsulta del Plan Bienestar 100 Días (día 30)', inicio: LUNES_10, modalidad: 'teleconsulta', incluida: true, teleconsultaUrl: SALA }),
  ],
  ['consulta-plan-confirmada', avisoReserva({ nombre: 'Teleconsulta del Plan Bienestar 100 Días (día 30)', inicio: LUNES_10, modalidad: 'teleconsulta', incluida: true })],
  [
    'consulta-plan-confirmada',
    avisoReserva({ nombre: 'Consulta del Plan Bienestar 100 Días (día 60)', inicio: LUNES_10, modalidad: 'presencial', incluida: true, traerLaboratorio: true }),
  ],
  ['reserva-portal-sena', avisoReservaPortal({ nombre: 'Consulta de Cardiología', inicio: LUNES_10, modalidad: 'presencial', senaARS: 75000, linkPago: LINK_PAGO, expira: EXPIRA })],
  ['reserva-portal-sena', avisoReservaPortal({ nombre: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta', senaARS: 75000, linkPago: LINK_PAGO, expira: EXPIRA })],
  ['reserva-vencida', avisoReservaVencida({ nombre: 'Consulta de Cardiología', inicio: LUNES_10 })],
  ['plan-bienestar-apertura', avisoConsultaPlan({ aviso: 'apertura', titulo: 'Consulta del día 30', ventana: VENTANA })],
  ['plan-bienestar-mitad', avisoConsultaPlan({ aviso: 'mitad', titulo: 'Consulta del día 30', ventana: VENTANA })],
  ['invitacion-portal', mensajeInvitacion('Ana', LINK_ACCESO, PORTAL).texto],
  ['invitacion-portal', mensajeInvitacion('', LINK_ACCESO, `${PORTAL}/`).texto],
  ['acuse', TEXTO_ACUSE],
  ['fuera-de-horario', textoFueraDeHorario(HORARIO)],
  ['mensaje-nuevo', TEXTO_MENSAJE_NUEVO],
];

describe('Plantillas de WhatsApp · catálogo', () => {
  it('Cada plantilla pasa las reglas de Meta, con nombre y secret propios', () => {
    for (const p of PLANTILLAS_WHATSAPP) {
      expect(problemasPlantilla(p), p.nombre).toEqual([]);
      expect(p.nombre).toMatch(/^som_[a-z0-9_]+$/);
      expect(p.secret).toMatch(/^TWILIO_CONTENT_SID_[A-Z0-9_]+$/);
      expect(p.categoria).toBe('UTILITY');
    }
    expect(new Set(PLANTILLAS_WHATSAPP.map((p) => p.nombre)).size).toBe(PLANTILLAS_WHATSAPP.length);
    expect(new Set(PLANTILLAS_WHATSAPP.map((p) => p.secret)).size).toBe(PLANTILLAS_WHATSAPP.length);
    expect(new Set(PLANTILLAS_WHATSAPP.map((p) => p.cuerpo)).size).toBe(PLANTILLAS_WHATSAPP.length);
  });

  it('Todas menos la genérica dicen con qué aviso salen; la genérica es el respaldo', () => {
    for (const p of PLANTILLAS_WHATSAPP) {
      if (p === PLANTILLA_AVISO) {
        expect(p.avisos).toBeUndefined();
      } else {
        expect(p.avisos?.length, p.nombre).toBeGreaterThan(0);
      }
    }
    // Cada aviso al paciente y cada respuesta automática tiene plantilla propia.
    for (const clave of new Set(AVISOS.map(([clave]) => clave))) {
      expect(plantillasDeAviso(clave).length, clave).toBeGreaterThan(0);
    }
    // Los avisos internos a Recepción salen con la genérica.
    expect(plantillasDeAviso('reserva-portal-sin-link')).toEqual([]);
  });

  it('Detecta lo que Meta rechazaría', () => {
    const base: PlantillaWhatsApp = { ...PLANTILLA_AVISO };
    const casos: Array<[Partial<PlantillaWhatsApp>, RegExp]> = [
      [{ nombre: 'SOM Aviso' }, /minúsculas/],
      [{ cuerpo: '{{1}} Si tenés dudas, respondé.' }, /empezar ni terminar/],
      [{ cuerpo: 'Segunda Opinión Médica: {{1}}' }, /empezar ni terminar/],
      [{ cuerpo: 'Hola {{2}} y {{1}}.', ejemplo: { '1': 'a', '2': 'b' } }, /en orden/],
      [{ cuerpo: 'Hola {{1}} {{2}}.', ejemplo: { '1': 'a', '2': 'b' } }, /seguidas/],
      [{ ejemplo: {} }, /falta el ejemplo de \{\{1\}\}/],
      [{ cuerpo: `Hola {{1}} ${'x'.repeat(1100)}.` }, /1024/],
    ];
    for (const [cambio, problema] of casos) {
      expect(problemasPlantilla({ ...base, ...cambio }), JSON.stringify(cambio).slice(0, 60)).toContainEqual(
        expect.stringMatching(problema),
      );
    }
    expect(variablesDe('a {{1}} b {{ 2 }} c')).toEqual(['1', '2']);
  });

  it('El pedido a Twilio: tipo texto, con el ejemplo de cada variable (vacío si no tiene)', () => {
    expect(contenidoTwilio(PLANTILLA_AVISO)).toEqual({
      friendly_name: 'som_aviso',
      language: 'es_AR',
      variables: PLANTILLA_AVISO.ejemplo,
      types: { 'twilio/text': { body: PLANTILLA_AVISO.cuerpo } },
    });
    const acuse = plantillasDeAviso('acuse')[0]!;
    expect(contenidoTwilio(acuse)).toMatchObject({ friendly_name: 'som_acuse', variables: {}, types: { 'twilio/text': { body: TEXTO_ACUSE } } });
  });
});

describe('Plantillas de WhatsApp · cada aviso tiene su plantilla y el paciente recibe el mismo texto', () => {
  it.each(AVISOS)('%s: «%s»', (clave, texto) => {
    const propias = plantillasDeAviso(clave);
    // Tal cual o, si la plantilla lo ajusta (la invitación sin el nombre), ajustado.
    const ajustado = (p: PlantillaWhatsApp): string => (variablesSegunPlantilla(p, texto) || !p.adaptar ? texto : p.adaptar(texto));
    const propia = propias.find((p) => variablesSegunPlantilla(p, ajustado(p)));
    expect(propia, `ninguna plantilla de "${clave}" reconoce el texto`).toBeDefined();
    const recibe = ajustado(propia!).trim();
    const variables = variablesSegunPlantilla(propia!, recibe)!;
    // Ida y vuelta exacta: el cuerpo con las variables es el texto que ya mandan los bots.
    expect(textoPlantilla(propia!.cuerpo, variables)).toBe(recibe);
    for (const v of Object.values(variables)) {
      expect(v.trim()).toBe(v.length ? v : 'x');
      expect(v).not.toMatch(/[\n\t]/);
    }
    // Y es la que eligen los bots cuando está aprobada.
    const elegida = elegirPlantilla(clave, texto, todasAprobadas);
    expect(elegida?.plantilla.nombre).toBe(propia!.nombre);
    expect(elegida?.contentSid).toBe(`HX_${propia!.secret}`);
    expect(elegida?.texto).toBe(recibe);
  });

  it('La invitación sale con la plantilla sin nombre: a quien tiene nombre se le saca del saludo', () => {
    const conNombre = elegirPlantilla('invitacion-portal', mensajeInvitacion('María Adela', LINK_ACCESO, PORTAL).texto, todasAprobadas)!;
    expect(conNombre.plantilla.nombre).toBe('som_invitacion_portal_sin_nombre');
    expect(conNombre.variables).toEqual({ '1': LINK_ACCESO, '2': PORTAL });
    // Lo que recibe (y queda registrado) es el texto sin el nombre.
    expect(conNombre.texto).toBe(mensajeInvitacion('', LINK_ACCESO, PORTAL).texto.trim());
    const sinNombre = elegirPlantilla('invitacion-portal', mensajeInvitacion('', LINK_ACCESO, PORTAL).texto, todasAprobadas)!;
    expect(sinNombre.plantilla.nombre).toBe('som_invitacion_portal_sin_nombre');
    expect(sinNombre.texto).toBe(conNombre.texto);
    // La versión con el nombre la rechazó Meta: ya no está en el catálogo.
    expect(PLANTILLAS_WHATSAPP.map((p) => p.nombre)).not.toContain('som_invitacion_portal');
  });

  it('Sin la plantilla de la invitación aprobada, no cae en la genérica (tiene saltos de línea): texto libre', () => {
    const soloGenerica = (secret: string): string | undefined => (secret === PLANTILLA_AVISO.secret ? 'HX_AVISO' : undefined);
    expect(elegirPlantilla('invitacion-portal', mensajeInvitacion('Ana', LINK_ACCESO, PORTAL).texto, soloGenerica)).toBeUndefined();
  });

  it('Un aviso con nota al final usa la plantilla "con nota" (Meta no admite una variable vacía)', () => {
    const sinNota = avisoReserva({ nombre: 'Consulta de Cardiología', inicio: LUNES_10, modalidad: 'presencial' });
    const conNota = avisoReserva({ nombre: 'Teleconsulta de Cardiología', inicio: LUNES_10, modalidad: 'teleconsulta', traerLaboratorio: true });
    expect(elegirPlantilla('reserva-tentativa', sinNota, todasAprobadas)?.plantilla.nombre).toBe('som_reserva_tentativa');
    const nota = elegirPlantilla('reserva-tentativa', conNota, todasAprobadas)!;
    expect(nota.plantilla.nombre).toBe('som_reserva_tentativa_nota');
    expect(nota.variables['3']).toBe('Es por videollamada: te mandamos el link antes del turno. Traé los resultados del laboratorio del control.');
  });
});

describe('Plantillas de WhatsApp · con cuál sale cada mensaje', () => {
  const confirmado = avisoConfirmacion({ descripcion: 'Consulta de Cardiología', senaARS: 75000 });

  it('La propia si está aprobada; si no, la genérica; si no, texto libre', () => {
    expect(elegirPlantilla('turno-confirmado', confirmado, todasAprobadas)?.plantilla.nombre).toBe('som_turno_confirmado');
    const generica = elegirPlantilla('turno-confirmado', confirmado, soloGenerica)!;
    expect(generica.plantilla).toBe(PLANTILLA_AVISO);
    expect(generica.contentSid).toBe('HXaviso');
    expect(generica.variables).toEqual({ '1': '¡tu turno quedó confirmado! Consulta de Cardiología. Recibimos la seña de $75.000. ¡Te esperamos!' });
    expect(generica.texto).toBe(
      'Segunda Opinión Médica: ¡tu turno quedó confirmado! Consulta de Cardiología. Recibimos la seña de $75.000. ¡Te esperamos! Si tenés dudas, respondé este mensaje. 💙',
    );
    expect(elegirPlantilla('turno-confirmado', confirmado, ninguna)).toBeUndefined();
  });

  it('Un texto que no es el de la plantilla propia cae en la genérica', () => {
    const otro = 'Segunda Opinión Médica: tu turno cambió de consultorio. 💙';
    expect(elegirPlantilla('turno-confirmado', otro, todasAprobadas)?.plantilla).toBe(PLANTILLA_AVISO);
    // Un aviso interno a Recepción no tiene propia: genérica.
    const alerta = alertaRecepcionSinLink({ paciente: 'Ana Pérez', nombre: 'Consulta de Cardiología', inicio: LUNES_10 });
    expect(elegirPlantilla('reserva-portal-sin-link', alerta, todasAprobadas)?.plantilla).toBe(PLANTILLA_AVISO);
  });

  it('Las respuestas automáticas no usan la genérica: sin la propia salen como texto libre', () => {
    expect(elegirPlantilla('acuse', TEXTO_ACUSE, soloGenerica, { generica: false })).toBeUndefined();
    const propia = elegirPlantilla('acuse', TEXTO_ACUSE, todasAprobadas, { generica: false })!;
    expect(propia.plantilla.nombre).toBe('som_acuse');
    expect(propia.variables).toEqual({});
    expect(propia.texto).toBe(TEXTO_ACUSE);
    expect(elegirPlantilla('fuera-de-horario', textoFueraDeHorario(HORARIO), todasAprobadas, { generica: false })?.variables).toEqual({ '1': HORARIO });
  });

  it('Reconocer el texto: exacto, sin variables vacías ni saltos de línea dentro de una variable', () => {
    const p = plantillasDeAviso('reserva-vencida')[0]!;
    expect(variablesSegunPlantilla(p, 'Segunda Opinión Médica: no recibimos la seña de tu consulta del lunes y el horario se liberó. Podés elegir otro desde el portal. 💙')).toEqual({
      '1': 'consulta',
      '2': 'lunes',
    });
    expect(variablesSegunPlantilla(p, 'Segunda Opinión Médica: no recibimos la seña de tu  del lunes y el horario se liberó. Podés elegir otro desde el portal. 💙')).toBeUndefined();
    expect(variablesSegunPlantilla(p, 'Segunda Opinión Médica: no recibimos la seña de tu consulta\nde hoy del lunes y el horario se liberó. Podés elegir otro desde el portal. 💙')).toBeUndefined();
    expect(variablesSegunPlantilla(p, 'Otro texto')).toBeUndefined();
    const acuse = plantillasDeAviso('acuse')[0]!;
    expect(variablesSegunPlantilla(acuse, `  ${TEXTO_ACUSE}  `)).toEqual({});
    expect(variablesSegunPlantilla(acuse, `${TEXTO_ACUSE} Gracias.`)).toBeUndefined();
  });
});

describe('Plantillas de WhatsApp · la genérica envuelve los avisos que ya existen', () => {
  const avisos = [
    avisoConfirmacion({ descripcion: 'Consulta de Cardiología', senaARS: 75000 }),
    avisoRecordatorio({ tipo: '48h', descripcion: 'Consulta de Cardiología', inicio: LUNES_10 }),
    avisoReservaPortal({ nombre: 'Consulta de Cardiología', inicio: LUNES_10, modalidad: 'presencial', senaARS: 75000, linkPago: LINK_PAGO, expira: EXPIRA }),
    alertaRecepcionSinLink({ paciente: 'Ana Pérez', nombre: 'Consulta de Cardiología', inicio: LUNES_10 }),
    'Segunda Opinión Médica · prueba de WhatsApp (27/9/2026, 10:00:00). Si lo recibiste, Twilio funciona. 💙',
  ];

  it.each(avisos)('%s', (aviso) => {
    const vars = variablesAviso(aviso);
    expect(vars).toBeDefined();
    const texto = textoPlantilla(PLANTILLA_AVISO.cuerpo, vars!);
    // La firma y el 💙 los pone la plantilla: no quedan duplicados.
    expect(texto.startsWith('Segunda Opinión Médica: ')).toBe(true);
    expect(texto.match(/Segunda Opinión Médica/g)).toHaveLength(1);
    expect(texto.match(/💙/gu)).toHaveLength(1);
    expect(texto.endsWith('Si tenés dudas, respondé este mensaje. 💙')).toBe(true);
    expect(texto.length).toBeLessThanOrEqual(1024);
  });

  it('No se puede con saltos de línea o un texto que no entra: sale como texto libre', () => {
    expect(variablesAviso('Segunda Opinión Médica: hola\nchau 💙')).toBeUndefined();
    expect(variablesAviso(`Segunda Opinión Médica: ${'x'.repeat(1000)}`)).toBeUndefined();
    expect(variablesAviso('Segunda Opinión Médica: 💙')).toBeUndefined();
  });

  it('Lo que va a Twilio: ContentSid y las variables en JSON', () => {
    expect(paramsPlantilla('HX123', { '1': 'hola' })).toEqual({ ContentSid: 'HX123', ContentVariables: '{"1":"hola"}' });
  });
});
