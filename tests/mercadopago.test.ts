/**
 * MercadoPago: credencial, seña $0 y el 403 "PolicyAgent" (PA_UNAUTHORIZED_RESULT_FROM_POLICIES)
 * que devuelve MercadoPago cuando la credencial no está autorizada para crear links de pago.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Appointment } from '@medplum/fhirtypes';
import { handler as linkMercadoPago } from '../src/bots/link-mercadopago.js';
import { handler as webhookMercadoPago } from '../src/bots/webhook-mercadopago.js';
import { EXT } from '../src/fhir/identifiers.js';
import {
  armarPreferenciaSena,
  bloqueaCredencialMP,
  diagnosticarCuentaMP,
  esRechazoDePoliticas,
  explicarErrorMP,
  limpiarTokenMP,
  problemaCredencialMP,
  problemaMontoSena,
  resumenCredencial,
  resumenErrorMP,
  tipoCredencialMP,
} from '../src/lib/mercadopago.js';
import { fakeMedplum } from './fake-medplum.js';

// Algunos tests fijan la seña a mano para no depender de la lista de precios.
const precio = vi.hoisted(() => ({ sena: undefined as number | undefined }));
vi.mock('../src/lib/pricing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/pricing.js')>();
  return {
    ...real,
    calcularSenaARS: (...args: Parameters<typeof real.calcularSenaARS>) =>
      precio.sena === undefined ? real.calcularSenaARS(...args) : { totalARS: precio.sena * 2, senaARS: precio.sena },
  };
});

const ACCESS = 'APP_USR-1234567890123456-092611-0123456789abcdef0123456789abcdef-123456789';
const ACCESS_PRUEBA = 'TEST-1234567890123456-092611-0123456789abcdef0123456789abcdef-123456789';
const PUBLIC_KEY = 'APP_USR-0a1b2c3d-4e5f-6789-abcd-ef0123456789';

/** El cuerpo exacto del 403 que devolvió MercadoPago. */
const RECHAZO_POLITICAS =
  '{"blocked_by":"PolicyAgent","code":"PA_UNAUTHORIZED_RESULT_FROM_POLICIES","status":403,"message":"At least one policy returned UNAUTHORIZED."}';

const CUENTA_OK = {
  id: 987654321,
  nickname: 'SEGUNDAOPINION',
  site_id: 'MLA',
  status: { site_status: 'active', mercadopago_tc_accepted: true, required_action: '', confirmed_email: true, sell: { allow: true, codes: [] } },
};

const respuesta = (status: number, cuerpo: unknown) =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch falso: `rutas[url o prefijo]` → respuesta; guarda las llamadas. */
function stubFetch(rutas: Record<string, () => Response>) {
  const llamadas: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      llamadas.push({ url, init });
      const clave = Object.keys(rutas).find((k) => url.startsWith(k));
      if (!clave) {
        throw new Error(`fetch inesperado: ${url}`);
      }
      return rutas[clave]!();
    }),
  );
  return llamadas;
}

const turno: Appointment = {
  resourceType: 'Appointment',
  id: 'a1',
  status: 'pending',
  participant: [],
  description: 'Consulta de Cardiología',
  extension: [
    { url: EXT.itemTipo, valueCode: 'servicio' },
    { url: EXT.itemCodigo, valueString: 'CARDIOLOGIA' },
  ],
};
const secretos = (token: string) => ({ MERCADOPAGO_ACCESS_TOKEN: { name: 'MERCADOPAGO_ACCESS_TOKEN', valueString: token } });
const ev = (input: unknown, token: string) => ({ input, secrets: secretos(token) }) as never;

afterEach(() => {
  vi.unstubAllGlobals();
  precio.sena = undefined;
});

