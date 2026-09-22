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
    expect(linkSetPassword('https://recepcion.medplum.com.ar/', 'abc', 'xyz')).toBe(
      'https://recepcion.medplum.com.ar/setpassword/abc/xyz',
    );
    expect(linkSetPassword('https://recepcion.medplum.com.ar', 'abc', 'xyz')).toBe(
      'https://recepcion.medplum.com.ar/setpassword/abc/xyz',
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

describe('Bot invitar-paciente · PORTAL_BASE_URL obligatorio', () => {
  it('Sin el Project Secret no invita y no toca Medplum', async () => {
    const llamadas: string[] = [];
    const medplum = new Proxy(
      {},
      {
        get: (_t, prop) => () => {
          llamadas.push(String(prop));
          throw new Error(`no debería llamar a medplum.${String(prop)}`);
        },
      },
    ) as unknown as MedplumClient;
    const event = {
      input: { pacienteRef: 'Patient/p1', canal: 'qr' },
      secrets: {},
    } as unknown as BotEvent<EntradaInvitarPaciente>;

    const r = await invitarHandler(medplum, event);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain('PORTAL_BASE_URL');
    expect(llamadas).toEqual([]);
  });
});
