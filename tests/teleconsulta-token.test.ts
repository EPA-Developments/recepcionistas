import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Appointment, Practitioner } from '@medplum/fhirtypes';
import { EXT } from '../src/fhir/identifiers.js';
import {
  claimsToken,
  dominioJitsi,
  esNombreSala,
  motivoSinAcceso,
  nombreSalaJitsi,
  salaDelLink,
  urlTeleconsulta,
} from '../src/lib/teleconsulta.js';
import { handler, type ResultadoToken } from '../src/bots/teleconsulta-token.js';
import { fakeMedplum } from './fake-medplum.js';

const BASE = 'https://meet.segundaopinionmedica.org';
const DOMINIO = 'meet.segundaopinionmedica.org';
const SALA = nombreSalaJitsi('0123456789abcdef0123456789abcdef');
// 15:00 UTC = 12:00 en Argentina: la sala abre 11:45 y cierra 13:30 (turno de 30 min).
const INICIO = new Date('2026-10-01T15:00:00Z');
const FIN = new Date('2026-10-01T15:30:00Z');

describe('La sala de un turno', () => {
  it('reconoce el nombre que arma la reserva, y nada más', () => {
    expect(esNombreSala(SALA)).toBe(true);
    expect(esNombreSala('som-abc')).toBe(false); // menos de 128 bits
    expect(esNombreSala(`otra-${'0'.repeat(32)}`)).toBe(false);
    expect(esNombreSala(undefined)).toBe(false);
  });

  it('el dominio sale de JITSI_BASE_URL, y solo con https', () => {
    expect(dominioJitsi(BASE)).toBe(DOMINIO);
    expect(dominioJitsi(`${BASE}/`)).toBe(DOMINIO);
    expect(dominioJitsi('http://meet.segundaopinionmedica.org')).toBeUndefined();
    expect(dominioJitsi(DOMINIO)).toBeUndefined(); // sin esquema no es una URL
    expect(dominioJitsi(undefined)).toBeUndefined();
  });

  it('lee la sala del link que guarda la reserva (ida y vuelta)', () => {
    expect(salaDelLink(urlTeleconsulta(BASE, SALA), DOMINIO)).toBe(SALA);
  });

  // La falla muda: cada uno entra a un servidor distinto y los dos esperan solos.
  it('un link a otro servidor no tiene sala', () => {
    expect(salaDelLink(`https://otro.example.org/${SALA}`, DOMINIO)).toBeUndefined();
    expect(salaDelLink(`${BASE}/sala-cualquiera`, DOMINIO)).toBeUndefined();
    expect(salaDelLink(undefined, DOMINIO)).toBeUndefined();
  });
});

describe('La ventana de la sala', () => {
  it('abre 15 minutos antes, en la hora de Argentina', () => {
    expect(motivoSinAcceso(INICIO, FIN, new Date('2026-10-01T14:44:00Z'))).toBe(
      'La sala se abre a las 11:45, 15 minutos antes del turno.'
    );
    expect(motivoSinAcceso(INICIO, FIN, new Date('2026-10-01T14:45:00Z'))).toBeUndefined();
  });

  it('cierra una hora después del fin', () => {
    expect(motivoSinAcceso(INICIO, FIN, new Date('2026-10-01T16:30:00Z'))).toBeUndefined();
    expect(motivoSinAcceso(INICIO, FIN, new Date('2026-10-01T16:31:00Z'))).toBe('Esta videollamada ya terminó.');
  });
});

describe('Lo que dice el token', () => {
  const datos = { appId: 'som', dominio: DOMINIO, sala: SALA, nombre: 'Profesional de prueba', inicio: INICIO, fin: FIN };

  it('el profesional sale moderador', () => {
    const c = claimsToken({ ...datos, rol: 'profesional' });
    expect(c.context.user).toEqual({ name: 'Profesional de prueba', moderator: true, affiliation: 'owner' });
    expect(c).toMatchObject({ aud: 'jitsi', iss: 'som', sub: DOMINIO, room: SALA });
  });

  it('el paciente no', () => {
    const c = claimsToken({ ...datos, rol: 'paciente' });
    expect(c.context.user.moderator).toBe(false);
    expect(c.context.user.affiliation).toBe('member');
  });

  it('vale lo que dura la ventana de la sala', () => {
    const c = claimsToken({ ...datos, rol: 'profesional' });
    expect(new Date(c.nbf * 1000).toISOString()).toBe('2026-10-01T14:45:00.000Z');
    expect(new Date(c.exp * 1000).toISOString()).toBe('2026-10-01T16:30:00.000Z');
  });
});

