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
 * Antes: `npm run deploy:bots` con la versión que se quiere probar (también fija el tiempo
 * máximo del bot: Lambda corta a los 10 s por defecto).
 *
 * Si la llamada se corta sin respuesta (un proxy con límite de tiempo) el bot puede seguir
 * corriendo: se espera el resultado en el documento (informe o tarea para el equipo).
 */
import 'dotenv/config';
import type { DocumentReference } from '@medplum/fhirtypes';
import { BOT_SOM_LABORATORIO, COD, SYSTEM } from '../fhir/identifiers.js';
import type { MedplumClient } from '@medplum/core';
import { adjuntoPdf, estadoProcesamiento, pendientesDeProcesar, type EstadoProcesamiento } from '../lib/laboratorio.js';
import { fechaHoraAR } from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';

const USO = 'Uso: npm run laboratorio:reprocesar -- <id del paciente> [--apply]';
/** Cuánto esperar el resultado en el documento si la llamada se cortó (el bot tiene hasta 300 s). */
const ESPERA_MAXIMA_MS = 6 * 60_000;
const CADA_MS = 10_000;

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

/** Espera a que el documento tenga informe o una revisión para el equipo tocada desde `desde`. */
async function esperarResultado(medplum: MedplumClient, doc: DocumentReference, desde: string): Promise<EstadoProcesamiento> {
  const ref = `DocumentReference/${doc.id}`;
  const hasta = Date.now() + ESPERA_MAXIMA_MS;
  let estado: EstadoProcesamiento = { estado: 'en-proceso' };
  while (estado.estado === 'en-proceso' && Date.now() < hasta) {
    await new Promise((r) => setTimeout(r, CADA_MS));
    const actual = await medplum.readResource('DocumentReference', doc.id as string);
    const tareas = await medplum.searchResources('Task', { focus: ref, _count: '20' });
    estado = estadoProcesamiento(actual, tareas, desde);
  }
  return estado;
}

function textoEstado(e: EstadoProcesamiento): string {
  if (e.estado === 'procesado') {
    return `✓ ${e.informe} (terminó después de que se cortó la llamada)`;
  }
  return e.estado === 'derivado' ? `✗ ${e.motivo}` : '✗ no terminó en 6 minutos: revisá el log del bot (npm run laboratorio:seguimiento)';
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
    // Margen por diferencia de reloj con el servidor.
    const desde = new Date(Date.now() - 60_000).toISOString();
    try {
      const r = (await medplum.executeBot(bot.id, d, 'application/fhir+json')) as RespuestaBot;
      fallas += r?.ok ? 0 : 1;
      console.log(`    ${textoRespuesta(r ?? {})}`);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      // Lambda lo cortó por tiempo: ahí no sigue corriendo, no hay nada que esperar.
      if (/timed ?out/i.test(mensaje)) {
        fallas += 1;
        console.log(`    ✗ el bot se cortó por tiempo (${mensaje}). Corré npm run deploy:bots (fija Bot.timeout) y volvé a reprocesar.`);
        continue;
      }
      console.log(`    … la llamada se cortó sin respuesta (${mensaje}); espero el resultado en el documento…`);
      const estado = await esperarResultado(medplum, d, desde);
      fallas += estado.estado === 'procesado' ? 0 : 1;
      console.log(`    ${textoEstado(estado)}`);
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
