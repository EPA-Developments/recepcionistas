/**
 * Onboarding de pacientes al portal — lógica pura (sin FHIR ni red).
 *
 * El alta del paciente crea el recurso `Patient`. La invitación al portal le da
 * login: usa el invite de Medplum con `sendEmail:false` y entrega el link mágico
 * (`/setpassword/{id}/{secret}`) por el canal elegido (WhatsApp / mail / QR).
 */
import type { Extension } from '@medplum/fhirtypes';
import { EXT } from '../fhir/identifiers.js';

export type CanalInvitacion = 'whatsapp' | 'email' | 'qr';

/**
 * Origen del paciente invitado (Patient Journey del portal): `reception` = lo invitó
 * Recepción; `referral` = lo derivó un colega. El portal ramifica la primera pantalla
 * (Bienvenida vs Onboarding) según este valor; sin la extensión lo trata como
 * auto-registrado (`self`), que el backend nunca escribe.
 */
export type OrigenPaciente = 'reception' | 'referral';

export function esOrigenValido(o: string | undefined): o is OrigenPaciente {
  return o === 'reception' || o === 'referral';
}

/**
 * Extensiones del Patient al invitarlo: registra el canal elegido (auditoría) y el
 * origen (`patient-origin`, valueCode). Si no se indica el origen, conserva el que
 * ya tenía (p. ej. una derivación) y si no tenía ninguno, es Recepción. Nunca toca
 * `onboarding-completed` (la escribe el portal).
 */
export function extensionesInvitacion(
  actuales: Extension[] | undefined,
  canal: CanalInvitacion,
  origen?: OrigenPaciente,
): Extension[] {
  const previo = actuales?.find((x) => x.url === EXT.patientOrigin)?.valueCode;
  const origenFinal: OrigenPaciente = origen ?? (esOrigenValido(previo) ? previo : 'reception');
  return [
    ...(actuales ?? []).filter((x) => x.url !== EXT.canalInvitacion && x.url !== EXT.patientOrigin),
    { url: EXT.canalInvitacion, valueCode: canal },
    { url: EXT.patientOrigin, valueCode: origenFinal },
  ];
}

export const CANALES_INVITACION: readonly CanalInvitacion[] = ['whatsapp', 'email', 'qr'];

export function esCanalValido(c: string | undefined): c is CanalInvitacion {
  return c === 'whatsapp' || c === 'email' || c === 'qr';
}

/**
 * Email mínimamente válido (algo@algo.dominio). No pretende ser RFC-completo:
 * sólo evita altas de portal con un email obviamente roto.
 */
export function validarEmail(email: string | undefined): email is string {
  if (!email) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Link mágico de Medplum para que el paciente fije su contraseña. */
export function linkSetPassword(baseUrl: string, id: string, secret: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/setpassword/${id}/${secret}`;
}

/** Parte el nombre completo en nombre + apellido (apellido = última palabra). */
export function partirNombre(completo: string): { firstName: string; lastName: string } {
  const partes = completo.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) {
    return { firstName: partes[0] ?? '', lastName: '' };
  }
  return { firstName: partes.slice(0, -1).join(' '), lastName: partes[partes.length - 1]! };
}

export interface MensajeInvitacion {
  asunto: string;
  texto: string;
}

/**
 * Cuerpo de la invitación al portal (mismo link mágico en todos los canales).
 * Personalizado para Segunda Opinión Médica (CABA): asunto de bienvenida + sugerencia de
 * añadir el portal a la pantalla de inicio (PWA). `portalUrl` es la URL del portal
 * del paciente (Project Secret `PORTAL_BASE_URL`), la que el paciente guarda.
 */
export function mensajeInvitacion(nombre: string, link: string, portalUrl: string): MensajeInvitacion {
  const saludo = nombre ? `¡Hola ${nombre}!` : '¡Hola!';
  return {
    asunto: 'Bienvenido a Segunda Opinión Médica | CABA',
    texto:
      `${saludo} Te damos la bienvenida a Segunda Opinión Médica 💙\n\n` +
      `Activá tu acceso al portal para ver tus turnos, tu plan, tus pagos y tus estudios. ` +
      `Entrá a este link y elegí tu contraseña:\n\n${link}\n\n` +
      `Después vas a poder ingresar siempre desde:\n${portalUrl.replace(/\/+$/, '')}\n\n` +
      `📲 Te recomendamos "Añadir a pantalla de inicio" para abrirlo como una app:\n` +
      `• iPhone (Safari): tocá Compartir → "Añadir a pantalla de inicio".\n` +
      `• Android (Chrome): tocá el menú ⋮ → "Añadir a pantalla de inicio".\n\n` +
      `Si no solicitaste esto, podés ignorar este mensaje.`,
  };
}
