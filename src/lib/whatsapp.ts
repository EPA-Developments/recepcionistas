/**
 * WhatsApp (Twilio) — lógica pura del chat de Recepción (sin red).
 *
 *  - Teléfonos: WhatsApp (y Twilio) exigen E.164. En Argentina un celular es
 *    `+54 9 {área sin 0} {número sin 15}`; acá se normaliza lo que se tipeó en la ficha
 *    (`011 15 2233-4455`, `11 2233-4455`, `+54 11 …`) y se arman las variantes para
 *    encontrar al paciente que escribe.
 *  - Webhook de Twilio: el mismo bot recibe los mensajes entrantes y los estados de
 *    entrega de los salientes (enviado / entregado / leído / fallido: los ✓✓).
 *  - Ventana de 24 h de WhatsApp: el negocio responde texto libre solo dentro de las
 *    24 h del último mensaje del paciente; fuera de ella, solo plantillas aprobadas.
 *  - Chats: cada paciente es un chat (todas sus Communication de WhatsApp, entrantes y
 *    salientes, incluidos recordatorios y confirmaciones).
 */
import type { Attachment, CodeableConcept, Coding, Communication, Patient } from '@medplum/fhirtypes';
import { TZ } from '../config/horario.js';
import { EXT, SYSTEM } from '../fhir/identifiers.js';

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

// ───────────────────────────── ventana de 24 h ─────────────────────────────

/** Horas en que WhatsApp deja responder texto libre después del último mensaje del paciente. */
export const VENTANA_WHATSAPP_HORAS = 24;

export interface VentanaWhatsApp {
  abierta: boolean;
  /** Hasta cuándo se puede responder (ISO), si hubo un mensaje del paciente. */
  cierra?: string;
}

export function ventanaWhatsApp(ultimoEntrante: string | undefined, ahora: Date = new Date()): VentanaWhatsApp {
  if (!ultimoEntrante) {
    return { abierta: false };
  }
  const cierra = new Date(Date.parse(ultimoEntrante) + VENTANA_WHATSAPP_HORAS * 3_600_000);
  return { abierta: cierra.getTime() > ahora.getTime(), cierra: cierra.toISOString() };
}

/**
 * ¿El mensaje del paciente abre una conversación? Sí, si no hubo ningún WhatsApp con él
 * (de ida o de vuelta) en las últimas 24 h: el contacto nuevo o el que vuelve a escribir
 * después de un tiempo (lo que WhatsApp llama una conversación iniciada por el usuario).
 * Es lo que avisa la campanita de Recepción.
 */
