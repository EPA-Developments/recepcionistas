/**
 * Deploy de los Medplum Bots.
 *
 *   npm run bots:bundle   → DRY-RUN: bundlea cada bot y muestra tamaños (sin red).
 *   npm run deploy:bots   → crea (si faltan) + bundlea + deploya a Medplum, y
 *                            escribe los ids en medplum.config.json.
 *
 * Replica lo que hace la CLI de Medplum, pero con dotenv (mismo flujo que el seed):
 *   - crear bot:   POST admin/projects/{projectId}/bot { name, runtimeVersion }
 *   - deployar:    POST Bot/{id}/$deploy { code, filename }
 * El código se bundlea a un único módulo CJS (exports.handler) con esbuild.
 */
import 'dotenv/config';
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { build, type Plugin } from 'esbuild';
import type { MedplumClient } from '@medplum/core';
import type { Bot, Subscription } from '@medplum/fhirtypes';
import { BOT_SOM_LABORATORIO, BOT_SOM_REPORT, COD, SYSTEM } from '../fhir/identifiers.js';
import { conectarMedplum } from './conexion.js';

/** Runtime de los bots. El servidor Medplum de SOM usa AWS Lambda. Configurable por env. */
const RUNTIME_VERSION = process.env.BOT_RUNTIME_VERSION ?? 'awslambda';

interface DefBot {
  name: string;
  source: string;
  dist: string;
  description: string;
}

const BOTS: DefBot[] = [
  { name: 'som-calcular-cobro', source: 'src/bots/calcular-cobro.ts', dist: 'dist/bots/calcular-cobro.js', description: 'Calcula el cobro (USD→ARS, splits) y emite Invoice.' },
  { name: 'som-validar-turno', source: 'src/bots/validar-turno.ts', dist: 'dist/bots/validar-turno.js', description: 'Valida un turno (capacidad de recursos, ventana de reserva).' },
  { name: 'som-reservar-turno', source: 'src/bots/reservar-turno.ts', dist: 'dist/bots/reservar-turno.js', description: 'Valida y crea un turno (Appointment + Slot ocupado).' },
  { name: 'som-estado-turno', source: 'src/bots/estado-turno.ts', dist: 'dist/bots/estado-turno.js', description: 'Cambia el estado del turno (check-in/out), gestiona Encounter y libera la sala.' },
  { name: 'som-pagar-sena', source: 'src/bots/pagar-sena.ts', dist: 'dist/bots/pagar-sena.js', description: 'Registra la seña (50%), confirma el turno y envía WhatsApp.' },
  { name: 'som-link-mercadopago', source: 'src/bots/link-mercadopago.ts', dist: 'dist/bots/link-mercadopago.js', description: 'Genera link de MercadoPago para pagar la seña.' },
  { name: 'som-webhook-mercadopago', source: 'src/bots/webhook-mercadopago.ts', dist: 'dist/bots/webhook-mercadopago.js', description: 'Webhook de MercadoPago: confirma el turno al acreditarse el pago.' },
  { name: 'som-recordatorios', source: 'src/bots/recordatorios.ts', dist: 'dist/bots/recordatorios.js', description: 'Cron: envía recordatorios de turnos confirmados a 48 h y 2 h (WhatsApp).' },
  { name: 'som-alta-paciente', source: 'src/bots/alta-paciente.ts', dist: 'dist/bots/alta-paciente.js', description: 'Alta de paciente (Patient) con dedupe por DNI/email/teléfono.' },
  { name: 'som-invitar-paciente', source: 'src/bots/invitar-paciente.ts', dist: 'dist/bots/invitar-paciente.js', description: 'Invita al paciente al portal (invite Medplum) y entrega el link por WhatsApp/email/QR. Requiere admin.' },
  { name: 'som-limpiar-demo', source: 'src/bots/limpiar-demo.ts', dist: 'dist/bots/limpiar-demo.js', description: 'Cron: borra los datos demo (tag demo) con más de 48 h.' },
  { name: 'som-enviar-whatsapp', source: 'src/bots/enviar-whatsapp.ts', dist: 'dist/bots/enviar-whatsapp.js', description: 'Envía WhatsApp (Twilio) y registra Communication.' },
  { name: 'som-solicitar-turno', source: 'src/bots/solicitar-turno.ts', dist: 'dist/bots/solicitar-turno.js', description: 'Crea una solicitud de turno (Task) desde el portal del paciente y avisa a Recepción por WhatsApp.' },
  // CRM — embudo de captación (redes sociales) → segmentos → campañas (docs/crm.md).
  { name: 'som-recomputar-segmentos', source: 'src/bots/recomputar-segmentos.ts', dist: 'dist/bots/recomputar-segmentos.js', description: 'CRM: recalcula los miembros de los segmentos (origen del lead/red social, perfil, ciclo de vida, biomarcadores).' },
  { name: 'som-enviar-campana', source: 'src/bots/enviar-campana.ts', dist: 'dist/bots/enviar-campana.js', description: 'CRM: envía una campaña a un segmento (email; WhatsApp queda pendiente de plantilla aprobada) y registra una Communication por destinatario.' },
  // SOM — Segunda Opinión Médica.
  { name: 'som-solicitar', source: 'src/bots/som-solicitar.ts', dist: 'dist/bots/som-solicitar.js', description: 'SOM: crea una ServiceRequest de segunda opinión cardiológica desde el portal del paciente.' },
  { name: 'bot-som-report', source: 'src/bots/som-report.ts', dist: 'dist/bots/som-report.js', description: 'SOM: genera el informe (PREVENT + Claude + PDF) ante una ServiceRequest activa. Lo dispara una Subscription.' },
  { name: 'som-procesar-laboratorio', source: 'src/bots/som-procesar-laboratorio.ts', dist: 'dist/bots/som-procesar-laboratorio.js', description: 'SOM: transcribe el PDF de laboratorio que manda el paciente (Claude) a Observation + DiagnosticReport. Lo dispara una Subscription (create).' },
  // Seguimiento GLP-1 (docs/glp1.md).
  { name: 'som-glp1-inscribir', source: 'src/bots/glp1-inscribir.ts', dist: 'dist/bots/glp1-inscribir.js', description: 'GLP-1 (Recepción): inscribe al paciente en el seguimiento; deja la indicación pendiente al equipo médico.' },
  { name: 'som-glp1-plan', source: 'src/bots/glp1-plan.ts', dist: 'dist/bots/glp1-plan.js', description: 'GLP-1 (equipo médico): arma o recalcula el programa (CarePlan, meta, laboratorio y controles a agendar).' },
  // Plan Bienestar · 100 días (portal: tarjeta de progreso).
  { name: 'som-bienestar-inscribir', source: 'src/bots/bienestar-inscribir.ts', dist: 'dist/bots/bienestar-inscribir.js', description: 'Plan Bienestar (Recepción): inscribe al paciente; crea el CarePlan plan-bienestar-100 de 100 días que lee el portal.' },
];

