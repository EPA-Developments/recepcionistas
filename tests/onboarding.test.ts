import { describe, it, expect } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import {
  esCanalValido,
  esOrigenValido,
  extensionesInvitacion,
  validarEmail,
  linkSetPassword,
  partirNombre,
  mensajeInvitacion,
} from '../src/lib/onboarding.js';
import { handler as invitarHandler, type EntradaInvitarPaciente } from '../src/bots/invitar-paciente.js';
import { APP_BASE_URL_DEFAULT, PORTAL_BASE_URL_DEFAULT, urlBase } from '../src/config/urls.js';
import { EXT } from '../src/fhir/identifiers.js';

describe('onboarding · canal y email', () => {
  it('canales válidos', () => {
    expect(esCanalValido('whatsapp')).toBe(true);
    expect(esCanalValido('email')).toBe(true);
    expect(esCanalValido('qr')).toBe(true);
    expect(esCanalValido('paloma')).toBe(false);
    expect(esCanalValido(undefined)).toBe(false);
  });

  it('valida emails', () => {
    expect(validarEmail('ana@ejemplo.com')).toBe(true);
    expect(validarEmail('ana@ejemplo')).toBe(false);
    expect(validarEmail('anaejemplo.com')).toBe(false);
    expect(validarEmail('')).toBe(false);
    expect(validarEmail(undefined)).toBe(false);
  });
});

describe('onboarding · link y nombre', () => {
  it('arma el link de setpassword sin doble barra', () => {
    expect(linkSetPassword('https://app.segundaopinionmedica.org/', 'abc', 'xyz')).toBe(
      'https://app.segundaopinionmedica.org/setpassword/abc/xyz',
    );
    expect(linkSetPassword('https://app.segundaopinionmedica.org', 'abc', 'xyz')).toBe(
      'https://app.segundaopinionmedica.org/setpassword/abc/xyz',
    );
  });

  it('parte nombre y apellido', () => {
    expect(partirNombre('Ana Pérez')).toEqual({ firstName: 'Ana', lastName: 'Pérez' });
    expect(partirNombre('Ana María Pérez Gómez')).toEqual({ firstName: 'Ana María Pérez', lastName: 'Gómez' });
    expect(partirNombre('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' });
  });

  it('el mensaje incluye el link y la URL del portal configurada', () => {
    const m = mensajeInvitacion('Ana', 'https://x/setpassword/a/b', 'https://portal.ejemplo.org/');
    expect(m.texto).toContain('https://x/setpassword/a/b');
    expect(m.texto).toContain('Ana');
    expect(m.texto).toContain('https://portal.ejemplo.org\n');
    expect(m.asunto).toMatch(/Segunda Opinión Médica/);
  });
});

describe('URLs de SOM (defaults + Project Secrets)', () => {
  it('Portal y recepción de producción por defecto', () => {
    expect(PORTAL_BASE_URL_DEFAULT).toBe('https://app.segundaopinionmedica.org');
    expect(APP_BASE_URL_DEFAULT).toBe('https://recepcion.segundaopinionmedica.org');
    expect(urlBase(undefined, PORTAL_BASE_URL_DEFAULT)).toBe('https://app.segundaopinionmedica.org');
    expect(urlBase('  ', APP_BASE_URL_DEFAULT)).toBe('https://recepcion.segundaopinionmedica.org');
  });

  it('El Project Secret pisa el default (sin barra final)', () => {
    expect(urlBase('https://staging.ejemplo.org/', PORTAL_BASE_URL_DEFAULT)).toBe('https://staging.ejemplo.org');
  });
});

