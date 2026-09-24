/**
 * Bot interno · som-procesar-laboratorio — procesa el PDF de laboratorio que manda
 * el paciente desde el portal ("Enviar estudios en PDF").
 *
 * Lo dispara una `Subscription` (solo en *create*) sobre
 *   DocumentReference?category=…/CodeSystem/documento|resultado-laboratorio
 * (ver `deploy-bots.ts`). El paciente no lo ejecuta (no está en su AccessPolicy) y
 * `runAsUser` va DESACTIVADO: el bot escribe con su propia identidad (el paciente
 * tiene `DiagnosticReport` de solo lectura).
 *
 * Pipeline (contrato con el portal, `bot-som-interface.md` §3):
 *  1) Precondición: consentimiento informado firmado; sin él no se procesa nada ni
 *     se envía nada al LLM.
 *  2) Lee el PDF (`url` → Binary, o `data` embebido en base64).
 *  3) Claude transcribe los analitos (salida estructurada); los códigos salen del
 *     catálogo de ObservationDefinition del servidor (LOINC / `biomarker`).
 *  4) Crea una Observation por analito y el DiagnosticReport (LAB, LOINC 11502-2).
 *  5) Cierra el circuito: suma el DiagnosticReport a `context.related` del documento
 *     (el portal pasa de "En proceso" a "Ver resultados").
 *  6) Si no se puede leer: mensaje al paciente (Communication) y Task al equipo.
 *
 * Idempotente: si el documento ya tiene su DiagnosticReport, no reprocesa. Para
 * reprocesar a mano, ejecutar el bot con el DocumentReference como entrada.
 * La lógica testeable vive en `src/lib/laboratorio.ts`.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication, DiagnosticReport, DocumentReference, Observation, Task } from '@medplum/fhirtypes';
import { COD, MODELO_CLAUDE_LABORATORIO, SYSTEM } from '../fhir/identifiers.js';
import {
  ESQUEMA_EXTRACCION,
  MENSAJE_NO_PROCESADO,
  SYSTEM_PROMPT_LABORATORIO,
  adjuntoPdf,
  catalogoDesdeObservationDefinitions,
  construirDiagnosticReportLaboratorio,
  construirObservaciones,
  construirPromptLaboratorio,
  esDocumentoLaboratorio,
  informeYaGenerado,
  normalizarExtraccion,
  relatedConInforme,
  type EntradaCatalogo,
  type ExtraccionLaboratorio,
} from '../lib/laboratorio.js';
import { clienteClaude, textoRespuesta } from './_claude.js';
import { tieneConsentimiento } from './_shared.js';

export interface ResultadoLaboratorio {
  ok: boolean;
  mensaje?: string;
  diagnosticReportId?: string;
  observaciones?: number;
  /** true si no se pudo procesar y quedó derivado al equipo (Task + mensaje al paciente). */
  derivadoAlEquipo?: boolean;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<DocumentReference>,
): Promise<ResultadoLaboratorio> {
  const entrada = event.input;
  if (entrada?.resourceType !== 'DocumentReference' || !entrada.id) {
    return { ok: false, mensaje: 'Entrada inválida: se esperaba un DocumentReference.' };
  }
  // Versión vigente del servidor (la Subscription manda la del momento del create).
  const doc = await medplum.readResource('DocumentReference', entrada.id);
  if (!esDocumentoLaboratorio(doc)) {
    return { ok: false, mensaje: 'El documento no es un resultado de laboratorio del portal.' };
  }
  const previo = informeYaGenerado(doc);
  if (previo) {
    return { ok: true, mensaje: 'El estudio ya estaba procesado.', diagnosticReportId: previo.split('/')[1] };
  }
  const pacienteRef = doc.subject?.reference;
  if (!pacienteRef?.startsWith('Patient/')) {
    return { ok: false, mensaje: 'El documento no tiene paciente.' };
  }
  const documentoRef = `DocumentReference/${doc.id}`;

  // 1) Sin consentimiento informado no se procesa ni se envía nada al LLM.
  if (!(await tieneConsentimiento(medplum, pacienteRef))) {
    console.warn('som-procesar-laboratorio: el paciente no firmó el consentimiento; no se procesa.');
    return { ok: false, mensaje: 'El paciente no firmó el consentimiento informado.' };
  }

  // 2) El PDF.
  const pdf = adjuntoPdf(doc);
  const base64 = pdf ? await leerPdfBase64(medplum, pdf.url, pdf.data) : undefined;
  if (!base64) {
    return derivarAlEquipo(medplum, pacienteRef, documentoRef, 'no se encontró el PDF en el documento');
  }

  // 3) Claude transcribe; el catálogo del servidor define los códigos.
  const claude = clienteClaude(event.secrets);
  if (!claude) {
    console.warn('som-procesar-laboratorio: falta ANTHROPIC_API_KEY.');
    return derivarAlEquipo(medplum, pacienteRef, documentoRef, 'procesamiento automático no configurado');
  }
  const defs = await medplum.searchResources('ObservationDefinition', '_count=1000').catch(() => []);
  const catalogo = catalogoDesdeObservationDefinitions(defs);
  const extraccion = await extraer(claude, base64, catalogo);
  if (!extraccion?.esInformeDeLaboratorio || extraccion.analitos.length === 0) {
    return derivarAlEquipo(medplum, pacienteRef, documentoRef, 'no se pudieron leer resultados en el PDF');
  }

  // 4) Observations + DiagnosticReport.
  const refs = { pacienteRef, documentoRef, fechaRespaldo: (doc.date ?? new Date().toISOString()).slice(0, 10), pdf };
  const observaciones: Observation[] = [];
  for (const o of construirObservaciones(extraccion, catalogo, refs)) {
    observaciones.push(await medplum.createResource<Observation>(o));
  }
  const informe = await medplum.createResource<DiagnosticReport>(
    construirDiagnosticReportLaboratorio(
      extraccion,
      observaciones.map((o) => `Observation/${o.id}`),
      refs,
    ),
  );

  // 5) Cerrar el circuito en el documento (el portal muestra "Ver resultados").
  await medplum.updateResource<DocumentReference>({ ...doc, context: relatedConInforme(doc, `DiagnosticReport/${informe.id}`) });

  return { ok: true, diagnosticReportId: informe.id, observaciones: observaciones.length };
}

