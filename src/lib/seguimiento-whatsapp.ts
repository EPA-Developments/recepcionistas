/**
 * Seguimiento de la prueba de WhatsApp de punta a punta (lógica pura, sin red).
 *
 * `npm run whatsapp:seguimiento -- +549…` lee de Medplum lo que dejó un celular (paciente,
 * aviso a Recepción, su conversación) y de Twilio lo que pasó con sus mensajes; estas
 * funciones lo convierten en el **paso a paso** de la prueba (qué ya pasó, qué falta y qué
 * falló) y cruzan los dos lados: un mensaje que Twilio recibió y SOM no registró es un
 * webhook que no llegó. Ver docs/whatsapp.md → Probar.
 */
import type { Communication, Patient, Task } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';
import { textoRestante, ventana24h } from './auto-respuesta.js';
import { esAvisoContacto } from './contactos-whatsapp.js';
import { ocultarClaveUrl } from './webhooks.js';
import {
  estadoEntregaDe,
  esInicioContacto,
  esSinFicha,
  esWhatsApp,
  explicarErrorTwilio,
  fechaCorta,
  horaMensaje,
  nombreDePaciente,
  tipoAutomatica,
  vistaPrevia,
  type EstadoEntrega,
} from './whatsapp.js';

export type EstadoPaso = 'ok' | 'pendiente' | 'falla' | 'no-aplica';

export interface PasoSeguimiento {
  titulo: string;
  estado: EstadoPaso;
  detalle: string;
}

export interface DatosSeguimiento {
  /** El paciente (o lead) con ese número, si hay. */
  paciente?: Patient;
  /** El aviso a Recepción (`Task` whatsapp-nuevo-contacto) del paciente, si hay. */
  aviso?: Task;
  /** Los mensajes de su conversación más reciente (en cualquier orden). */
  mensajes: Communication[];
  ahora: Date;
}

const MARCA: Readonly<Record<EstadoPaso, string>> = { ok: '✓', pendiente: '·', falla: '✗', 'no-aplica': '–' };

export function marcaPaso(estado: EstadoPaso): string {
  return MARCA[estado];
}

const ENTREGA: Readonly<Record<EstadoEntrega, string>> = {
  'en-cola': '🕓 en cola',
  enviado: '✓ enviado',
  entregado: '✓✓ entregado',
  leido: '✓✓ leído',
  fallido: '✗ falló',
};

/** "✓✓ entregado", "✗ falló", o "sin estado" (el ✓ de un mensaje que salió por WhatsApp). */
export function textoEntrega(e: EstadoEntrega | undefined): string {
  return e ? ENTREGA[e] : 'sin estado de entrega';
}

function delPaciente(c: Communication): boolean {
  return Boolean(c.sender?.reference?.startsWith('Patient/'));
}

function cronologico(mensajes: Communication[]): Communication[] {
  return [...mensajes].sort((a, b) => (a.sent ?? '').localeCompare(b.sent ?? ''));
}

function cuando(iso: string | undefined, ahora: Date): string {
  if (!iso) {
    return '¿cuándo?';
  }
  const dia = fechaCorta(iso, ahora);
  const hora = horaMensaje(iso);
  return dia === hora ? `hoy ${hora}` : `${dia} ${hora}`;
}

function corto(texto: string, max = 60): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/** Un saliente por WhatsApp: su estado de entrega y, si falló o no salió, el motivo. */
function estadoSaliente(m: Communication): { estado: EstadoPaso; texto: string } {
  const entrega = estadoEntregaDe(m);
  const motivo = m.statusReason?.text;
  if (entrega === 'fallido' || (!entrega && motivo)) {
    return { estado: 'falla', texto: `${textoEntrega('fallido')}${motivo ? `: ${motivo}` : ''}` };
  }
  if (entrega === 'entregado' || entrega === 'leido') {
    return { estado: 'ok', texto: textoEntrega(entrega) };
  }
  return {
    estado: 'pendiente',
    texto:
      `${textoEntrega(entrega)}: esperando los ✓✓. Si no cambia en un minuto, Twilio no está devolviendo ` +
      'los estados (TWILIO_WEBHOOK_URL / alertas de Twilio más abajo).',
  };
}

