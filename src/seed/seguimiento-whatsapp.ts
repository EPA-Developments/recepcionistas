/**
 * Seguimiento de la prueba de WhatsApp de punta a punta.
 *
 *   npm run whatsapp:seguimiento                    → Twilio → SOM: a dónde manda Twilio los
 *                                                     mensajes que llegan (paso 1 de la prueba)
 *   npm run whatsapp:seguimiento -- +5491122334455  → ídem y el paso a paso de ese celular
 *
 * Twilio → SOM: lee el sender de WhatsApp de SOM (y el Messaging Service, si está en uno: su
 * webhook manda sobre el del número) y controla que la URL de los mensajes entrantes sea
 * EXACTAMENTE `TWILIO_WEBHOOK_URL` (POST): Twilio firma sobre la URL que llama.
 *
 * Con un celular, lee de Medplum lo que dejó ese número (paciente o lead, aviso a Recepción, su conversación
 * de Mensajes con las respuestas automáticas, las de Recepción y sus ✓✓) y de Twilio lo que
 * pasó con sus mensajes y las alertas del webhook; muestra el **paso a paso** (qué ya pasó,
 * qué falta y qué falló) y cruza los dos lados: un mensaje que Twilio recibió y SOM no
 * registró es un webhook que no llegó. Se corre después de cada paso de la prueba
 * (docs/whatsapp.md → Probar).
 *
 * Solo lee: no manda, no crea ni cambia nada. Las credenciales de Twilio salen de los
 * Project Secrets (lectura de admin), se usan en memoria y nunca se imprimen.
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import type { Communication, Patient, Task } from '@medplum/fhirtypes';
import { RUTA_WEBHOOK_TWILIO } from '../config/urls.js';
import { BOT_WHATSAPP_ENTRANTE, SYSTEM } from '../fhir/identifiers.js';
import { busquedaAvisoContacto, esDemo } from '../lib/contactos-whatsapp.js';
import {
  alertasRelevantes,
  autocreacionDe,
  conversacionesQueCapturan,
  entrantesEnOtroPaciente,
  entrantesSinEjecucion,
  entrantesSinRegistrar,
  explicarAlertaTwilio,
  lineaMensajeTwilio,
  marcaPaso,
  pasosSeguimiento,
  revisarRuteoEntrante,
  rutaDeUrl,
  textoEntrega,
  textoVentana,
  ubicacionesPorSid,
  type AlertaTwilio,
  type ConversacionTwilio,
  type DireccionConversations,
  type MensajeTwilio,
  type SenderTwilio,
  type ServicioTwilio,
} from '../lib/seguimiento-whatsapp.js';
import { modoUrlWebhook } from '../lib/webhooks.js';
import {
  aE164AR,
  elegirPacientePorTelefono,
  estadoEntregaDe,
  esWhatsApp,
  formatoTelefono,
  horaMensaje,
  nombreDePaciente,
  tipoAutomatica,
  variantesTelefonoAR,
  vistaPrevia,
} from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';
import { leerSecretos, valorSecreto } from './secretos.js';

const API_TWILIO = 'https://api.twilio.com/2010-04-01';
const MONITOR_TWILIO = 'https://monitor.twilio.com/v1';
const MESSAGING_TWILIO = 'https://messaging.twilio.com';
const CONVERSATIONS_TWILIO = 'https://conversations.twilio.com/v1';

async function twilio<T>(auth: string, url: string): Promise<T> {
  const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  const cuerpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(`Twilio respondió ${resp.status}${cuerpo.message ? `: ${String(cuerpo.message)}` : ''}`);
  }
  return cuerpo as T;
}

/** Las formas en que Twilio puede tener un celular argentino (con y sin el 9). */
function formasTwilio(e164: string): string[] {
  return e164.startsWith('+549') ? [e164, `+54${e164.slice(4)}`] : [e164];
}

/** Los últimos mensajes de Twilio con ese número (entrantes y salientes), del más nuevo al más viejo. */
async function mensajesTwilio(auth: string, cuenta: string, e164: string): Promise<MensajeTwilio[]> {
  const porSid = new Map<string, MensajeTwilio>();
  for (const forma of formasTwilio(e164)) {
    for (const campo of ['From', 'To']) {
      const params = new URLSearchParams({ [campo]: `whatsapp:${forma}`, PageSize: '20' });
      const r = await twilio<{ messages?: MensajeTwilio[] }>(auth, `${API_TWILIO}/Accounts/${cuenta}/Messages.json?${params}`);
      for (const m of r.messages ?? []) {
        porSid.set(m.sid, m);
      }
    }
  }
  return [...porSid.values()].sort((a, b) => Date.parse(b.date_created ?? '') - Date.parse(a.date_created ?? '')).slice(0, 20);
}

