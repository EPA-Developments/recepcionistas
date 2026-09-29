/**
 * Firma de los tokens de Jitsi, compartida por los bots de teleconsulta.
 *
 * La usan `som-teleconsulta-token` (el profesional, moderador) y
 * `som-teleconsulta-entrar` (la paciente, no moderadora). Lo que el token dice y
 * cuándo vale está en `src/lib/teleconsulta.ts`, que es puro; acá queda lo que
 * necesita el servidor: los secretos, `node:crypto` y el nombre de la ficha.
 *
 * No va en `src/lib/` porque `node:crypto` no entra en el navegador, y la app de
 * Recepción importa de ahí.
 *
 * Project Secrets: `JITSI_BASE_URL` (el mismo del link), `JITSI_APP_ID` y
 * `JITSI_APP_SECRET`. Sin los tres no hay token: el Jitsi sigue abierto y se
 * entra con el link, como antes.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { createHmac } from 'node:crypto';
import { claimsToken, dominioJitsi, type RolSala } from '../lib/teleconsulta.js';

export interface ConfigJitsi {
  /** El host del Jitsi, desde `JITSI_BASE_URL`. */
  dominio: string;
  appId: string;
  secreto: string;
}

/** Los tres secretos, o nada: con uno solo no se firma. */
export function configJitsi(secrets: BotEvent['secrets']): ConfigJitsi | undefined {
  const dominio = dominioJitsi(secrets['JITSI_BASE_URL']?.valueString);
  const appId = secrets['JITSI_APP_ID']?.valueString?.trim();
  const secreto = secrets['JITSI_APP_SECRET']?.valueString;
  return dominio && appId && secreto ? { dominio, appId, secreto } : undefined;
}

/** Un JWT HS256, firmado con el secreto del Jitsi. */
export function firmarJwt(claims: object, secreto: string): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cabecera = b64({ alg: 'HS256', typ: 'JWT' });
  const cuerpo = b64(claims);
  const firma = createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

/** El token de una sala para un rol: vence cuando cierra la sala. */
export function tokenDeSala(
  cfg: ConfigJitsi,
  datos: { sala: string; nombre: string; rol: RolSala; inicio: Date; fin: Date },
): { jwt: string; venceISO: string } {
  const claims = claimsToken({ appId: cfg.appId, dominio: cfg.dominio, ...datos });
  return { jwt: firmarJwt(claims, cfg.secreto), venceISO: new Date(claims.exp * 1000).toISOString() };
}

/**
 * El link de la sala con el token, como lo lee Jitsi (`?jwt=`). Sólo para devolverlo
 * a quien lo pidió: nunca en un mensaje, que se reenvía y serviría toda la ventana.
 */
export function linkConToken(link: string, jwt: string): string {
  const url = new URL(link);
  url.searchParams.set('jwt', jwt);
  return url.toString();
}

/** El nombre visible en la sala: el de la ficha. Nunca documento ni email. */
export async function nombreVisible(medplum: MedplumClient, ref: string): Promise<string> {
  const [tipo, id] = ref.split('/');
  if ((tipo !== 'Patient' && tipo !== 'Practitioner') || !id) {
    return 'Participante';
  }
  try {
    const r = await medplum.readResource(tipo, id);
    const n = r.name?.[0];
    const texto = n?.text ?? [n?.given?.join(' '), n?.family].filter(Boolean).join(' ');
    return texto?.trim() || 'Participante';
  } catch {
    // Sin nombre se entra igual: quedarse afuera de la consulta por no poder leer
    // la ficha sería el peor de los dos errores posibles.
    return 'Participante';
  }
}