/**
 * El paso a paso de la prueba para un celular: escribió, quién es en SOM, aviso a Recepción,
 * respuesta automática, respuesta de Recepción (con sus ✓✓) y ficha completada.
 */
export function pasosSeguimiento(d: DatosSeguimiento): PasoSeguimiento[] {
  const hilo = cronologico(d.mensajes);
  const entrantes = hilo.filter((m) => delPaciente(m) && esWhatsApp(m));
  const ultimoEntrante = entrantes[entrantes.length - 1];
  const esNuevo = Boolean(d.aviso && esAvisoContacto(d.aviso)) || hilo.some(esInicioContacto);
  const pasos: PasoSeguimiento[] = [];

  // 1) El celular escribió.
  pasos.push(
    ultimoEntrante
      ? {
          titulo: 'El celular escribió al WhatsApp de SOM',
          estado: 'ok',
          detalle: `${entrantes.length} mensaje(s); el último ${cuando(ultimoEntrante.sent, d.ahora)} «${corto(vistaPrevia(ultimoEntrante))}»`,
        }
      : {
          titulo: 'El celular escribió al WhatsApp de SOM',
          estado: 'pendiente',
          detalle: d.paciente
            ? 'Todavía no hay mensajes de WhatsApp de este número en su conversación: escribí desde el celular.'
            : 'Escribí desde el celular al WhatsApp de SOM (abre la ventana de 24 h).',
        },
  );

  // 2) Quién es en SOM.
  if (!d.paciente) {
    pasos.push({
      titulo: 'Quién es en SOM',
      estado: 'pendiente',
      detalle: 'El número no está en SOM: cuando escriba se crea como lead (contacto nuevo).',
    });
  } else if (esNuevo) {
    pasos.push({
      titulo: 'Quién es en SOM',
      estado: 'ok',
      detalle: `Lead nuevo del CRM (origen WhatsApp): «${nombreDePaciente(d.paciente)}» · Patient/${d.paciente.id ?? '?'}`,
    });
  } else {
    pasos.push({
      titulo: 'Quién es en SOM',
      estado: 'ok',
      detalle:
        `Ya estaba en SOM: «${nombreDePaciente(d.paciente)}» · Patient/${d.paciente.id ?? '?'}. No es un contacto ` +
        'nuevo, así que no hay aviso ni campanita; para probar la pestaña WhatsApp, usá un celular que no esté en SOM.',
    });
  }

  // 3) El aviso a Recepción (pestaña WhatsApp y campanita).
  if (d.aviso) {
    const resuelto = d.aviso.status === 'completed';
    pasos.push({
      titulo: 'Aviso a Recepción (pestaña WhatsApp y campanita)',
      estado: 'ok',
      detalle: resuelto
        ? `Resuelto: ${d.aviso.businessStatus?.text ?? 'sí'} · Task/${d.aviso.id ?? '?'}`
        : `Pendiente: la tarjeta está en la pestaña WhatsApp y suena la campanita · Task/${d.aviso.id ?? '?'}`,
    });
  } else if (esNuevo) {
    pasos.push({
      titulo: 'Aviso a Recepción (pestaña WhatsApp y campanita)',
      estado: 'falla',
      detalle:
        'Es un número nuevo pero no hay aviso: el bot devuelve error para que Twilio reintente y lo deje. ' +
        'Revisá los logs de som-whatsapp-entrante.',
    });
  } else {
    pasos.push({
      titulo: 'Aviso a Recepción (pestaña WhatsApp y campanita)',
      estado: d.paciente ? 'no-aplica' : 'pendiente',
      detalle: d.paciente ? 'Solo para números nuevos.' : 'Aparece cuando escriba un número que no está en SOM.',
    });
  }

  // 4) La respuesta automática (acuse o fuera de horario).
  const automaticas = hilo.filter((m) => tipoAutomatica(m) !== undefined);
  const ultimaAutomatica = automaticas[automaticas.length - 1];
  if (ultimaAutomatica) {
    const s = estadoSaliente(ultimaAutomatica);
    pasos.push({
      titulo: 'Respuesta automática',
      estado: s.estado,
      detalle: `${tipoAutomatica(ultimaAutomatica) === 'acuse' ? 'Acuse' : 'Fuera de horario'} ${cuando(ultimaAutomatica.sent, d.ahora)} · ${s.texto}`,
    });
  } else if (hilo[0] && delPaciente(hilo[0]) && esWhatsApp(hilo[0])) {
    pasos.push({
      titulo: 'Respuesta automática',
      estado: 'falla',
      detalle: 'El WhatsApp abrió la conversación y no salió el acuse: revisá los logs de som-whatsapp-entrante.',
    });
  } else {
    pasos.push({
      titulo: 'Respuesta automática',
      estado: ultimoEntrante ? 'no-aplica' : 'pendiente',
      detalle: ultimoEntrante
        ? 'La conversación ya estaba abierta y era horario de atención: no corresponde.'
        : 'Sale sola cuando el WhatsApp abre una conversación (acuse) o llega fuera de horario.',
    });
  }

  // 5) La respuesta de Recepción, por WhatsApp, con sus ✓✓.
  const deRecepcion = hilo.filter((m) => !delPaciente(m) && tipoAutomatica(m) === undefined);
  const ultimaRespuesta = deRecepcion[deRecepcion.length - 1];
  if (!ultimaRespuesta) {
    pasos.push({
      titulo: 'Respuesta de Recepción por WhatsApp (✓ → ✓✓ → leído)',
      estado: 'pendiente',
      detalle: 'Respondé desde la tarjeta de la pestaña WhatsApp o desde Mensajes.',
    });
  } else if (!esWhatsApp(ultimaRespuesta)) {
    pasos.push({
      titulo: 'Respuesta de Recepción por WhatsApp (✓ → ✓✓ → leído)',
      estado: 'falla',
      detalle:
        `La última respuesta (${cuando(ultimaRespuesta.sent, d.ahora)}) quedó solo en el portal` +
        `${ultimaRespuesta.statusReason?.text ? `: ${ultimaRespuesta.statusReason.text}` : ' (el paciente escribió por el portal o la ventana de 24 h estaba cerrada).'}`,
    });
  } else {
    const s = estadoSaliente(ultimaRespuesta);
    pasos.push({
      titulo: 'Respuesta de Recepción por WhatsApp (✓ → ✓✓ → leído)',
      estado: s.estado,
      detalle: `${cuando(ultimaRespuesta.sent, d.ahora)} «${corto(vistaPrevia(ultimaRespuesta))}» · ${s.texto}`,
    });
  }

  // 6) La ficha completada (resuelve el aviso solo).
  if (!d.paciente || !esNuevo) {
    pasos.push({
      titulo: 'Completar la ficha (resuelve el aviso)',
      estado: d.paciente ? 'no-aplica' : 'pendiente',
      detalle: d.paciente ? 'El paciente ya tenía ficha.' : 'Después de responder: «Completar ficha» en la tarjeta.',
    });
  } else if (esSinFicha(d.paciente)) {
    pasos.push({
      titulo: 'Completar la ficha (resuelve el aviso)',
      estado: 'pendiente',
      detalle: 'Solo tiene el nombre del perfil de WhatsApp: «Completar ficha» en la tarjeta (alta con el teléfono precargado).',
    });
  } else if (d.aviso && d.aviso.status !== 'completed') {
    pasos.push({
      titulo: 'Completar la ficha (resuelve el aviso)',
      estado: 'falla',
      detalle: 'La ficha está completa pero el aviso sigue pendiente: som-alta-paciente no lo resolvió.',
    });
  } else {
    pasos.push({
      titulo: 'Completar la ficha (resuelve el aviso)',
      estado: 'ok',
      detalle: `Ficha completa: «${nombreDePaciente(d.paciente)}»${d.aviso ? ` · aviso ${d.aviso.businessStatus?.text ?? 'resuelto'}` : ''}.`,
    });
  }

  return pasos;
}

