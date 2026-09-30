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
 *  6) Si no se puede leer: mensaje al paciente (Communication) y Task al equipo, con el
 *     motivo concreto (descarga, archivo que no es PDF, falla de la API, sin valores). Al
 *     reprocesarlo con éxito, esa tarea se cierra sola.
 *  7) Cada llamada a Claude deja su uso (tokens y costo estimado) en un AuditEvent
 *     `uso-ia` ligado al documento, sirva o no la respuesta (`src/lib/uso-ia.ts`).
 *
 * Idempotente: si el documento ya tiene su DiagnosticReport, no reprocesa. Para
 * reprocesar a mano, ejecutar el bot con el DocumentReference como entrada.
 * La lógica testeable vive en `src/lib/laboratorio.ts`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication, DiagnosticReport, DocumentReference, Observation, Task } from '@medplum/fhirtypes';
import {
  BOT_SOM_LABORATORIO,
  COD,
  ESFUERZO_CLAUDE_LABORATORIO,
  MODELO_CLAUDE_LABORATORIO,
  SYSTEM,
} from '../fhir/identifiers.js';
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
  esRevisionLaboratorio,
  esUrlExterna,
  informeYaGenerado,
  motivoSinResultados,
  normalizarExtraccion,
  pareceUnPdf,
  relatedConInforme,
  type EntradaCatalogo,
  type ExtraccionLaboratorio,
} from '../lib/laboratorio.js';
import { PROCESO_IA, registrarUsoIa, usoDeRespuesta, type UsoIa } from '../lib/uso-ia.js';
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
  const lectura = pdf ? await leerPdf(medplum, pdf.url, pdf.data) : { motivo: 'no se encontró el PDF en el documento' };
  if ('motivo' in lectura) {
    return derivarAlEquipo(medplum, pacienteRef, documentoRef, lectura.motivo);
  }
  const { base64 } = lectura;

  // 3) Claude transcribe; el catálogo del servidor define los códigos.
  const claude = clienteClaude(event.secrets);
  if (!claude) {
    console.warn('som-procesar-laboratorio: falta ANTHROPIC_API_KEY.');
    return derivarAlEquipo(medplum, pacienteRef, documentoRef, 'procesamiento automático no configurado');
  }
  const defs = await medplum.searchResources('ObservationDefinition', '_count=1000').catch(() => []);
  const catalogo = catalogoDesdeObservationDefinitions(defs);
  const { extraccion, uso, motivo } = await extraer(claude, base64, catalogo);
  const legible = Boolean(extraccion?.esInformeDeLaboratorio && extraccion.analitos.length > 0);
  if (uso) {
    await registrarUsoIa(medplum, {
      proceso: PROCESO_IA.laboratorioPdf,
      uso,
      bot: event.bot,
      botNombre: BOT_SOM_LABORATORIO,
      origen: documentoRef,
      ok: legible,
      motivo: motivo ?? motivoSinResultados(extraccion),
      esfuerzo: ESFUERZO_CLAUDE_LABORATORIO,
    });
  }
  if (!extraccion || !legible) {
    return derivarAlEquipo(medplum, pacienteRef, documentoRef, motivo ?? motivoSinResultados(extraccion));
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
  // Si antes había pasado al equipo (esto es un reproceso), esa revisión ya no hace falta.
  await cerrarRevisionesPendientes(medplum, documentoRef);

  return { ok: true, diagnosticReportId: informe.id, observaciones: observaciones.length };
}

const TAREA_ABIERTA: ReadonlySet<Task['status']> = new Set(['draft', 'requested', 'received', 'accepted', 'ready', 'in-progress', 'on-hold']);

/** Las tareas "revisar-laboratorio" todavía abiertas del documento. */
async function revisionesAbiertas(medplum: MedplumClient, documentoRef: string): Promise<Task[]> {
  const tareas = await medplum.searchResources('Task', { focus: documentoRef, _count: '20' }).catch(() => [] as Task[]);
  return tareas.filter((t) => TAREA_ABIERTA.has(t.status) && esRevisionLaboratorio(t));
}

/** Cierra las tareas "revisar-laboratorio" abiertas del documento (ya quedó procesado). */
async function cerrarRevisionesPendientes(medplum: MedplumClient, documentoRef: string): Promise<void> {
  for (const t of await revisionesAbiertas(medplum, documentoRef)) {
    await medplum
      .updateResource<Task>({ ...t, status: 'completed', businessStatus: { text: 'Procesado automáticamente al reprocesar el PDF' } })
      .catch((err: unknown) =>
        console.error(`som-procesar-laboratorio: no se pudo cerrar Task/${t.id}:`, err instanceof Error ? err.message : err),
      );
  }
}