describe('Credencial de MercadoPago', () => {
  it('distingue el Access Token (producción / prueba) de la Public Key', () => {
    expect(tipoCredencialMP(ACCESS)).toBe('access-token');
    expect(tipoCredencialMP(ACCESS_PRUEBA)).toBe('access-token-prueba');
    expect(tipoCredencialMP(PUBLIC_KEY)).toBe('public-key');
    expect(tipoCredencialMP('abc123')).toBe('desconocida');
    expect(tipoCredencialMP('  ')).toBe('falta');
    expect(tipoCredencialMP(undefined)).toBe('falta');
  });

  it('tolera espacios y un "Bearer " pegado de más', () => {
    expect(limpiarTokenMP(`  Bearer ${ACCESS}\n`)).toBe(ACCESS);
    expect(tipoCredencialMP(`Bearer ${ACCESS}`)).toBe('access-token');
  });

  it('solo frena antes de llamar si falta o es la Public Key (un formato nuevo se prueba igual)', () => {
    expect(bloqueaCredencialMP('falta')).toBe(true);
    expect(bloqueaCredencialMP('public-key')).toBe(true);
    expect(bloqueaCredencialMP('desconocida')).toBe(false);
    expect(bloqueaCredencialMP('access-token')).toBe(false);
  });

  it('dice qué cargar cuando no es el Access Token', () => {
    expect(problemaCredencialMP('public-key')).toMatch(/Public Key, no el Access Token/);
    expect(problemaCredencialMP('desconocida')).toMatch(/no tiene formato de Access Token/);
    expect(problemaCredencialMP('falta')).toMatch(/falta el Project Secret MERCADOPAGO_ACCESS_TOKEN/);
    expect(problemaCredencialMP('access-token')).toBeUndefined();
  });
});

describe('Errores de MercadoPago', () => {
  it('el 403 PolicyAgent se explica con los pasos a revisar', () => {
    expect(esRechazoDePoliticas(403, RECHAZO_POLITICAS)).toBe(true);
    expect(resumenErrorMP(403, RECHAZO_POLITICAS)).toBe('403 PolicyAgent');
    expect(resumenErrorMP(401, '{"message":"invalid token"}')).toBe('401: invalid token');
    expect(resumenErrorMP(500, 'caído')).toBe('500');
    const m = explicarErrorMP(403, RECHAZO_POLITICAS, 'access-token');
    expect(m).toMatch(/403 PolicyAgent/);
    expect(m).toMatch(/Access Token de producción de la cuenta de SOM/);
    expect(m).toMatch(/credenciales de producción/);
    expect(m).toMatch(/habilitada para cobrar/);
    expect(m).not.toContain('{"blocked_by"'); // ya no sale el JSON crudo
    expect(explicarErrorMP(403, RECHAZO_POLITICAS, 'access-token-prueba')).toMatch(/es de PRUEBA \(TEST-\)/);
  });

  it('401 y 400 también se traducen', () => {
    expect(explicarErrorMP(401, '{"message":"invalid access token"}', 'access-token')).toMatch(/inválido, venció o fue renovado/);
    expect(explicarErrorMP(400, '{"message":"unit_price invalid"}', 'access-token')).toBe('MercadoPago rechazó el pedido (400: unit_price invalid).');
  });
});

describe('Cuenta de MercadoPago (GET /users/me)', () => {
  it('una cuenta de Argentina activa no muestra problemas', () => {
    expect(diagnosticarCuentaMP(CUENTA_OK)).toEqual({ resumen: 'cuenta 987654321 (SEGUNDAOPINION), Argentina', problemas: [] });
  });

  it('detecta lo que impide cobrar', () => {
    const d = diagnosticarCuentaMP({
      id: 1,
      site_id: 'MLB',
      tags: ['test_user'],
      status: { site_status: 'deactive', mercadopago_tc_accepted: false, required_action: 'validar identidad', sell: { allow: false, codes: ['address_pending'] } },
    });
    expect(d.problemas.join(' ')).toMatch(/otro país \(site MLB\)/);
    expect(d.problemas.join(' ')).toMatch(/usuario de PRUEBA/);
    expect(d.problemas.join(' ')).toMatch(/términos y condiciones/);
    expect(d.problemas.join(' ')).toMatch(/validar identidad/);
    expect(d.problemas.join(' ')).toMatch(/habilitada para vender\/cobrar \(address_pending\)/);
  });

  it('resumen de la credencial para Recepción', () => {
    expect(resumenCredencial(diagnosticarCuentaMP(CUENTA_OK), 'access-token')).toBe(
      'La credencial de MercadoPago funciona (cuenta 987654321 (SEGUNDAOPINION), Argentina).',
    );
    expect(resumenCredencial({ error: '403' }, 'access-token')).toMatch(/no funciona: MercadoPago no deja leer la cuenta \(403\)/);
  });
});