/** La ventana de 24 h del celular, en palabras. */
export function textoVentana(mensajes: Communication[], ahora: Date): string {
  const entrantes = cronologico(mensajes).filter((m) => delPaciente(m) && esWhatsApp(m));
  const ultimo = entrantes[entrantes.length - 1];
  if (!ultimo) {
    return 'cerrada: el celular no escribió. Sin plantilla aprobada, lo que mande SOM primero no llega (63016).';
  }
  const v = ventana24h(ultimo.sent, ahora);
  return v.abierta
    ? `abierta: quedan ${textoRestante(v.restanteMin)}${v.porCerrar ? ' (¡por cerrar!)' : ''}. Recepción puede responder texto libre.`
    : 'cerrada (pasaron más de 24 h): para seguir probando, escribí de nuevo desde el celular.';
}

// ───────────────────────────── cruce con Twilio ─────────────────────────────

/** Lo que devuelve la API de Twilio de un mensaje (Messages.json). */
export interface MensajeTwilio {
  sid: string;
  /** `inbound`, `outbound-api`, `outbound-reply`… */
  direction?: string;
  status?: string;
  error_code?: number | string | null;
  date_created?: string;
}

/** Una alerta del Debugger de Twilio (Monitor → Alerts). */
export interface AlertaTwilio {
  sid: string;
  error_code?: string | number | null;
  log_level?: string;
  date_created?: string;
  request_url?: string | null;
  resource_sid?: string | null;
}

