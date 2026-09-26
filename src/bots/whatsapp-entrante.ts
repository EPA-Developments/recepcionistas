/**
 * Bot · WhatsApp entrante (webhook de Twilio).
 *
 * WhatsApp es un canal de las conversaciones de **Mensajes** (el mismo modelo de hilos
 * que el portal). Twilio llama a este bot por dos motivos, con el mismo formulario:
 *  1) **Mensaje entrante** ("A message comes in"): un paciente escribe al WhatsApp de SOM.
 *     - Idempotente por `MessageSid` (Twilio puede reintentar).
 *     - Busca al paciente por su número (las formas en que puede estar en la ficha); si
 *       no existe, lo crea como **lead** del CRM (origen `whatsapp`) y el mensaje queda
 *       marcado **inicio de contacto**: lo avisa la campanita de Recepción.
 *     - El mensaje entra en la **conversación abierta** del paciente; si no tiene
 *       ninguna, abre una nueva con motivo «Otro motivo». El paciente también la ve en el
 *       portal.
 *     - Guarda fotos, audios y documentos en `Binary` (en el compartimento del paciente).
 *     - **Respuesta automática** (`lib/auto-respuesta.ts`): fuera de horario, un aviso
 *       una vez por período cerrado; si abrió una conversación nueva, un acuse.
 *  2) **Estado de entrega** (`StatusCallback` de lo que salió): actualiza los ✓✓
 *     (enviado → entregado → leído, o fallido con el motivo).
 *
 * Seguridad: la URL lleva las credenciales de una ClientApplication dedicada, que solo
 * puede ejecutar este bot (AccessPolicy "Webhook Twilio"), y el bot rechaza lo que no
 * venga de la cuenta de Twilio de SOM (`AccountSid` = secret `TWILIO_ACCOUNT_SID`).
 * Ver `docs/whatsapp.md`.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Attachment, Communication, Patient } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';
import { respuestaAutomatica, type TipoRespuestaAutomatica } from '../lib/auto-respuesta.js';
import {
  aE164AR,
  claveConversacionWhatsApp,
  combinarEstadoEntrega,
  conEnvioWhatsApp,
  conEstadoEntrega,
  construirConversacionWhatsApp,
  construirLeadWhatsApp,
  construirMensajeEntrante,
  construirRespuestaAutomatica,
  conversacionAbierta,
  elegirPacientePorTelefono,
  esMediaDeTwilio,
  estadoEntregaDe,
  leerWebhookTwilio,
  MAX_ADJUNTO_BYTES,
  nombreAdjunto,
  tipoAutomatica,
  variantesTelefonoAR,
  type EstadoEntrega,
  type MediaTwilio,
  type WebhookTwilio,
} from '../lib/whatsapp.js';
import { mandarWhatsApp } from './_shared.js';

type Secrets = BotEvent['secrets'];

export interface ResultadoWebhookWhatsApp {
  ok: boolean;
  tipo: 'entrante' | 'estado' | 'ignorado';
  motivo?: string;
  pacienteRef?: string;
  /** Conversación de Mensajes donde entró el mensaje. */
  conversacionId?: string;
  communicationId?: string;
  /** Número nuevo: se creó un lead y suena la campanita. */
  pacienteNuevo?: boolean;
  /** El mensaje abrió una conversación nueva. */
  conversacionNueva?: boolean;
  /** Qué respondió solo el sistema, si respondió. */
  respuestaAutomatica?: TipoRespuestaAutomatica;
  estadoEntrega?: EstadoEntrega;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Record<string, string> | string>,
): Promise<ResultadoWebhookWhatsApp> {
  const w = leerWebhookTwilio(event.input);
  if (w.tipo === 'desconocido') {
    return { ok: true, tipo: 'ignorado', motivo: w.motivo };
  }

  const cuenta = event.secrets['TWILIO_ACCOUNT_SID']?.valueString?.trim();
  if (cuenta && w.accountSid !== cuenta) {
    console.error(`som-whatsapp-entrante: AccountSid ajeno (${w.messageSid}); se ignora.`);
    return { ok: false, tipo: 'ignorado', motivo: 'El pedido no viene de la cuenta de Twilio de SOM.' };
  }

  return w.tipo === 'estado' ? actualizarEntrega(medplum, w) : registrarEntrante(medplum, event.secrets, w);
}