/** El PDF en base64: embebido (`data`) o descargado del Binary (`url`). */
async function leerPdfBase64(medplum: MedplumClient, url?: string, data?: string): Promise<string | undefined> {
  if (data) {
    return data;
  }
  if (!url) {
    return undefined;
  }
  try {
    const blob = await medplum.download(url);
    return Buffer.from(await blob.arrayBuffer()).toString('base64');
  } catch (err) {
    console.error('som-procesar-laboratorio: no se pudo descargar el PDF:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** Claude transcribe el informe con salida estructurada; undefined si no pudo. */
async function extraer(
  claude: NonNullable<ReturnType<typeof clienteClaude>>,
  base64: string,
  catalogo: EntradaCatalogo[],
): Promise<ExtraccionLaboratorio | undefined> {
  try {
    const resp = await claude.beta.messages.create({
      model: MODELO_CLAUDE_LABORATORIO,
      max_tokens: 16000,
      // Si el modelo declina, el servidor reintenta con el modelo de respaldo recomendado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT_LABORATORIO,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: construirPromptLaboratorio(catalogo) },
          ],
        },
      ],
      output_config: { format: { type: 'json_schema', schema: ESQUEMA_EXTRACCION } },
    });
    if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') {
      console.error('som-procesar-laboratorio: extracción incompleta:', resp.stop_reason);
      return undefined;
    }
    return normalizarExtraccion(JSON.parse(textoRespuesta(resp.content)), catalogo);
  } catch (err) {
    console.error('som-procesar-laboratorio: error de extracción:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * No se pudo procesar: mensaje al paciente (lo ve en Mensajes del portal) y tarea al
 * equipo para revisarlo a mano. El documento queda "En proceso" hasta que el equipo
 * lo resuelva (p. ej. reejecutando este bot con el DocumentReference).
 */
async function derivarAlEquipo(
  medplum: MedplumClient,
  pacienteRef: string,
  documentoRef: string,
  motivo: string,
): Promise<ResultadoLaboratorio> {
  await medplum.createResource<Communication>({
    resourceType: 'Communication',
    status: 'in-progress',
    sent: new Date().toISOString(),
    topic: { text: 'Tu estudio de laboratorio' },
    subject: { reference: pacienteRef },
    recipient: [{ reference: pacienteRef }],
    about: [{ reference: documentoRef }],
    payload: [{ contentString: MENSAJE_NO_PROCESADO }],
  });
  await medplum.createResource<Task>({
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    authoredOn: new Date().toISOString(),
    code: { coding: [{ system: SYSTEM.taskTipo, code: COD.revisarLaboratorio }], text: 'Revisar estudio de laboratorio' },
    for: { reference: pacienteRef },
    focus: { reference: documentoRef },
    description: `Revisar a mano un PDF de laboratorio del paciente (${motivo}).`,
  });
  return { ok: false, derivadoAlEquipo: true, mensaje: `No se pudo procesar automáticamente: ${motivo}.` };
}
