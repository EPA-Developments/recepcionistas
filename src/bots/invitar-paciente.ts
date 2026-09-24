/**
 * Bot · Invitar paciente al portal.
 *
 * Le da acceso de login al paciente (para ver SUS turnos/plan/pagos) reutilizando
 * el invite de Medplum con `sendEmail:false`, y entrega el link mágico
 * (`/setpassword/{id}/{secret}`) por el canal elegido:
 *   - whatsapp → Twilio;     - email → mail Segunda Opinión Médica (SES);     - qr → devuelve
 *     el link para que el front lo muestre como QR en el mostrador.
 *
 * Reusa el `Patient` existente (`upsert:true` → no duplica). Requiere que el bot
 * tenga **admin del proyecto** (el invite es un endpoint de administración).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, Patient, ProjectMembership, UserSecurityRequest } from '@medplum/fhirtypes';
import { PORTAL_BASE_URL_DEFAULT, urlBase } from '../config/urls.js';
import { EXT } from '../fhir/identifiers.js';
import { NOMBRE_POLICY_PACIENTE } from '../fhir/access-policies.js';
import {
  esCanalValido,
  esOrigenValido,
  extensionesInvitacion,
  linkSetPassword,
  mensajeInvitacion,
  partirNombre,
  validarEmail,
  type CanalInvitacion,
  type OrigenPaciente,
} from '../lib/onboarding.js';
import { enviarEmail, enviarWhatsApp, resolverProjectId } from './_shared.js';

export interface EntradaInvitarPaciente {
  pacienteRef: string; // "Patient/123"
  canal: CanalInvitacion;
  /** Email para el login (si no se pasa, se toma del Patient.telecom). */
  email?: string;
  /**
   * Origen del paciente para el Patient Journey del portal (`patient-origin`):
   * `reception` (default) o `referral` (derivación de un colega).
   */
  origen?: OrigenPaciente;
}