// ───────────────────────────── estados de entrega (✓✓) ─────────────────────────────

async function actualizarEntrega(
  medplum: MedplumClient,
  w: Extract<WebhookTwilio, { tipo: 'estado' }>,
): Promise<ResultadoWebhookWhatsApp> {
  // Los estados llegan casi juntos: se actualiza con If-Match y, si otro ganó, se relee.
  for (let intento = 1; ; intento++) {
    // (En los bots el cliente no cachea: cada vuelta relee la última versión.)
    const c = await medplum.searchOne('Communication', { identifier: `${SYSTEM.twilioMessageSid}|${w.messageSid}` });
    if (!c?.id) {
      return { ok: true, tipo: 'estado', motivo: 'El mensaje no está registrado en SOM.' };
    }
    const actual = estadoEntregaDe(c);
    const nuevo = combinarEstadoEntrega(actual, w.estado);
    if (nuevo === actual) {
      return { ok: true, tipo: 'estado', communicationId: c.id, estadoEntrega: nuevo };
    }
    try {
      const version = c.meta?.versionId;
      await medplum.updateResource<Communication>(
        conEstadoEntrega(c, nuevo, w.codigoError),
        version ? { headers: { 'If-Match': `W/"${version}"` } } : undefined,
      );
      return { ok: true, tipo: 'estado', communicationId: c.id, estadoEntrega: nuevo };
    } catch (err) {
      if (!esConflicto(err) || intento >= 3) {
        throw err;
      }
    }
  }
}

function esConflicto(err: unknown): boolean {
  const e = err as { status?: number; outcome?: { issue?: Array<{ code?: string }> } };
  return e?.status === 412 || e?.status === 409 || e?.outcome?.issue?.some((i) => i.code === 'conflict') === true;
}

// ───────────────────────────── mensajes entrantes ─────────────────────────────

async function registrarEntrante(
  medplum: MedplumClient,
  secrets: Secrets,
  w: Extract<WebhookTwilio, { tipo: 'entrante' }>,
): Promise<ResultadoWebhookWhatsApp> {
  // 1) Idempotencia: un reintento de Twilio no duplica el mensaje.
  const ya = await medplum.searchOne('Communication', { identifier: `${SYSTEM.twilioMessageSid}|${w.messageSid}` });
  if (ya?.id) {
    return {
      ok: true,
      tipo: 'entrante',
      motivo: 'ya registrado',
      communicationId: ya.id,
      pacienteRef: ya.subject?.reference,
      conversacionId: ya.partOf?.[0]?.reference?.split('/')[1],
    };
  }

  // 2) El número de Recepción (el que recibe los avisos) no es un paciente.
  const recepcion = aE164AR(secrets['RECEPCION_WHATSAPP_TO']?.valueString);
  if (recepcion && recepcion === w.desde) {
    return { ok: true, tipo: 'ignorado', motivo: 'Mensaje del número de Recepción.' };
  }

  // 3) ¿Quién escribe? El paciente con ese número o, si no hay, un lead nuevo (campanita).
  const { paciente, nuevo } = await pacientePorTelefono(medplum, w.desde, w.nombrePerfil);
  const pacienteRef = `Patient/${paciente.id}`;

  // 4) La conversación: la abierta del paciente o una nueva («Otro motivo»).
  const { conversacion, conversacionNueva } = await conversacionDelPaciente(medplum, pacienteRef);
  const conversacionRef = `Communication/${conversacion.id}`;

  // 5) Fotos, audios, documentos (best-effort: sin la media, el mensaje igual queda).
  const adjuntos = await guardarAdjuntos(medplum, secrets, w.media, pacienteRef);

  // 6) El mensaje, sin leer, en la conversación.
  const ahora = new Date();
  const comm = await medplum.createResource<Communication>(
    construirMensajeEntrante({
      conversacionRef,
      pacienteRef,
      texto: w.texto,
      adjuntos,
      messageSid: w.messageSid,
      telefono: w.desde,
      inicioContacto: nuevo,
      ahora: ahora.toISOString(),
    }),
  );

  // 7) Lo que responde solo el sistema (acuse / fuera de horario).
  const automatica = await responderSolo(medplum, secrets, {
    conversacionRef,
    conversacionNueva,
    pacienteRef,
    telefono: w.desde,
    ahora,
  });

  return {
    ok: true,
    tipo: 'entrante',
    pacienteRef,
    conversacionId: conversacion.id,
    communicationId: comm.id,
    pacienteNuevo: nuevo,
    conversacionNueva,
    ...(automatica ? { respuestaAutomatica: automatica } : {}),
  };
}

