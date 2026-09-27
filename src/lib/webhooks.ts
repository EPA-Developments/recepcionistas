/**
 * Webhooks públicos (Twilio y MercadoPago) — lógica pura de su configuración (sin red).
 *
 * Twilio y MercadoPago llaman a rutas limpias del nginx del API (`/webhooks/som/…`), **sin
 * credenciales en la URL**: nginx agrega el `Authorization` de la ClientApplication dedicada
 * de cada webhook y reenvía al `$execute` del bot (`deploy/nginx-webhooks-som.conf`). Así
 * la clave no aparece en la consola de Twilio, en el panel de MercadoPago, en los
 * `StatusCallback` de cada envío ni en los logs: vive solo en el servidor.
 *
 * Como la URL es pública, cada bot valida que el pedido sea legítimo: el de WhatsApp, la
 * firma `X-Twilio-Signature` (`firma-twilio.ts`); el de MercadoPago, consultando el pago
 * a la API de MercadoPago.
 *
 * La URL "directa" (`https://<clientId>:<clientSecret>@…/Bot/<id>/$execute`) queda solo para
 * Twilio y como paso temporal mientras nginx no tiene el bloque: expone la clave.
 */
import { NOMBRE_POLICY_WEBHOOK_MERCADOPAGO, NOMBRE_POLICY_WEBHOOK_TWILIO } from '../fhir/access-policies.js';
import { BOT_WEBHOOK_MERCADOPAGO, BOT_WHATSAPP_ENTRANTE } from '../fhir/identifiers.js';
import { RUTA_WEBHOOK_MERCADOPAGO, RUTA_WEBHOOK_TWILIO } from '../config/urls.js';

export interface DefWebhook {
  /** Quién llama. */
  nombre: string;
  bot: string;
  /** ClientApplication cuyas credenciales agrega nginx. */
  cliente: string;
  policy: string;
  /** Ruta pública en el nginx del API. */
  ruta: string;
  /** Project Secret con la URL pública (Twilio: `StatusCallback`; MercadoPago: `notification_url`). */
  secret: 'TWILIO_WEBHOOK_URL' | 'MP_WEBHOOK_URL';
  /** Placeholders de su bloque en `deploy/nginx-webhooks-som.conf`. */
  nginx: { botId: string; basic: string };
}

export const WEBHOOK_TWILIO: DefWebhook = {
  nombre: 'WhatsApp (Twilio)',
  bot: BOT_WHATSAPP_ENTRANTE,
  cliente: 'Webhook Twilio',
  policy: NOMBRE_POLICY_WEBHOOK_TWILIO,
  ruta: RUTA_WEBHOOK_TWILIO,
  secret: 'TWILIO_WEBHOOK_URL',
  nginx: { botId: 'BOT_ID_SOM_WHATSAPP_ENTRANTE', basic: 'BASIC_SOM_WEBHOOK_TWILIO' },
};

export const WEBHOOK_MERCADOPAGO: DefWebhook = {
  nombre: 'MercadoPago',
  bot: BOT_WEBHOOK_MERCADOPAGO,
  cliente: 'Webhook MercadoPago',
  policy: NOMBRE_POLICY_WEBHOOK_MERCADOPAGO,
  ruta: RUTA_WEBHOOK_MERCADOPAGO,
  secret: 'MP_WEBHOOK_URL',
  nginx: { botId: 'BOT_ID_SOM_WEBHOOK_MP', basic: 'BASIC_SOM_WEBHOOK_MP' },
};

export const WEBHOOKS: readonly DefWebhook[] = [WEBHOOK_TWILIO, WEBHOOK_MERCADOPAGO];

/**
 * Project Secrets que necesita el canal WhatsApp: enviar, validar la firma del webhook y
 * pedir los ✓✓. (`RECEPCION_WHATSAPP_TO` es opcional.)
 */
export const SECRETS_TWILIO = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_WEBHOOK_URL'] as const;

/** URL pública de un webhook: el host del API + la ruta de nginx. */
export function urlPublicaWebhook(baseUrl: string, ruta: string): string {
  return new URL(ruta, baseUrl).toString();
}