/** Los MessageSid que SOM registró en esos mensajes (entrantes y salientes). */
export function sidsRegistrados(mensajes: Communication[]): Set<string> {
  return new Set(
    mensajes.flatMap((m) =>
      (m.identifier ?? []).filter((i) => i.system === SYSTEM.twilioMessageSid && i.value).map((i) => i.value!),
    ),
  );
}

function esEntranteTwilio(m: MensajeTwilio): boolean {
  return m.direction === 'inbound';
}

/** Una línea por mensaje de Twilio: dirección, estado (con el error explicado) y si SOM lo tiene. */
export function lineaMensajeTwilio(m: MensajeTwilio, registrados: Set<string>, ahora: Date): string {
  const entrante = esEntranteTwilio(m);
  const error = m.error_code ? explicarErrorTwilio(m.error_code) : undefined;
  const enSom = registrados.has(m.sid)
    ? 'en SOM ✓'
    : entrante
      ? 'NO llegó a SOM ✗'
      : 'fuera de la conversación (aviso o prueba)';
  // Twilio manda las fechas en RFC 2822 ("Mon, 28 Sep 2026 13:00:00 +0000").
  const creado = m.date_created ? Date.parse(m.date_created) : Number.NaN;
  return (
    `${m.sid} · ${cuando(Number.isNaN(creado) ? undefined : new Date(creado).toISOString(), ahora)} · ` +
    `${entrante ? 'entrante' : 'saliente'} · ${m.status ?? '?'}${error ? ` — ${error}` : ''} · ${enSom}`
  );
}

/** Los entrantes que Twilio recibió y SOM no registró: el webhook no llegó o el bot los rechazó. */
export function entrantesSinRegistrar(twilio: MensajeTwilio[], registrados: Set<string>): MensajeTwilio[] {
  return twilio.filter((m) => esEntranteTwilio(m) && !registrados.has(m.sid));
}

/** Qué significan las alertas de Twilio que tocan al webhook de SOM. */
const ALERTAS_TWILIO: Readonly<Record<string, string>> = {
  '11200':
    'Twilio llamó al webhook y no recibió un 200 (401: nginx sin la autenticación; 5xx/timeout: el bot falló). ' +
    'Probá con npm run webhooks',
  '11205': 'Twilio no pudo conectarse con el webhook (DNS, TLS o puerto): revisá la URL del sender y nginx',
  '11210': 'la URL del webhook tiene un host inválido: revisá la URL del sender en Twilio',
  '12300': 'el webhook responde JSON, no TwiML: inofensiva',
};

