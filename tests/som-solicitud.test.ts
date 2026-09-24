import { describe, it, expect } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Resource, ServiceRequest } from '@medplum/fhirtypes';
import {
  MENSAJE_SIN_CONSENTIMIENTO,
  origenSom,
  validarAdjuntosDelPaciente,
  validarSolicitante,
  validarSolicitudSom,
  supportingInfoRefs,
  resumenSolicitudSom,
  type SolicitudSom,
} from '../src/lib/som-solicitud.js';
import { handler as somSolicitar } from '../src/bots/som-solicitar.js';
import { COD, EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { fakeMedplum } from './fake-medplum.js';

const base: SolicitudSom = { pacienteRef: 'Patient/123', motivo: 'Dolor de pecho al esfuerzo' };

describe('Solicitud SOM — validación', () => {
  it('OK con paciente y motivo', () => {
    expect(validarSolicitudSom(base)).toEqual({ ok: true });
  });

  it('OK con paciente y solo estudios adjuntos', () => {
    expect(validarSolicitudSom({ pacienteRef: 'Patient/1', documentReferences: ['DocumentReference/9'] }).ok).toBe(true);
  });

  it('Rechaza sin paciente o ref inválida', () => {
    expect(validarSolicitudSom({ ...base, pacienteRef: '' }).ok).toBe(false);
    expect(validarSolicitudSom({ ...base, pacienteRef: '123' }).ok).toBe(false);
  });

  it('Rechaza sin ningún contexto clínico', () => {
    expect(validarSolicitudSom({ pacienteRef: 'Patient/1' }).ok).toBe(false);
  });

  it('Rechaza adjunto con tipo de referencia inválido', () => {
    expect(validarSolicitudSom({ ...base, documentReferences: ['Patient/1'] }).ok).toBe(false);
  });

  it('Rechaza cuestionario con referencia inválida', () => {
    expect(validarSolicitudSom({ ...base, questionnaireResponseRef: 'Foo/1' }).ok).toBe(false);
  });

  it('Rechaza motivo demasiado largo', () => {
    expect(validarSolicitudSom({ ...base, motivo: 'x'.repeat(2001) }).ok).toBe(false);
  });
});

describe('Solicitud SOM — armado', () => {
  it('supportingInfoRefs junta cuestionario y estudios en orden', () => {
    const refs = supportingInfoRefs({
      pacienteRef: 'Patient/1',
      questionnaireResponseRef: 'QuestionnaireResponse/q1',
      documentReferences: ['DocumentReference/a', 'DocumentReference/b'],
    });
    expect(refs).toEqual(['QuestionnaireResponse/q1', 'DocumentReference/a', 'DocumentReference/b']);
  });

  it('resumenSolicitudSom incluye nombre, motivo y cantidad de estudios', () => {
    const r = resumenSolicitudSom(
      { ...base, documentReferences: ['DocumentReference/a', 'DocumentReference/b'] },
      'Ana Gómez',
    );
    expect(r).toContain('Ana Gómez');
    expect(r).toContain('Dolor de pecho al esfuerzo');
    expect(r).toContain('2 estudios');
  });
});

describe('Solicitud SOM — origen y titularidad', () => {
  it('origin: self | referral; ausente = self; otro valor se rechaza', () => {
    expect(origenSom(base)).toBe('self');
    expect(origenSom({ ...base, origin: 'referral' })).toBe('referral');
    expect(validarSolicitudSom({ ...base, origin: 'web' }).ok).toBe(false);
  });

  it('un paciente solo pide para sí; el staff puede cargar la de un paciente', () => {
    expect(validarSolicitante('Patient/123', 'Patient/123').ok).toBe(true);
    expect(validarSolicitante('Patient/999', 'Patient/123').ok).toBe(false);
    expect(validarSolicitante('Practitioner/7', 'Patient/123').ok).toBe(true);
    expect(validarSolicitante(undefined, 'Patient/123').ok).toBe(true);
  });

  it('los adjuntos tienen que ser del mismo paciente (o no existir falla)', () => {
    expect(validarAdjuntosDelPaciente('Patient/1', [{ ref: 'DocumentReference/a', subjectRef: 'Patient/1' }]).ok).toBe(true);
    expect(validarAdjuntosDelPaciente('Patient/1', [{ ref: 'DocumentReference/a', subjectRef: 'Patient/2' }]).ok).toBe(false);
    expect(validarAdjuntosDelPaciente('Patient/1', [{ ref: 'DocumentReference/a' }]).ok).toBe(false);
  });
});

describe('Bot som-solicitar (contrato con el portal)', () => {
  const paciente: Resource = { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Gómez' }] };
  const consentimiento: Resource = {
    resourceType: 'DocumentReference',
    id: 'consent1',
    status: 'current',
    type: { coding: [{ system: 'http://loinc.org', code: '59284-0' }] },
    subject: { reference: 'Patient/p1' },
    content: [{ attachment: { title: 'Consentimiento' } }],
  };
  const qr: Resource = { resourceType: 'QuestionnaireResponse', id: 'qr1', status: 'completed', subject: { reference: 'Patient/p1' } };
  const estudio: Resource = {
    resourceType: 'DocumentReference',
    id: 'doc1',
    status: 'current',
    subject: { reference: 'Patient/p1' },
    content: [{ attachment: { title: 'eco.pdf' } }],
  };
  const ajeno: Resource = {
    resourceType: 'DocumentReference',
    id: 'doc2',
    status: 'current',
    subject: { reference: 'Patient/otro' },
    content: [{ attachment: { title: 'ajeno.pdf' } }],
  };
  const entrada: SolicitudSom = {
    pacienteRef: 'Patient/p1',
    questionnaireResponseRef: 'QuestionnaireResponse/qr1',
    documentReferences: ['DocumentReference/doc1'],
    motivo: 'Dolor de pecho',
    origin: 'referral',
  };
  const evento = (input: SolicitudSom, requester?: string) =>
    ({ input, secrets: {}, ...(requester ? { requester: { reference: requester } } : {}) }) as unknown as BotEvent<SolicitudSom>;

  it('crea la ServiceRequest activa con code, motivo, adjuntos y origen (valueCode)', async () => {
    const { medplum, todos } = fakeMedplum([paciente, consentimiento, qr, estudio]);
    const r = await somSolicitar(medplum, evento(entrada, 'Patient/p1'));
    expect(r.ok).toBe(true);
    const [sr] = todos<ServiceRequest>('ServiceRequest');
    expect(r.serviceRequestId).toBe(sr?.id);
    expect(sr?.status).toBe('active');
    expect(sr?.intent).toBe('order');
    expect(sr?.code?.coding?.[0]).toMatchObject({ system: SYSTEM.somServices, code: COD.somCardiology });
    expect(sr?.reasonCode?.[0]?.text).toBe('Dolor de pecho');
    expect(sr?.supportingInfo?.map((x) => x.reference)).toEqual(['QuestionnaireResponse/qr1', 'DocumentReference/doc1']);
    expect(sr?.extension).toEqual([{ url: EXT.somOrigin, valueCode: 'referral' }]);
  });

  it('sin consentimiento firmado no crea nada y devuelve el mensaje del contrato', async () => {
    const { medplum, todos } = fakeMedplum([paciente, qr, estudio]);
    const r = await somSolicitar(medplum, evento(entrada));
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_SIN_CONSENTIMIENTO });
    expect(todos('ServiceRequest')).toHaveLength(0);
  });

  it('rechaza si el que ejecuta es otro paciente', async () => {
    const { medplum, todos } = fakeMedplum([paciente, consentimiento, qr, estudio]);
    const r = await somSolicitar(medplum, evento(entrada, 'Patient/intruso'));
    expect(r.ok).toBe(false);
    expect(todos('ServiceRequest')).toHaveLength(0);
  });

  it('rechaza adjuntos de otro paciente', async () => {
    const { medplum, todos } = fakeMedplum([paciente, consentimiento, qr, estudio, ajeno]);
    const r = await somSolicitar(medplum, evento({ ...entrada, documentReferences: ['DocumentReference/doc2'] }));
    expect(r.ok).toBe(false);
    expect(todos('ServiceRequest')).toHaveLength(0);
  });
});