/** Resuelve imports relativos ".js" a su fuente ".ts" (ESM + Bundler). */
const jsToTs: Plugin = {
  name: 'js-to-ts',
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.importer || !args.path.startsWith('.')) {
        return undefined;
      }
      const tsPath = resolve(dirname(args.importer), args.path.replace(/\.js$/, '.ts'));
      return existsSync(tsPath) ? { path: tsPath } : undefined;
    });
  },
};

/**
 * `$deploy` manda el código en un JSON: el servidor Medplum rechaza cuerpos de más
 * de 1 MB por defecto (`maxJsonSize`). Avisamos antes de llegar.
 */
const MAX_BUNDLE_KB = 900;

async function bundle(source: string): Promise<string> {
  const result = await build({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    legalComments: 'none',
    // Compacta (el SDK de Anthropic pesa ~850 kB sin compactar) sin renombrar
    // identificadores: los stack traces en CloudWatch siguen siendo legibles.
    minifyWhitespace: true,
    minifySyntax: true,
    plugins: [jsToTs],
  });
  return result.outputFiles[0]!.text;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  // 1) Bundle (siempre; sirve para verificar sin red).
  const bundles = new Map<string, string>();
  for (const b of BOTS) {
    const code = await bundle(b.source);
    bundles.set(b.name, code);
    const kb = JSON.stringify({ code }).length / 1024;
    console.log(`  • ${b.name}: ${(code.length / 1024).toFixed(1)} kB bundleado`);
    if (kb > MAX_BUNDLE_KB) {
      throw new Error(`${b.name}: el bundle (${kb.toFixed(0)} kB en JSON) supera ${MAX_BUNDLE_KB} kB; $deploy lo rechazaría.`);
    }
  }

  if (dryRun) {
    console.log('\n[dry-run] Bots bundleados OK. No se conecta a Medplum.');
    return;
  }

  // 2) Conectar a Medplum (aborta si las credenciales no son de MEDPLUM_PROJECT_ID).
  const { medplum, projectId } = await conectarMedplum();
  console.log(`\nConectado a Medplum (project ${projectId}).`);

  // 3) Asegurar + deployar cada bot.
  const ids = new Map<string, string>();
  const faltantes: string[] = [];
  for (const b of BOTS) {
    const id = await asegurarBot(medplum, projectId, b);
    if (!id) {
      faltantes.push(b.name);
      continue;
    }
    await medplum.post(medplum.fhirUrl('Bot', id, '$deploy'), {
      code: bundles.get(b.name),
      filename: basename(b.dist),
    });
    console.log(`    ✓ deployado`);
    ids.set(b.name, id);
  }

  // 4) Asegurar las Subscriptions que disparan los bots internos de SOM.
  for (const sub of SUBSCRIPTIONS) {
    const botId = ids.get(sub.bot);
    if (botId) {
      await asegurarSubscription(medplum, botId, sub);
    }
  }

  // 5) Escribir los ids en medplum.config.json.
  escribirConfig(ids);

  if (faltantes.length > 0) {
    console.log('\n⚠️  Faltan crear estos bots (sin permiso de admin del proyecto):');
    for (const n of faltantes) {
      console.log(`   - ${n}`);
    }
    console.log(
      '\n   Crealos UNA vez en Medplum (Project Admin → Bots → New Bot) con ese nombre exacto\n' +
        `   y runtime "${RUNTIME_VERSION}". Después volvé a correr: npm run deploy:bots\n` +
        '   (el bundle + deploy lo hace el script; solo falta la creación inicial).',
    );
  } else {
    console.log('\nDeploy de bots completado. Ids guardados en medplum.config.json.');
  }
}

