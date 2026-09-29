/**
 * Firma de los tokens de Jitsi, compartida por los bots de teleconsulta.
 *
 * Hoy la usa sólo `som-teleconsulta-token`: el profesional es el único que entra con
 * token, y por eso modera; la paciente entra como invitada (decisión del 29/09/2026).
 * Lo que el token dice y cuándo vale está en `src/lib/teleconsulta.ts`, que es puro;
 * acá queda lo que necesita el servidor: los secretos, `node:crypto` y el nombre de
 * la ficha.
 *
 * No va en `src/lib/` porque `node:crypto` no entra en el navegador, y la app de
 * Recepción importa de ahí.
 *
 * Project Secrets: `JITSI_BASE_URL` (el mismo del link), `JITSI_APP_ID` y
 * `JITSI_APP_SECRET`. Sin los tres no hay token: el profesional entra con el link,
 * como la paciente, y no modera.
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
