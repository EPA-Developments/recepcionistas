/**
 * Seguimiento de la prueba de WhatsApp de punta a punta, para un celular.
 *
 *   npm run whatsapp:seguimiento -- +5491122334455
 *
 * Lee de Medplum lo que dejó ese número (paciente o lead, aviso a Recepción, su conversación
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
import { busquedaAvisoContacto } from '../lib/contactos-whatsapp.js';
import {
  alertasRelevantes,
  entrantesSinRegistrar,
  explicarAlertaTwilio,
  lineaMensajeTwilio,
  marcaPaso,
  pasosSeguimiento,
  rutaDeUrl,
  sidsRegistrados,
  textoEntrega,
  textoVentana,
  type AlertaTwilio,
  type MensajeTwilio,
} from '../lib/seguimiento-whatsapp.js';
import {
  aE164AR,
  elegirPacientePorTelefono,
  estadoEntregaDe,
  esWhatsApp,
  formatoTelefono,
  horaMensaje,
  tipoAutomatica,
  variantesTelefonoAR,
  vistaPrevia,
} from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';
import { leerSecretos, valorSecreto } from './secretos.js';

const API_TWILIO = 'https://api.twilio.com/2010-04-01';
const MONITOR_TWILIO = 'https://monitor.twilio.com/v1';

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
  if (!e164) {
    console.error(`Uso: npm run whatsapp:seguimiento -- +5491122334455${crudo ? ` ("${crudo}" no es un celular válido)` : ''}`);
    process.exitCode = 1;
    return;
  }
  const ahora = new Date();
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl} (project ${projectId}). Celular: ${formatoTelefono(e164)}`);

  // ── Medplum ──
  const candidatos = await medplum.searchResources('Patient', { phone: variantesTelefonoAR(e164).join(','), _count: '20' });
  const paciente: Patient | undefined = elegirPacientePorTelefono(candidatos);
  const pacienteRef = paciente?.id ? `Patient/${paciente.id}` : undefined;
  const aviso: Task | undefined = pacienteRef
    ? await medplum.searchOne('Task', busquedaAvisoContacto(pacienteRef))
    : undefined;
  const mensajes = pacienteRef ? await conversacionReciente(medplum, pacienteRef) : [];
  if (candidatos.length > 1) {
    console.log(`  (hay ${candidatos.length} pacientes con ese número; se usa Patient/${paciente?.id ?? '?'})`);
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

  // ── Twilio ──
  const secretos = await leerSecretos(medplum, projectId);
  const cuenta = valorSecreto(secretos, 'TWILIO_ACCOUNT_SID');
  const token = valorSecreto(secretos, 'TWILIO_AUTH_TOKEN');
  if (!cuenta || !token) {
    console.error('\n✗ Faltan los Project Secrets TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN: no puedo mirar Twilio.');
    process.exitCode = 1;
    return;
  }
  const auth = Buffer.from(`${cuenta}:${token}`).toString('base64');
  const registrados = sidsRegistrados(mensajes);

  const enTwilio = await mensajesTwilio(auth, cuenta, e164);
  console.log(`\nTwilio (${enTwilio.length} mensaje(s) con este número, los más nuevos primero):`);
  for (const m of enTwilio) {
    console.log(`  ${lineaMensajeTwilio(m, registrados, ahora)}`);
  }
  const perdidos = entrantesSinRegistrar(enTwilio, registrados);
  if (perdidos.length > 0) {
    console.error(
      `\n  ✗ Twilio recibió ${perdidos.length} mensaje(s) de este celular que no están en SOM: el webhook no llegó o el\n` +
        `    bot lo rechazó. Revisá en Twilio el "Webhook URL for incoming messages" del número de SOM\n` +
        `    (https://api.medplum.com.ar${RUTA_WEBHOOK_TWILIO}, POST), las alertas de abajo y npm run webhooks.`,
    );
    process.exitCode = 1;
  } else if (enTwilio.some((m) => m.direction === 'inbound')) {
    console.log('\n  ✓ Todo lo que el celular mandó a Twilio llegó a SOM.');
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