describe('Bot invitar-paciente · link al portal SOM', () => {
  function fakeMedplum() {
    return {
      getProfile: () => ({ meta: { project: 'p1' } }),
      readResource: async () => ({
        resourceType: 'Patient',
        id: 'p1',
        name: [{ text: 'Ana Pérez', given: ['Ana'], family: 'Pérez' }],
        telecom: [{ system: 'email', value: 'ana@ejemplo.com' }],
      }),
      updateResource: async (r: unknown) => r,
      searchOne: async () => ({ resourceType: 'AccessPolicy', id: 'ap1' }),
      post: async () => ({ resourceType: 'ProjectMembership', id: 'm1', user: { reference: 'User/u1' } }),
      get: async () => ({ resourceType: 'Bundle', entry: [{ resource: { id: 'usr1', secret: 's3cr3t' } }] }),
    } as unknown as MedplumClient;
  }
  const evento = (secrets: Record<string, unknown>) =>
    ({ input: { pacienteRef: 'Patient/p1', canal: 'qr' }, secrets }) as unknown as BotEvent<EntradaInvitarPaciente>;

  it('Sin PORTAL_BASE_URL, el link va a app.segundaopinionmedica.org', async () => {
    const r = await invitarHandler(fakeMedplum(), evento({}));
    expect(r.ok).toBe(true);
    expect(r.link).toBe('https://app.segundaopinionmedica.org/setpassword/usr1/s3cr3t');
  });

  it('Con PORTAL_BASE_URL (p. ej. staging), el link usa esa URL', async () => {
    const r = await invitarHandler(
      fakeMedplum(),
      evento({ PORTAL_BASE_URL: { name: 'PORTAL_BASE_URL', valueString: 'https://staging.ejemplo.org/' } }),
    );
    expect(r.link).toBe('https://staging.ejemplo.org/setpassword/usr1/s3cr3t');
  });
});

describe('Patient Journey · origen del paciente (patient-origin)', () => {
  const origenDe = (ext: ReturnType<typeof extensionesInvitacion>) => ext.find((x) => x.url === EXT.patientOrigin)?.valueCode;

  it('origen válido: reception | referral (self no lo escribe nunca el backend)', () => {
    expect(esOrigenValido('reception')).toBe(true);
    expect(esOrigenValido('referral')).toBe(true);
    expect(esOrigenValido('self')).toBe(false);
  });

  it('por defecto la invitación es de Recepción', () => {
    expect(origenDe(extensionesInvitacion(undefined, 'qr'))).toBe('reception');
  });

  it('respeta el origen pedido y, si no se pide, conserva una derivación previa', () => {
    expect(origenDe(extensionesInvitacion(undefined, 'email', 'referral'))).toBe('referral');
    const previas = [{ url: EXT.patientOrigin, valueCode: 'referral' }];
    expect(origenDe(extensionesInvitacion(previas, 'whatsapp'))).toBe('referral');
  });

  it('no duplica extensiones y nunca toca onboarding-completed (la escribe el portal)', () => {
    const previas = [
      { url: EXT.canalInvitacion, valueCode: 'qr' },
      { url: EXT.patientOrigin, valueCode: 'reception' },
      { url: EXT.onboardingCompleted, valueDateTime: '2026-09-01T10:00:00Z' },
    ];
    const ext = extensionesInvitacion(previas, 'email', 'referral');
    expect(ext.filter((x) => x.url === EXT.patientOrigin)).toHaveLength(1);
    expect(ext.filter((x) => x.url === EXT.canalInvitacion)).toEqual([{ url: EXT.canalInvitacion, valueCode: 'email' }]);
    expect(ext).toContainEqual({ url: EXT.onboardingCompleted, valueDateTime: '2026-09-01T10:00:00Z' });
  });

  it('el bot de invitación guarda el origen en el Patient', async () => {
    let guardado: Patient | undefined;
    const medplum = {
      getProfile: () => ({ meta: { project: 'p1' } }),
      readResource: async () => ({
        resourceType: 'Patient',
        id: 'p1',
        name: [{ text: 'Ana Pérez' }],
        telecom: [{ system: 'email', value: 'ana@ejemplo.com' }],
      }),
      updateResource: async (r: Patient) => (guardado = r),
      searchOne: async () => ({ resourceType: 'AccessPolicy', id: 'ap1' }),
      post: async () => ({ resourceType: 'ProjectMembership', id: 'm1', user: { reference: 'User/u1' } }),
      get: async () => ({ resourceType: 'Bundle', entry: [{ resource: { id: 'usr1', secret: 's3cr3t' } }] }),
    } as unknown as MedplumClient;
    const input: EntradaInvitarPaciente = { pacienteRef: 'Patient/p1', canal: 'qr', origen: 'referral' };
    const r = await invitarHandler(medplum, { input, secrets: {} } as unknown as BotEvent<EntradaInvitarPaciente>);
    expect(r.ok).toBe(true);
    expect(guardado?.extension).toContainEqual({ url: EXT.patientOrigin, valueCode: 'referral' });
  });

  it('el bot rechaza un origen inválido', async () => {
    const input = { pacienteRef: 'Patient/p1', canal: 'qr', origen: 'self' } as unknown as EntradaInvitarPaciente;
    const r = await invitarHandler({} as MedplumClient, { input, secrets: {} } as unknown as BotEvent<EntradaInvitarPaciente>);
    expect(r.ok).toBe(false);
  });
});
