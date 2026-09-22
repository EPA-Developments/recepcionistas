/**
 * URLs públicas de Segunda Opinión Médica.
 *
 * Son los defaults de producción; los Project Secrets `PORTAL_BASE_URL` y
 * `APP_BASE_URL` los pisan por entorno (p. ej. staging).
 */

/** Portal del paciente (destino del link de invitación). */
export const PORTAL_BASE_URL_DEFAULT = 'https://app.segundaopinionmedica.org';

/** App de recepción (back_urls de MercadoPago). */
export const APP_BASE_URL_DEFAULT = 'https://recepcion.segundaopinionmedica.org';

/** URL base efectiva: la del Project Secret si está cargada, si no el default; sin barra final. */
export function urlBase(secreto: string | undefined, porDefecto: string): string {
  return (secreto?.trim() || porDefecto).replace(/\/+$/, '');
}
