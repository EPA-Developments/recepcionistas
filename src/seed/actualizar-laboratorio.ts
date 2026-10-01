/**
 * Pone al día los laboratorios en PDF que ya se procesaron: duplicados, relectura con el
 * catálogo vigente y eGFR (ver `src/lib/laboratorio-actualizar.ts`).
 *
 *   npm run laboratorio:actualizar                              → DRY-RUN de todo el proyecto
 *   npm run laboratorio:actualizar -- <id del paciente>         → DRY-RUN de un paciente
 *   npm run laboratorio:actualizar -- [<id del paciente>] --apply
 *
 * Con --apply, en este orden:
 *  1. Duplicados (mismo paciente, misma fecha, mismos valores): queda el más viejo; el otro
 *     y sus valores pasan a `entered-in-error` y su documento muestra el original.
 *  2. Relectura: los informes leídos con el catálogo viejo (antes de que el servidor
 *     publicara el laboratorio de rutina) que tienen valores sin código, como la creatinina.
 *     Ejecuta `som-procesar-laboratorio` con `{ releer }`: UNA lectura de Claude por PDF
 *     (queda en `npm run uso:ia`). El informe nuevo trae los códigos y el eGFR; el viejo pasa
 *     a `entered-in-error`. Si una relectura falla, ese informe queda como estaba.
 *  3. eGFR: los informes con la creatinina codificada y sin filtrado con un número reciben
 *     el calculado (CKD-EPI 2021), sin Claude.
 * Al final lista a quién le falta la fecha de nacimiento o el sexo para calcularlo.
 *
 * Antes: `npm run seed` (catálogo vigente) y `npm run deploy:bots` (bot con `releer`).
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import type { DiagnosticReport, DocumentReference, Observation, ObservationDefinition, Patient } from '@medplum/fhirtypes';
import { BOT_SOM_LABORATORIO, COD, LOINC_INFORME_LABORATORIO, SYSTEM } from '../fhir/identifiers.js';
import {
  aplicarDuplicado,
  aplicarEgfr,
  planActualizacion,
  type InformeConValores,
  type PlanActualizacion,
} from '../lib/laboratorio-actualizar.js';
import { catalogoDesdeObservationDefinitions, informeYaGenerado } from '../lib/laboratorio.js';
import { fechaHoraAR } from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';

const USO = 'Uso: npm run laboratorio:actualizar -- [<id del paciente>] [--apply]';
/** Cuánto esperar el resultado de una relectura si la llamada se cortó (el bot tiene hasta 300 s). */
const ESPERA_MAXIMA_MS = 6 * 60_000;
const CADA_MS = 10_000;
const LOTE = 100;

async function todos<T extends DiagnosticReport | DocumentReference | ObservationDefinition>(
  medplum: MedplumClient,
  tipo: T['resourceType'],
  query: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const pagina of medplum.searchResourcePages(tipo, { ...query, _count: '500' })) {
    out.push(...(pagina as unknown as T[]));
  }
  return out;
}

async function porId<T extends Observation | Patient>(medplum: MedplumClient, tipo: T['resourceType'], ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    out.push(...((await medplum.searchResources(tipo, { _id: lote.join(','), _count: String(lote.length) })) as unknown as T[]));
  }
  return out;
}

/** Desde cuándo el servidor publica el catálogo vigente: la creación de la definición del eGFR. */
async function catalogoVigenteDesde(medplum: MedplumClient, defs: ObservationDefinition[]): Promise<string | undefined> {
  const egfr = defs.find((d) => d.identifier?.some((i) => i.system === SYSTEM.analito && i.value === 'e_gfr'));
  if (!egfr?.id) {
    return undefined;
  }
  const historia = await medplum.readHistory('ObservationDefinition', egfr.id).catch(() => undefined);
  const fechas = (historia?.entry ?? []).map((e) => e.resource?.meta?.lastUpdated).filter((f): f is string => Boolean(f));
  return fechas.sort()[0] ?? egfr.meta?.lastUpdated;
}

const describir = (x: InformeConValores) =>
  `DiagnosticReport/${x.informe.id} · ${x.informe.subject?.reference} · estudio del ${x.informe.effectiveDateTime?.slice(0, 10) ?? '¿?'}` +
  `${x.informe.performer?.[0]?.display ? ` · ${x.informe.performer[0].display}` : ''} · ${x.observaciones.length} valor(es)`;

