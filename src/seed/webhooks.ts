/**
 * Webhooks públicos de SOM (WhatsApp por Twilio y MercadoPago): deja listo el lado de
 * Medplum y prueba las URLs públicas de punta a punta.
 *
 *   npm run webhooks               → configura y prueba
 *   npm run webhooks -- --dry-run  → solo muestra qué haría (prueba lo que ya esté bien)
 *   npm run webhooks -- --directa  → Twilio con la URL con credenciales: TEMPORAL, mientras
 *                                    nginx no tiene el bloque (expone la clave en Twilio)
 *
 * Antes: `npm run deploy:bots` y `npm run seed` (las policies de los webhooks).
 * Por cada webhook (idempotente):
 *  1. ClientApplication dedicada con su AccessPolicy (solo ejecuta su bot); si ya existe,
 *     corrige la membership (esa policy, sin admin).
 *  2. Project Secret con la URL pública (`TWILIO_WEBHOOK_URL`, `MP_WEBHOOK_URL`) sin tocar
 *     los demás.
 *  3. Dice qué va en nginx (`deploy/nginx-webhooks-som.conf`). El `Authorization` se arma
 *     en el servidor con la clave que muestra Medplum: nunca pasa por este script.
 *  4. Prueba la URL pública: a Twilio le manda un estado de entrega firmado de un mensaje
 *     que no existe (no escribe nada) y el mismo sin firma (tiene que rechazarlo); a
 *     MercadoPago, un evento que el bot ignora.
 * Ver docs/whatsapp.md y docs/bots.md.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReference, getReferenceString, type MedplumClient } from '@medplum/core';
import type { AccessPolicy, ClientApplication, ProjectMembership, ProjectSetting } from '@medplum/fhirtypes';
import { firmaTwilio } from '../lib/firma-twilio.js';
import {
  basicDeCliente,
  ocultarClaveUrl,
  problemasUrlPublica,
  problemasUrlWebhookTwilio,
  urlDirectaWebhookTwilio,
  urlPublicaWebhook,
  versionPasaEncabezados,
  WEBHOOK_MERCADOPAGO,
  WEBHOOK_TWILIO,
  WEBHOOKS,
  type DefWebhook,
} from '../lib/webhooks.js';
import { conectarMedplum } from './conexion.js';
import { guardarSecretos, leerSecretos, valorSecreto } from './secretos.js';

let fallas = 0;

function mal(mensaje: string): void {
  console.error(`  ✗ ${mensaje}`);
  fallas++;
}

interface Listo {
  def: DefWebhook;
  botId: string;
  clientId: string;
  url: string;
  /** El secret quedó con esta URL (se puede probar). */
  secretOk: boolean;
  /** El Basic de su ClientApplication: solo en memoria, para probar sin nginx. Nunca se imprime. */
  basic?: string;
}

/**
 * Huella del Basic (SHA-256 recortado): permite comparar el que tiene nginx con el correcto
 * sin mostrar ninguno. 48 bits de un hash no revelan una clave de 256.
 */
