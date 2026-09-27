/**
 * URLs públicas de Segunda Opinión Médica.
 *
 * Son los defaults de producción; los Project Secrets `PORTAL_BASE_URL` y
 * `APP_BASE_URL` los pisan por entorno (p. ej. staging).
 */

/** Portal del paciente (destino del link de invitación). */
export const PORTAL_BASE_URL_DEFAULT = 'https://app.segundaopinionmedica.org';

/** App de recepción. (Las back_urls de MercadoPago van al portal: paga el paciente.) */
export const APP_BASE_URL_DEFAULT = 'https://recepcion.segundaopinionmedica.org';

/**
 * Webhooks públicos en el nginx del API (Twilio y MercadoPago los llaman): rutas limpias,
 * **sin credenciales en la URL**. nginx agrega el `Authorization` de la ClientApplication
 * dedicada de cada webhook y reenvía al `$execute` del bot
 * (`deploy/nginx-webhooks-som.conf`). La clave vive solo en el servidor.
 */
export const RUTA_WEBHOOK_TWILIO = '/webhooks/som/twilio-whatsapp';
export const RUTA_WEBHOOK_MERCADOPAGO = '/webhooks/som/mercadopago';

/** URL base efectiva: la del Project Secret si está cargada, si no el default; sin barra final. */
export function urlBase(secreto: string | undefined, porDefecto: string): string {
  return (secreto?.trim() || porDefecto).replace(/\/+$/, '');
}
