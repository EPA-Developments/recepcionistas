/**
 * WhatsApp (Twilio) — lógica pura del canal WhatsApp de **Mensajes** (sin red).
 *
 * WhatsApp no es una bandeja aparte: es un canal de las conversaciones de Mensajes
 * (el mismo modelo de hilos que el portal, `src/lib/mensajes.ts`).
 *  - Teléfonos: WhatsApp (y Twilio) exigen E.164. En Argentina un celular es
 *    `+54 9 {área sin 0} {número sin 15}`; acá se normaliza lo que se tipeó en la ficha
 *    (`011 15 2233-4455`, `11 2233-4455`, `+54 11 …`) y se arman las variantes para
 *    encontrar al paciente que escribe.
 *  - Webhook de Twilio: el mismo bot recibe los mensajes entrantes y los estados de
 *    entrega de las respuestas (enviado / entregado / leído / fallido: los ✓✓).
 *  - Hilos: un WhatsApp entra en la conversación abierta del paciente o abre una nueva
 *    (motivo «Otro motivo»); la respuesta de Recepción sale por WhatsApp si el último
 *    mensaje del paciente en esa conversación llegó por WhatsApp y la ventana de 24 h
 *    sigue abierta (`auto-respuesta.ts`).
 *  - Números nuevos (contactos que no estaban en SOM): el primer mensaje queda marcado
 *    `inicio-contacto` y el aviso a Recepción (pestaña WhatsApp y campanita) es un `Task`
 *    (`contactos-whatsapp.ts`).
 */
import type { Attachment, CodeableConcept, Coding, Communication, Patient } from '@medplum/fhirtypes';
import { TZ } from '../config/horario.js';
import { REMITENTE_AUTOMATICO } from '../config/auto-respuesta.js';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import { ventana24h, type TipoRespuestaAutomatica } from './auto-respuesta.js';

// ───────────────────────────── teléfonos (Argentina) ─────────────────────────────

/** Área por defecto para números locales sin característica (el centro está en CABA). */
const AREA_POR_DEFECTO = '11';

/** Número nacional de 10 dígitos (área sin 0 + número sin 15), o undefined. */
function nacionalAR(digitos: string): string | undefined {
  let x = digitos.startsWith('0') ? digitos.slice(1) : digitos;
  if (x.length === 11 && x.startsWith('9')) {
    x = x.slice(1); // "9" de celular sin el 54
  }
  if (x.length === 10) {
    // "15" + 8 dígitos sin característica: celular de CABA.
    return x.startsWith('15') ? `${AREA_POR_DEFECTO}${x.slice(2)}` : x;
  }
  if (x.length === 12) {
    // Área (2 a 4 dígitos) + "15" + número.
    for (const largo of [2, 3, 4]) {
      if (x.slice(largo, largo + 2) === '15') {
        return x.slice(0, largo) + x.slice(largo + 2);
      }
    }
  }
  if (x.length === 8) {
    return `${AREA_POR_DEFECTO}${x}`; // número local de CABA sin característica
  }
  return undefined;
}

/**
 * E.164 para WhatsApp. Números argentinos → `+549…` (el 9 de celular es obligatorio en
 * WhatsApp); de otros países, se respetan si vienen con `+`. undefined si no se puede.
 */
export function aE164AR(texto: string | undefined): string | undefined {
  if (!texto) {
    return undefined;
  }
  const t = texto.trim().replace(/^whatsapp:/i, '').trim();
  let d = t.replace(/\D/g, '');
  const internacional = t.startsWith('+') || t.startsWith('00');
  if (t.startsWith('00')) {
    d = d.slice(2);
  }
  if (internacional || (d.startsWith('54') && d.length >= 12)) {
    if (d.startsWith('54')) {
      const resto = d.slice(2);
      const nacional = nacionalAR(resto.startsWith('9') ? resto.slice(1) : resto);
      return nacional ? `+549${nacional}` : undefined;
    }
    return d.length >= 8 && d.length <= 15 ? `+${d}` : undefined;
  }
  const nacional = nacionalAR(d);
  return nacional ? `+549${nacional}` : undefined;
}

