/**
 * Webhook de Twilio (WhatsApp en Mensajes): deja listo el lado de Medplum.
 *
 *   npm run whatsapp:webhook              → crea o corrige, y guarda el secret
 *   npm run whatsapp:webhook -- --dry-run → solo muestra qué haría
 *
 * Idempotente. Antes: `npm run deploy:bots` (bot som-whatsapp-entrante) y `npm run seed`
 * (AccessPolicy "Webhook Twilio — WhatsApp entrante").
 *  1. ClientApplication "Webhook Twilio": si falta la crea con esa AccessPolicy (solo
 *     puede ejecutar el bot: si la URL se filtrara no da acceso a ningún dato); si existe,
 *     verifica su membership (esa policy, sin admin) y la corrige.
 *  2. Arma la URL del webhook y la guarda en el Project Secret `TWILIO_WEBHOOK_URL` (los
 *     ✓✓ de cada envío) sin tocar los demás secrets.
 *  3. Dice dónde pegarla en Twilio. La clave no se imprime: se copia de Medplum
 *     (Project → Secrets → TWILIO_WEBHOOK_URL).
 * Ver docs/whatsapp.md.
 */
import 'dotenv/config';
import { createReference, getReferenceString } from '@medplum/core';
import type { ClientApplication, ProjectMembership } from '@medplum/fhirtypes';
import { NOMBRE_POLICY_WEBHOOK_TWILIO } from '../fhir/access-policies.js';
import { BOT_WHATSAPP_ENTRANTE } from '../fhir/identifiers.js';
import {
  NOMBRE_CLIENTE_WEBHOOK_TWILIO,
  ocultarClaveUrl,
  problemasUrlWebhookTwilio,
  SECRETS_TWILIO,
  urlWebhookTwilio,
} from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';
import { guardarSecretos, leerSecretos, valorSecreto } from './secretos.js';