/** La conversación abierta más reciente del paciente o, si no tiene, una nueva. */
async function conversacionDelPaciente(
  medplum: MedplumClient,
  pacienteRef: string,
): Promise<{ conversacion: Communication & { id: string }; conversacionNueva: boolean }> {
  const candidatas = await medplum.searchResources('Communication', {
    subject: pacienteRef,
    'part-of:missing': 'true',
    status: 'in-progress',
    _sort: '-_lastUpdated',
    _count: '50',
  });
  const abierta = conversacionAbierta(candidatas);
  if (abierta?.id) {
    return { conversacion: abierta as Communication & { id: string }, conversacionNueva: false };
  }
  // Condicional: si otro WhatsApp del paciente llegó a la vez, no se abren dos conversaciones.
  const nueva = await medplum.createResourceIfNoneExist<Communication>(
    construirConversacionWhatsApp(pacienteRef),
    new URLSearchParams({
      identifier: `${SYSTEM.communication}|${claveConversacionWhatsApp(pacienteRef)}`,
      status: 'in-progress',
    }).toString(),
  );
  return { conversacion: nueva as Communication & { id: string }, conversacionNueva: true };
}

/** Manda (y deja en la conversación) la respuesta automática que corresponda, si corresponde. */
async function responderSolo(
  medplum: MedplumClient,
  secrets: Secrets,
  p: { conversacionRef: string; conversacionNueva: boolean; pacienteRef: string; telefono: string; ahora: Date },
): Promise<TipoRespuestaAutomatica | undefined> {
  const previos = p.conversacionNueva
    ? []
    : await medplum.searchResources('Communication', { 'part-of': p.conversacionRef, _sort: '-sent', _count: '200' });
  const ultimoAviso = previos
    .filter((m) => tipoAutomatica(m) === 'fuera-de-horario')
    .map((m) => m.sent)
    .filter((s): s is string => Boolean(s))
    .sort()
    .pop();
  const r = respuestaAutomatica({ conversacionNueva: p.conversacionNueva, ahora: p.ahora, ultimoAvisoFueraDeHorario: ultimoAviso });
  if (!r) {
    return undefined;
  }
  const envio = await mandarWhatsApp(secrets, { to: p.telefono, body: r.texto });
  const base = construirRespuestaAutomatica({
    conversacionRef: p.conversacionRef,
    pacienteRef: p.pacienteRef,
    tipo: r.tipo,
    texto: r.texto,
    // Siempre después del mensaje que la provocó (el orden de la conversación).
    ahora: new Date(Math.max(Date.now(), p.ahora.getTime() + 1)).toISOString(),
  });
  await medplum.createResource<Communication>(
    conEnvioWhatsApp(base, {
      telefono: envio.destino,
      entrega: envio.entrega,
      messageSids: envio.messageSids,
      ...(envio.status === 'completed'
        ? {}
        : { motivo: envio.motivo ?? 'No salió por WhatsApp: faltan los secrets de Twilio en Medplum.' }),
    }),
  );
  return r.tipo;
}

