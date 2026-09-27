/**
 * Diagnóstico de envío de WhatsApp (Medplum Bot → Twilio).
 *
 *   npm run whatsapp:test -- +5491122334455
 *
 * Los secretos de Twilio NO viven en el .env: son **Project Secrets de Medplum** y
 * solo los ve el bot al ejecutarse (event.secrets). Por eso este diagnóstico se
 * conecta con las credenciales del .env y **ejecuta el bot `som-enviar-whatsapp`**
 * en el servidor (que sí lee los secrets reales), y reporta el `status` de la
 * Communication que devuelve:
 *   - "completed"          → Twilio aceptó el mensaje (secrets OK). Revisá tu WhatsApp.
 *   - "preparation"        → falta algún secret de Twilio (o el destinatario).
 *   - "entered-in-error"   → secrets presentes, pero Twilio rechazó (número/sandbox/FROM).
 *
 * Para Twilio Sandbox: el número destino debe haber enviado el "join <code>" al
 * número del sandbox, y TWILIO_WHATSAPP_FROM debe ser el del sandbox.
 *
 * Al final revisa el webhook de entrada (WhatsApp en Mensajes): los Project Secrets de
 * Twilio (solo si están, nunca sus valores) y que `TWILIO_WEBHOOK_URL` llame al bot con
 * las credenciales de "Webhook Twilio" (`npm run whatsapp:webhook` lo deja listo). Ver
 * docs/whatsapp.md.
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import type { Communication, ProjectSetting } from '@medplum/fhirtypes';
import { BOT_WHATSAPP_ENTRANTE } from '../fhir/identifiers.js';
import { NOMBRE_CLIENTE_WEBHOOK_TWILIO, problemasUrlWebhookTwilio, SECRETS_TWILIO } from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';
import { leerSecretos, valorSecreto } from './secretos.js';

async function main(): Promise<void> {
  const to = process.argv[2] ?? process.env.DIAG_WHATSAPP_TO;
  if (!to) {
    console.error('Uso: npm run whatsapp:test -- +5491122334455');
    process.exitCode = 1;
    return;
  }

  const { medplum, baseUrl, projectId } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl}. Probando WhatsApp a: ${to}`);

  const bot = await medplum.searchOne('Bot', 'name=som-enviar-whatsapp');
  if (!bot?.id) {
    console.error('\n✗ No encontré el bot "som-enviar-whatsapp". Deployalo: npm run deploy:bots');
    process.exitCode = 1;
    return;
  }

  const body = `Segunda Opinión Médica · prueba de WhatsApp (${new Date().toLocaleString('es-AR')}). Si lo recibiste, Twilio funciona. 💙`;
  const comm = (await medplum.executeBot(bot.id, { to, template: 'diagnostico', body })) as Communication;
  const status = comm?.status;
  console.log(`\nCommunication creada: ${comm?.id ?? '(sin id)'} · status = ${status ?? '(desconocido)'}`);
  if (comm?.statusReason?.text) {
    console.log(`Motivo: ${comm.statusReason.text}`);
  }

  if (status === 'completed') {
    console.log('\n✓ Twilio ACEPTÓ el mensaje (los Project Secrets de Twilio están cargados y son válidos).');
    console.log('  Revisá tu WhatsApp y, si no llega, el Twilio Console → Messaging logs (entrega/sandbox).');
  } else if (status === 'preparation') {
    console.error('\n✗ NO se envió: falta algún Project Secret de Twilio (o el destinatario).');
    console.error(
      '  Cargá en Medplum (Project → Secrets) estos tres y volvé a probar:\n' +
        '    • TWILIO_ACCOUNT_SID\n' +
        '    • TWILIO_AUTH_TOKEN\n' +
        '    • TWILIO_WHATSAPP_FROM  (ej. "whatsapp:+14155238886" del sandbox, o tu número WhatsApp Business)\n' +
        '  (para el aviso de solicitudes a Recepción, además: RECEPCION_WHATSAPP_TO).',
    );
    process.exitCode = 1;
  } else if (status === 'entered-in-error') {
    console.error('\n✗ Twilio RECHAZÓ el mensaje (los secrets están, pero algo no cierra).');
    console.error(
      '  Causas típicas:\n' +
        '    • Sandbox: el número destino no envió el "join <code>" al número del sandbox.\n' +
        '    • TWILIO_WHATSAPP_FROM mal (no es un sender de WhatsApp válido).\n' +
        '    • Número destino mal formado (usá E.164: +549...).\n' +
        '  Revisá el detalle en Twilio Console → Monitor → Logs → Messaging.',
    );
    process.exitCode = 1;
  } else {
    console.error('\n? Estado inesperado. Revisá el recurso Communication y los logs del bot (CloudWatch).');
    process.exitCode = 1;
  }

  // Webhook de entrada (mensajes que llegan + ✓✓): Project Secrets y TWILIO_WEBHOOK_URL.
  await revisarWebhook(medplum, projectId, baseUrl);
}

/** Revisa la configuración del webhook de Twilio sin mostrar ningún valor. */
async function revisarWebhook(medplum: MedplumClient, projectId: string, baseUrl: string): Promise<void> {
  console.log('\nWhatsApp en Mensajes (mensajes que llegan y ✓✓):');
  const entrante = await medplum.searchOne('Bot', { 'name:exact': BOT_WHATSAPP_ENTRANTE });
  if (!entrante?.id) {
    console.error(`  ✗ Falta el bot "${BOT_WHATSAPP_ENTRANTE}": npm run deploy:bots`);
    process.exitCode = 1;
    return;
  }
  let secretos: ProjectSetting[];
  try {
    secretos = await leerSecretos(medplum, projectId);
  } catch {
    console.log('  ? No pude leer los Project Secrets (hace falta una ClientApplication admin del proyecto).');
    return;
  }
  for (const nombre of SECRETS_TWILIO) {
    console.log(`  ${valorSecreto(secretos, nombre) ? '✓' : '✗'} ${nombre}`);
  }
  console.log(`  ${valorSecreto(secretos, 'RECEPCION_WHATSAPP_TO') ? '✓' : '·'} RECEPCION_WHATSAPP_TO (opcional)`);

  const cliente = await medplum.searchOne('ClientApplication', { 'name:exact': NOMBRE_CLIENTE_WEBHOOK_TWILIO });
  const problemas = [
    ...(cliente?.id ? [] : [`falta la ClientApplication "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}"`]),
    ...problemasUrlWebhookTwilio(valorSecreto(secretos, 'TWILIO_WEBHOOK_URL'), {
      baseUrl,
      botId: entrante.id,
      clientId: cliente?.id,
    }),
  ];
  if (problemas.length === 0) {
    console.log(`  ✓ TWILIO_WEBHOOK_URL llama a ${BOT_WHATSAPP_ENTRANTE} con las credenciales de "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}".`);
    console.log('    En Twilio va esa misma URL: webhook de mensajes entrantes del número de SOM (POST).');
  } else {
    for (const p of problemas) {
      console.error(`  ✗ TWILIO_WEBHOOK_URL: ${p}`);
    }
    console.error('  → npm run whatsapp:webhook lo deja listo.');
    process.exitCode = 1;
  }
  console.log('  Pasos completos: docs/whatsapp.md');
}

main().catch((err) => {
  console.error('Diagnóstico de WhatsApp falló:', err);
  process.exitCode = 1;
});
