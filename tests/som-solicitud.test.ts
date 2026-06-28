import { describe, it, expect } from 'vitest';
import {
  validarSolicitudSom,
  supportingInfoRefs,
  resumenSolicitudSom,
  type SolicitudSom,
} from '../src/lib/som-solicitud.js';

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