/**
 * Formas en que puede estar guardado un celular argentino en la ficha (para buscar al
 * paciente con `Patient?phone=a,b,c`: la búsqueda FHIR compara el valor exacto).
 */
export function variantesTelefonoAR(e164: string): string[] {
  if (!e164.startsWith('+549') || e164.length !== 14) {
    return [e164, e164.replace(/^\+/, '')];
  }
  const n = e164.slice(4);
  const v = new Set<string>([e164, e164.slice(1), `+54${n}`, `54${n}`, `9${n}`, n, `0${n}`, formatoTelefono(e164)]);
  for (const largo of [2, 3, 4]) {
    const area = n.slice(0, largo);
    const numero = n.slice(largo);
    const guion = `${numero.slice(0, -4)}-${numero.slice(-4)}`;
    v.add(`0${area}15${numero}`);
    v.add(`${area}15${numero}`);
    // Tipeados con espacios y guion ("11 2233-4455", "011 15 2233-4455").
    v.add(`${area} ${guion}`);
    v.add(`0${area} 15 ${guion}`);
    if (area === AREA_POR_DEFECTO) {
      v.add(`15${numero}`);
      v.add(numero);
    }
  }
  return [...v];
}

/** "+5491122334455" → "+54 9 11 2233-4455" (para mostrar). */
export function formatoTelefono(e164: string | undefined): string {
  if (!e164) {
    return '';
  }
  if (e164.startsWith('+549') && e164.length === 14) {
    const n = e164.slice(4);
    const area = n.startsWith('11') ? 2 : 3;
    const numero = n.slice(area);
    return `+54 9 ${n.slice(0, area)} ${numero.slice(0, numero.length - 4)}-${numero.slice(-4)}`;
  }
  return e164;
}

// ───────────────────────────── webhook de Twilio ─────────────────────────────

/** Estado de entrega de un saliente (los ✓✓ de WhatsApp). */
export type EstadoEntrega = 'en-cola' | 'enviado' | 'entregado' | 'leido' | 'fallido';

const RANGO: Record<EstadoEntrega, number> = { 'en-cola': 0, enviado: 1, entregado: 2, leido: 3, fallido: 4 };

export function estadoEntregaDeTwilio(status: string | undefined): EstadoEntrega | undefined {
  switch ((status ?? '').toLowerCase()) {
    case 'accepted':
    case 'scheduled':
    case 'queued':
    case 'sending':
      return 'en-cola';
    case 'sent':
      return 'enviado';
    case 'delivered':
      return 'entregado';
    case 'read':
      return 'leido';
    case 'failed':
    case 'undelivered':
    case 'canceled':
      return 'fallido';
    default:
      return undefined;
  }
}

/**
 * Los estados de Twilio pueden llegar desordenados (el "leído" antes que el
 * "entregado"): nunca se retrocede, y un fallo siempre queda.
 */
export function combinarEstadoEntrega(actual: EstadoEntrega | undefined, nuevo: EstadoEntrega): EstadoEntrega {
  if (!actual) {
    return nuevo;
  }
  return RANGO[nuevo] >= RANGO[actual] ? nuevo : actual;
}

/**
 * El saliente con su nuevo estado de entrega (los ✓✓). Si falló, `statusReason` explica
 * por qué en palabras de Recepción (p. ej. fuera de la ventana de 24 h).
 */
export function conEstadoEntrega(c: Communication, estado: EstadoEntrega, codigoError?: string): Communication {
  return {
    ...c,
    extension: [...(c.extension ?? []).filter((e) => e.url !== EXT.estadoEntrega), { url: EXT.estadoEntrega, valueCode: estado }],
    ...(estado === 'fallido'
      ? { statusReason: { text: explicarErrorTwilio(codigoError) ?? 'WhatsApp no pudo entregar el mensaje.' } }
      : {}),
  };
}

