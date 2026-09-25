import { describe, it, expect } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Appointment, CarePlan, Communication, DocumentReference, Patient, Resource } from '@medplum/fhirtypes';
import { LOINC_CONSENTIMIENTO, SYSTEM } from '../src/fhir/identifiers.js';
import {
  limpiarBorrador,
  promptBorrador,
  SIN_BORRADOR,
  systemBorrador,
  textoContexto,
  usoDelBorrador,
} from '../src/lib/borrador.js';
import { armarEntradaBorrador, handler, type EntradaBorrador } from '../src/bots/borrador-respuesta.js';
import { fakeMedplum } from './fake-medplum.js';

describe('borrador de respuesta — lógica pura', () => {
  it('el prompt es de SOM, sin horarios ni direcciones (provisionales) y con las reglas', () => {
    const s = systemBorrador();
    expect(s).toMatch(/SEGUNDA OPINIÓN MÉDICA/);
    // Ningún horario ni link: el borrador no puede afirmar datos sin confirmar.
    expect(s).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(s).not.toMatch(/https?:\/\//);
    expect(s).toMatch(/NO des indicaciones médicas/);
    expect(s).toMatch(/NO inventes precios, horarios ni direcciones/);
    expect(s).toContain(`"${SIN_BORRADOR}: <motivo`);
    expect(s).toMatch(/urgencia/);
  });

  it('el contexto: nombre, motivo, turno, programas y consentimiento solo si falta', () => {
    expect(
      textoContexto({
        nombre: 'Ana García',
        motivo: 'Turnos y reservas',
        proximoTurno: 'jue 02/10 09:30',
        programas: ['Plan Bienestar · 100 días'],
        consentimientoFirmado: true,
      }),
    ).toBe(
      [
        'Paciente: Ana García',
        'Motivo que eligió al escribir: Turnos y reservas',
        'Próximo turno: jue 02/10 09:30',
        'Programas activos: Plan Bienestar · 100 días.',
      ].join('\n'),
    );
    expect(textoContexto({ consentimientoFirmado: false })).toContain('Consentimiento informado: NO firmado.');
    expect(
      promptBorrador({ nombre: 'Ana' }, [
        { de: 'paciente', texto: 'Hola' },
        { de: 'recepcion', texto: '¡Hola Ana!' },
      ]),
    ).toContain('PACIENTE: Hola\nRECEPCIÓN: ¡Hola Ana!');
  });

  it('limpia la salida: SIN_BORRADOR → motivo, comillas afuera, tope de largo', () => {
    expect(limpiarBorrador(`${SIN_BORRADOR}: consulta clínica`)).toEqual({ motivo: 'consulta clínica' });
    expect(limpiarBorrador('')).toEqual({ motivo: 'El asistente no devolvió nada.' });
    expect(limpiarBorrador('«¡Hola! Te lo confirmamos.»')).toEqual({ borrador: '¡Hola! Te lo confirmamos.' });
    expect(limpiarBorrador('a'.repeat(20), 10).borrador).toBe(`${'a'.repeat(10)}…`);
  });

  it('marca si el borrador salió tal cual o editado', () => {
    expect(usoDelBorrador(' Listo. ', 'Listo.')).toBe('sin-editar');
    expect(usoDelBorrador('Listo, te esperamos.', 'Listo.')).toBe('editado');
    expect(usoDelBorrador('Listo.', undefined)).toBeUndefined();
  });
});

const ana: Patient = { resourceType: 'Patient', id: 'ana', name: [{ given: ['Ana'], family: 'García' }] };
const REF = { reference: 'Patient/ana' };

function conversacion(ultimoDe: 'paciente' | 'recepcion'): Resource[] {
  const mensajes: Communication[] = [
    {
      resourceType: 'Communication',
      id: 'm1',
      status: 'completed',
      subject: REF,
      sender: REF,
      partOf: [{ reference: 'Communication/c1' }],
      sent: '2026-09-25T10:00:00.000Z',
      payload: [{ contentString: '¿Puedo pasar mi turno al viernes?' }],
    },
  ];
  if (ultimoDe === 'recepcion') {
    mensajes.push({
      resourceType: 'Communication',
      id: 'm2',
      status: 'in-progress',
      subject: REF,
      sender: { reference: 'Practitioner/recepcion' },
      partOf: [{ reference: 'Communication/c1' }],
      sent: '2026-09-25T10:05:00.000Z',
      payload: [{ contentString: 'Sí, ya te lo pasamos.' }],
    });
  }
  return [
    {
      resourceType: 'Communication',
      id: 'c1',
      status: 'in-progress',
      subject: REF,
      topic: { coding: [{ system: SYSTEM.motivoMensaje, code: 'turnos' }], text: 'turnos' },
    },
    ...mensajes,
  ];
}

const turno: Appointment = {
  resourceType: 'Appointment',
  id: 't1',
  status: 'booked',
  start: '2099-10-02T12:30:00.000Z',
  serviceType: [{ text: 'Ecocardiograma' }],
  participant: [{ actor: REF, status: 'accepted' }],
};

const plan: CarePlan = {
  resourceType: 'CarePlan',
  id: 'p1',
  status: 'active',
  intent: 'plan',
  subject: REF,
  category: [{ coding: [{ system: SYSTEM.planCuidado, code: 'plan-bienestar-100' }] }],
};

const consentimiento: DocumentReference = {
  resourceType: 'DocumentReference',
  id: 'd1',
  status: 'current',
  subject: REF,
  type: { coding: [{ system: 'http://loinc.org', code: LOINC_CONSENTIMIENTO }] },
  content: [{ attachment: { contentType: 'text/plain' } }],
};

describe('bot som-borrador-respuesta', () => {
  it('arma el contexto operativo (sin historia clínica) y la conversación', async () => {
    const { medplum } = fakeMedplum([ana, turno, plan, consentimiento, ...conversacion('paciente')]);
    const entrada = await armarEntradaBorrador(medplum, 'c1');
    expect('motivo' in entrada).toBe(false);
    if ('motivo' in entrada) {
      return;
    }
    expect(entrada.contexto).toMatchObject({
      nombre: 'Ana García',
      motivo: 'Turnos y reservas',
      consentimientoFirmado: true,
      programas: ['Plan Bienestar · 100 días'],
    });
    expect(entrada.contexto.proximoTurno).toMatch(/Ecocardiograma$/);
    expect(entrada.mensajes).toEqual([
      { de: 'paciente', texto: '¿Puedo pasar mi turno al viernes?', cuandoISO: '2026-09-25T10:00:00.000Z' },
    ]);
  });

  it('no pide borrador si el último mensaje es de Recepción o la conversación no existe', async () => {
    const { medplum } = fakeMedplum([ana, ...conversacion('recepcion')]);
    expect(await armarEntradaBorrador(medplum, 'c1')).toEqual({
      motivo: 'El último mensaje es de Recepción: no hay nada pendiente de responder.',
    });
    expect(await armarEntradaBorrador(medplum, 'no-existe')).toMatchObject({
      motivo: expect.stringMatching(/No encontré/),
    });
  });

  it('sin ANTHROPIC_API_KEY avisa y no llama a nadie', async () => {
    const { medplum } = fakeMedplum([ana, ...conversacion('paciente')]);
    const event = { input: { hiloId: 'c1' }, secrets: {} } as unknown as BotEvent<EntradaBorrador>;
    expect(await handler(medplum, event)).toEqual({
      motivo: 'Falta el secret ANTHROPIC_API_KEY en Medplum: "Sugerir" está desactivado.',
    });
  });
});
