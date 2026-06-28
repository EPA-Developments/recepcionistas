/**
 * Bot · Solicitar segunda opinión médica (SOM) desde el portal del paciente.
 *
 * Análogo a `bw-solicitar-turno`, pero para SOM: el paciente adjunta su
 * cuestionario clínico y sus estudios y pide una segunda opinión cardiológica.
 * Este bot crea una `ServiceRequest` (status `active`) que —vía Subscription—
 * dispara al bot interno `bot-som-report` (PREVENT + informe + PDF).
 *
 * Seguridad: el paciente solo puede ejecutar ESTE bot (su AccessPolicy acota
 * `Bot?name=som-solicitar`) y solo lee sus propias `ServiceRequest`. El bot debe
 * crearse con `runAsUser` para que el `subject`/`requester` no se pueda falsificar.
 *
 * Contrato (entrada/salida) fijado por el portal (`drdalessandro/app`,
 * `docs/medplum/bot-som-interface.md`). NO cambiar sin sincronizar con el portal.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Reference, Resource, ServiceRequest } from '@medplum/fhirtypes';
import { COD, EXT, SYSTEM } from '../fhir/identifiers.js';
import {
  resumenSolicitudSom,
  supportingInfoRefs,
  validarSolicitudSom,
  type SolicitudSom,
} from '../lib/som-solicitud.js';

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
      coding: [{ system: SYSTEM.somServices, code: COD.somCardiology }],
      text: 'Segunda opinión cardiológica',
    },
    subject: { reference: e.pacienteRef },
    requester: { reference: e.pacienteRef },
    ...(e.motivo?.trim() ? { reasonCode: [{ text: e.motivo.trim() }] } : {}),
    ...(supportingInfo.length > 0 ? { supportingInfo } : {}),
    note: [{ text: resumenSolicitudSom(e, nombre) }],
    ...(e.origin?.trim() ? { extension: [{ url: EXT.somOrigin, valueString: e.origin.trim() }] } : {}),
  });

  return { ok: true, serviceRequestId: serviceRequest.id };
}
