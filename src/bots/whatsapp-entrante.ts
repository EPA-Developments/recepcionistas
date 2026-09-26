/**
 * Bot · WhatsApp entrante (webhook de Twilio).
 *
 * Twilio llama a este bot por dos motivos, con el mismo formulario (form-urlencoded):
 *  1) **Mensaje entrante** ("A message comes in"): un paciente escribe al WhatsApp de SOM.
 *     - Idempotente por `MessageSid` (Twilio puede reintentar).
 *     - Busca al paciente por su número (las formas en que puede estar en la ficha); si
 *       no existe, lo crea como **lead** del CRM (origen `whatsapp`).
 *     - Marca el **inicio de contacto** (la campanita de Recepción) si no hubo ningún
 *       WhatsApp con él en las últimas 24 h.
 *     - Guarda fotos, audios y documentos en `Binary` (en el compartimento del paciente).
 *     - Deja la `Communication` sin leer (`in-progress`) en el chat de Recepción.
 *  2) **Estado de entrega** (`StatusCallback` de los salientes): actualiza los ✓✓
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
import {
  aE164AR,
  combinarEstadoEntrega,
  conEstadoEntrega,
  construirLeadWhatsApp,
  construirMensajeEntrante,
  elegirPacientePorTelefono,
  esInicioDeContacto,
  esMediaDeTwilio,
  estadoEntregaDe,
  leerWebhookTwilio,
  MAX_ADJUNTO_BYTES,
  nombreAdjunto,
  ultimaActividad,
  variantesTelefonoAR,
  type EstadoEntrega,
  type MediaTwilio,
  type WebhookTwilio,
} from '../lib/whatsapp.js';

type Secrets = BotEvent['secrets'];

export interface ResultadoWebhookWhatsApp {
  ok: boolean;
  tipo: 'entrante' | 'estado' | 'ignorado';
  motivo?: string;
  pacienteRef?: string;
  communicationId?: string;
  /** Se creó un lead nuevo para el número. */
  pacienteNuevo?: boolean;
  /** El mensaje abre conversación: lo avisa la campanita. */
  inicioContacto?: boolean;
  estadoEntrega?: EstadoEntrega;
}

const CATEGORIA = `${SYSTEM.canal}|whatsapp`;

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
    return { ok: true, tipo: 'entrante', motivo: 'ya registrado', communicationId: ya.id, pacienteRef: ya.subject?.reference };
  }

  // 2) El número de Recepción (el que recibe los avisos) no es un paciente.
  const recepcion = aE164AR(secrets['RECEPCION_WHATSAPP_TO']?.valueString);
  if (recepcion && recepcion === w.desde) {
    return { ok: true, tipo: 'ignorado', motivo: 'Mensaje del número de Recepción.' };
  }

  // 3) ¿Quién escribe? El paciente con ese número o, si no hay, un lead nuevo.
  const { paciente, nuevo } = await pacientePorTelefono(medplum, w.desde, w.nombrePerfil);
  const pacienteRef = `Patient/${paciente.id}`;

  // 4) ¿Abre conversación? Ningún WhatsApp con él (de ida o de vuelta) en 24 h.
  const ahora = new Date();
  const previos = await medplum.searchResources('Communication', {
    subject: pacienteRef,
    category: CATEGORIA,
    _sort: '-sent',
    _count: '5',
  });
  const inicioContacto = esInicioDeContacto(ultimaActividad(previos), ahora);

  // 5) Fotos, audios, documentos (best-effort: sin la media, el mensaje igual queda).
  const adjuntos = await guardarAdjuntos(medplum, secrets, w.media, pacienteRef);

  // 6) El mensaje, sin leer, en el chat de Recepción.
  const comm = await medplum.createResource<Communication>(
    construirMensajeEntrante({
      pacienteRef,
      texto: w.texto,
      adjuntos,
      messageSid: w.messageSid,
      telefono: w.desde,
      inicioContacto,
      ahora: ahora.toISOString(),
    }),
  );
  return { ok: true, tipo: 'entrante', pacienteRef, communicationId: comm.id, pacienteNuevo: nuevo, inicioContacto };
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
  const lead = await medplum.createResourceIfNoneExist<Patient>(
    construirLeadWhatsApp(telefono, nombrePerfil),
    `phone=${encodeURIComponent(telefono)}`,
  );
  return { paciente: lead as Patient & { id: string }, nuevo: true };
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
