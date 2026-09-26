/**
 * Bot · Responder un chat de WhatsApp (Recepción).
 *
 * Recepción escribe en el chat y el bot:
 *  1) Verifica la **ventana de 24 h** de WhatsApp: solo se responde texto libre dentro de
 *     las 24 h del último mensaje del paciente (fuera de ella, WhatsApp solo acepta
 *     plantillas aprobadas por Meta, que están pendientes).
 *  2) Responde al número desde el que escribió el paciente (el del último entrante).
 *  3) Envía por Twilio y registra la `Communication` en el chat (con los ✓✓ que después
 *     actualiza `som-whatsapp-entrante`).
 *
 * La regla vive acá (no en la app): la recepción no decide si se puede mandar.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';
import { MAX_TEXTO_WHATSAPP, PLANTILLA_RESPUESTA, telefonoDe, ultimoEntrante, ventanaWhatsApp } from '../lib/whatsapp.js';
import { enviarWhatsApp } from './_shared.js';

export interface EntradaResponderWhatsApp {
  /** "Patient/<id>" del chat. */
  pacienteRef: string;
  texto: string;
  /** Quién responde (el usuario de Recepción): queda como remitente del mensaje. */
  autor?: { reference?: string; display?: string };
}

export interface ResultadoResponderWhatsApp {
  ok: boolean;
  motivo?: string;
  mensaje?: Communication;
  /** Hasta cuándo se puede responder texto libre (ISO). */
  ventanaCierra?: string;
}

/** Remitentes válidos de un saliente: el equipo de SOM, nunca un paciente. */
const AUTORES = /^(Practitioner|PractitionerRole|Organization)\/[^/]+$/;

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaResponderWhatsApp>,
): Promise<ResultadoResponderWhatsApp> {
  const { pacienteRef, autor } = event.input ?? ({} as EntradaResponderWhatsApp);
  const texto = (event.input?.texto ?? '').trim();
  if (!/^Patient\/[^/]+$/.test(pacienteRef ?? '')) {
    return { ok: false, motivo: 'Falta el paciente del chat.' };
  }
  if (!texto) {
    return { ok: false, motivo: 'Escribí el mensaje.' };
  }
  if (texto.length > MAX_TEXTO_WHATSAPP) {
    return { ok: false, motivo: `El mensaje es muy largo (máximo ${MAX_TEXTO_WHATSAPP} caracteres).` };
  }

  const entrantes = await medplum.searchResources('Communication', {
    subject: pacienteRef,
    sender: pacienteRef,
    category: `${SYSTEM.canal}|whatsapp`,
    _sort: '-sent',
    _count: '10',
  });
  const ultimo = ultimoEntrante(entrantes);
  const ventana = ventanaWhatsApp(ultimo?.sent);
  if (!ventana.abierta) {
    return {
      ok: false,
      ...(ventana.cierra ? { ventanaCierra: ventana.cierra } : {}),
      motivo: ultimo
        ? 'Pasaron más de 24 h desde el último mensaje del paciente: WhatsApp solo permite plantillas aprobadas (pendientes). Esperá a que el paciente vuelva a escribir o contactalo por otro canal.'
        : 'El paciente todavía no escribió por WhatsApp: solo se le puede escribir primero con una plantilla aprobada (pendientes).',
    };
  }

  const remitente = autor?.reference && AUTORES.test(autor.reference) ? autor : undefined;
  const mensaje = await enviarWhatsApp(medplum, event.secrets, {
    template: PLANTILLA_RESPUESTA,
    body: texto,
    pacienteRef,
    to: telefonoDe(ultimo!),
    ...(remitente ? { autor: remitente } : {}),
  });
  const ok = mensaje.status === 'completed';
  return {
    ok,
    mensaje,
    ...(ventana.cierra ? { ventanaCierra: ventana.cierra } : {}),
    ...(ok
      ? {}
      : { motivo: mensaje.statusReason?.text ?? 'No se envió: faltan los secrets de Twilio en Medplum (ver docs/whatsapp.md).' }),
  };
}
