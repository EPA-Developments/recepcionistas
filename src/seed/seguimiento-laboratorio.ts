/**
 * Seguimiento de la prueba del laboratorio en PDF, de punta a punta, para un paciente.
 *
 *   npm run laboratorio:seguimiento -- <id del paciente> [id del DocumentReference]
 *
 * Toma el último PDF de laboratorio que mandó el paciente desde el portal (o el indicado) y
 * muestra la cadena paso a paso: consentimiento, bot, Subscription, secret, el envío, las
 * ejecuciones del bot, el uso de IA y el resultado (informe o tarea para el equipo), con el
 * arreglo de lo que falle. SOLO LECTURA: no escribe nada. Ver docs/som.md → Laboratorio en PDF.
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import type { AuditEvent, Communication, DiagnosticReport, DocumentReference, Patient, Task } from '@medplum/fhirtypes';
import { BOT_SOM_LABORATORIO, COD, LOINC_CONSENTIMIENTO, SYSTEM } from '../fhir/identifiers.js';
import { CRITERIO_SUBSCRIPTION_LABORATORIO, informeYaGenerado } from '../lib/laboratorio.js';
import { envioDe, pasosSeguimientoLaboratorio } from '../lib/seguimiento-laboratorio.js';
import { marcaPaso } from '../lib/seguimiento-whatsapp.js';
import { TIPO_USO_IA } from '../lib/uso-ia.js';
import { conectarMedplum } from './conexion.js';

const USO = 'Uso: npm run laboratorio:seguimiento -- <id del paciente> [id del DocumentReference]';

/** "Patient/abc" o "abc" → "abc". */
const soloId = (valor: string | undefined, tipo: string): string | undefined => valor?.trim().replace(new RegExp(`^${tipo}/`), '') || undefined;

async function leerSecretClaude(medplum: MedplumClient, projectId: string): Promise<boolean | undefined> {
  try {
    const project = await medplum.readResource('Project', projectId);
    // Sólo los nombres: los valores no se leen ni se imprimen.
    return (project.secret ?? []).some((s) => s.name === 'ANTHROPIC_API_KEY');
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const pacienteId = soloId(process.argv[2], 'Patient');
  const documentoId = soloId(process.argv[3], 'DocumentReference');
  if (!pacienteId) {
    console.error(USO);
    process.exitCode = 1;
    return;
  }
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  const pacienteRef = `Patient/${pacienteId}`;
  const paciente = await medplum.readResource('Patient', pacienteId).catch(() => undefined as Patient | undefined);
  if (!paciente) {
    console.error(`No existe ${pacienteRef} en ${baseUrl}.`);
    process.exitCode = 1;
    return;
  }

  const documentos = await medplum.searchResources('DocumentReference', {
    subject: pacienteRef,
    category: `${SYSTEM.documento}|${COD.resultadoLaboratorio}`,
    _sort: '-date',
    _count: '50',
  });
  const documento = documentoId ? documentos.find((d) => d.id === documentoId) : documentos[0];
  if (documentoId && !documento) {
    console.error(`DocumentReference/${documentoId} no es un PDF de laboratorio de ${pacienteRef}.`);
    process.exitCode = 1;
    return;
  }
  const documentoRef = documento ? `DocumentReference/${documento.id}` : undefined;

  const consentimiento = Boolean(
    await medplum.searchOne('DocumentReference', {
      subject: pacienteRef,
      type: `http://loinc.org|${LOINC_CONSENTIMIENTO}`,
      status: 'current',
    }),
  );
  const bot = await medplum.searchOne('Bot', { 'name:exact': BOT_SOM_LABORATORIO });
  const subscriptions = await medplum.searchResources('Subscription', { _count: '200' });
  const subscriptionActiva = Boolean(
    bot?.id &&
      subscriptions.some(
        (s) => s.criteria === CRITERIO_SUBSCRIPTION_LABORATORIO && s.channel?.endpoint === `Bot/${bot.id}` && s.status === 'active',
      ),
  );
  const secretClaude = await leerSecretClaude(medplum, projectId);

  let ejecuciones: AuditEvent[] = [];
  let usoIa: AuditEvent[] = [];
  let informe: DiagnosticReport | undefined;
  let tarea: Task | undefined;
  let aviso: Communication | undefined;
  if (documento && documentoRef) {
    const envio = envioDe(documento);
    if (bot?.id && envio) {
      const desde = new Date(new Date(envio).getTime() - 60_000).toISOString();
      ejecuciones = await medplum
        .searchResources('AuditEvent', { entity: `Bot/${bot.id}`, _lastUpdated: `ge${desde}`, _count: '200' })
        .catch(() => []);
    }
    usoIa = await medplum
      .searchResources('AuditEvent', { type: `${SYSTEM.usoIa}|${TIPO_USO_IA.code}`, entity: documentoRef, _count: '20' })
      .catch(() => []);
    const informeRef = informeYaGenerado(documento);
    if (informeRef) {
      informe = await medplum.readReference<DiagnosticReport>({ reference: informeRef }).catch(() => undefined);
    }
    tarea = (await medplum.searchResources('Task', { focus: documentoRef, _count: '20' })).find((t) =>
      t.code?.coding?.some((c) => c.system === SYSTEM.taskTipo && c.code === COD.revisarLaboratorio),
    );
    aviso = (await medplum.searchResources('Communication', { subject: pacienteRef, _sort: '-sent', _count: '50' })).find((c) =>
      c.about?.some((a) => a.reference === documentoRef),
    );
  }

  const pasos = pasosSeguimientoLaboratorio({
    paciente,
    consentimiento,
    ...(documento ? { documento } : {}),
    documentosEnviados: documentos.length,
    ...(bot?.id ? { botId: bot.id } : {}),
    subscriptionActiva,
    ...(secretClaude === undefined ? {} : { secretClaude }),
    ejecuciones,
    usoIa,
    ...(informe ? { informe } : {}),
    ...(tarea ? { tarea } : {}),
    ...(aviso ? { aviso } : {}),
    ahora: new Date(),
  });

  console.log(`Laboratorio en PDF · seguimiento · ${baseUrl}`);
  pasos.forEach((p, i) => console.log(`  ${i + 1}. ${marcaPaso(p.estado)} ${p.titulo}\n       ${p.detalle}`));
  const fallas = pasos.filter((p) => p.estado === 'falla').length;
  const pendientes = pasos.filter((p) => p.estado === 'pendiente').length;
  console.log(
    fallas
      ? `\n✗ ${fallas} paso(s) con falla: arreglalos en orden y volvé a correr esto.`
      : pendientes
        ? `\n· Sin fallas; ${pendientes} paso(s) pendiente(s).`
        : '\n✓ La cadena completa funcionó.',
  );
  if (fallas) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Seguimiento del laboratorio: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