/**
 * Solo se descarga media de la API de Twilio (con las credenciales de la cuenta): una URL
 * de otro host en el webhook no recibe nunca el token.
 */
export function esMediaDeTwilio(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'api.twilio.com';
  } catch {
    return false;
  }
}

export interface MediaTwilio {
  url: string;
  contentType?: string;
}

export type WebhookTwilio =
  | {
      tipo: 'entrante';
      accountSid?: string;
      messageSid: string;
      /** Número del paciente (E.164 si se pudo normalizar). */
      desde: string;
      /** Texto del mensaje (una ubicación compartida llega como link al mapa). */
      texto: string;
      /** Nombre del perfil de WhatsApp del que escribe. */
      nombrePerfil?: string;
      media: MediaTwilio[];
    }
  | { tipo: 'estado'; accountSid?: string; messageSid: string; estado: EstadoEntrega; codigoError?: string }
  | { tipo: 'desconocido'; motivo: string };

/** Los campos del POST de Twilio (form-urlencoded: llega como texto o ya parseado). */
function camposTwilio(input: unknown): Record<string, string> {
  if (typeof input === 'string') {
    return Object.fromEntries(new URLSearchParams(input));
  }
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    );
  }
  return {};
}

/** Ubicación compartida por WhatsApp (Latitude/Longitude de Twilio) → link al mapa. */
function textoUbicacion(f: Record<string, string>): string {
  const lat = Number(f.Latitude);
  const lng = Number(f.Longitude);
  if (!f.Latitude || !f.Longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return '';
  }
  const nombre = [f.Label, f.Address].map((x) => x?.trim()).filter(Boolean).join(' · ');
  return `📍 ${nombre || 'Ubicación'}: https://maps.google.com/?q=${lat},${lng}`;
}

/** Interpreta lo que manda Twilio: un mensaje entrante o el estado de un saliente. */
export function leerWebhookTwilio(input: unknown): WebhookTwilio {
  const f = camposTwilio(input);
  const messageSid = f.MessageSid ?? f.SmsMessageSid ?? f.SmsSid;
  if (!messageSid) {
    return { tipo: 'desconocido', motivo: 'sin MessageSid' };
  }
  const estadoCrudo = (f.MessageStatus ?? f.SmsStatus ?? '').toLowerCase();
  const numMedia = Number(f.NumMedia ?? 0) || 0;
  if (estadoCrudo === 'received' || (!estadoCrudo && (f.Body !== undefined || numMedia > 0))) {
    const media: MediaTwilio[] = [];
    for (let i = 0; i < Math.min(numMedia, 10); i++) {
      const url = f[`MediaUrl${i}`];
      if (url) {
        media.push({ url, ...(f[`MediaContentType${i}`] ? { contentType: f[`MediaContentType${i}`] } : {}) });
      }
    }
    const desdeCrudo = f.From ?? (f.WaId ? `+${f.WaId}` : '');
    return {
      tipo: 'entrante',
      ...(f.AccountSid ? { accountSid: f.AccountSid } : {}),
      messageSid,
      desde: aE164AR(desdeCrudo) ?? desdeCrudo.replace(/^whatsapp:/i, ''),
      texto: [(f.Body ?? '').trim(), textoUbicacion(f)].filter(Boolean).join('\n'),
      ...(f.ProfileName?.trim() ? { nombrePerfil: f.ProfileName.trim() } : {}),
      media,
    };
  }
  const estado = estadoEntregaDeTwilio(estadoCrudo);
  if (estado) {
    return {
      tipo: 'estado',
      ...(f.AccountSid ? { accountSid: f.AccountSid } : {}),
      messageSid,
      estado,
      ...(f.ErrorCode ? { codigoError: f.ErrorCode } : {}),
    };
  }
  return { tipo: 'desconocido', motivo: `estado no reconocido: ${estadoCrudo || '(vacío)'}` };
}

