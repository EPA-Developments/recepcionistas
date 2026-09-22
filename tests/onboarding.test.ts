import { describe, it, expect } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import {
  esCanalValido,
  validarEmail,
  linkSetPassword,
  partirNombre,
  mensajeInvitacion,
} from '../src/lib/onboarding.js';
import { handler as invitarHandler, type EntradaInvitarPaciente } from '../src/bots/invitar-paciente.js';
import { APP_BASE_URL_DEFAULT, PORTAL_BASE_URL_DEFAULT, urlBase } from '../src/config/urls.js';

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