/** Las alertas de Twilio de las últimas 24 h (Monitor → Alerts). */
async function alertasTwilio(auth: string, ahora: Date): Promise<AlertaTwilio[]> {
  const desde = new Date(ahora.getTime() - 24 * 3600_000).toISOString();
  const params = new URLSearchParams({ StartDate: desde, PageSize: '100' });
  const r = await twilio<{ alerts?: AlertaTwilio[] }>(auth, `${MONITOR_TWILIO}/Alerts?${params}`);
  return r.alerts ?? [];
}

/** Los senders de WhatsApp de la cuenta, con su webhook (Senders API v2). */
async function sendersTwilio(auth: string): Promise<SenderTwilio[]> {
  const r = await twilio<{ senders?: SenderTwilio[] }>(auth, `${MESSAGING_TWILIO}/v2/Channels/Senders?Channel=whatsapp&PageSize=100`);
  return r.senders ?? [];
}

/** Los Messaging Services de la cuenta, cada uno con sus remitentes (números y senders de WhatsApp). */
async function serviciosTwilio(auth: string): Promise<ServicioTwilio[]> {
  const r = await twilio<{ services?: Array<Omit<ServicioTwilio, 'remitentes'>> }>(auth, `${MESSAGING_TWILIO}/v1/Services?PageSize=100`);
  const servicios: ServicioTwilio[] = [];
  for (const s of r.services ?? []) {
    const numeros = await twilio<{ phone_numbers?: Array<{ phone_number?: string }> }>(
      auth,
      `${MESSAGING_TWILIO}/v1/Services/${s.sid}/PhoneNumbers?PageSize=100`,
    ).catch(() => ({ phone_numbers: [] }));
    const canales = await twilio<{ senders?: Array<{ sender?: string }> }>(
      auth,
      `${MESSAGING_TWILIO}/v1/Services/${s.sid}/ChannelSenders?PageSize=100`,
    ).catch(() => ({ senders: [] }));
    servicios.push({
      ...s,
      remitentes: [
        ...(numeros.phone_numbers ?? []).map((n) => n.phone_number),
        ...(canales.senders ?? []).map((c) => c.sender),
      ].filter((x): x is string => Boolean(x)),
    });
  }
  return servicios;
}