function imprimirPlan(plan: PlanActualizacion): void {
  console.log(`\n1. Duplicados: ${plan.duplicados.length}`);
  for (const d of plan.duplicados) {
    console.log(`  · ${describir(d.duplicado)}\n      es copia de DiagnosticReport/${d.original.informe.id} → entered-in-error`);
  }
  console.log(`\n2. Releer con el catálogo vigente (Claude): ${plan.relecturas.length}`);
  for (const r of plan.relecturas) {
    console.log(`  · ${describir(r.informe)}\n      ${r.motivo} · PDF DocumentReference/${r.documento.id} (${fechaHoraAR(r.documento.date)})`);
  }
  console.log(`\n3. eGFR calculado (CKD-EPI 2021, sin Claude): ${plan.egfr.length}`);
  for (const e of plan.egfr) {
    const nota = e.calculada.note?.[0]?.text ?? '';
    console.log(
      `  · ${describir(e.informe)}\n      eGFR ${e.calculada.valueQuantity?.value} mL/min/1,73 m²${e.reemplaza ? ` (reemplaza a Observation/${e.reemplaza.id})` : ''} · ${nota}`,
    );
  }
  console.log(`\n4. Sin datos para calcular el eGFR: ${plan.sinDatos.length}`);
  for (const s of plan.sinDatos) {
    console.log(`  · ${s.pacienteRef} (DiagnosticReport/${s.informe.informe.id}): falta ${s.falta.join(' y ')}`);
  }
}