/**
 * Errores de Twilio más comunes al mandar un WhatsApp, en palabras de Recepción
 * (códigos del diccionario de errores de Twilio: https://www.twilio.com/docs/api/errors).
 */
const ERRORES_TWILIO: Readonly<Record<string, string>> = {
  '63016': 'pasaron más de 24 h desde el último mensaje del paciente: WhatsApp solo deja mandar plantillas aprobadas',
  '63003': 'el número no tiene WhatsApp',
  '63024': 'el destinatario no es válido para WhatsApp',
  '63018': 'se superó el límite de envíos de WhatsApp; probá de nuevo en unos minutos',
  '21211': 'el número de teléfono no es válido',
  '30003': 'el teléfono del paciente no está disponible (apagado o sin señal)',
  '30005': 'el número no existe o ya no está activo',
  '30006': 'es un teléfono fijo o la operadora no lo alcanza',
  '30007': 'el mensaje fue filtrado por la operadora o por WhatsApp',
};

/** Explicación de un error de Twilio (undefined si no hay código). */
export function explicarErrorTwilio(codigo: string | number | undefined): string | undefined {
  const c = codigo === undefined || codigo === null ? '' : String(codigo).trim();
  if (!c) {
    return undefined;
  }
  const texto = ERRORES_TWILIO[c];
  return texto ? `WhatsApp no entregó el mensaje: ${texto} (Twilio ${c}).` : `WhatsApp no entregó el mensaje (Twilio ${c}: https://www.twilio.com/docs/api/errors/${c}).`;
}

// ───────────────────────────── mensajes del canal WhatsApp ─────────────────────────────

export const CATEGORIA_WHATSAPP: CodeableConcept = {
  coding: [{ system: SYSTEM.canal, code: 'whatsapp', display: 'WhatsApp' }],
  text: 'WhatsApp',
};

/** Largo máximo de un mensaje de WhatsApp por Twilio. */
export const MAX_TEXTO_WHATSAPP = 1600;

/**
 * Un texto largo en partes que Twilio acepta (hasta `max` caracteres), cortando en un
 * salto de línea o un espacio para no partir palabras.
 */
export function partirTexto(texto: string, max: number = MAX_TEXTO_WHATSAPP): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max / 2) {
      corte = resto.lastIndexOf(' ', max);
    }
    if (corte < max / 2) {
      corte = max;
    }
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  return resto ? [...partes, resto] : partes;
}

/** Llegó o salió por WhatsApp (extensión `canal` o categoría). */
export function esWhatsApp(c: Communication): boolean {
  return (
    c.extension?.some((e) => e.url === EXT.canal && e.valueCode === 'whatsapp') === true ||
    (c.category ?? []).some((cc) => cc.coding?.some((k) => k.system === SYSTEM.canal && k.code === 'whatsapp'))
  );
}

function delPaciente(c: Communication): boolean {
  return Boolean(c.sender?.reference?.startsWith('Patient/'));
}

export function estadoEntregaDe(c: Communication): EstadoEntrega | undefined {
  const v = c.extension?.find((e) => e.url === EXT.estadoEntrega)?.valueCode;
  return v && v in RANGO ? (v as EstadoEntrega) : undefined;
}

export function telefonoDe(c: Communication): string | undefined {
  return c.extension?.find((e) => e.url === EXT.telefonoWhatsapp)?.valueString;
}

/** Primer WhatsApp de un número nuevo (Mensajes lo marca «Nuevo»; el aviso es un Task). */
export function esInicioContacto(c: Communication): boolean {
  return c.extension?.some((e) => e.url === EXT.inicioContacto && e.valueBoolean === true) === true;
}

