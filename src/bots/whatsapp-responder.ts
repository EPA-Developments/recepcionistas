/**
 * Bot · Respuesta de Mensajes por WhatsApp (Recepción).
 *
 * Recepción responde en la conversación de **Mensajes** (queda en el portal, como
 * siempre) y la app llama a este bot con el id de ese mensaje. El bot decide si además
 * sale por WhatsApp — la recepción no decide nada:
 *  - sí, si el **último mensaje del paciente** en esa conversación llegó por WhatsApp y
 *    la **ventana de 24 h** sigue abierta (`lib/whatsapp.ts` → `decidirEnvioWhatsApp`);
 *  - si escribió por el portal, la respuesta queda solo en el portal;
 *  - con la ventana cerrada no se intenta (WhatsApp solo acepta plantillas) y lo dice.
 * Manda el texto y los adjuntos al número desde el que escribió el paciente, y marca el
 * mensaje: canal WhatsApp, MessageSid y ✓ (los ✓✓ los actualiza `som-whatsapp-entrante`).
 * Idempotente: un mensaje que ya salió no se vuelve a mandar.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';
import { adjuntosDe, conEnvioWhatsApp, decidirEnvioWhatsApp, textoDe } from '../lib/whatsapp.js';
import { mandarWhatsApp } from './_shared.js';

export interface EntradaResponderWhatsApp {
  /** Id del mensaje (Communication hija de la conversación) que escribió Recepción. */
  mensajeId: string;
}

export interface ResultadoResponderWhatsApp {
  /** false solo si tenía que salir por WhatsApp y no salió. */
  ok: boolean;
  /** Por dónde quedó: solo el portal, o también WhatsApp. */
  canal: 'portal' | 'whatsapp';
  /** Salió por WhatsApp (Twilio lo aceptó). */
  enviado: boolean;
  /** El mensaje, con los datos del envío si salió. */
  mensaje?: Communication;
  /** Por qué no salió por WhatsApp. */
  motivo?: string;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaResponderWhatsApp>,
): Promise<ResultadoResponderWhatsApp> {
  const id = event.input?.mensajeId;
  const mensaje = id ? await medplum.readResource('Communication', id).catch(() => undefined) : undefined;
  const conversacionRef = mensaje?.partOf?.[0]?.reference;
  if (!mensaje || !conversacionRef || mensaje.sender?.reference?.startsWith('Patient/')) {
    return { ok: false, canal: 'portal', enviado: false, motivo: 'No es una respuesta de Recepción en una conversación.' };
  }
  if (mensaje.identifier?.some((i) => i.system === SYSTEM.twilioMessageSid)) {
    return { ok: true, canal: 'whatsapp', enviado: true, mensaje };
  }

  const hilo = await medplum.searchResources('Communication', { 'part-of': conversacionRef, _sort: 'sent', _count: '500' });
  const decision = decidirEnvioWhatsApp(hilo);
  if (!decision.enviar) {
    return decision.canal === 'portal'
      ? { ok: true, canal: 'portal', enviado: false, mensaje }
      : { ok: false, canal: 'whatsapp', enviado: false, mensaje, motivo: decision.motivo };
  }

  // Los adjuntos llegan con su link firmado (el bot puede leer los Binary): Twilio los baja al enviar.
  const mediaUrls = adjuntosDe(mensaje)
    .map((a) => a.url)
    .filter((u): u is string => Boolean(u?.startsWith('https://')));
  const envio = await mandarWhatsApp(event.secrets, { to: decision.telefono, body: textoDe(mensaje), mediaUrls });
  if (envio.status === 'preparation') {
    // No se intentó: el mensaje queda como estaba (solo en el portal).
    return {
      ok: false,
      canal: 'whatsapp',
      enviado: false,
      mensaje,
      motivo: envio.motivo ?? 'faltan los secrets de Twilio en Medplum (ver docs/whatsapp.md).',
    };
  }
  // Salió o Twilio lo rechazó: la burbuja muestra el canal y el ✓ (o el error, con el motivo).
  const actualizado = await medplum.updateResource<Communication>(
    conEnvioWhatsApp(mensaje, {
      telefono: envio.destino,
      entrega: envio.entrega,
      messageSids: envio.messageSids,
      ...(envio.motivo ? { motivo: envio.motivo } : {}),
    }),
  );
  const enviado = envio.status === 'completed';
  return {
    ok: enviado,
    canal: 'whatsapp',
    enviado,
    mensaje: actualizado,
    ...(envio.motivo ? { motivo: envio.motivo } : {}),
  };
}
