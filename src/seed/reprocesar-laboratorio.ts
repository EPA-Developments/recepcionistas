/**
 * Reprocesa los PDF de laboratorio de un paciente que siguen "En proceso".
 *
 *   npm run laboratorio:reprocesar -- <id del paciente>            → DRY-RUN: lista cuáles
 *   npm run laboratorio:reprocesar -- <id del paciente> --apply    → ejecuta el bot con cada uno
 *
 * La Subscription dispara `som-procesar-laboratorio` solo al CREAR el documento: un PDF
 * que quedó trabado (bot sin deployar, falla ya corregida) no se vuelve a procesar solo.
 * Esto ejecuta el bot, en orden y de a uno, con cada DocumentReference sin informe. El bot
 * escribe con su identidad (Observations + DiagnosticReport) y es idempotente; si vuelve a
 * fallar, actualiza el motivo de la tarea del equipo sin avisarle de nuevo al paciente.
 * Antes: `npm run deploy:bots` con la versión que se quiere probar.
 */
import 'dotenv/config';
import type { DocumentReference } from '@medplum/fhirtypes';
import { BOT_SOM_LABORATORIO, COD, SYSTEM } from '../fhir/identifiers.js';
import { adjuntoPdf, pendientesDeProcesar } from '../lib/laboratorio.js';
import { fechaHoraAR } from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';

const USO = 'Uso: npm run laboratorio:reprocesar -- <id del paciente> [--apply]';

interface RespuestaBot {
  ok?: boolean;
  mensaje?: string;
  diagnosticReportId?: string;
  observaciones?: number;
  derivadoAlEquipo?: boolean;
}

const describir = (d: DocumentReference): string =>
  `DocumentReference/${d.id} · ${fechaHoraAR(d.date) || 'sin fecha'} · ${adjuntoPdf(d)?.title ?? 'sin título'}`;

function textoRespuesta(r: RespuestaBot): string {
  if (r.ok && r.diagnosticReportId) {
    return `✓ DiagnosticReport/${r.diagnosticReportId}${r.observaciones === undefined ? '' : ` con ${r.observaciones} valor(es)`}${r.mensaje ? ` (${r.mensaje})` : ''}`;
  }
  return `✗ ${r.mensaje ?? 'sin respuesta del bot'}${r.derivadoAlEquipo ? ' → tarea "revisar-laboratorio" para el equipo' : ''}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const pacienteId = args.find((a) => !a.startsWith('--'))?.replace(/^Patient\//, '');
  if (!pacienteId) {
    console.error(USO);
    process.exitCode = 1;
    return;
  }
  const { medplum, baseUrl } = await conectarMedplum();
  const pacienteRef = `Patient/${pacienteId}`;
  const bot = await medplum.searchOne('Bot', { 'name:exact': BOT_SOM_LABORATORIO });
  if (!bot?.id) {
    console.error(`No existe el bot ${BOT_SOM_LABORATORIO} en ${baseUrl}: npm run deploy:bots.`);
    process.exitCode = 1;
    return;
  }
  const documentos = await medplum.searchResources('DocumentReference', {
    subject: pacienteRef,
    category: `${SYSTEM.documento}|${COD.resultadoLaboratorio}`,
    _count: '100',
  });
  const pendientes = pendientesDeProcesar(documentos);

  console.log(`Laboratorio en PDF · reprocesar · ${pacienteRef} · ${baseUrl}`);
  console.log(`  ${documentos.length} PDF(s) de laboratorio; ${pendientes.length} en proceso (sin informe).`);
  if (pendientes.length === 0) {
    return;
  }
  if (!apply) {
    pendientes.forEach((d) => console.log(`  · ${describir(d)}`));
    console.log(
      `\n[dry-run] No se ejecutó nada. Con el bot deployado (npm run deploy:bots), corré:\n` +
        `  npm run laboratorio:reprocesar -- ${pacienteId} --apply`,
    );
    return;
  }

  let fallas = 0;
  for (const d of pendientes) {
    console.log(`  → ${describir(d)}`);
    try {
      const r = (await medplum.executeBot(bot.id, d, 'application/fhir+json')) as RespuestaBot;
      fallas += r?.ok ? 0 : 1;
      console.log(`    ${textoRespuesta(r ?? {})}`);
    } catch (err) {
      fallas += 1;
      console.log(`    ✗ la ejecución falló: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(
    fallas
      ? `\n${fallas} de ${pendientes.length} sin procesar: el motivo está arriba y en la tarea del equipo (npm run laboratorio:seguimiento -- ${pacienteId}).`
      : `\n✓ Los ${pendientes.length} quedaron procesados: en el portal pasan a "Ver resultados".`,
  );
  if (fallas) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Reprocesar laboratorio: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