function huella(basic: string): string {
  return createHash('sha256').update(basic).digest('hex').slice(0, 12);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const directa = process.argv.includes('--directa');
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  const salud = (await medplum.get('healthcheck').catch(() => undefined)) as { version?: string } | undefined;
  console.log(
    `Conectado a ${baseUrl} (project ${projectId}, Medplum ${salud?.version ?? '¿versión?'})` +
      `${dryRun ? ' · DRY-RUN: no escribe nada' : ''}.`,
  );
  if (!versionPasaEncabezados(salud?.version)) {
    console.warn(
      '⚠️  Este servidor no le pasa los encabezados a los bots (hace falta Medplum ≥ 4.2): con la URL\n' +
        '   pública, el webhook de WhatsApp no puede validar la firma de Twilio y rechaza todo.',
    );
  }

  const secretos = await leerSecretos(medplum, projectId);
  const listos: Listo[] = [];
  for (const def of WEBHOOKS) {
    console.log(`\n${def.nombre}`);
    const listo = await configurar(medplum, projectId, baseUrl, def, secretos, {
      dryRun,
      directa: directa && def === WEBHOOK_TWILIO,
    });
    if (listo) {
      listos.push(listo);
    }
  }

  const publicos = listos.filter((l) => !(directa && l.def === WEBHOOK_TWILIO));
  if (publicos.length > 0) {
    console.log('\nnginx del API: placeholders de deploy/nginx-webhooks-som.conf');
    for (const l of publicos) {
      console.log(`  location = ${l.def.ruta}`);
      console.log(`      ${l.def.nginx.botId} = ${l.botId}`);
      console.log(
        `      ${l.def.nginx.basic} = Basic de "${l.def.cliente}" (clientId ${l.clientId}` +
          `${l.basic ? `, huella ${huella(l.basic)}` : ''})`,
      );
    }
    console.log(
      '  El Basic se arma EN EL SERVIDOR, así la clave no pasa por ningún otro lado: Medplum →\n' +
        '  Project Admin → Clients → la ClientApplication → su secret, y\n' +
        "    printf '%s' '<clientId>:<clientSecret>' | base64 -w0",
    );
  }

  console.log('\nPrueba de las URLs públicas:');
  for (const l of listos) {
    if (!l.secretOk) {
      console.log(`  · ${l.def.nombre}: no pruebo (el secret ${l.def.secret} no quedó guardado).`);
    } else if (l.def === WEBHOOK_TWILIO && directa) {
      console.log('  · WhatsApp: con --directa no se prueba (no pasa por nginx).');
    } else if (l.def === WEBHOOK_TWILIO) {
      await probarTwilio(baseUrl, l, secretos);
    } else {
      await probarMercadoPago(baseUrl, l);
    }
  }

  const twilio = listos.find((l) => l.def === WEBHOOK_TWILIO);
  const mp = listos.find((l) => l.def === WEBHOOK_MERCADOPAGO);
  console.log('\nFalta, en los paneles:');
  if (twilio) {
    console.log(
      '  • Twilio Console → Messaging → Senders → WhatsApp senders → el número de SOM →\n' +
        '    "Webhook URL for incoming messages" (POST): ' +
        (directa ? 'el valor del secret TWILIO_WEBHOOK_URL (copialo de Medplum → Project → Secrets)' : twilio.url) +
        '\n    Si el número está en un Messaging Service: Integration → "Send a webhook", la misma URL.',
    );
  }
  if (mp) {
    console.log(
      '  • MercadoPago → Tus integraciones → la aplicación → Webhooks (modo productivo), evento\n' +
        `    Pagos: ${mp.url}  (Webhooks, no IPN: IPN viaja en la query string y el bot no la ve).`,
    );
  }
  console.log('Después: npm run whatsapp:test -- +549…  ·  npm run mercadopago:test');
  if (fallas > 0) {
    process.exitCode = 1;
  }
}

async function configurar(
  medplum: MedplumClient,
  projectId: string,
  baseUrl: string,
  def: DefWebhook,
  secretos: ProjectSetting[],
  op: { dryRun: boolean; directa: boolean },
): Promise<Listo | undefined> {
  const bot = await medplum.searchOne('Bot', { 'name:exact': def.bot });
  if (!bot?.id) {
    mal(`Falta el bot "${def.bot}": npm run deploy:bots`);
    return undefined;
  }
  console.log(`  ✓ Bot ${def.bot}: ${bot.id}`);
  const policy = await medplum.searchOne('AccessPolicy', { 'name:exact': def.policy });
  if (!policy?.id) {
    mal(`Falta la AccessPolicy "${def.policy}": npm run seed`);
    return undefined;
  }
  const cliente = await asegurarCliente(medplum, projectId, def, policy, op.dryRun);
  if (!cliente?.id) {
    return undefined;
  }

  let url: string;
  if (op.directa) {
    if (!cliente.secret) {
      mal(`No pude leer la clave de "${def.cliente}": sin ella no hay URL directa.`);
      return undefined;
    }
    url = urlDirectaWebhookTwilio({ baseUrl, botId: bot.id, clientId: cliente.id, clientSecret: cliente.secret });
    console.warn('  ⚠️  URL directa (TEMPORAL): la clave queda a la vista en Twilio y en cada envío. Pasar a nginx.');
  } else {
    url = urlPublicaWebhook(baseUrl, def.ruta);
  }

  const actual = valorSecreto(secretos, def.secret);
  let secretOk = actual === url;
  if (secretOk) {
    console.log(`  = ${def.secret} ya estaba bien.`);
  } else {
    if (actual) {
      const problemas =
        def === WEBHOOK_TWILIO
          ? problemasUrlWebhookTwilio(actual, { baseUrl, botId: bot.id, clientId: cliente.id })
          : problemasUrlPublica(actual, { baseUrl, ruta: def.ruta });
      console.log(`  ~ ${def.secret} tenía ${ocultarClaveUrl(actual)}${problemas.length ? ` (${problemas.join('; ')})` : ''}.`);
    }
    if (op.dryRun) {
      console.log(`  ~ Guardaría ${def.secret} = ${ocultarClaveUrl(url)}`);
    } else {
      await guardarSecretos(medplum, projectId, [{ name: def.secret, valueString: url }]);
      secretOk = true;
      console.log(`  + ${def.secret} = ${ocultarClaveUrl(url)} (los demás secrets quedan como estaban).`);
    }
  }
  const basic = cliente.secret ? basicDeCliente(cliente.id, cliente.secret) : undefined;
  return { def, botId: bot.id, clientId: cliente.id, url, secretOk, basic };
}