describe('Seña por MercadoPago', () => {
  it('nunca por $0 (precios PENDIENTES)', () => {
    expect(problemaMontoSena(0)).toMatch(/precio de la consulta está PENDIENTE/);
    expect(problemaMontoSena(NaN)).toBeDefined();
    expect(problemaMontoSena(5000)).toBeUndefined();
  });

  it('la preferencia lleva el turno como referencia externa', () => {
    expect(
      armarPreferenciaSena({ appointmentId: 'a1', descripcion: 'Consulta de Cardiología', senaARS: 5000, appUrl: 'https://recepcion.segundaopinionmedica.org' }),
    ).toMatchObject({
      items: [{ title: 'Seña 50% · Consulta de Cardiología', quantity: 1, unit_price: 5000, currency_id: 'ARS' }],
      external_reference: 'a1',
      auto_return: 'approved',
    });
  });
});

describe('Bot som-link-mercadopago', () => {
  it('con la Public Key no llama a MercadoPago y dice qué cargar', async () => {
    const llamadas = stubFetch({});
    const { medplum } = fakeMedplum([turno]);
    const r = await linkMercadoPago(medplum, ev({ appointmentId: 'a1' }, PUBLIC_KEY));
    expect(r).toMatchObject({ ok: false, credencial: 'public-key' });
    expect(r.mensaje).toMatch(/Public Key, no el Access Token/);
    expect(llamadas).toHaveLength(0);
  });

  it('seña $0 (precio aún PENDIENTE, p. ej. el control GLP-1): no crea el link, pero verifica la credencial', async () => {
    const llamadas = stubFetch({ 'https://api.mercadopago.com/users/me': () => respuesta(200, CUENTA_OK) });
    const sinPrecio: Appointment = {
      ...turno,
      description: 'Seguimiento de tratamiento GLP-1 — Control',
      extension: [
        { url: EXT.itemTipo, valueCode: 'servicio' },
        { url: EXT.itemCodigo, valueString: 'CONTROL_GLP1' },
      ],
    };
    const { medplum } = fakeMedplum([sinPrecio]);
    const r = await linkMercadoPago(medplum, ev({ appointmentId: 'a1' }, ACCESS));
    expect(r.ok).toBe(false);
    expect(r.senaARS).toBe(0);
    expect(r.mensaje).toMatch(/seña de este turno es \$0/);
    expect(r.mensaje).toMatch(/La credencial de MercadoPago funciona \(cuenta 987654321/);
    expect(llamadas.map((l) => l.url)).toEqual(['https://api.mercadopago.com/users/me']);
  });

  it('403 PolicyAgent: explica y suma lo que se ve de la cuenta, sin el JSON crudo', async () => {
    precio.sena = 5000;
    stubFetch({
      'https://api.mercadopago.com/checkout/preferences': () => respuesta(403, RECHAZO_POLITICAS),
      'https://api.mercadopago.com/users/me': () => respuesta(403, RECHAZO_POLITICAS),
    });
    const { medplum } = fakeMedplum([turno]);
    const r = await linkMercadoPago(medplum, ev({ appointmentId: 'a1' }, ACCESS));
    expect(r).toMatchObject({ ok: false, senaARS: 5000, credencial: 'access-token' });
    expect(r.mensaje).toMatch(/403 PolicyAgent/);
    expect(r.mensaje).toMatch(/tampoco deja leer la cuenta \(403 PolicyAgent\)/);
    expect(r.mensaje).not.toContain('{"blocked_by"');
    expect(r.mensaje).not.toContain(ACCESS);
  });

  it('403 con una cuenta que no puede cobrar: lo dice', async () => {
    precio.sena = 5000;
    stubFetch({
      'https://api.mercadopago.com/checkout/preferences': () => respuesta(403, RECHAZO_POLITICAS),
      'https://api.mercadopago.com/users/me': () =>
        respuesta(200, { ...CUENTA_OK, status: { ...CUENTA_OK.status, required_action: 'validar identidad' } }),
    });
    const { medplum } = fakeMedplum([turno]);
    const r = await linkMercadoPago(medplum, ev({ appointmentId: 'a1' }, ACCESS));
    expect(r.mensaje).toMatch(/En la cuenta 987654321 \(SEGUNDAOPINION\), Argentina: MercadoPago pide completar una acción en la cuenta: validar identidad/);
  });

  it('con la credencial buena y un precio, devuelve el link (token limpio en el header)', async () => {
    precio.sena = 5000;
    const llamadas = stubFetch({
      'https://api.mercadopago.com/checkout/preferences': () => respuesta(201, { init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1' }),
    });
    const { medplum } = fakeMedplum([turno]);
    const r = await linkMercadoPago(medplum, ev({ appointmentId: 'a1' }, `  ${ACCESS}\n`));
    expect(r).toEqual({ ok: true, senaARS: 5000, credencial: 'access-token', url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1' });
    expect((llamadas[0]?.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(String(llamadas[0]?.init?.body))).toMatchObject({ external_reference: 'a1', items: [{ unit_price: 5000 }] });
  });

  it('un token con formato desconocido se prueba igual; si MercadoPago lo rechaza, se avisa el formato', async () => {
    precio.sena = 5000;
    const llamadas = stubFetch({
      'https://api.mercadopago.com/checkout/preferences': () => respuesta(403, RECHAZO_POLITICAS),
      'https://api.mercadopago.com/users/me': () => respuesta(401, '{"message":"invalid token"}'),
    });
    const { medplum } = fakeMedplum([turno]);
    const r = await linkMercadoPago(medplum, ev({ appointmentId: 'a1' }, 'client-secret-xyz'));
    expect(r.credencial).toBe('desconocida');
    expect(llamadas.map((l) => l.url)).toEqual(['https://api.mercadopago.com/checkout/preferences', 'https://api.mercadopago.com/users/me']);
    expect(r.mensaje).toMatch(/^MERCADOPAGO_ACCESS_TOKEN no tiene formato de Access Token.*403 PolicyAgent.*tampoco deja leer la cuenta \(401: invalid token\)/);
  });

  it('modo diagnóstico: no toca turnos, revisa la credencial y la cuenta', async () => {
    stubFetch({ 'https://api.mercadopago.com/users/me': () => respuesta(200, CUENTA_OK) });
    const { medplum } = fakeMedplum([]);
    const r = await linkMercadoPago(medplum, ev({ diagnosticar: true }, ACCESS));
    expect(r).toMatchObject({ ok: true, credencial: 'access-token', cuenta: { resumen: 'cuenta 987654321 (SEGUNDAOPINION), Argentina' } });

    stubFetch({ 'https://api.mercadopago.com/users/me': () => respuesta(403, RECHAZO_POLITICAS) });
    const mala = await linkMercadoPago(medplum, ev({ diagnosticar: true }, ACCESS));
    expect(mala.ok).toBe(false);
    expect(mala.mensaje).toMatch(/no funciona/);
  });
});

describe('Bot som-webhook-mercadopago', () => {
  it('con la Public Key no consulta el pago y deja el motivo', async () => {
    const llamadas = stubFetch({});
    const { medplum } = fakeMedplum([]);
    const r = await webhookMercadoPago(medplum, ev({ type: 'payment', data: { id: 123 } }, PUBLIC_KEY));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/Public Key/);
    expect(llamadas).toHaveLength(0);
  });

  it('si MercadoPago rechaza la consulta del pago, explica por qué', async () => {
    stubFetch({ 'https://api.mercadopago.com/v1/payments/123': () => respuesta(403, RECHAZO_POLITICAS) });
    const { medplum } = fakeMedplum([]);
    const r = await webhookMercadoPago(medplum, ev({ type: 'payment', data: { id: 123 } }, ACCESS));
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/MP payments respondió 403\. MercadoPago bloqueó el pedido \(403 PolicyAgent\): la credencial cargada no está autorizada para consultar los pagos/);
  });
});