/** Respuesta que mandó solo el sistema (acuse o fuera de horario): se ve «🤖 Automática». */
export function tipoAutomatica(c: Communication): TipoRespuestaAutomatica | undefined {
  const v = c.extension?.find((e) => e.url === EXT.autoRespuesta)?.valueCode;
  return v === 'acuse' || v === 'fuera-de-horario' ? v : undefined;
}

export function textoDe(c: Communication): string {
  return (c.payload ?? [])
    .map((p) => p.contentString)
    .filter((t): t is string => Boolean(t?.trim()))
    .join('\n');
}

export function adjuntosDe(c: Communication): Attachment[] {
  return (c.payload ?? []).map((p) => p.contentAttachment).filter((a): a is Attachment => Boolean(a));
}

/**
 * Etiqueta de confidencialidad HL7 v3 "R" (restricted) para los WhatsApp que llevan
 * información clínica (p. ej. el aviso del informe SOM con su resumen).
 */
export const ETIQUETA_RESERVADO: Coding = {
  system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
  code: 'R',
  display: 'restricted',
};

export type TipoAdjunto = 'imagen' | 'audio' | 'video' | 'documento' | 'contacto' | 'otro';

export function tipoAdjunto(contentType: string | undefined): TipoAdjunto {
  const t = (contentType ?? '').toLowerCase();
  if (t.startsWith('image/')) {
    return 'imagen';
  }
  if (t.startsWith('audio/')) {
    return 'audio';
  }
  if (t.startsWith('video/')) {
    return 'video';
  }
  if (t.includes('vcard')) {
    return 'contacto';
  }
  if (t.startsWith('application/') || t.startsWith('text/')) {
    return 'documento';
  }
  return 'otro';
}

const ETIQUETA_ADJUNTO: Readonly<Record<TipoAdjunto, string>> = {
  imagen: '📷 Foto',
  audio: '🎤 Audio',
  video: '🎬 Video',
  documento: '📄 Documento',
  contacto: '👤 Contacto',
  otro: '📎 Archivo',
};

export function etiquetaAdjunto(a: Attachment): string {
  return ETIQUETA_ADJUNTO[tipoAdjunto(a.contentType)];
}

const EXTENSIONES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'text/vcard': 'vcf',
  'text/x-vcard': 'vcf',
};

/** Nombre del archivo que se guarda para el adjunto n.º `indice` de un mensaje. */
export function nombreAdjunto(contentType: string | undefined, indice: number): string {
  const base = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  return `whatsapp-${indice + 1}.${EXTENSIONES[base] ?? 'bin'}`;
}

/** Tope de un adjunto entrante que se guarda (WhatsApp admite hasta 16 MB). */
export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;

/** Tope de un archivo que adjunta Recepción (Twilio rechaza medios más grandes). */
export const MAX_ADJUNTO_RECEPCION_BYTES = 15 * 1024 * 1024;

/** Una línea para la lista de conversaciones y la campanita. */
export function vistaPrevia(c: Communication): string {
  const texto = textoDe(c).replace(/\s+/g, ' ').trim();
  if (texto) {
    return texto;
  }
  const adjunto = adjuntosDe(c)[0];
  return adjunto ? etiquetaAdjunto(adjunto) : '';
}

/** Lo que se muestra si WhatsApp mandó un tipo de mensaje sin texto ni archivo. */
export const MENSAJE_SIN_CONTENIDO = '(mensaje de WhatsApp sin texto que no se puede mostrar)';

// ───────────────────────────── hilos (conversaciones de Mensajes) ─────────────────────────────

/** Motivo de las conversaciones que abre un WhatsApp (los del portal, `mensajes.ts`). */
export const MOTIVO_WHATSAPP = { code: 'otro', titulo: 'Otro motivo' } as const;

/**
 * Una conversación de Mensajes abierta (no un mensaje, ni una Novedad del portal, ni un
 * aviso suelto): sin `partOf`, en curso y con motivo.
 */