async function pacientePorTelefono(
  medplum: MedplumClient,
  telefono: string,
  nombrePerfil: string | undefined,
): Promise<{ paciente: Patient & { id: string }; nuevo: boolean }> {
  const candidatos = await medplum.searchResources('Patient', {
    phone: variantesTelefonoAR(telefono).join(','),
    _count: '20',
  });
  const existente = elegirPacientePorTelefono(candidatos);
  if (existente?.id) {
    return { paciente: existente as Patient & { id: string }, nuevo: false };
  }
  // Condicional: si otro mensaje del mismo número llegó a la vez, no se duplica el lead.
  try {
    const lead = await medplum.createResourceIfNoneExist<Patient>(
      construirLeadWhatsApp(telefono, nombrePerfil),
      `phone=${encodeURIComponent(telefono)}`,
    );
    return { paciente: lead as Patient & { id: string }, nuevo: true };
  } catch (err) {
    // Otro mensaje lo creó en el mismo instante: se usa ese.
    const otro = elegirPacientePorTelefono(await medplum.searchResources('Patient', { phone: telefono, _count: '20' }));
    if (!otro?.id) {
      throw err;
    }
    return { paciente: otro as Patient & { id: string }, nuevo: false };
  }
}

async function guardarAdjuntos(
  medplum: MedplumClient,
  secrets: Secrets,
  media: MediaTwilio[],
  pacienteRef: string,
): Promise<Attachment[]> {
  const sid = secrets['TWILIO_ACCOUNT_SID']?.valueString?.trim();
  const token = secrets['TWILIO_AUTH_TOKEN']?.valueString?.trim();
  const auth = sid && token ? Buffer.from(`${sid}:${token}`).toString('base64') : undefined;

  const adjuntos: Attachment[] = [];
  for (const [i, m] of media.entries()) {
    const titulo = nombreAdjunto(m.contentType, i);
    try {
      const archivo = esMediaDeTwilio(m.url) ? await descargar(m.url, auth) : undefined;
      if (!archivo) {
        adjuntos.push({ contentType: m.contentType, title: `${titulo} (no se pudo descargar)` });
        continue;
      }
      const contentType = m.contentType ?? archivo.contentType ?? 'application/octet-stream';
      const binary = await medplum.createBinary({
        data: archivo.bytes,
        contentType,
        filename: titulo,
        securityContext: { reference: pacienteRef },
      });
      adjuntos.push({
        contentType,
        url: `Binary/${binary.id}`,
        title: titulo,
        size: archivo.bytes.byteLength,
        creation: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`som-whatsapp-entrante: no se pudo guardar el adjunto ${i + 1}:`, err instanceof Error ? err.message : err);
      adjuntos.push({ contentType: m.contentType, title: `${titulo} (no se pudo descargar)` });
    }
  }
  return adjuntos;
}

/**
 * Descarga la media de Twilio. Con "HTTP Basic Authentication for media access" la API
 * pide las credenciales de la cuenta; después redirige a un link firmado de otro host,
 * que se sigue SIN credenciales (el token nunca sale de api.twilio.com).
 */
async function descargar(
  url: string,
  auth: string | undefined,
): Promise<{ bytes: Uint8Array; contentType?: string } | undefined> {
  let resp = await fetch(url, { headers: auth ? { Authorization: `Basic ${auth}` } : {}, redirect: 'manual' });
  if (resp.status >= 300 && resp.status < 400) {
    const destino = resp.headers.get('location');
    if (!destino) {
      return undefined;
    }
    resp = await fetch(new URL(destino, url).toString());
  }
  if (!resp.ok || Number(resp.headers.get('content-length') ?? 0) > MAX_ADJUNTO_BYTES) {
    return undefined;
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ADJUNTO_BYTES) {
    return undefined;
  }
  return { bytes, contentType: resp.headers.get('content-type')?.split(';')[0]?.trim() || undefined };
}