export function esInicioDeContacto(ultimaActividad: string | undefined, ahora: Date = new Date()): boolean {
  const t = ultimaActividad ? Date.parse(ultimaActividad) : Number.NaN;
  return Number.isNaN(t) || ahora.getTime() - t >= VENTANA_WHATSAPP_HORAS * 3_600_000;
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

// ───────────────────────────── mensajes (Communication) ─────────────────────────────

export const CATEGORIA_WHATSAPP: CodeableConcept = {
  coding: [{ system: SYSTEM.canal, code: 'whatsapp', display: 'WhatsApp' }],
  text: 'WhatsApp',
};

/** Largo máximo de un mensaje de WhatsApp por Twilio. */
export const MAX_TEXTO_WHATSAPP = 1600;

export function esWhatsApp(c: Communication): boolean {
  return (
    (c.category ?? []).some((cc) => cc.coding?.some((k) => k.system === SYSTEM.canal && k.code === 'whatsapp')) ||
    c.extension?.some((e) => e.url === EXT.canal && e.valueCode === 'whatsapp') === true
  );
}

/** Mensaje del paciente (entrante): lo manda el Patient. */
export function esEntrante(c: Communication): boolean {
  return Boolean(c.sender?.reference?.startsWith('Patient/'));
}

export function estadoEntregaDe(c: Communication): EstadoEntrega | undefined {
  const v = c.extension?.find((e) => e.url === EXT.estadoEntrega)?.valueCode;
  return v && v in RANGO ? (v as EstadoEntrega) : undefined;
}

export function telefonoDe(c: Communication): string | undefined {
  return c.extension?.find((e) => e.url === EXT.telefonoWhatsapp)?.valueString;
}

export function esInicioContacto(c: Communication): boolean {
  return c.extension?.some((e) => e.url === EXT.inicioContacto && e.valueBoolean === true) === true;
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
 * Etiqueta de confidencialidad HL7 v3 "R" (restricted): el WhatsApp lleva información
 * clínica (p. ej. el aviso del informe SOM con su resumen). El chat de Recepción muestra
 * que salió, nunca el contenido (privacidad por diseño).
 */
export const ETIQUETA_RESERVADO: Coding = {
  system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
  code: 'R',
  display: 'restricted',
};

export function esReservado(c: Communication): boolean {
  return (c.meta?.security ?? []).some((s) => s.system === ETIQUETA_RESERVADO.system && s.code === ETIQUETA_RESERVADO.code);
}

/** Lo que Recepción ve en lugar de un mensaje reservado. */
export const TEXTO_RESERVADO = '🔒 Aviso con información clínica (solo lo ve el paciente)';

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

/**
 * ¿Se puede abrir en el navegador? Solo fotos, audio, video y PDF. Lo demás (un HTML o un
 * SVG que mande alguien por WhatsApp puede traer código) se descarga, nunca se abre en
 * la app de Recepción.
 */
export function esSeguroParaVer(contentType: string | undefined): boolean {
  const t = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  return /^(image\/(png|jpeg|webp|gif)|audio\/[\w.+-]+|video\/(mp4|3gpp|webm)|application\/pdf)$/.test(t);
}

/** Tope de un adjunto entrante que se guarda (WhatsApp admite hasta 16 MB). */
export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;

/** Tope de un adjunto que el bot devuelve para verlo en el chat (la respuesta viaja en base64). */
export const MAX_ADJUNTO_VISTA_BYTES = 4 * 1024 * 1024;

/** Una línea para la lista de chats y la campanita. */
export function vistaPrevia(c: Communication): string {
  if (esReservado(c)) {
    return TEXTO_RESERVADO;
  }
  const texto = textoDe(c).replace(/\s+/g, ' ').trim();
  if (texto) {
    return texto;
  }
  const adjunto = adjuntosDe(c)[0];
  return adjunto ? etiquetaAdjunto(adjunto) : '';
}

/** Lo que se muestra si WhatsApp mandó un tipo de mensaje sin texto ni archivo. */
export const MENSAJE_SIN_CONTENIDO = '(mensaje de WhatsApp sin texto que no se puede mostrar)';

/** El mensaje entrante tal como se guarda (sin leer: `in-progress`, como en Mensajes). */
export function construirMensajeEntrante(p: {
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
    category: [CATEGORIA_WHATSAPP],
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

// ───────────────────────────── chats (vista de Recepción) ─────────────────────────────

export interface ChatWhatsApp {
  /** "Patient/<id>". */
  pacienteRef: string;
  nombre: string;
  /** El número de WhatsApp del chat (E.164), si se conoce. */
  telefono?: string;
  ultimo: Communication;
  /** Mensajes del paciente que Recepción no leyó. */
  sinLeer: number;
  /** Primer mensaje de un contacto que todavía nadie de SOM respondió. */
  nuevoContacto: boolean;
  /** Último mensaje del paciente (ISO): abre la ventana de 24 h. */
  ultimoEntrante?: string;
  /** Última actividad (ISO), para ordenar. */
  actividad: string;
  /** Contacto que llegó por WhatsApp y todavía no tiene ficha (solo el apodo del perfil). */
  sinFicha?: boolean;
}

function porFecha(a: Communication, b: Communication): number {
  return (a.sent ?? a.meta?.lastUpdated ?? '').localeCompare(b.sent ?? b.meta?.lastUpdated ?? '');
}

export function ordenarMensajes(mensajes: Communication[]): Communication[] {
  return [...mensajes].sort(porFecha);
}

/**
 * Agrupa los WhatsApp por paciente: un chat por paciente, del más activo al menos.
 * Los mensajes sin paciente (p. ej. avisos al número de Recepción) no son un chat.
 */
export function resumirChats(mensajes: Communication[], nombres: ReadonlyMap<string, string>): ChatWhatsApp[] {
  const porPaciente = new Map<string, Communication[]>();
  for (const m of mensajes) {
    const ref = m.subject?.reference;
    if (ref?.startsWith('Patient/') && esWhatsApp(m)) {
      porPaciente.set(ref, [...(porPaciente.get(ref) ?? []), m]);
    }
  }
  const chats: ChatWhatsApp[] = [];
  for (const [pacienteRef, lista] of porPaciente) {
    const orden = ordenarMensajes(lista);
    const ultimo = orden[orden.length - 1]!;
    const entrantes = orden.filter(esEntrante);
    const inicio = orden.findIndex(esInicioContacto);
    const respondido = inicio >= 0 && orden.slice(inicio + 1).some((m) => !esEntrante(m));
    chats.push({
      pacienteRef,
      nombre: nombres.get(pacienteRef) ?? 'Paciente',
      telefono: [...orden].reverse().map(telefonoDe).find(Boolean),
      ultimo,
      sinLeer: entrantes.filter(esNoLeido).length,
      nuevoContacto: inicio >= 0 && !respondido,
      ultimoEntrante: entrantes[entrantes.length - 1]?.sent,
      actividad: ultimo.sent ?? ultimo.meta?.lastUpdated ?? '',
    });
  }
  return chats.sort((a, b) => b.actividad.localeCompare(a.actividad));
}

/** El paciente solo tiene el apodo del perfil de WhatsApp: falta completar la ficha (alta). */
export function esSinFicha(p: Patient): boolean {
  return (p.name ?? []).every((n) => n.use === 'nickname');
}

/** Lo que se ve al pie de un saliente: los ✓✓ o que no salió. */
export type EstadoVisible = EstadoEntrega | 'no-enviado';

export function estadoVisible(c: Communication): EstadoVisible {
  const entrega = estadoEntregaDe(c);
  if (c.status === 'entered-in-error' || entrega === 'fallido') {
    return 'fallido';
  }
  if (c.status === 'preparation') {
    return 'no-enviado';
  }
  return entrega ?? 'enviado';
}

/** El template de un saliente automático (recordatorio, confirmación, …). */
export function plantillaDe(c: Communication): string | undefined {
  return c.extension?.find((e) => e.url === EXT.templateUsado)?.valueString;
}

/** Template de las respuestas que escribe Recepción en el chat (no son automáticas). */
export const PLANTILLA_RESPUESTA = 'respuesta-recepcion';

/** Fecha (ISO) del mensaje más reciente de la lista. */
export function ultimaActividad(mensajes: Communication[]): string | undefined {
  return mensajes.map((m) => m.sent).filter((s): s is string => Boolean(s)).sort().pop();
}

/** El último mensaje del paciente (define la ventana de 24 h y a qué número responder). */
export function ultimoEntrante(mensajes: Communication[]): Communication | undefined {
  return ordenarMensajes(mensajes.filter((m) => esWhatsApp(m) && esEntrante(m))).pop();
}

/** Un aviso de la campanita: alguien abrió una conversación y nadie la leyó todavía. */
export interface AvisoWhatsApp {
  pacienteRef: string;
  nombre: string;
  telefono?: string;
  /** Vista previa del mensaje. */
  texto: string;
  sent: string;
}

/** Mensaje del paciente que Recepción todavía no leyó (`in-progress`, como en Mensajes). */
export function esNoLeido(m: Communication): boolean {
  return esWhatsApp(m) && esEntrante(m) && m.status === 'in-progress';
}

/**
 * La campanita: los mensajes que abren conversación (inicio de contacto) sin leer, uno
 * por paciente (el más reciente), del más nuevo al más viejo. Se apagan al abrir el chat.
 */
export function avisosInicioContacto(mensajes: Communication[], nombres: ReadonlyMap<string, string>): AvisoWhatsApp[] {
  const porPaciente = new Map<string, Communication>();
  for (const m of mensajes) {
    const ref = m.subject?.reference;
    if (!ref?.startsWith('Patient/') || !esNoLeido(m) || !esInicioContacto(m)) {
      continue;
    }
    const previo = porPaciente.get(ref);
    if (!previo || (m.sent ?? '') > (previo.sent ?? '')) {
      porPaciente.set(ref, m);
    }
  }
  return [...porPaciente.entries()]
    .map(([pacienteRef, m]) => ({
      pacienteRef,
      nombre: nombres.get(pacienteRef) ?? 'Contacto nuevo',
      ...(telefonoDe(m) ? { telefono: telefonoDe(m) } : {}),
      texto: vistaPrevia(m),
      sent: m.sent ?? '',
    }))
    .sort((a, b) => b.sent.localeCompare(a.sent));
}

/** Mensajes de pacientes sin leer (el contador de la pestaña WhatsApp). */
export function contarNoLeidos(mensajes: Communication[]): number {
  return mensajes.filter(esNoLeido).length;
}

export function nombreDePaciente(p: Patient): string {
  const n = p.name?.[0];
  return n?.text ?? ([...(n?.given ?? []), n?.family].filter(Boolean).join(' ') || 'Paciente');
}

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

/** Cuándo se cierra la ventana de 24 h: "hoy a las 18:40" o "mañana a las 09:15". */
export function cierreVentana(cierra: string | undefined, ahora: Date = new Date()): string {
  if (!cierra) {
    return '';
  }
  const hoy = diaDeMensaje(ahora.toISOString()) === diaDeMensaje(cierra);
  return `${hoy ? 'hoy' : 'mañana'} a las ${horaMensaje(cierra)}`;
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

/** Día (AAAA-MM-DD, Argentina) de un mensaje: para agrupar por separador. */
export function diaDeMensaje(iso: string | undefined): string {
  return iso ? fmtDia.format(new Date(iso)) : '';
}
