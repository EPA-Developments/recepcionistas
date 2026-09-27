import { describe, it, expect } from 'vitest';
import { PLANTILLA_AVISO, PLANTILLAS_WHATSAPP, type PlantillaWhatsApp } from '../src/config/plantillas-whatsapp.js';
import {
  alertaRecepcionSinLink,
  avisoConfirmacion,
  avisoRecordatorio,
  avisoReservaPortal,
  avisoReservaVencida,
} from '../src/lib/avisos.js';
import {
  contenidoTwilio,
  paramsPlantilla,
  problemasPlantilla,
  textoPlantilla,
  variablesAviso,
  variablesDe,
} from '../src/lib/plantillas-whatsapp.js';

const LUNES_10 = new Date('2026-09-28T10:00:00-03:00');

describe('Plantillas de WhatsApp · catálogo', () => {
  it('Cada plantilla pasa las reglas de Meta, con nombre y secret propios', () => {
    for (const p of PLANTILLAS_WHATSAPP) {
      expect(problemasPlantilla(p), p.nombre).toEqual([]);
      expect(p.secret).toMatch(/^TWILIO_CONTENT_SID_[A-Z0-9_]+$/);
    }
    expect(new Set(PLANTILLAS_WHATSAPP.map((p) => p.nombre)).size).toBe(PLANTILLAS_WHATSAPP.length);
    expect(new Set(PLANTILLAS_WHATSAPP.map((p) => p.secret)).size).toBe(PLANTILLAS_WHATSAPP.length);
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

  it('El pedido a Twilio: tipo texto, con el ejemplo de cada variable', () => {
    expect(contenidoTwilio(PLANTILLA_AVISO)).toEqual({
      friendly_name: 'som_aviso',
      language: 'es_AR',
      variables: PLANTILLA_AVISO.ejemplo,
      types: { 'twilio/text': { body: PLANTILLA_AVISO.cuerpo } },
    });
  });
});

describe('Plantillas de WhatsApp · la genérica envuelve los avisos que ya existen', () => {
  const avisos = [
    avisoConfirmacion({ descripcion: 'Consulta de Cardiología', senaARS: 75000 }),
    avisoRecordatorio({ tipo: '48h', descripcion: 'Consulta de Cardiología', inicio: LUNES_10 }),
    avisoRecordatorio({
      tipo: '2h',
      descripcion: 'Teleconsulta de Cardiología',
      inicio: LUNES_10,
      modalidad: 'teleconsulta',
      teleconsultaUrl: 'https://meet.example/sala',
    }),
    avisoReservaPortal({
      nombre: 'Consulta de Cardiología',
      inicio: LUNES_10,
      modalidad: 'presencial',
      senaARS: 75000,
      linkPago: 'https://mpago.la/abc',
      expira: new Date('2026-09-27T12:30:00-03:00'),
    }),
    avisoReservaVencida({ nombre: 'Consulta de Cardiología', inicio: LUNES_10 }),
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
