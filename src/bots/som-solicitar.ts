/**
 * Bot · Solicitar segunda opinión médica (SOM) desde el portal del paciente.
 *
 * Análogo a `som-solicitar-turno`, pero para SOM: el paciente adjunta su
 * cuestionario clínico y sus estudios y pide una segunda opinión cardiológica.
 * Este bot crea una `ServiceRequest` (status `active`) que —vía Subscription—
 * dispara al bot interno `bot-som-report` (PREVENT + informe + PDF).
 *
 * Seguridad (contrato con el portal, `bot-som-interface.md` §1):
 *  - El paciente solo puede ejecutar ESTE bot (su AccessPolicy acota
 *    `Bot?name=som-solicitar`) y solo lee sus propias `ServiceRequest`.
 *  - `runAsUser` va DESACTIVADO: con la policy del paciente (ServiceRequest de solo
 *    lectura) la creación daría Forbidden. El bot escribe con su propia identidad
 *    (modelo de solicitud), por eso valida todo del lado del servidor:
 *      · consentimiento informado firmado (DocumentReference LOINC 59284-0);
 *      · quien ejecuta (`requester`, si Medplum lo informa) es el mismo paciente;
 *      · el cuestionario y los estudios adjuntos son de ese paciente.
 *
 * Contrato (entrada/salida) fijado por el portal (`EPA-Developments/app`,
 * `docs/medplum/bot-som-interface.md`). NO cambiar sin sincronizar con el portal.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Reference, Resource, ServiceRequest } from '@medplum/fhirtypes';
import { COD, EXT, SYSTEM } from '../fhir/identifiers.js';
import {
  MENSAJE_SIN_CONSENTIMIENTO,
  origenSom,
  resumenSolicitudSom,
  supportingInfoRefs,
  validarAdjuntosDelPaciente,
  validarSolicitante,
  validarSolicitudSom,
  type SolicitudSom,
} from '../lib/som-solicitud.js';
import { tieneConsentimiento } from './_shared.js';

export interface ResultadoSolicitudSom {
  ok: boolean;
  mensaje?: string;
  serviceRequestId?: string;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<SolicitudSom>,
): Promise<ResultadoSolicitudSom> {
  const e = event.input;
  const v = validarSolicitudSom(e);
  if (!v.ok) {
    return { ok: false, mensaje: v.error };
  }

  // Quién ejecuta: Medplum lo informa en `requester` (no está en el tipo de
  // @medplum/core 3.3; si el servidor no lo manda, rigen los demás controles).
  const requester = (event as BotEvent<SolicitudSom> & { requester?: Reference }).requester?.reference;
  const quien = validarSolicitante(requester, e.pacienteRef);
  if (!quien.ok) {
    return { ok: false, mensaje: quien.error };
  }

  // Precondición: consentimiento informado firmado. Sin él no se crea la orden
  // (y por lo tanto no se dispara el informe ni se envía nada al LLM).
  if (!(await tieneConsentimiento(medplum, e.pacienteRef))) {
    return { ok: false, mensaje: MENSAJE_SIN_CONSENTIMIENTO };
  }

  // Los adjuntos tienen que ser del mismo paciente.
  const adjuntos = await Promise.all(
    supportingInfoRefs(e).map(async (ref) => {
      const [tipo, id] = ref.split('/') as ['QuestionnaireResponse' | 'DocumentReference', string];
      const r = await medplum.readResource(tipo, id).catch(() => undefined);
      return { ref, subjectRef: r?.subject?.reference };
    }),
  );
  const propios = validarAdjuntosDelPaciente(e.pacienteRef, adjuntos);
  if (!propios.ok) {
    return { ok: false, mensaje: propios.error };
  }

  // Nombre del paciente (best-effort, para la nota legible).
  let nombre = '';
  try {
    const id = e.pacienteRef.split('/')[1];
    if (id) {
      const p = await medplum.readResource('Patient', id);
      nombre = p.name?.[0]?.text ?? [p.name?.[0]?.given?.join(' '), p.name?.[0]?.family].filter(Boolean).join(' ');
    }
  } catch {
    // sin nombre; seguimos
  }

  const supportingInfo: Reference<Resource>[] = supportingInfoRefs(e).map((reference) => ({ reference }));

  const serviceRequest = await medplum.createResource<ServiceRequest>({
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    authoredOn: new Date().toISOString(),
    code: {
      coding: [{ system: SYSTEM.somServices, code: COD.somCardiology, display: 'Segunda Opinión Cardiológica' }],
      text: 'Segunda opinión cardiológica',
    },
    subject: { reference: e.pacienteRef },
    requester: { reference: e.pacienteRef },
    ...(e.motivo?.trim() ? { reasonCode: [{ text: e.motivo.trim() }] } : {}),
    ...(supportingInfo.length > 0 ? { supportingInfo } : {}),
    note: [{ text: resumenSolicitudSom(e, nombre) }],
    extension: [{ url: EXT.somOrigin, valueCode: origenSom(e) }],
  });

  return { ok: true, serviceRequestId: serviceRequest.id };
}
