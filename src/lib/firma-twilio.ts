/**
 * Firma de Twilio (`X-Twilio-Signature`) — el control del webhook público de WhatsApp.
 *
 * Con la URL pública (nginx, sin credenciales) cualquiera puede llamar al webhook: el bot
 * acepta solo lo que Twilio firmó con el Auth Token de la cuenta de SOM. Algoritmo
 * (https://www.twilio.com/docs/usage/webhooks/webhooks-security): HMAC-SHA1 con el Auth
 * Token sobre la URL que llamó Twilio + cada parámetro del POST ordenado por nombre
 * (nombre y valor pegados), en base64.
 *
 * Usa `node:crypto`: lo importan solo los bots y los scripts, nunca el front.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { modoUrlWebhook } from './webhooks.js';
import { camposTwilio } from './whatsapp.js';

type Encabezados = Record<string, string | string[] | undefined>;

/** La firma que Twilio pone en `X-Twilio-Signature` para esa URL y esos parámetros. */
export function firmaTwilio(authToken: string, url: string, params: Record<string, string>): string {
  const datos = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(datos, 'utf8').digest('base64');
}

/**
 * La URL tal cual y con/sin el puerto por defecto: Twilio puede firmar cualquiera de las
 * dos (así validan sus SDK). Sobre el texto: `new URL()` borra el puerto por defecto.
 */
export function variantesUrl(url: string): string[] {
  const m = /^(https?:\/\/[^/?#:@]+)(:\d+)?(.*)$/i.exec(url);
  if (!m) {
    return [url];
  }
  const [, origen, puerto, resto] = m;
  const porDefecto = /^https:/i.test(url) ? ':443' : ':80';
  if (!puerto) {
    return [url, `${origen}${porDefecto}${resto}`];
  }
  return puerto === porDefecto ? [url, `${origen}${resto}`] : [url];
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function encabezado(headers: Encabezados, nombre: string): string | undefined {
  const clave = Object.keys(headers).find((k) => k.toLowerCase() === nombre);
  const v = clave === undefined ? undefined : headers[clave];
  return Array.isArray(v) ? v[0] : v;
}

export type ControlFirma = { ok: true } | { ok: false; motivo: string };

/**
 * ¿Se acepta el pedido que llegó al webhook? Falla cerrado:
 *  - sin `TWILIO_WEBHOOK_URL` no hay contra qué validar → se rechaza;
 *  - URL **directa** (credenciales en la URL, temporal): Medplum ya autenticó la
 *    ClientApplication dedicada → se acepta;
 *  - URL **pública** (nginx): la firma es obligatoria y tiene que coincidir.
 * Los motivos nunca incluyen el token ni la firma.
 */
export function controlarFirmaTwilio(p: {
  urlWebhook: string | undefined;
  authToken: string | undefined;
  headers: Encabezados | undefined;
  input: unknown;
}): ControlFirma {
  const url = p.urlWebhook?.trim();
  if (!url) {
    return { ok: false, motivo: 'Falta el Project Secret TWILIO_WEBHOOK_URL: sin él no se puede validar el pedido.' };
  }
  const modo = modoUrlWebhook(url);
  if (modo === 'directa') {
    return { ok: true };
  }
  if (!modo) {
    return { ok: false, motivo: 'TWILIO_WEBHOOK_URL no es una URL válida.' };
  }
  if (!p.authToken) {
    return { ok: false, motivo: 'Falta el Project Secret TWILIO_AUTH_TOKEN: sin él no se puede validar la firma de Twilio.' };
  }
  if (!p.headers) {
    return {
      ok: false,
      motivo: 'El servidor Medplum no le pasa los encabezados al bot (hace falta Medplum ≥ 4.2): no se puede validar la firma de Twilio.',
    };
  }
  const firma = encabezado(p.headers, 'x-twilio-signature');
  if (!firma) {
    return { ok: false, motivo: 'El pedido no trae la firma de Twilio (X-Twilio-Signature).' };
  }
  const params = camposTwilio(p.input);
  const token = p.authToken;
  const valida = variantesUrl(url).some((v) => iguales(firmaTwilio(token, v, params), firma));
  return valida ? { ok: true } : { ok: false, motivo: 'La firma de Twilio no coincide: el pedido no viene de la cuenta de SOM.' };
}