describe('som-teleconsulta-token', () => {
  const SECRETO = 'secreto-de-prueba';
  const secretos = {
    JITSI_BASE_URL: { name: 'JITSI_BASE_URL', valueString: BASE },
    JITSI_APP_ID: { name: 'JITSI_APP_ID', valueString: 'som' },
    JITSI_APP_SECRET: { name: 'JITSI_APP_SECRET', valueString: SECRETO },
  };
  // Quién pide lo dice `requester`, como en Medplum: el input no decide nada.
  const ev = (input: unknown, requester: string | null = 'Practitioner/pr1', secrets: Record<string, unknown> = secretos) =>
    ({ input, secrets, ...(requester ? { requester: { reference: requester } } : {}) }) as never;
  const DENTRO = new Date('2026-10-01T15:05:00Z');

  const profesional: Practitioner = { resourceType: 'Practitioner', id: 'pr1', name: [{ text: 'Profesional de prueba' }] };
  const turno = (cambios: Partial<Appointment> = {}): Appointment => ({
    resourceType: 'Appointment',
    id: 'a1',
    status: 'booked',
    start: INICIO.toISOString(),
    end: FIN.toISOString(),
    participant: [
      { actor: { reference: 'Patient/p1' }, status: 'accepted' },
      { actor: { reference: 'Practitioner/pr1' }, status: 'accepted' },
    ],
    extension: [{ url: EXT.teleconsultaUrl, valueUrl: urlTeleconsulta(BASE, SALA) }],
    ...cambios,
  });
  const pedir = (
    appt: Appointment,
    opciones: { input?: Record<string, unknown>; requester?: string | null; secrets?: Record<string, unknown>; ahora?: Date } = {},
  ) =>
    handler(
      fakeMedplum([appt, profesional]).medplum,
      ev({ appointmentId: 'a1', ...opciones.input }, opciones.requester === undefined ? 'Practitioner/pr1' : opciones.requester, opciones.secrets),
      opciones.ahora ?? DENTRO,
    ) as Promise<ResultadoToken>;

  it('el profesional del turno recibe un token de moderador, firmado', async () => {
    const r = await pedir(turno());
    expect(r).toMatchObject({ ok: true, dominio: DOMINIO, sala: SALA, venceISO: '2026-10-01T16:30:00.000Z' });
    const [cabecera, cuerpo, firma] = r.jwt!.split('.');
    expect(createHmac('sha256', SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url')).toBe(firma);
    const claims = JSON.parse(Buffer.from(cuerpo!, 'base64url').toString());
    expect(claims.context.user).toEqual({ name: 'Profesional de prueba', moderator: true, affiliation: 'owner' });
    expect(claims.room).toBe(SALA);
  });

  // Mismo mensaje para "no existe" y "no es tuyo": no confirma qué turnos existen.
  it('quien no es parte del turno recibe lo mismo que si el turno no existiera', async () => {
    const ajeno = await pedir(turno(), { requester: 'Practitioner/otro' });
    const inexistente = await pedir(turno(), { input: { appointmentId: 'no-existe' } });
    expect(ajeno).toEqual({ ok: false, mensaje: 'No encontramos esa videollamada en tu cuenta.' });
    expect(inexistente).toEqual(ajeno);
  });

  // El agujero que cierra `requester`: con el id del profesional del turno en el
  // input, otro profesional sacaba un token de moderador para una sala ajena.
  it('mandar el practitionerRef del profesional del turno en el input no sirve', async () => {
    const r = await pedir(turno(), {
      input: { rol: 'profesional', practitionerRef: 'Practitioner/pr1' },
      requester: 'Practitioner/otro',
    });
    expect(r.ok).toBe(false);
    expect(r.jwt).toBeUndefined();
  });

  it('la paciente no saca token de moderador (entra con som-teleconsulta-entrar)', async () => {
    const r = await pedir(turno(), { requester: 'Patient/p1' });
    expect(r).toEqual({ ok: false, mensaje: 'No encontramos esa videollamada en tu cuenta.' });
  });

  it('sin requester no hace nada', async () => {
    expect((await pedir(turno(), { requester: null })).ok).toBe(false);
  });

  // El dashboard lo lee para entrar con el link, como antes, avisando que no modera.
  it('sin los tres secretos no emite nada, y avisa que falta configurar', async () => {
    const r = await pedir(turno(), { secrets: { JITSI_BASE_URL: secretos.JITSI_BASE_URL } });
    expect(r).toMatchObject({ ok: false, sinConfigurar: true });
    expect(r.jwt).toBeUndefined();
  });

  it('un turno con la seña sin pagar no entra', async () => {
    const r = await pedir(turno({ status: 'pending' }));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain('seña');
  });

  it('un turno presencial (sin link) no tiene sala', async () => {
    const r = await pedir(turno({ extension: [] }));
    expect(r).toMatchObject({ ok: false });
    expect(r.mensaje).toContain('sala de videollamada');
  });

  it('fuera de la ventana contesta cuándo abre', async () => {
    const r = await pedir(turno(), { ahora: new Date('2026-10-01T14:00:00Z') });
    expect(r).toEqual({ ok: false, mensaje: 'La sala se abre a las 11:45, 15 minutos antes del turno.' });
  });

  it('sin turno en el input, lo dice', async () => {
    const r = await pedir(turno(), { input: { appointmentId: undefined } });
    expect(r).toEqual({ ok: false, mensaje: 'Falta el turno.' });
  });
});