export function esConversacionAbierta(c: Communication): boolean {
  return (
    !c.partOf?.length &&
    c.status === 'in-progress' &&
    Boolean(c.topic) &&
    !(c.category ?? []).some((cc) => cc.coding?.some((k) => k.system === SYSTEM.notificacion))
  );
}

/** La conversación abierta más reciente del paciente (a la que entra su WhatsApp). */
export function conversacionAbierta(candidatas: Communication[]): Communication | undefined {
  return candidatas
    .filter(esConversacionAbierta)
    .sort((a, b) => (b.meta?.lastUpdated ?? '').localeCompare(a.meta?.lastUpdated ?? ''))[0];
}

/**
 * Clave de la conversación que abre un WhatsApp (identifier): evita abrir dos si llegan
 * dos mensajes a la vez. Solo cuenta la abierta (se busca junto con `status=in-progress`).
 */
export function claveConversacionWhatsApp(pacienteRef: string): string {
  return `conversacion-whatsapp-${pacienteRef.split('/')[1] ?? pacienteRef}`;
}

/** Conversación nueva que abre un WhatsApp (el paciente no tenía ninguna abierta). */
export function construirConversacionWhatsApp(pacienteRef: string): Communication {
  const paciente = { reference: pacienteRef };
  return {
    resourceType: 'Communication',
    status: 'in-progress',
    identifier: [{ system: SYSTEM.communication, value: claveConversacionWhatsApp(pacienteRef) }],
    subject: paciente,
    sender: paciente,
    topic: {
      coding: [{ system: SYSTEM.motivoMensaje, code: MOTIVO_WHATSAPP.code, display: MOTIVO_WHATSAPP.titulo }],
      text: MOTIVO_WHATSAPP.titulo,
    },
    // Por dónde empezó (la bandeja lo muestra con el ícono de WhatsApp).
    extension: [{ url: EXT.canal, valueCode: 'whatsapp' }],
  };
}

/** El WhatsApp del paciente como mensaje de la conversación (sin leer: `in-progress`). */
export function construirMensajeEntrante(p: {
  conversacionRef: string;
  pacienteRef: string;
  texto: string;
  adjuntos: Attachment[];
  messageSid: string;
  telefono: string;
  inicioContacto: boolean;
  ahora: string;
}): Communication {
  return {
    resourceType: 'Communication',
    status: 'in-progress',
    partOf: [{ reference: p.conversacionRef }],
    identifier: [{ system: SYSTEM.twilioMessageSid, value: p.messageSid }],
    subject: { reference: p.pacienteRef },
    sender: { reference: p.pacienteRef },
    sent: p.ahora,
    payload: [
      // Sin texto ni adjuntos (un tipo de mensaje que Twilio no reenvía): que se vea igual.
      ...(p.texto || p.adjuntos.length === 0 ? [{ contentString: p.texto || MENSAJE_SIN_CONTENIDO }] : []),
      ...p.adjuntos.map((a) => ({ contentAttachment: a })),
    ],
    extension: [
      { url: EXT.canal, valueCode: 'whatsapp' },
      { url: EXT.telefonoWhatsapp, valueString: p.telefono },
      ...(p.inicioContacto ? [{ url: EXT.inicioContacto, valueBoolean: true }] : []),
    ],
  };
}

/** La respuesta automática como mensaje de la conversación (firmada por el sistema). */
export function construirRespuestaAutomatica(p: {
  conversacionRef: string;
  pacienteRef: string;
  tipo: TipoRespuestaAutomatica;
  texto: string;
  ahora: string;
}): Communication {
  const paciente = { reference: p.pacienteRef };
  return {
    resourceType: 'Communication',
    status: 'in-progress',
    partOf: [{ reference: p.conversacionRef }],
    subject: paciente,
    sender: { display: REMITENTE_AUTOMATICO },
    recipient: [paciente],
    sent: p.ahora,
    payload: [{ contentString: p.texto }],
    extension: [{ url: EXT.autoRespuesta, valueCode: p.tipo }],
  };
}

