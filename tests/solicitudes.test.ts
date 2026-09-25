import { describe, it, expect } from 'vitest';
import {
  codigoPedido,
  validarSolicitud,
  resumenSolicitud,
  preferenciaLegible,
  mensajeWhatsAppRecepcion,
  servicioPedido,
  SERVICIOS_SOLICITABLES,
  esServicioSolicitable,
  type SolicitudTurno,
} from '../src/lib/solicitudes.js';

// Contrato del portal (EPA-Developments/app, src/fhir/solicitudes.ts).
const base: SolicitudTurno = { pacienteRef: 'Patient/123', servicio: 'Segunda opinión — Cardiología', servicioCodigo: 'CONSULTA_CARDIO' };

describe('Solicitudes de turno — validación', () => {
  it('OK con paciente y servicio (lo que manda el portal)', () => {
    expect(validarSolicitud(base)).toEqual({ ok: true });
  });

  it('Sigue aceptando el contrato anterior (terapia / terapiaCodigo)', () => {
    const vieja: SolicitudTurno = { pacienteRef: 'Patient/123', terapia: 'Cardiología', terapiaCodigo: 'CARDIOLOGIA' };
    expect(validarSolicitud(vieja)).toEqual({ ok: true });
    expect(servicioPedido(vieja)).toBe('Cardiología');
    expect(codigoPedido(vieja)).toBe('CARDIOLOGIA');
    expect(codigoPedido(base)).toBe('CONSULTA_CARDIO');
  });

  it('Rechaza sin paciente o ref inválida', () => {
    expect(validarSolicitud({ ...base, pacienteRef: '' }).ok).toBe(false);
    expect(validarSolicitud({ ...base, pacienteRef: '123' }).ok).toBe(false);
  });

  it('Acepta todos los servicios del portal y rechaza un código desconocido', () => {
    for (const { codigo, label } of SERVICIOS_SOLICITABLES) {
      expect(validarSolicitud({ pacienteRef: 'Patient/1', servicio: label, servicioCodigo: codigo }).ok).toBe(true);
    }
    expect(validarSolicitud({ ...base, servicioCodigo: 'HBOT' }).ok).toBe(false);
  });

  it('Rechaza sin servicio', () => {
    expect(validarSolicitud({ ...base, servicio: '   ' }).ok).toBe(false);
    expect(validarSolicitud({ pacienteRef: 'Patient/123' }).ok).toBe(false);
  });

  it('Rechaza fecha preferida inválida', () => {
    expect(validarSolicitud({ ...base, preferenciaInicio: 'no-es-fecha' }).ok).toBe(false);
  });

  it('Rechaza texto demasiado largo', () => {
    expect(validarSolicitud({ ...base, nota: 'x'.repeat(501) }).ok).toBe(false);
  });
});

describe('Solicitudes de turno — textos', () => {
  it('preferenciaLegible prioriza la fecha elegida sobre el texto', () => {
    const conFecha = preferenciaLegible({ ...base, preferenciaInicio: '2026-07-02T18:00:00-03:00', preferenciaTexto: 'cuando sea' });
    expect(conFecha).toMatch(/18:00/);
    expect(preferenciaLegible({ ...base, preferenciaTexto: 'jueves a la tarde' })).toBe('jueves a la tarde');
    expect(preferenciaLegible(base)).toBeUndefined();
  });

  it('resumenSolicitud arma el detalle para Recepción', () => {
    const r = resumenSolicitud({ ...base, preferenciaTexto: 'jueves a la tarde', nota: 'vengo con un amigo' });
    expect(r).toContain('Segunda opinión — Cardiología');
    expect(r).toContain('jueves a la tarde');
    expect(r).toContain('vengo con un amigo');
  });

  it('mensajeWhatsAppRecepcion incluye el nombre y el servicio', () => {
    const m = mensajeWhatsAppRecepcion({ ...base, preferenciaTexto: 'mañana' }, 'Juan Pérez');
    expect(m).toContain('Juan Pérez');
    expect(m).toContain('Segunda opinión — Cardiología');
    expect(m).toContain('mañana');
  });
});

describe('Bot som-solicitar-turno con el payload del portal', () => {
  it('Crea la solicitud con servicio y código (antes rechazaba "Elegí una terapia")', async () => {
    const { handler } = await import('../src/bots/solicitar-turno.js');
    const { fakeMedplum } = await import('./fake-medplum.js');
    const { medplum, todos } = fakeMedplum([{ resourceType: 'Patient', id: '123', name: [{ given: ['Ana'], family: 'Pérez' }] }]);
    // Lo que manda `crearSolicitud` del portal: { pacienteRef, ...NuevaSolicitud }.
    const r = await handler(medplum, {
      input: { pacienteRef: 'Patient/123', servicio: 'Consulta cardiológica', servicioCodigo: 'CONSULTA_CARDIO', nota: 'por la tarde' },
      secrets: {},
    } as never);

    expect(r).toMatchObject({ ok: true, avisada: false });
    const [task] = todos<import('@medplum/fhirtypes').Task>('Task');
    expect(task?.description).toContain('Consulta cardiológica');
    expect(task?.input?.map((i) => [i.type?.text, i.valueString])).toEqual([
      ['servicio', 'Consulta cardiológica'],
      ['servicio-codigo', 'CONSULTA_CARDIO'],
      ['nota', 'por la tarde'],
    ]);
  });
});

describe('Solicitudes con el catálogo nuevo y modalidad (R-21)', () => {
  const base = { pacienteRef: 'Patient/p1', servicio: 'Consulta' };

  it('se pueden pedir las consultas por especialidad y la del Plan Bienestar, además de los códigos de siempre', () => {
    for (const codigo of ['NEUROLOGIA', 'INSUFICIENCIA_CARDIACA', 'NUTRICION', 'CONSULTA_PB100D', 'CONSULTA_CARDIO', 'TELECONSULTA']) {
      expect(esServicioSolicitable(codigo)).toBe(true);
    }
    expect(esServicioSolicitable('CONTROL_GLP1')).toBe(false);
  });

  it('valida la modalidad contra el catálogo', () => {
    expect(validarSolicitud({ ...base, servicioCodigo: 'GINECOLOGIA', modalidad: 'teleconsulta' }).ok).toBe(true);
    expect(validarSolicitud({ ...base, servicioCodigo: 'GINECOLOGIA', modalidad: 'domicilio' as never }).ok).toBe(false);
    expect(validarSolicitud({ ...base, servicioCodigo: 'ECG', modalidad: 'teleconsulta' }).ok).toBe(true); // código anterior: decide Recepción
  });

  it('la modalidad aparece en el resumen y en el aviso a Recepción', () => {
    const s = { ...base, servicio: 'Teleconsulta de Cardiología', servicioCodigo: 'CARDIOLOGIA', modalidad: 'teleconsulta' as const };
    expect(resumenSolicitud(s)).toBe('Solicitud de turno: Teleconsulta de Cardiología. Modalidad: teleconsulta.');
    expect(mensajeWhatsAppRecepcion(s, 'Ana')).toContain('Ana pidió: Teleconsulta de Cardiología (teleconsulta)');
  });
});