/**
 * El PDF en base64: embebido (`data`) o descargado (`url`). El link firmado del
 * almacenamiento (S3) se baja con `fetch` SIN el token: S3 rechaza el pedido que trae su
 * firma y además `Authorization`, y `medplum.download` agrega el token siempre y no mira el
 * estado HTTP (devolvía la página de error de S3 como si fuera el PDF). Se verifica que lo
 * bajado sea un PDF antes de mandarlo a Claude.
 */
async function leerPdf(medplum: MedplumClient, url?: string, data?: string): Promise<{ base64: string } | { motivo: string }> {
  if (data) {
    return pareceUnPdf(Buffer.from(data, 'base64')) ? { base64: data } : { motivo: 'el archivo adjunto no es un PDF' };
  }
  if (!url) {
    return { motivo: 'no se encontró el PDF en el documento' };
  }
  let bytes: Buffer;
  try {
    if (esUrlExterna(url, medplum.getBaseUrl())) {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`som-procesar-laboratorio: el almacenamiento respondió HTTP ${res.status} al bajar el PDF.`);
        return { motivo: `no se pudo descargar el PDF (HTTP ${res.status})` };
      }
      bytes = Buffer.from(await res.arrayBuffer());
    } else {
      bytes = Buffer.from(await (await medplum.download(url)).arrayBuffer());
    }
  } catch (err) {
    console.error('som-procesar-laboratorio: no se pudo descargar el PDF:', err instanceof Error ? err.message : err);
    return { motivo: 'no se pudo descargar el PDF' };
  }
  if (!pareceUnPdf(bytes)) {
    console.error(`som-procesar-laboratorio: lo descargado no es un PDF (${bytes.length} bytes).`);
    return { motivo: 'el archivo descargado no es un PDF' };
  }
  return { base64: bytes.toString('base64') };
}

interface Transcripcion {
  extraccion?: ExtraccionLaboratorio;
  /** Tokens y costo de la llamada (falta solo si la llamada falló sin respuesta). */
  uso?: UsoIa;
  /** Por qué la respuesta no sirve (negativa, corte por largo, JSON ilegible). */
  motivo?: string;
}

/** Claude transcribe el informe con salida estructurada; sin `extraccion` si no pudo. */
async function extraer(
  claude: NonNullable<ReturnType<typeof clienteClaude>>,
  base64: string,
  catalogo: EntradaCatalogo[],
): Promise<Transcripcion> {
  const resp = await claude.beta.messages
    .create({
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
      output_config: { effort: ESFUERZO_CLAUDE_LABORATORIO, format: { type: 'json_schema', schema: ESQUEMA_EXTRACCION } },
    })
    .catch((err: unknown) => {
      console.error('som-procesar-laboratorio: error de extracción:', err instanceof Error ? err.message : err);
      return err instanceof Anthropic.APIError ? err : undefined;
    });
  if (!resp || resp instanceof Anthropic.APIError) {
    return { motivo: `falló la llamada a Claude${resp?.status ? ` (HTTP ${resp.status})` : ''}` };
  }
  const uso = usoDeRespuesta(resp, MODELO_CLAUDE_LABORATORIO);
  if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') {
    console.error('som-procesar-laboratorio: extracción incompleta:', resp.stop_reason);
    return { uso, motivo: resp.stop_reason };
  }
  try {
    return { uso, extraccion: normalizarExtraccion(JSON.parse(textoRespuesta(resp.content)), catalogo) };
  } catch (err) {
    console.error('som-procesar-laboratorio: respuesta ilegible:', err instanceof Error ? err.message : err);
    return { uso, motivo: 'respuesta ilegible' };
  }
}

/**
 * No se pudo procesar: mensaje al paciente (lo ve en Mensajes del portal) y tarea al
 * equipo para revisarlo a mano. Si ya tenía una revisión abierta (un reproceso que vuelve
 * a fallar), solo se actualiza su motivo: ni tarea duplicada ni otro aviso al paciente. El documento queda "En proceso" hasta que el equipo
 * lo resuelva (p. ej. reejecutando este bot con el DocumentReference).
 */
async function derivarAlEquipo(
  medplum: MedplumClient,
  pacienteRef: string,
  documentoRef: string,
  motivo: string,
): Promise<ResultadoLaboratorio> {
  const resultado: ResultadoLaboratorio = { ok: false, derivadoAlEquipo: true, mensaje: `No se pudo procesar automáticamente: ${motivo}.` };
  const descripcion = `Revisar a mano un PDF de laboratorio del paciente (${motivo}).`;
  const [abierta] = await revisionesAbiertas(medplum, documentoRef);
  if (abierta) {
    await medplum.updateResource<Task>({ ...abierta, description: descripcion });
    return resultado;
  }
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
    description: descripcion,
  });
  return resultado;
}