/** El mensaje con los datos del envío por WhatsApp (canal, número, ✓ y MessageSid). */
export function conEnvioWhatsApp(
  c: Communication,
  envio: { telefono?: string; entrega?: EstadoEntrega; messageSids: string[]; motivo?: string },
): Communication {
  const propias: string[] = [EXT.canal, EXT.telefonoWhatsapp, EXT.estadoEntrega];
  return {
    ...c,
    extension: [
      ...(c.extension ?? []).filter((e) => !propias.includes(e.url)),
      { url: EXT.canal, valueCode: 'whatsapp' },
      ...(envio.telefono ? [{ url: EXT.telefonoWhatsapp, valueString: envio.telefono }] : []),
      ...(envio.entrega ? [{ url: EXT.estadoEntrega, valueCode: envio.entrega }] : []),
    ],
    ...(envio.messageSids.length
      ? {
          identifier: [
            ...(c.identifier ?? []),
            ...envio.messageSids.map((value) => ({ system: SYSTEM.twilioMessageSid, value })),
          ],
        }
      : {}),
    ...(envio.motivo ? { statusReason: { text: envio.motivo } } : {}),
  };
}

/** El último mensaje del paciente en la conversación (define por dónde se le responde). */
export function ultimoDelPaciente(hilo: Communication[]): Communication | undefined {
  return [...hilo]
    .filter(delPaciente)
    .sort((a, b) => (a.sent ?? '').localeCompare(b.sent ?? ''))
    .pop();
}

export type DecisionEnvio =
  | { enviar: true; telefono: string }
  | { enviar: false; canal: 'portal' }
  | { enviar: false; canal: 'whatsapp'; motivo: string };

/**
 * ¿La respuesta de Recepción sale también por WhatsApp? Sí, si el último mensaje del
 * paciente en la conversación llegó por WhatsApp y la ventana de 24 h sigue abierta.
 * Si escribió por el portal, la respuesta queda solo en el portal.
 */
export function decidirEnvioWhatsApp(hilo: Communication[], ahora: Date = new Date()): DecisionEnvio {
  const ultimo = ultimoDelPaciente(hilo);
  if (!ultimo || !esWhatsApp(ultimo)) {
    return { enviar: false, canal: 'portal' };
  }
  if (!ventana24h(ultimo.sent, ahora).abierta) {
    return {
      enviar: false,
      canal: 'whatsapp',
      motivo:
        'pasaron más de 24 h desde el último WhatsApp del paciente: WhatsApp solo acepta plantillas aprobadas (pendientes). El mensaje quedó en la conversación y lo ve en el portal.',
    };
  }
  const telefono = telefonoDe(ultimo);
  return telefono
    ? { enviar: true, telefono }
    : { enviar: false, canal: 'whatsapp', motivo: 'no se sabe desde qué número escribió el paciente.' };
}

// ───────────────────────────── pacientes ─────────────────────────────

/**
 * Paciente nuevo (lead del CRM) para un número que escribe por primera vez. El nombre
 * del perfil de WhatsApp queda como apodo (`nickname`): el real lo completa Recepción
 * con el alta (`som-alta-paciente` encuentra este lead por el teléfono y lo completa).
 * El embudo del CRM lo ve con origen `whatsapp`.
 */
export function construirLeadWhatsApp(telefono: string, nombrePerfil?: string): Patient {
  const nombre = nombrePerfil?.replace(/\s+/g, ' ').trim();
  return {
    resourceType: 'Patient',
    active: true,
    // Sin nombre de perfil, como WhatsApp con un número que no está en la agenda: el número.
    name: [{ use: 'nickname', text: nombre || formatoTelefono(telefono) }],
    telecom: [{ system: 'phone', value: telefono, use: 'mobile' }],
    extension: [
      { url: EXT.origenLead, valueString: 'whatsapp' },
      { url: EXT.cicloVidaCliente, valueCode: 'lead' },
    ],
  };
}