/** La ClientApplication dedicada del webhook, con su membership corregida. */
async function asegurarCliente(
  medplum: MedplumClient,
  projectId: string,
  def: DefWebhook,
  policy: AccessPolicy,
  dryRun: boolean,
): Promise<ClientApplication | undefined> {
  const clientes = await medplum.searchResources('ClientApplication', { 'name:exact': def.cliente });
  if (clientes.length > 1) {
    mal(`Hay ${clientes.length} ClientApplications "${def.cliente}" (${clientes.map((c) => c.id).join(', ')}): dejá una sola.`);
    return undefined;
  }
  let cliente: ClientApplication | undefined = clientes[0]?.id
    ? await medplum.readResource('ClientApplication', clientes[0].id)
    : undefined;
  if (!cliente) {
    if (dryRun) {
      console.log(`  + Crearía la ClientApplication "${def.cliente}" con la AccessPolicy "${def.policy}".`);
      return undefined;
    }
    cliente = (await medplum.post(`admin/projects/${projectId}/client`, {
      name: def.cliente,
      description: `Credenciales que agrega nginx en ${def.ruta}. Solo ejecuta ${def.bot}.`,
      accessPolicy: createReference(policy),
    })) as ClientApplication;
    console.log(`  + ClientApplication "${def.cliente}" creada: ${cliente.id}`);
  } else {
    console.log(`  = ClientApplication "${def.cliente}": ${cliente.id}`);
  }

  const refPolicy = getReferenceString(policy);
  const membership = await medplum.searchOne('ProjectMembership', { profile: getReferenceString(cliente) });
  if (!membership?.id) {
    mal(`La ClientApplication ${cliente.id} no tiene membership en el proyecto (Project Admin → Clients).`);
    return undefined;
  }
  if (membership.accessPolicy?.reference === refPolicy && !membership.admin && !membership.access?.length) {
    console.log('  ✓ Su membership tiene solo esa AccessPolicy (sin admin).');
  } else if (dryRun) {
    console.log('  ~ Corregiría su membership: solo esa AccessPolicy, sin admin.');
  } else {
    const corregida: ProjectMembership = { ...membership, accessPolicy: { reference: refPolicy }, admin: false };
    delete corregida.access;
    await medplum.post(`admin/projects/${projectId}/members/${membership.id}`, corregida);
    console.log('  ~ Membership corregida: solo esa AccessPolicy, sin admin.');
  }
  return cliente;
}

interface Respuesta {
  status: number;
  cuerpo?: Record<string, unknown>;
}

async function postear(url: string, body: string, headers: Record<string, string>): Promise<Respuesta> {
  const resp = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', ...headers }, body });
  let cuerpo: Record<string, unknown> | undefined;
  try {
    const json = (await resp.json()) as unknown;
    cuerpo = json && typeof json === 'object' ? (json as Record<string, unknown>) : undefined;
  } catch {
    // nginx o un proxy pueden devolver HTML
  }
  return { status: resp.status, cuerpo };
}

/** Qué significa un HTTP que no es 200 en la URL pública. */
function explicarHttp(status: number): string {
  if (status === 404) {
    return 'nginx todavía no tiene la ruta (HTTP 404)';
  }
  if (status === 401 || status === 403) {
    return `Medplum no acepta el Authorization que agrega nginx (HTTP ${status})`;
  }
  if (status >= 502 && status <= 504) {
    return `nginx no llega a Medplum (HTTP ${status})`;
  }
  return `HTTP ${status}`;
}

