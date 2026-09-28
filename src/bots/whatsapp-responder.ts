/**
 * Bot · Respuesta de Mensajes por WhatsApp (Recepción).
 *
 * Recepción responde en la conversación de **Mensajes** (queda en el portal, como
 * siempre) y la app llama a este bot con el id de ese mensaje. El bot decide si además
 * sale por WhatsApp — la recepción no decide nada:
 *  - sí, si el **último mensaje del paciente** en esa conversación llegó por WhatsApp y
 *    la **ventana de 24 h** sigue abierta (`lib/whatsapp.ts` → `decidirEnvioWhatsApp`);
 *  - si escribió por el portal, la respuesta queda solo en el portal;
 *  - con la ventana cerrada WhatsApp solo acepta plantillas: la respuesta queda marcada
 *    **pendiente** (sale sola cuando el paciente vuelva a escribir, `som-whatsapp-entrante`)
 *    y se le avisa con la plantilla `mensaje-nuevo`, una vez por período cerrado. Sin esa
 *    plantilla aprobada, no hay forma de avisarle y lo dice.
 * Manda el texto y los adjuntos al número desde el que escribió el paciente, y marca el
 * mensaje: canal WhatsApp, MessageSid y ✓ (los ✓✓ los actualiza `som-whatsapp-entrante`).
 * Idempotente: un mensaje que ya salió no se vuelve a mandar.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { TEXTO_MENSAJE_NUEVO } from '../config/auto-respuesta.js';
import { SYSTEM } from '../fhir/identifiers.js';
import { elegirPlantilla, paramsPlantilla } from '../lib/plantillas-whatsapp.js';
import {
  adjuntosDe,
  conEnvioWhatsApp,
  conPendienteWhatsApp,
  construirRespuestaAutomatica,
  decidirEnvioWhatsApp,
  textoDe,
  yaAvisadoMensajeNuevo,
} from '../lib/whatsapp.js';
import { mandarWhatsApp } from './_shared.js';

type Secrets = BotEvent['secrets'];

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
  /**
   * La ventana de 24 h estaba cerrada: la respuesta quedó pendiente (sale sola cuando el
   * paciente conteste) y se le avisó por WhatsApp, con plantilla, que tiene una respuesta.
   */
  avisado?: boolean;
  /** El mensaje, con los datos del envío si salió. */
  mensaje?: Communication;
  /** Por qué no salió por WhatsApp (o qué se hizo en su lugar). */
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
    if (decision.canal === 'portal') {
      return { ok: true, canal: 'portal', enviado: false, mensaje };
    }
    if (decision.ventanaCerrada && decision.telefono) {
      return avisarMensajeNuevo(medplum, event.secrets, { mensaje, hilo, telefono: decision.telefono, motivo: decision.motivo });
    }
    return { ok: false, canal: 'whatsapp', enviado: false, mensaje, motivo: decision.motivo };
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
  // Si estaba pendiente de una ventana anterior, deja de estarlo.
  const actualizado = await medplum.updateResource<Communication>(
    conPendienteWhatsApp(
      conEnvioWhatsApp(mensaje, {
        telefono: envio.destino,
        entrega: envio.entrega,
        messageSids: envio.messageSids,
        ...(envio.motivo ? { motivo: envio.motivo } : {}),
      }),
      false,
    ),
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

/**
 * Con la ventana de 24 h cerrada la respuesta no puede salir: queda marcada pendiente (sale
 * cuando el paciente escriba) y, si todavía no se le avisó desde su último mensaje, recibe
 * la plantilla `mensaje-nuevo` (queda en la conversación como «🤖 Automática»).
 */
async function avisarMensajeNuevo(
  medplum: MedplumClient,
  secrets: Secrets,
  p: { mensaje: Communication; hilo: Communication[]; telefono: string; motivo: string },
): Promise<ResultadoResponderWhatsApp> {
  const plantilla = elegirPlantilla('mensaje-nuevo', TEXTO_MENSAJE_NUEVO, (s) => secrets[s]?.valueString);
  if (!plantilla) {
    return {
      ok: false,
      canal: 'whatsapp',
      enviado: false,
      mensaje: p.mensaje,
      motivo: `${p.motivo} Sin la plantilla "mensaje nuevo" aprobada por Meta no se le puede avisar (npm run whatsapp:plantillas).`,
    };
  }
  const pendiente = await medplum.updateResource<Communication>(conPendienteWhatsApp(p.mensaje, true));
  if (yaAvisadoMensajeNuevo(p.hilo)) {
    return {
      ok: true,
      canal: 'whatsapp',
      enviado: false,
      avisado: true,
      mensaje: pendiente,
      motivo: 'Pasaron más de 24 h desde su último WhatsApp: ya le avisamos que tiene respuestas nuevas; esta también sale por WhatsApp cuando conteste.',
    };
  }

  const envio = await mandarWhatsApp(secrets, {
    to: p.telefono,
    body: plantilla.texto,
    plantilla: paramsPlantilla(plantilla.contentSid, plantilla.variables),
  });
  const conversacionRef = p.mensaje.partOf?.[0]?.reference;
  const pacienteRef = p.mensaje.subject?.reference;
  if (conversacionRef && pacienteRef) {
    await medplum.createResource<Communication>(
      conEnvioWhatsApp(
        construirRespuestaAutomatica({
          conversacionRef,
          pacienteRef,
          tipo: 'mensaje-nuevo',
          texto: plantilla.texto,
          ahora: new Date().toISOString(),
        }),
        {
          telefono: envio.destino,
          entrega: envio.entrega,
          messageSids: envio.messageSids,
          ...(envio.status === 'completed' ? {} : { motivo: envio.motivo ?? 'No salió por WhatsApp: faltan los secrets de Twilio en Medplum.' }),
        },
      ),
    );
  }
  if (envio.status !== 'completed') {
    return {
      ok: false,
      canal: 'whatsapp',
      enviado: false,
      mensaje: pendiente,
      motivo: `${p.motivo} Tampoco salió el aviso de mensaje nuevo${envio.motivo ? `: ${envio.motivo}` : '.'}`,
    };
  }
  return {
    ok: true,
    canal: 'whatsapp',
    enviado: false,
    avisado: true,
    mensaje: pendiente,
    motivo:
      'Pasaron más de 24 h desde su último WhatsApp: le avisamos que tiene una respuesta nueva (la ve en el portal) y se la reenviamos por WhatsApp cuando conteste.',
  };
}