export function explicarAlertaTwilio(codigo: string | number | null | undefined): string {
  const c = codigo === undefined || codigo === null ? '' : String(codigo).trim();
  return ALERTAS_TWILIO[c] ?? explicarErrorTwilio(c) ?? 'alerta sin código';
}

/**
 * Las alertas que tocan a esta prueba: las del webhook de SOM (por su ruta) y las de los
 * mensajes de este celular. Las demás de la cuenta de Twilio no se muestran.
 */
export function alertasRelevantes(alertas: AlertaTwilio[], sidsMensajes: Set<string>, rutaWebhook: string): AlertaTwilio[] {
  return alertas.filter(
    (a) => (a.request_url ?? '').includes(rutaWebhook) || (a.resource_sid ? sidsMensajes.has(a.resource_sid) : false),
  );
}

/** Solo la ruta de una URL (nunca usuario ni clave, si la URL las tuviera). */
export function rutaDeUrl(url: string | null | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

// ───────────────────────────── paso 1: a dónde manda Twilio los entrantes ─────────────────────────────

/** El webhook de un sender de WhatsApp (Senders API v2 de Twilio). */
export interface WebhookSenderTwilio {
  callback_url?: string | null;
  callback_method?: string | null;
  fallback_url?: string | null;
  status_callback_url?: string | null;
}

/** Un sender de WhatsApp de la cuenta (`messaging.twilio.com/v2/Channels/Senders`). */
export interface SenderTwilio {
  sid?: string;
  /** `whatsapp:+54…` */
  sender_id?: string;
  /** `ONLINE`, `OFFLINE`, `CREATING`… */
  status?: string;
  webhook?: WebhookSenderTwilio | null;
}

/** Un Messaging Service con los remitentes que tiene (números y senders de WhatsApp). */
export interface ServicioTwilio {
  sid: string;
  friendly_name?: string;
  /** Integration → "Send a webhook". */
  inbound_request_url?: string | null;
  inbound_method?: string | null;
  /** Integration → "Defer to sender's webhook". */
  use_inbound_webhook_on_number?: boolean | null;
  remitentes: string[];
}

export interface Hallazgo {
  estado: EstadoPaso;
  texto: string;
}

/** Número del sandbox de WhatsApp de Twilio. */
const SANDBOX_TWILIO = '14155238886';

function digitos(remitente: string | undefined): string {
  return (remitente ?? '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
}

/** El mismo remitente, esté escrito `whatsapp:+54…`, `+54…` o con espacios. */
export function mismoRemitente(a: string | undefined, b: string | undefined): boolean {
  const da = digitos(a);
  return da.length > 0 && da === digitos(b);
}

/** La URL comparable: host en minúsculas y sin barra final (para explicar un "casi igual"). */
function comparable(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim();
  }
}

/**
 * Paso 1 de la prueba: ¿Twilio manda los mensajes que llegan al WhatsApp de SOM a la URL
 * pública de SOM? La que manda es la del Messaging Service si el número está en uno con
 * "Send a webhook"; si no, la del número (sender). Tiene que ser **exactamente**
 * `TWILIO_WEBHOOK_URL`: Twilio firma sobre la URL que llama y el bot valida contra esa.
 */
export function revisarRuteoEntrante(p: {
  from: string | undefined;
  /** TWILIO_WEBHOOK_URL (la URL pública de nginx). */
  urlEsperada: string;
  senders: SenderTwilio[];
  servicios: ServicioTwilio[];
}): Hallazgo[] {
  if (!p.from) {
    return [{ estado: 'falla', texto: 'Falta el Project Secret TWILIO_WHATSAPP_FROM (el número de WhatsApp de SOM).' }];
  }
  if (digitos(p.from) === SANDBOX_TWILIO) {
    return [
      {
        estado: 'pendiente',
        texto:
          `Es el sandbox de Twilio: la URL va en Messaging → Try it out → Sandbox settings → "When a message comes in" ` +
          `(${p.urlEsperada}, POST); la API no la muestra.`,
      },
    ];
  }

  const hallazgos: Hallazgo[] = [];
  const sender = p.senders.find((s) => mismoRemitente(s.sender_id, p.from));
  if (!sender) {
    const otros = p.senders.map((s) => s.sender_id).filter(Boolean);
    return [
      {
        estado: 'falla',
        texto:
          `No encontré el sender de WhatsApp ${p.from} en la cuenta de Twilio` +
          `${otros.length ? ` (hay: ${otros.join(', ')})` : ''}: revisá TWILIO_WHATSAPP_FROM.`,
      },
    ];
  }
  const estado = (sender.status ?? '').toUpperCase();
  hallazgos.push(
    estado.startsWith('ONLINE')
      ? { estado: 'ok', texto: `Sender ${sender.sender_id} ${estado}.` }
      : {
          estado: 'falla',
          texto: `El sender ${sender.sender_id} está ${estado || 'sin estado'}: mientras no esté ONLINE no recibe ni manda mensajes.`,
        },
  );

  const servicio = p.servicios.find((s) => s.remitentes.some((r) => mismoRemitente(r, p.from)));
  let url: string | null | undefined;
  let metodo: string | null | undefined;
  let donde: string;
  if (servicio && !servicio.use_inbound_webhook_on_number) {
    const nombre = `el Messaging Service «${servicio.friendly_name ?? servicio.sid}»`;
    if (!servicio.inbound_request_url) {
      hallazgos.push({
        estado: 'falla',
        texto:
          `El número está en ${nombre} y el servicio no reenvía los mensajes (manda sobre el número). En Twilio → ` +
          `Messaging → Services → ${servicio.friendly_name ?? servicio.sid} → Integration: "Send a webhook" con ` +
          `${p.urlEsperada} (POST), o "Defer to sender's webhook".`,
      });
      return hallazgos;
    }
    url = servicio.inbound_request_url;
    metodo = servicio.inbound_method;
    donde = `${nombre} (Integration → Send a webhook; manda sobre la del número)`;
  } else {
    url = sender.webhook?.callback_url;
    metodo = sender.webhook?.callback_method;
    donde = `el número (Webhook URL for incoming messages)${servicio ? `, porque «${servicio.friendly_name ?? servicio.sid}» le cede el webhook` : ''}`;
  }

  if (!url?.trim()) {
    hallazgos.push({
      estado: 'falla',
      texto: `No hay URL para los mensajes entrantes en ${donde}: poné ${p.urlEsperada} (POST).`,
    });
  } else if (url.trim() !== p.urlEsperada.trim()) {
    const casi = comparable(url) === comparable(p.urlEsperada);
    hallazgos.push({
      estado: 'falla',
      texto:
        `${donde} manda a ${ocultarClaveUrl(url)} y tiene que ser ${p.urlEsperada}` +
        `${casi ? ' EXACTAMENTE (difiere en la barra final o en mayúsculas): Twilio firma sobre la URL que llama y la firma no validaría' : ''}.`,
    });
  } else if (metodo && metodo.toUpperCase() !== 'POST') {
    hallazgos.push({ estado: 'falla', texto: `${donde} usa ${metodo.toUpperCase()}: tiene que ser POST.` });
  } else {
    hallazgos.push({ estado: 'ok', texto: `Twilio manda los mensajes entrantes a ${p.urlEsperada} (POST), desde ${donde}.` });
  }

  const estados = sender.webhook?.status_callback_url?.trim();
  if (estados && estados !== p.urlEsperada.trim()) {
    hallazgos.push({
      estado: 'ok',
      texto: `El Status callback del número apunta a ${ocultarClaveUrl(estados)}: no molesta, cada envío de SOM pide sus ✓✓ a ${p.urlEsperada}.`,
    });
  }
  return hallazgos;
}