/**
 * Con 401/403 en la URL pública, el mismo pedido directo a Medplum con la clave de la
 * ClientApplication (sin nginx): separa "el Basic de nginx está mal" de "Medplum rechaza
 * la ClientApplication".
 */
async function probarSinNginx(baseUrl: string, l: Listo, body: string, headers: Record<string, string>): Promise<void> {
  if (!l.basic) {
    console.log(`    (no pude leer la clave de "${l.def.cliente}" para probar sin nginx)`);
    return;
  }
  const directa = new URL(`fhir/R4/Bot/${l.botId}/$execute`, baseUrl.replace(/\/?$/, '/')).toString();
  const r = await postear(directa, body, { ...headers, Authorization: `Basic ${l.basic}` });
  if (r.status === 200) {
    console.log(
      `    → Sin nginx, con la clave de "${l.def.cliente}", Medplum responde bien (HTTP 200): el Basic\n` +
        `      que tiene nginx en ${l.def.ruta} no es el correcto. Huella del correcto: ${huella(l.basic)}.\n` +
        '      Compararla en el servidor: docs/whatsapp.md → «Si la URL pública da 401».',
    );
  } else {
    console.log(
      `    → Sin nginx también falla (HTTP ${r.status}): Medplum rechaza la ClientApplication "${l.def.cliente}"\n` +
        '      (¿status inactivo, membership inactiva o reglas de IP en su AccessPolicy?).',
    );
  }
}

async function probarTwilio(baseUrl: string, l: Listo, secretos: ProjectSetting[]): Promise<void> {
  const token = valorSecreto(secretos, 'TWILIO_AUTH_TOKEN');
  const cuenta = valorSecreto(secretos, 'TWILIO_ACCOUNT_SID');
  if (!token || !cuenta) {
    mal('WhatsApp: no pruebo, faltan TWILIO_AUTH_TOKEN o TWILIO_ACCOUNT_SID (Project → Secrets).');
    return;
  }
  // Estado de entrega de un mensaje que no existe: el bot no encuentra nada que actualizar.
  const params = { AccountSid: cuenta, MessageSid: 'SMsomdiagnosticowebhook000000000', MessageStatus: 'delivered' };
  const body = new URLSearchParams(params).toString();
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const firmado = { ...form, 'X-Twilio-Signature': firmaTwilio(token, l.url, params) };

  const r = await postear(l.url, body, firmado);
  if (r.status !== 200) {
    mal(`WhatsApp: ${explicarHttp(r.status)}.`);
    if (r.status === 401 || r.status === 403) {
      await probarSinNginx(baseUrl, l, body, firmado);
    }
    return;
  }
  if (r.cuerpo?.tipo === 'estado') {
    console.log('  ✓ WhatsApp: nginx → Medplum → bot, y el bot acepta lo que firma Twilio.');
  } else {
    mal(`WhatsApp: el bot rechazó un pedido bien firmado: ${String(r.cuerpo?.motivo ?? JSON.stringify(r.cuerpo))}`);
    return;
  }

  const sinFirma = await postear(l.url, body, form);
  if (sinFirma.status === 200 && sinFirma.cuerpo?.ok === false) {
    console.log('  ✓ WhatsApp: rechaza un pedido sin la firma de Twilio.');
  } else {
    mal(`WhatsApp: ¡aceptó un pedido SIN firma! (HTTP ${sinFirma.status}). Revisá TWILIO_WEBHOOK_URL y el bot.`);
  }
}

async function probarMercadoPago(baseUrl: string, l: Listo): Promise<void> {
  const body = JSON.stringify({ type: 'som-diagnostico' });
  const json = { 'Content-Type': 'application/json' };
  const r = await postear(l.url, body, json);
  if (r.status !== 200) {
    mal(`MercadoPago: ${explicarHttp(r.status)}.`);
    if (r.status === 401 || r.status === 403) {
      await probarSinNginx(baseUrl, l, body, json);
    }
  } else if (r.cuerpo?.ok === true) {
    console.log('  ✓ MercadoPago: nginx → Medplum → bot (el evento de prueba se ignora, como corresponde).');
  } else {
    mal(`MercadoPago: el bot respondió ${JSON.stringify(r.cuerpo)}.`);
  }
}

main().catch((err) => {
  console.error('Configuración de los webhooks falló:', err);
  process.exitCode = 1;
});