/**
 * Si varios pacientes tienen el número que escribe: primero los activos, después los que
 * ya son pacientes (no un lead del CRM) y, entre ellos, el actualizado más recientemente.
 */
export function elegirPacientePorTelefono(candidatos: Patient[]): Patient | undefined {
  const esLead = (p: Patient): boolean =>
    p.extension?.some((e) => e.url === EXT.cicloVidaCliente && e.valueCode === 'lead') === true;
  const puntaje = (p: Patient): number => (p.active === false ? 0 : 2) + (esLead(p) ? 0 : 1);
  return [...candidatos].sort(
    (a, b) => puntaje(b) - puntaje(a) || (b.meta?.lastUpdated ?? '').localeCompare(a.meta?.lastUpdated ?? ''),
  )[0];
}

/** El paciente solo tiene el apodo del perfil de WhatsApp: falta completar la ficha (alta). */
export function esSinFicha(p: Patient): boolean {
  return (p.name ?? []).every((n) => n.use === 'nickname');
}

export function nombreDePaciente(p: Patient): string {
  const n = p.name?.[0];
  return n?.text ?? ([...(n?.given ?? []), n?.family].filter(Boolean).join(' ') || 'Paciente');
}

// ───────────────────────────── fechas e iniciales (hora de Argentina) ─────────────────────────────

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtFecha = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' });

/** "HH:MM" en Argentina. */
export function horaMensaje(iso: string | undefined): string {
  return iso ? fmtHora.format(new Date(iso)) : '';
}


/** Separador de día del chat: "Hoy", "Ayer" o "lunes 21/09". */
export function etiquetaDia(iso: string, ahora: Date = new Date()): string {
  const dia = fmtDia.format(new Date(iso));
  const hoy = fmtDia.format(ahora);
  const ayer = fmtDia.format(new Date(ahora.getTime() - 86_400_000));
  if (dia === hoy) {
    return 'Hoy';
  }
  if (dia === ayer) {
    return 'Ayer';
  }
  return fmtFecha.format(new Date(iso));
}

const fmtSemana = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long' });
const fmtCorta = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' });

/** Hora de la lista de chats, como WhatsApp: "14:32", "Ayer", "lunes" o "21/09/26". */
export function fechaCorta(iso: string | undefined, ahora: Date = new Date()): string {
  if (!iso) {
    return '';
  }
  const etiqueta = etiquetaDia(iso, ahora);
  if (etiqueta === 'Hoy') {
    return horaMensaje(iso);
  }
  if (etiqueta === 'Ayer') {
    return etiqueta;
  }
  const dias = (Date.parse(fmtDia.format(ahora)) - Date.parse(fmtDia.format(new Date(iso)))) / 86_400_000;
  return dias < 7 ? fmtSemana.format(new Date(iso)) : fmtCorta.format(new Date(iso));
}

/** "recién", "hace 5 min", "hace 2 h" o la fecha corta (para la campanita). */
export function haceCuanto(iso: string | undefined, ahora: Date = new Date()): string {
  if (!iso) {
    return '';
  }
  const minutos = Math.floor((ahora.getTime() - Date.parse(iso)) / 60_000);
  if (minutos < 1) {
    return 'recién';
  }
  if (minutos < 60) {
    return `hace ${minutos} min`;
  }
  if (minutos < 12 * 60) {
    return `hace ${Math.floor(minutos / 60)} h`;
  }
  return fechaCorta(iso, ahora);
}

/** El "nombre" es solo el número (un contacto que escribió sin nombre de perfil). */
export function esSoloNumero(nombre: string): boolean {
  return /^\+?[\d\s()-]+$/.test(nombre.trim());
}

/** Iniciales para el avatar ("" si el contacto todavía no tiene nombre: se muestra un ícono). */
export function iniciales(nombre: string): string {
  if (esSoloNumero(nombre)) {
    return '';
  }
  const palabras = nombre.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return palabras
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