/** Twilio → SOM: a dónde manda Twilio los mensajes que llegan al WhatsApp de SOM. */
async function revisarTwilioASom(auth: string, from: string | undefined, url: string | undefined): Promise<boolean> {
  console.log('\nTwilio → SOM: ¿a dónde manda Twilio los mensajes que llegan al WhatsApp de SOM?');
  if (!url || modoUrlWebhook(url) !== 'publica') {
    console.error('  ✗ TWILIO_WEBHOOK_URL no es la URL pública de nginx: npm run webhooks la deja lista.');
    return false;
  }
  let senders: SenderTwilio[];
  let servicios: ServicioTwilio[];
  try {
    [senders, servicios] = await Promise.all([sendersTwilio(auth), serviciosTwilio(auth)]);
  } catch (err) {
    console.error(
      `  ? No pude leer la configuración de Twilio (${err instanceof Error ? err.message : String(err)}). Revisalo a mano:\n` +
        `    Messaging → Senders → WhatsApp senders → ${from ?? 'el número de SOM'} → Webhook URL for incoming messages = ${url} (POST).`,
    );
    return false;
  }
  const hallazgos = revisarRuteoEntrante({ from, urlEsperada: url, senders, servicios });
  for (const h of hallazgos) {
    console.log(`  ${marcaPaso(h.estado)} ${h.texto}`);
  }
  // Twilio Conversations puede quedarse con los mensajes antes que el webhook.
  let autocreacion: DireccionConversations | undefined;
  try {
    const r = await twilio<{ address_configurations?: DireccionConversations[] }>(
      auth,
      `${CONVERSATIONS_TWILIO}/Configuration/Addresses?PageSize=100`,
    );
    autocreacion = autocreacionDe(r.address_configurations ?? [], from);
  } catch (err) {
    console.log(`  ? No pude leer la configuración de Conversations (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (autocreacion) {
    console.error(
      `  ✗ Twilio Conversations crea una conversación con cada WhatsApp nuevo que llega a ${from} (autocreación` +
        `${autocreacion.auto_creation?.type ? ` "${autocreacion.auto_creation.type}"` : ''}` +
        `${autocreacion.friendly_name ? `, «${autocreacion.friendly_name}»` : ''}): esos mensajes van a Conversations y no al webhook de SOM.\n` +
        '    Se desactiva en Twilio → Conversations → Manage → Address configuration (si otro sistema no la usa).',
    );
  }
  return !hallazgos.some((h) => h.estado === 'falla') && !autocreacion;
}

/** Las conversaciones de Twilio Conversations en las que participa el celular (con y sin el 9). */
async function conversacionesDelCelular(auth: string, e164: string): Promise<ConversacionTwilio[]> {
  const todas = new Map<string, ConversacionTwilio>();
  for (const forma of formasTwilio(e164)) {
    const params = new URLSearchParams({ Address: `whatsapp:${forma}`, PageSize: '50' });
    const r = await twilio<{ conversations?: ConversacionTwilio[] }>(auth, `${CONVERSATIONS_TWILIO}/ParticipantConversations?${params}`);
    for (const c of r.conversations ?? []) {
      todas.set(c.conversation_sid, c);
    }
  }
  return [...todas.values()];
}

/** Los mensajes de SOM con esos MessageSid (en cualquier paciente o conversación). */
async function porMessageSid(medplum: MedplumClient, sids: string[]): Promise<Communication[]> {
  const encontrados: Communication[] = [];
  for (let i = 0; i < sids.length; i += 20) {
    const tanda = sids.slice(i, i + 20).map((sid) => `${SYSTEM.twilioMessageSid}|${sid}`);
    encontrados.push(...(await medplum.searchResources('Communication', { identifier: tanda.join(','), _count: '100' })));
  }
  return encontrados;
}

/**
 * ¿Twilio llamó al bot cuando llegaron los entrantes que no están en SOM? Cruza la hora de
 * cada uno con las ejecuciones de som-whatsapp-entrante (AuditEvent de Medplum).
 */
async function ejecucionesDelBot(medplum: MedplumClient, perdidos: MensajeTwilio[]): Promise<void> {
  try {
    const bot = await medplum.searchOne('Bot', { 'name:exact': BOT_WHATSAPP_ENTRANTE });
    if (!bot?.id) {
      console.error(`    ✗ No existe el bot ${BOT_WHATSAPP_ENTRANTE}: npm run deploy:bots`);
      return;
    }
    const horas = perdidos.map((m) => Date.parse(m.date_created ?? '')).filter((t) => !Number.isNaN(t));
    const desde = new Date(Math.min(...horas, Date.now()) - 60_000).toISOString();
    const eventos = await medplum.searchResources('AuditEvent', {
      entity: `Bot/${bot.id}`,
      _lastUpdated: `ge${desde}`,
      _sort: '-_lastUpdated',
      _count: '500',
    });
    const ejecuciones = eventos.map((e) => e.recorded ?? e.meta?.lastUpdated ?? '');
    const sinEjecucion = entrantesSinEjecucion(perdidos, ejecuciones);
    const conEjecucion = perdidos.length - sinEjecucion.length;
    console.error(`    Ejecuciones de ${BOT_WHATSAPP_ENTRANTE} desde el primero de esos mensajes: ${eventos.length}.`);
    if (sinEjecucion.length > 0) {
      console.error(
        `    ✗ ${sinEjecucion.length} de ${perdidos.length} no tienen ninguna ejecución del bot a esa hora: Twilio NO llamó al webhook ` +
          'para esos mensajes (ver "Twilio Conversations" abajo).',
      );
    }
    if (conEjecucion > 0) {
      console.error(
        `    · ${conEjecucion} tienen una ejecución del bot a esa hora: el bot los recibió y no los guardó (logs del bot en Medplum).`,
      );
    }
  } catch (err) {
    console.error(`    ? No pude leer las ejecuciones del bot (${err instanceof Error ? err.message : String(err)}).`);
  }
}

/** Los mensajes de la conversación más reciente del paciente (la del último mensaje). */
async function conversacionReciente(medplum: MedplumClient, pacienteRef: string): Promise<Communication[]> {
  const recientes = await medplum.searchResources('Communication', { subject: pacienteRef, _sort: '-sent', _count: '50' });
  const conversacionRef = recientes.find((m) => m.partOf?.[0]?.reference)?.partOf?.[0]?.reference;
  if (!conversacionRef) {
    return [];
  }
  return medplum.searchResources('Communication', { 'part-of': conversacionRef, _sort: 'sent', _count: '200' });
}

function quien(m: Communication): string {
  if (m.sender?.reference?.startsWith('Patient/')) {
    return `Paciente${esWhatsApp(m) ? ' 📱' : ' (portal)'}`;
  }
  if (tipoAutomatica(m)) {
    return '🤖 Automática';
  }
  return `Recepción${esWhatsApp(m) ? ' 📱' : ' (solo portal)'}`;
}

async function main(): Promise<void> {
  const crudo = process.argv[2] ?? process.env.DIAG_WHATSAPP_TO;
  const e164 = aE164AR(crudo);
  if (crudo && !e164) {
    console.error(`"${crudo}" no es un celular válido. Uso: npm run whatsapp:seguimiento [-- +5491122334455]`);
    process.exitCode = 1;
    return;
  }
  const ahora = new Date();
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl} (project ${projectId}).${e164 ? ` Celular: ${formatoTelefono(e164)}` : ''}`);

  const secretos = await leerSecretos(medplum, projectId);
  const cuenta = valorSecreto(secretos, 'TWILIO_ACCOUNT_SID');
  const token = valorSecreto(secretos, 'TWILIO_AUTH_TOKEN');
  if (!cuenta || !token) {
    console.error('\n✗ Faltan los Project Secrets TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN: no puedo mirar Twilio.');
    process.exitCode = 1;
    return;
  }
  const auth = Buffer.from(`${cuenta}:${token}`).toString('base64');

  // ── Twilio → SOM (paso 1 de la prueba) ──
  const ruteoOk = await revisarTwilioASom(auth, valorSecreto(secretos, 'TWILIO_WHATSAPP_FROM'), valorSecreto(secretos, 'TWILIO_WEBHOOK_URL'));
  if (!ruteoOk) {
    process.exitCode = 1;
  }
  if (!e164) {
    console.log(
      ruteoOk
        ? '\nSiguiente: npm run webhooks (los dos ✓ de WhatsApp) y, con el celular de la prueba,\n  npm run whatsapp:seguimiento -- +549… antes de escribirle al WhatsApp de SOM.'
        : '\nCorregilo en Twilio y volvé a correr npm run whatsapp:seguimiento.',
    );
    return;
  }

  // ── Medplum ──
  const candidatos = await medplum.searchResources('Patient', { phone: variantesTelefonoAR(e164).join(','), _count: '20' });
  const paciente: Patient | undefined = elegirPacientePorTelefono(candidatos);
  const pacienteRef = paciente?.id ? `Patient/${paciente.id}` : undefined;
  const aviso: Task | undefined = pacienteRef
    ? await medplum.searchOne('Task', busquedaAvisoContacto(pacienteRef))
    : undefined;
  const mensajes = pacienteRef ? await conversacionReciente(medplum, pacienteRef) : [];
  if (candidatos.length > 1) {
    console.log(`\nHay ${candidatos.length} pacientes con ese número (el WhatsApp entra en el elegido):`);
    for (const c of candidatos) {
      console.log(
        `  ${c.id === paciente?.id ? '→' : ' '} «${nombreDePaciente(c)}» · Patient/${c.id ?? '?'}` +
          `${esDemo(c) ? ' · PRUEBA (demo: se borra solo a las 48 h)' : ''}${c.id === paciente?.id ? ' · elegido' : ''}`,
      );
    }
  }

  console.log('\nPaso a paso:');
  const pasos = pasosSeguimiento({ paciente, aviso, mensajes, ahora });
  pasos.forEach((p, i) => {
    console.log(`  ${i + 1}. ${marcaPaso(p.estado)} ${p.titulo}\n       ${p.detalle}`);
  });
  console.log(`\nVentana de 24 h: ${textoVentana(mensajes, ahora)}`);

  if (mensajes.length > 0) {
    console.log(`\nConversación (${mensajes.length} mensaje(s), los últimos 10):`);
    for (const m of mensajes.slice(-10)) {
      const saliente = !m.sender?.reference?.startsWith('Patient/') && esWhatsApp(m);
      const texto = vistaPrevia(m);
      console.log(
        `  ${horaMensaje(m.sent)} ${quien(m)}: «${texto.length > 50 ? `${texto.slice(0, 49)}…` : texto}»` +
          `${saliente ? ` · ${textoEntrega(estadoEntregaDe(m))}` : ''}`,
      );
    }
  }

  // ── Twilio: los mensajes de este celular, buscados por MessageSid en todo SOM ──
  const enTwilio = await mensajesTwilio(auth, cuenta, e164);
  const ubicaciones = ubicacionesPorSid([...mensajes, ...(await porMessageSid(medplum, enTwilio.map((m) => m.sid)))]);
  console.log(`\nTwilio (${enTwilio.length} mensaje(s) con este número, los más nuevos primero):`);
  for (const m of enTwilio) {
    console.log(`  ${lineaMensajeTwilio(m, ubicaciones, pacienteRef, ahora)}`);
  }
  for (const [otro, cantidad] of entrantesEnOtroPaciente(enTwilio, ubicaciones, pacienteRef)) {
    const quienEs = candidatos.find((c) => `Patient/${c.id}` === otro);
    console.log(
      `\n  ⚠️  ${cantidad} mensaje(s) del celular quedaron en ${quienEs ? `«${nombreDePaciente(quienEs)}» (${otro})` : otro}: ` +
        'otro paciente con el mismo número.',
    );
  }
  const perdidos = entrantesSinRegistrar(enTwilio, ubicaciones);
  if (perdidos.length > 0) {
    console.error(
      `\n  ✗ Twilio recibió ${perdidos.length} mensaje(s) de este celular que no están en SOM: el webhook no llegó o el\n` +
        `    bot lo rechazó. Revisá en Twilio el "Webhook URL for incoming messages" del número de SOM\n` +
        `    (https://api.medplum.com.ar${RUTA_WEBHOOK_TWILIO}, POST), las alertas de abajo y npm run webhooks.`,
    );
    await ejecucionesDelBot(medplum, perdidos);
    process.exitCode = 1;
  } else if (enTwilio.some((m) => m.direction === 'inbound')) {
    console.log('\n  ✓ Todo lo que el celular mandó a Twilio está en SOM.');
  }

  // ── Twilio Conversations: si el celular está en una conversación con el número de SOM,
  //    sus mensajes van ahí y no al webhook ──
  const from = valorSecreto(secretos, 'TWILIO_WHATSAPP_FROM');
  try {
    const capturan = conversacionesQueCapturan(await conversacionesDelCelular(auth, e164), from);
    if (capturan.length === 0) {
      console.log('\nTwilio Conversations: el celular no está en ninguna conversación abierta con el número de SOM ✓');
    } else {
      console.error(
        `\nTwilio Conversations: el celular está en ${capturan.length} conversación(es) abierta(s) con el número de SOM.\n` +
          '  ✗ Mientras exista una, Twilio mete ahí los mensajes de este celular y NO llama al webhook de SOM:',
      );
      for (const c of capturan) {
        const nombre = c.conversation_friendly_name ?? c.conversation_unique_name;
        console.error(
          `    ${c.conversation_sid} · ${c.conversation_state ?? '?'}${nombre ? ` · «${nombre}»` : ''}` +
            `${c.chat_service_sid ? ` · servicio ${c.chat_service_sid}` : ''}` +
            `${c.conversation_date_updated ? ` · última actividad ${new Date(c.conversation_date_updated).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}` : ''}`,
        );
      }
      console.error(
        '  Si ningún otro sistema las usa, cerrarlas (Twilio → Conversations → la conversación → State: closed)\n' +
          '  devuelve los mensajes de este celular a SOM. Si otro sistema (p. ej. otro servicio de EPA en la misma\n' +
          '  WABA) atiende por Conversations, SOM y ese sistema no pueden compartir el número: hay que decidir cuál.',
      );
      process.exitCode = 1;
    }
  } catch (err) {
    console.log(`\nTwilio Conversations: no pude leerlas (${err instanceof Error ? err.message : String(err)}).`);
  }

  const sidsCelular = new Set(enTwilio.map((m) => m.sid));
  let alertas: AlertaTwilio[] = [];
  try {
    alertas = alertasRelevantes(await alertasTwilio(auth, ahora), sidsCelular, RUTA_WEBHOOK_TWILIO);
  } catch (err) {
    console.log(`\nAlertas de Twilio: no pude leerlas (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (alertas.length > 0) {
    console.log(`\nAlertas de Twilio (últimas 24 h, del webhook de SOM o de este celular): ${alertas.length}`);
    for (const a of alertas.slice(0, 15)) {
      const ruta = rutaDeUrl(a.request_url);
      console.log(
        `  ${a.error_code ?? '?'} · ${a.log_level ?? '?'} · ${a.date_created ? new Date(a.date_created).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '?'}` +
          `${ruta ? ` · ${ruta}` : ''}${a.resource_sid ? ` · ${a.resource_sid}` : ''}\n    ${explicarAlertaTwilio(a.error_code)}`,
      );
    }
  } else {
    console.log('\nAlertas de Twilio (últimas 24 h): ninguna del webhook de SOM ni de este celular.');
  }

  if (pasos.some((p) => p.estado === 'falla')) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Seguimiento de WhatsApp: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