export interface ResultadoInvitarPaciente {
  ok: boolean;
  mensaje?: string;
  canal?: CanalInvitacion;
  membershipId?: string;
  /** Link de activación (para QR / copiar). Es sensible: sólo para uso de recepción. */
  link?: string;
  /** true si el link se entregó por WhatsApp/email. */
  enviado?: boolean;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaInvitarPaciente>,
): Promise<ResultadoInvitarPaciente> {
  const e = event.input;
  try {
    if (!esCanalValido(e.canal)) {
      return { ok: false, mensaje: 'Canal de invitación inválido (whatsapp / email / qr).' };
    }
    if (e.origen !== undefined && !esOrigenValido(e.origen)) {
      return { ok: false, mensaje: 'Origen inválido (reception / referral).' };
    }

    // El link va al PORTAL del paciente SOM, no a la app de recepción
    // (Project Secret PORTAL_BASE_URL; default: el portal de producción).
    const portalUrl = urlBase(event.secrets['PORTAL_BASE_URL']?.valueString, PORTAL_BASE_URL_DEFAULT);

    const patient = await medplum.readResource('Patient', e.pacienteRef.split('/')[1]!);
    const email = (e.email ?? patient.telecom?.find((t) => t.system === 'email')?.value)?.trim();
    if (!validarEmail(email)) {
      return { ok: false, mensaje: 'El paciente necesita un email válido para acceder al portal.' };
    }

    const display = patient.name?.[0]?.text ?? '';
    const given = patient.name?.[0]?.given?.join(' ');
    const family = patient.name?.[0]?.family;
    const { firstName, lastName } =
      given || family ? { firstName: given ?? '', lastName: family ?? '' } : partirNombre(display);

    // Registrar en el Patient el canal elegido (auditoría) y el origen que lee el
    // portal (`patient-origin`: Bienvenida vs Onboarding) + asegurar el email.
    const extension = extensionesInvitacion(patient.extension, e.canal, e.origen);
    const telecom = [...(patient.telecom ?? [])];
    if (!telecom.some((t) => t.system === 'email' && t.value === email)) {
      telecom.push({ system: 'email', value: email });
    }
    await medplum.updateResource<Patient>({ ...patient, telecom, extension });

    // AccessPolicy del portal (mínimo privilegio: sólo lo suyo).
    const policy = await medplum.searchOne('AccessPolicy', `name=${encodeURIComponent(NOMBRE_POLICY_PACIENTE)}`);
    if (!policy?.id) {
      return { ok: false, mensaje: `Falta la AccessPolicy "${NOMBRE_POLICY_PACIENTE}". Corré: npm run seed.` };
    }

    // Invite (sin email nativo): crea User + ProjectMembership, reusa el Patient.
    const projectId = await resolverProjectId(medplum);
    const membership = (await medplum.post(`admin/projects/${projectId}/invite`, {
      resourceType: 'Patient',
      firstName,
      lastName,
      email,
      sendEmail: false,
      upsert: true,
      membership: { accessPolicy: { reference: `AccessPolicy/${policy.id}` } },
    })) as ProjectMembership;

    // Recuperar el link mágico (UserSecurityRequest recién creado para ese usuario).
    const userId = membership.user?.reference?.split('/')[1];
    let link: string | undefined;
    if (userId) {
      // UserSecurityRequest no está en el union tipado de búsqueda: vía REST directo.
      const bundle = (await medplum.get(
        `fhir/R4/UserSecurityRequest?user=User/${userId}&_sort=-_lastUpdated&_count=1`,
      )) as Bundle<UserSecurityRequest>;
      const usr = bundle.entry?.[0]?.resource;
      if (usr?.id && usr.secret) {
        link = linkSetPassword(portalUrl, usr.id, usr.secret);
      }
    }

    if (!link) {
      return {
        ok: true,
        canal: e.canal,
        membershipId: membership.id,
        mensaje:
          'Se creó el acceso, pero no pude generar el link automáticamente. ' +
          'Revisá que el bot tenga permiso de lectura de UserSecurityRequest.',
      };
    }

    // Entrega por el canal elegido (qr: lo muestra el front con el link devuelto).
    // `enviado` refleja el envío REAL (status de la Communication), no el intento.
    let enviado = false;
    let avisoCanal: string | undefined;
    if (e.canal === 'whatsapp') {
      const comm = await enviarWhatsApp(medplum, event.secrets, {
        template: 'invitacion-portal',
        pacienteRef: e.pacienteRef,
        body: mensajeInvitacion(display, link, portalUrl).texto,
      });
      enviado = comm.status === 'completed';
      if (!enviado) {
        avisoCanal = 'El acceso se creó y el link está listo, pero el WhatsApp no salió (revisá Twilio / teléfono). Podés compartir el link por otro canal.';
      }
    } else if (e.canal === 'email') {
      const m = mensajeInvitacion(display, link, portalUrl);
      // Remitente con marca (la dirección sigue siendo la identidad SES verificada).
      // Configurable con el secret EMAIL_FROM.
      const from = event.secrets['EMAIL_FROM']?.valueString ?? 'Segunda Opinión Médica <hola@medplum.com.ar>';
      const comm = await enviarEmail(medplum, {
        to: email,
        asunto: m.asunto,
        cuerpo: m.texto,
        template: 'invitacion-portal',
        pacienteRef: e.pacienteRef,
        from,
      });
      enviado = comm.status === 'completed';
      if (!enviado) {
        avisoCanal = 'El acceso se creó y el link está listo, pero el email no salió (revisá SES). Podés compartir el link por otro canal.';
      }
    }

    return { ok: true, canal: e.canal, membershipId: membership.id, link, enviado, mensaje: avisoCanal };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'No se pudo invitar al paciente.';
    const forbidden = /forbidden/i.test(msg);
    return {
      ok: false,
      mensaje: forbidden
        ? 'El bot no tiene permiso de admin del proyecto para invitar. Asigná admin a su ProjectMembership en Medplum.'
        : msg,
    };
  }
}