/** Devuelve el id del bot: lo busca por nombre; si no existe intenta crearlo. */
async function asegurarBot(medplum: MedplumClient, projectId: string, b: DefBot): Promise<string | undefined> {
  const existente = await medplum.searchOne('Bot', `name=${encodeURIComponent(b.name)}`);
  if (existente?.id) {
    console.log(`  = Bot existente: ${b.name} (${existente.id})`);
    return existente.id;
  }
  try {
    const creado = (await medplum.post(`admin/projects/${projectId}/bot`, {
      name: b.name,
      description: b.description,
      runtimeVersion: RUNTIME_VERSION,
    })) as Bot;
    const bot = await medplum.readResource('Bot', creado.id as string);
    console.log(`  + Bot creado: ${b.name} (${bot.id})`);
    return bot.id;
  } catch (err) {
    if (esForbidden(err)) {
      console.warn(`  ! Sin permiso para crear "${b.name}" (la ClientApplication no es admin del proyecto).`);
      return undefined;
    }
    throw err;
  }
}

interface DefSubscription {
  /** Bot al que apunta (por nombre). */
  bot: string;
  nombre: string;
  reason: string;
  criteria: string;
  /** Si está, solo dispara en esa interacción (extensión de Medplum). */
  soloEn?: 'create' | 'update' | 'delete';
}

const EXT_INTERACCION = 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction';

const SUBSCRIPTIONS: DefSubscription[] = [
  {
    bot: BOT_SOM_REPORT,
    nombre: 'SOM informe',
    reason: 'SOM: generar informe ante una solicitud de segunda opinión cardiológica.',
    criteria: `ServiceRequest?status=active&code=${SYSTEM.somServices}|${COD.somCardiology}`,
  },
  {
    bot: BOT_SOM_LABORATORIO,
    nombre: 'SOM laboratorio',
    reason: 'SOM: procesar el PDF de laboratorio que manda el paciente desde el portal.',
    criteria: `DocumentReference?category=${SYSTEM.documento}|${COD.resultadoLaboratorio}`,
    // Solo al crear: el bot actualiza ese mismo documento al terminar.
    soloEn: 'create',
  },
];

/**
 * Asegura (idempotente) una Subscription rest-hook que invoca a un bot. Busca una
 * existente que apunte al mismo bot con el mismo criterio; si no hay, la crea.
 */
async function asegurarSubscription(medplum: MedplumClient, botId: string, def: DefSubscription): Promise<void> {
  const endpoint = `Bot/${botId}`;
  const extension = def.soloEn ? [{ url: EXT_INTERACCION, valueCode: def.soloEn }] : undefined;
  const existentes = await medplum.searchResources('Subscription', '_count=200');
  const ya = existentes.find((s) => s.criteria === def.criteria && s.channel?.endpoint === endpoint);
  if (ya) {
    const interaccion = ya.extension?.find((e) => e.url === EXT_INTERACCION)?.valueCode;
    if (ya.status !== 'active' || interaccion !== def.soloEn) {
      const otras = (ya.extension ?? []).filter((e) => e.url !== EXT_INTERACCION);
      await medplum.updateResource<Subscription>({
        ...ya,
        status: 'active',
        extension: [...otras, ...(extension ?? [])],
      });
      console.log(`  = Subscription ${def.nombre} actualizada/reactivada.`);
    } else {
      console.log(`  = Subscription ${def.nombre} ya existente.`);
    }
    return;
  }
  const creada = await medplum.createResource<Subscription>({
    resourceType: 'Subscription',
    status: 'active',
    reason: def.reason,
    criteria: def.criteria,
    channel: { type: 'rest-hook', endpoint },
    ...(extension ? { extension } : {}),
  });
  console.log(`  + Subscription ${def.nombre} creada (${creada.id}).`);
}

function esForbidden(err: unknown): boolean {
  const id = (err as { outcome?: { id?: string } })?.outcome?.id;
  const msg = err instanceof Error ? err.message : String(err);
  return id === 'forbidden' || /forbidden/i.test(msg);
}

function escribirConfig(ids: Map<string, string>): void {
  const path = 'medplum.config.json';
  const config = { bots: BOTS.map((b) => ({ name: b.name, id: ids.get(b.name) ?? '', source: b.source, dist: b.dist })) };
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

main().catch((err) => {
  console.error('Deploy de bots falló:', err);
  process.exitCode = 1;
});