function fallar(mensaje: string): void {
  console.error(`\n✗ ${mensaje}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl} (project ${projectId})${dryRun ? ' · DRY-RUN: no escribe nada' : ''}.\n`);

  const bot = await medplum.searchOne('Bot', { 'name:exact': BOT_WHATSAPP_ENTRANTE });
  if (!bot?.id) {
    fallar(`No encontré el bot "${BOT_WHATSAPP_ENTRANTE}". Deployalo antes: npm run deploy:bots`);
    return;
  }
  console.log(`✓ Bot ${BOT_WHATSAPP_ENTRANTE}: ${bot.id}`);

  const policy = await medplum.searchOne('AccessPolicy', { 'name:exact': NOMBRE_POLICY_WEBHOOK_TWILIO });
  if (!policy?.id) {
    fallar(`No encontré la AccessPolicy "${NOMBRE_POLICY_WEBHOOK_TWILIO}". Cargala antes: npm run seed`);
    return;
  }
  const refPolicy = getReferenceString(policy);
  console.log(`✓ AccessPolicy "${NOMBRE_POLICY_WEBHOOK_TWILIO}": ${policy.id}`);

  // 1) ClientApplication dedicada.
  const clientes = await medplum.searchResources('ClientApplication', { 'name:exact': NOMBRE_CLIENTE_WEBHOOK_TWILIO });
  if (clientes.length > 1) {
    fallar(
      `Hay ${clientes.length} ClientApplications "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}" (${clientes.map((c) => c.id).join(', ')}). ` +
        'Dejá una sola (Project Admin → Clients) y volvé a correr.',
    );
    return;
  }
  let cliente: ClientApplication | undefined = clientes[0]?.id
    ? await medplum.readResource('ClientApplication', clientes[0].id)
    : undefined;
  if (!cliente) {
    if (dryRun) {
      console.log(`+ Crearía la ClientApplication "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}" con esa AccessPolicy y guardaría TWILIO_WEBHOOK_URL.`);
      return;
    }
    cliente = (await medplum.post(`admin/projects/${projectId}/client`, {
      name: NOMBRE_CLIENTE_WEBHOOK_TWILIO,
      description: `Credenciales de la URL del webhook de Twilio (WhatsApp). Solo ejecuta ${BOT_WHATSAPP_ENTRANTE}.`,
      accessPolicy: createReference(policy),
    })) as ClientApplication;
    console.log(`+ ClientApplication "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}" creada: ${cliente.id}`);
  } else {
    console.log(`= ClientApplication "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}" existente: ${cliente.id}`);
  }
  if (!cliente.id || !cliente.secret) {
    fallar(
      `No pude leer la clave de la ClientApplication "${NOMBRE_CLIENTE_WEBHOOK_TWILIO}". ` +
        'Armá la URL a mano (docs/whatsapp.md, paso 3) y cargala en el secret TWILIO_WEBHOOK_URL.',
    );
    return;
  }

  // Su membership: solo la policy del webhook, nunca admin.
  const membership = await medplum.searchOne('ProjectMembership', { profile: getReferenceString(cliente) });
  if (!membership?.id) {
    fallar(`La ClientApplication ${cliente.id} no tiene membership en el proyecto: revisala en Project Admin → Clients.`);
    return;
  }
  if (membership.accessPolicy?.reference === refPolicy && !membership.admin && !membership.access?.length) {
    console.log('✓ Su membership tiene solo esa AccessPolicy (sin admin).');
  } else if (dryRun) {
    console.log('~ Corregiría su membership: solo esa AccessPolicy, sin admin.');
  } else {
    const corregida: ProjectMembership = { ...membership, accessPolicy: { reference: refPolicy }, admin: false };
    delete corregida.access;
    await medplum.post(`admin/projects/${projectId}/members/${membership.id}`, corregida);
    console.log('~ Membership corregida: solo esa AccessPolicy, sin admin.');
  }

  // 2) Project Secret TWILIO_WEBHOOK_URL.
  const url = urlWebhookTwilio({ baseUrl, botId: bot.id, clientId: cliente.id, clientSecret: cliente.secret });
  const secretos = await leerSecretos(medplum, projectId);
  const actual = valorSecreto(secretos, 'TWILIO_WEBHOOK_URL');
  if (actual === url) {
    console.log('= TWILIO_WEBHOOK_URL ya estaba bien.');
  } else {
    if (actual) {
      const problemas = problemasUrlWebhookTwilio(actual, { baseUrl, botId: bot.id, clientId: cliente.id });
      console.log(`~ TWILIO_WEBHOOK_URL tenía otro valor${problemas.length ? `: ${problemas.join('; ')}` : ' (otra clave)'}.`);
    }
    if (dryRun) {
      console.log('~ Guardaría TWILIO_WEBHOOK_URL.');
    } else {
      await guardarSecretos(medplum, projectId, [{ name: 'TWILIO_WEBHOOK_URL', valueString: url }]);
      console.log('+ TWILIO_WEBHOOK_URL guardado (los demás secrets quedan como estaban).');
    }
  }
  const faltan = SECRETS_TWILIO.filter((n) => n !== 'TWILIO_WEBHOOK_URL' && !valorSecreto(secretos, n));
  if (faltan.length > 0) {
    console.log(`\n⚠️  Faltan estos Project Secrets de Twilio: ${faltan.join(', ')} (Project → Secrets).`);
  }

  // 3) Twilio.
  console.log(
    `\nURL del webhook: ${ocultarClaveUrl(url)}\n\n` +
      'Falta pegarla en Twilio (la URL completa, con la clave, es el valor del secret\n' +
      'TWILIO_WEBHOOK_URL: copiala de Medplum → Project → Secrets):\n' +
      '  • Twilio Console → Messaging → Senders → WhatsApp senders → el número de SOM →\n' +
      '    "Webhook URL for incoming messages", método POST.\n' +
      '  • Si el número está en un Messaging Service: Messaging → Services → el servicio →\n' +
      '    Integration → "Send a webhook" → Request URL (POST).\n' +
      '  • El "Status callback URL" del número puede quedar vacío: cada envío pide sus ✓✓.\n' +
      'Después: npm run whatsapp:test -- +549…',
  );
}

main().catch((err) => {
  console.error('Configuración del webhook de WhatsApp falló:', err);
  process.exitCode = 1;
});