/** Relee un PDF con el bot; si la llamada se corta, espera a que el documento cambie de informe. */
async function releer(medplum: MedplumClient, botId: string, doc: DocumentReference): Promise<string> {
  const previo = informeYaGenerado(doc);
  try {
    const r = (await medplum.executeBot(botId, { releer: `DocumentReference/${doc.id}` }, 'application/json')) as {
      ok?: boolean;
      mensaje?: string;
      diagnosticReportId?: string;
      observaciones?: number;
    };
    return r?.ok
      ? `✓ DiagnosticReport/${r.diagnosticReportId} con ${r.observaciones ?? '?'} valor(es) reemplaza a ${previo}`
      : `✗ ${r?.mensaje ?? 'sin respuesta del bot'}`;
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (/timed ?out/i.test(mensaje)) {
      return `✗ el bot se cortó por tiempo (${mensaje}): npm run deploy:bots fija Bot.timeout. El informe anterior sigue vigente.`;
    }
    console.log(`    … la llamada se cortó sin respuesta (${mensaje}); espero el resultado en el documento…`);
    const hasta = Date.now() + ESPERA_MAXIMA_MS;
    while (Date.now() < hasta) {
      await new Promise((r) => setTimeout(r, CADA_MS));
      const actual = informeYaGenerado(await medplum.readResource('DocumentReference', doc.id as string));
      if (actual && actual !== previo) {
        return `✓ ${actual} reemplaza a ${previo} (terminó después de que se cortó la llamada)`;
      }
    }
    return '✗ no terminó en 6 minutos: el informe anterior sigue vigente; revisá el log del bot.';
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const pacienteId = args.find((a) => !a.startsWith('--'))?.replace(/^Patient\//, '');
  if (args.some((a) => a.startsWith('--') && a !== '--apply')) {
    console.error(USO);
    process.exitCode = 1;
    return;
  }
  const { medplum, baseUrl } = await conectarMedplum();
  const delPaciente: Record<string, string> = pacienteId ? { subject: `Patient/${pacienteId}` } : {};
  console.log(`Laboratorio en PDF · actualizar · ${pacienteId ? `Patient/${pacienteId}` : 'todo el proyecto'} · ${baseUrl}`);

  const defs = await todos<ObservationDefinition>(medplum, 'ObservationDefinition', {});
  const catalogoDesde = await catalogoVigenteDesde(medplum, defs);
  if (!catalogoDesde) {
    console.error('El servidor todavía no publica el catálogo vigente (falta la definición del eGFR): corré npm run seed.');
    process.exitCode = 1;
    return;
  }
  const catalogo = catalogoDesdeObservationDefinitions(defs);

  const informes = (
    await todos<DiagnosticReport>(medplum, 'DiagnosticReport', { ...delPaciente, code: `http://loinc.org|${LOINC_INFORME_LABORATORIO}` })
  ).filter((d) => d.status !== 'entered-in-error');
  const documentos = await todos<DocumentReference>(medplum, 'DocumentReference', {
    ...delPaciente,
    category: `${SYSTEM.documento}|${COD.resultadoLaboratorio}`,
  });
  const idsObs = [...new Set(informes.flatMap((d) => (d.result ?? []).map((r) => r.reference?.split('/')[1]).filter(Boolean) as string[]))];
  const obsPorId = new Map((await porId<Observation>(medplum, 'Observation', idsObs)).map((o) => [o.id, o]));
  const idsPacientes = [...new Set(informes.map((d) => d.subject?.reference?.split('/')[1]).filter(Boolean) as string[])];
  const pacientes = new Map((await porId<Patient>(medplum, 'Patient', idsPacientes)).map((p) => [`Patient/${p.id}`, p]));

  const conValores: InformeConValores[] = informes.map((informe) => ({
    informe,
    observaciones: (informe.result ?? [])
      .map((r) => obsPorId.get(r.reference?.split('/')[1]))
      .filter((o): o is Observation => Boolean(o)),
  }));
  console.log(
    `  ${informes.length} informe(s) de laboratorio, ${documentos.length} PDF(s), ${pacientes.size} paciente(s). ` +
      `Catálogo vigente desde el ${fechaHoraAR(catalogoDesde)}.`,
  );

  const plan = planActualizacion({ informes: conValores, documentos, pacientes, catalogo, catalogoDesde });
  imprimirPlan(plan);
  const cambios = plan.duplicados.length + plan.relecturas.length + plan.egfr.length;
  if (cambios === 0) {
    console.log('\n✓ No hay nada para actualizar.');
    return;
  }
  if (!apply) {
    console.log(
      `\n[dry-run] No se escribió nada.${plan.relecturas.length ? ` Las ${plan.relecturas.length} relectura(s) son una lectura de Claude cada una (≈ US$ 0,10–0,20 por PDF; quedan en npm run uso:ia).` : ''}\n` +
        `Para aplicarlo: npm run laboratorio:actualizar --${pacienteId ? ` ${pacienteId}` : ''} --apply`,
    );
    return;
  }

  let fallas = 0;
  let docs = documentos;
  if (plan.duplicados.length) {
    console.log('\n→ Duplicados');
    for (const d of plan.duplicados) {
      const religados = await aplicarDuplicado(medplum, d, docs);
      docs = docs.map((x) => religados.find((r) => r.id === x.id) ?? x);
      console.log(`  ✓ DiagnosticReport/${d.duplicado.informe.id} → entered-in-error (${religados.length} PDF ligado(s) al original)`);
    }
  }
  if (plan.relecturas.length) {
    const bot = await medplum.searchOne('Bot', { 'name:exact': BOT_SOM_LABORATORIO });
    if (!bot?.id) {
      console.error(`  ✗ No existe el bot ${BOT_SOM_LABORATORIO} en ${baseUrl}: npm run deploy:bots. Se saltean las relecturas.`);
      fallas += plan.relecturas.length;
    } else {
      console.log('\n→ Relecturas');
      for (const r of plan.relecturas) {
        const doc = docs.find((d) => d.id === r.documento.id) ?? r.documento;
        console.log(`  · DocumentReference/${doc.id}`);
        const texto = await releer(medplum, bot.id, doc);
        fallas += texto.startsWith('✓') ? 0 : 1;
        console.log(`    ${texto}`);
      }
    }
  }
  if (plan.egfr.length) {
    console.log('\n→ eGFR');
    for (const e of plan.egfr) {
      const o = await aplicarEgfr(medplum, e);
      console.log(`  ✓ Observation/${o.id}: eGFR ${o.valueQuantity?.value} en DiagnosticReport/${e.informe.informe.id}`);
    }
  }
  console.log(
    fallas
      ? `\n${fallas} cambio(s) sin aplicar: el motivo está arriba.`
      : `\n✓ Listo. Los informes y valores reemplazados quedan en el historial como entered-in-error.${plan.sinDatos.length ? ' Para los de "Sin datos", completá la fecha de nacimiento o el sexo del paciente y volvé a correrlo.' : ''}`,
  );
  if (fallas) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Actualizar laboratorio: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
