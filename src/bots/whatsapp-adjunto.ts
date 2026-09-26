/**
 * Bot · Ver un adjunto del chat de WhatsApp (Recepción).
 *
 * Las fotos, audios y documentos que manda el paciente quedan en `Binary`. Recepción no
 * tiene acceso general a `Binary` (ahí también están los estudios clínicos): este bot
 * entrega SOLO el adjunto de un mensaje de WhatsApp, y nunca el de un mensaje reservado
 * (con información clínica). Devuelve el archivo en base64 para mostrarlo en el chat.
 *
 * Como Recepción puede escribir `Communication`, no alcanza con que el mensaje "diga"
 * ser de WhatsApp: el archivo tiene que haberlo guardado `som-whatsapp-entrante`
 * (`Binary.meta.author`; Recepción no puede escribir `Binary`). Así el bot nunca sirve
 * para bajar un estudio clínico apuntándole un mensaje armado a mano.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { BOT_WHATSAPP_ENTRANTE } from '../fhir/identifiers.js';
import { adjuntosDe, esReservado, esWhatsApp, MAX_ADJUNTO_VISTA_BYTES } from '../lib/whatsapp.js';

export interface EntradaAdjuntoWhatsApp {
  /** Id de la Communication (el mensaje del chat). */
  communicationId: string;
  /** Qué adjunto del mensaje (0 = el primero). */
  indice?: number;
}

export interface ResultadoAdjuntoWhatsApp {
  ok: boolean;
  motivo?: string;
  contentType?: string;
  /** El archivo en base64. */
  data?: string;
  titulo?: string;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaAdjuntoWhatsApp>,
): Promise<ResultadoAdjuntoWhatsApp> {
  const id = event.input?.communicationId;
  const indice = event.input?.indice ?? 0;
  if (!id || !Number.isInteger(indice) || indice < 0) {
    return { ok: false, motivo: 'Falta el mensaje.' };
  }
  const c = await medplum.readResource('Communication', id).catch(() => undefined as Communication | undefined);
  if (!c || !esWhatsApp(c)) {
    return { ok: false, motivo: 'No es un mensaje de WhatsApp.' };
  }
  if (esReservado(c)) {
    return { ok: false, motivo: 'El contenido es reservado (información clínica).' };
  }
  const adjunto = adjuntosDe(c)[indice];
  if (!adjunto?.url?.startsWith('Binary/')) {
    return { ok: false, motivo: 'El adjunto no está disponible.' };
  }
  if ((adjunto.size ?? 0) > MAX_ADJUNTO_VISTA_BYTES) {
    return { ok: false, motivo: 'El archivo es muy grande para verlo acá.' };
  }

  // Solo archivos que guardó el webhook de WhatsApp.
  const [binario, webhook] = await Promise.all([
    medplum.readResource('Binary', adjunto.url.slice('Binary/'.length)).catch(() => undefined),
    medplum.searchOne('Bot', `name:exact=${BOT_WHATSAPP_ENTRANTE}`),
  ]);
  if (!binario || !webhook?.id || binario.meta?.author?.reference !== `Bot/${webhook.id}`) {
    console.error(`som-whatsapp-adjunto: ${adjunto.url} no es un adjunto de WhatsApp (Communication/${id}).`);
    return { ok: false, motivo: 'El adjunto no está disponible.' };
  }

  const blob = await medplum.download(adjunto.url);
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_ADJUNTO_VISTA_BYTES) {
    return { ok: false, motivo: 'El archivo es muy grande para verlo acá.' };
  }
  return {
    ok: true,
    contentType: adjunto.contentType ?? (blob.type || 'application/octet-stream'),
    data: bytes.toString('base64'),
    ...(adjunto.title ? { titulo: adjunto.title } : {}),
  };
}