/** Lo que va después de `Basic ` en el `Authorization` que agrega nginx (base64 de `clientId:clave`, sin salto de línea). */
export function basicDeCliente(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`);
}

/** `publica` (nginx, sin credenciales) o `directa` (credenciales en la URL, temporal). */
export function modoUrlWebhook(url: string): 'publica' | 'directa' | undefined {
  try {
    const u = new URL(url.trim());
    return u.username || u.password ? 'directa' : 'publica';
  } catch {
    return undefined;
  }
}

/** Ruta del `$execute` de un bot bajo el servidor Medplum (respeta un prefijo en la base). */
function rutaExecute(baseUrl: string, botId: string): URL {
  return new URL(`fhir/R4/Bot/${encodeURIComponent(botId)}/$execute`, baseUrl.replace(/\/?$/, '/'));
}

/**
 * URL **directa** del webhook de Twilio (temporal, mientras nginx no tiene el bloque): el
 * `$execute` del bot con las credenciales de la ClientApplication en la URL.
 * `_medplum-prompt-basic-auth=1` es obligatorio: Twilio manda las credenciales solo si el
 * servidor responde 401 con `WWW-Authenticate: Basic`, y Medplum lo hace solo con él.
 */
export function urlDirectaWebhookTwilio(p: { baseUrl: string; botId: string; clientId: string; clientSecret: string }): string {
  const u = rutaExecute(p.baseUrl, p.botId);
  u.username = p.clientId;
  u.password = p.clientSecret;
  u.searchParams.set('_medplum-prompt-basic-auth', '1');
  return u.toString();
}

/**
 * La URL con la clave tapada, para mostrarla. Solo muestra URLs http(s): `id:clave` sin
 * esquema también "parsea" (esquema `id:`) y se vería entera.
 */
export function ocultarClaveUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return '(URL inválida)';
    }
    if (u.password) {
      u.password = '***';
    }
    return u.toString();
  } catch {
    return '(URL inválida)';
  }
}

/** Qué está mal en la URL pública de un webhook (vacío = bien). */
export function problemasUrlPublica(url: string | undefined, esperado: { baseUrl: string; ruta: string }): string[] {
  if (!url?.trim()) {
    return ['falta'];
  }
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return ['no es una URL válida'];
  }
  const publica = new URL(urlPublicaWebhook(esperado.baseUrl, esperado.ruta));
  const problemas: string[] = [];
  if (u.protocol !== 'https:') {
    problemas.push('tiene que ser https');
  }
  if (u.username || u.password) {
    problemas.push('lleva credenciales: la URL pública no las lleva (las agrega nginx)');
  }
  if (u.host !== publica.host) {
    problemas.push(`apunta a ${u.host}, no a ${publica.host}`);
  }
  if (u.pathname !== publica.pathname) {
    problemas.push(`la ruta tiene que ser ${publica.pathname}`);
  }
  return problemas;
}

/**
 * Qué está mal en `TWILIO_WEBHOOK_URL` (vacío = bien). Acepta la URL pública (nginx) o la
 * directa (temporal). Los textos nunca incluyen la clave: se pueden mostrar.
 */
export function problemasUrlWebhookTwilio(
  url: string | undefined,
  esperado: { baseUrl: string; botId: string; clientId?: string },
): string[] {
  if (!url?.trim()) {
    return ['falta: sin ella el webhook rechaza todo y no hay ✓✓'];
  }
  const modo = modoUrlWebhook(url);
  if (!modo) {
    return ['no es una URL válida'];
  }
  if (modo === 'publica') {
    return problemasUrlPublica(url, { baseUrl: esperado.baseUrl, ruta: RUTA_WEBHOOK_TWILIO });
  }
  const u = new URL(url.trim());
  const ruta = rutaExecute(esperado.baseUrl, esperado.botId);
  const problemas: string[] = [];
  if (u.protocol !== 'https:') {
    problemas.push('tiene que ser https');
  }
  if (u.host !== ruta.host) {
    problemas.push(`apunta a ${u.host}, no a ${ruta.host}`);
  }
  if (!u.username || !u.password) {
    problemas.push(`las credenciales de "${WEBHOOK_TWILIO.cliente}" están incompletas (https://<clientId>:<clientSecret>@…)`);
  } else if (esperado.clientId && decodeURIComponent(u.username) !== esperado.clientId) {
    problemas.push(`las credenciales no son las de "${WEBHOOK_TWILIO.cliente}" (clientId ${esperado.clientId})`);
  }
  if (u.pathname !== ruta.pathname) {
    problemas.push(`la ruta tiene que ser ${ruta.pathname} (el bot ${BOT_WHATSAPP_ENTRANTE})`);
  }
  if (u.searchParams.get('_medplum-prompt-basic-auth') !== '1') {
    problemas.push('falta ?_medplum-prompt-basic-auth=1: sin él Twilio nunca manda las credenciales');
  }
  return problemas;
}

/**
 * ¿El servidor Medplum le pasa los encabezados HTTP al bot? Desde la 4.2: sin eso el bot no
 * ve `X-Twilio-Signature` y con la URL pública rechaza todo.
 */
export function versionPasaEncabezados(version: string | undefined): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version?.trim() ?? '');
  if (!m) {
    return false;
  }
  const [mayor, menor] = [Number(m[1]), Number(m[2])];
  return mayor > 4 || (mayor === 4 && menor >= 2);
}
