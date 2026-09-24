/**
 * Bot interno · Informe de Segunda Opinión Médica (SOM).
 *
 * Lo dispara una `Subscription` sobre
 *   ServiceRequest?status=active&code=…som-services|som-cardiology
 * (ver `deploy-bots.ts`, que crea/asegura esa Subscription apuntando a este bot).
 *
 * Pipeline:
 *  1) Lee la ServiceRequest y reúne el contexto clínico del paciente
 *     (Patient, Condition, Observation, MedicationRequest, DocumentReference).
 *  2) Calcula PREVENT (AHA 2023) → crea un `RiskAssessment`.
 *  3) Llama a Claude (`claude-sonnet-4-6`, secret `ANTHROPIC_API_KEY`) para
 *     redactar las 6 secciones del informe — solo si el paciente firmó el
 *     consentimiento informado (sin él, ningún dato clínico sale hacia el LLM).
 *  4) Genera un PDF → `Binary` → `DocumentReference` (LOINC 11488-4).
 *  5) Crea el `DiagnosticReport` final (secciones en la extensión `som-sections`).
 *  6) Pasa la ServiceRequest a `completed` y notifica al paciente.
 *
 * Idempotente: si la ServiceRequest ya tiene un DiagnosticReport asociado, no hace
 * nada. Toda la lógica testeable vive en `src/lib/som-report.ts` y `prevent.ts`.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type {
  Condition,
  DiagnosticReport,
  DocumentReference,
  MedicationRequest,
  Observation,
  Patient,
  ServiceRequest,
} from '@medplum/fhirtypes';
import { COD, LOINC_INFORME, MODELO_CLAUDE_SOM, SYSTEM } from '../fhir/identifiers.js';
import { calcularPrevent, type EntradaPrevent } from '../lib/prevent.js';
import {
  SYSTEM_PROMPT,
  TITULOS_SECCION,
  construirDiagnosticReport,
  construirPdf,
  construirPromptUsuario,
  construirRiskAssessment,
  parsearSecciones,
  resumenRiesgo,
  type ContextoClinico,
  type Secciones,
} from '../lib/som-report.js';
import { SOM_SECCIONES } from '../fhir/identifiers.js';
import { clienteClaude, textoRespuesta } from './_claude.js';
import { enviarWhatsApp, tieneConsentimiento } from './_shared.js';

export interface ResultadoInforme {
  ok: boolean;
  mensaje?: string;
  diagnosticReportId?: string;
  riskAssessmentId?: string;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<ServiceRequest>,
): Promise<ResultadoInforme> {
  const sr = event.input;
  if (sr?.resourceType !== 'ServiceRequest' || !sr.id) {
    return { ok: false, mensaje: 'Entrada inválida: se esperaba una ServiceRequest.' };
  }

  // Guarda: solo solicitudes SOM activas.
  const esSom = sr.code?.coding?.some((c) => c.system === SYSTEM.somServices && c.code === COD.somCardiology);
  if (!esSom) {
    return { ok: false, mensaje: 'La ServiceRequest no es una solicitud SOM.' };
  }
  const srRef = `ServiceRequest/${sr.id}`;

  // Idempotencia: si ya hay informe para esta solicitud, no reprocesar.
  const previo = await medplum.searchOne('DiagnosticReport', `based-on=${srRef}`);
  if (previo) {
    return { ok: true, mensaje: 'Informe ya generado.', diagnosticReportId: previo.id };
  }

  const pacienteRef = sr.subject?.reference;
  if (!pacienteRef?.startsWith('Patient/')) {
    return { ok: false, mensaje: 'La ServiceRequest no tiene paciente.' };
  }
  const pacienteId = pacienteRef.split('/')[1]!;

  // 1) Contexto clínico.
  const paciente = await medplum.readResource('Patient', pacienteId).catch(() => undefined);
  const condiciones = await medplum.searchResources('Condition', `subject=${pacienteRef}&_count=100`).catch(() => []);
  const observaciones = await medplum.searchResources('Observation', `subject=${pacienteRef}&_count=200`).catch(() => []);
  const medicacion = await medplum.searchResources('MedicationRequest', `subject=${pacienteRef}&_count=100`).catch(() => []);
  const estudios = await cargarEstudios(medplum, sr);

  // 2) PREVENT → RiskAssessment.
  const entrada = construirEntradaPrevent(paciente, condiciones, observaciones, medicacion);
  const prevent = entrada
    ? calcularPrevent(entrada)
    : { predicciones: [], pendienteValidacion: true, faltantes: ['datos insuficientes para PREVENT'] };
  const riskAssessment = await medplum.createResource(
    construirRiskAssessment(prevent, { pacienteRef, serviceRequestRef: srRef }),
  );

  // 3) Claude → secciones.
  const contexto: ContextoClinico = {
    motivo: sr.reasonCode?.[0]?.text,
    paciente: { edad: edadDe(paciente), sexo: paciente?.gender },
    condiciones: condiciones.map(textoCondition),
    observaciones: observaciones.map(textoObservation),
    medicacion: medicacion.map(textoMedication),
    estudios,
    resumenRiesgo: resumenRiesgo(prevent),
  };
  // Sin consentimiento informado firmado no se envía ningún dato clínico al LLM
  // (defensa en profundidad: `som-solicitar` ya lo exige al crear la solicitud).
  const secciones = (await tieneConsentimiento(medplum, pacienteRef))
    ? await redactarSecciones(contexto, event.secrets)
    : seccionesFallback(contexto);

  // 4) PDF → Binary → DocumentReference.
  const docPdf: Array<{ titulo: string; texto: string }> = SOM_SECCIONES.map((clave) => ({
    titulo: TITULOS_SECCION[clave],
    texto: secciones[clave] ?? '—',
  }));
  const pdfBytes = construirPdf('Segunda Opinión Médica — Informe', docPdf);
  let pdfBinaryRef: string | undefined;
  try {
    const binary = await medplum.createBinary(pdfBytes, 'informe-som.pdf', 'application/pdf');
    pdfBinaryRef = `Binary/${binary.id}`;
    await medplum.createResource<DocumentReference>({
      resourceType: 'DocumentReference',
      status: 'current',
      type: { coding: [{ system: 'http://loinc.org', code: LOINC_INFORME, display: 'Consultation note' }], text: 'Informe SOM' },
      subject: { reference: pacienteRef },
      date: new Date().toISOString(),
      content: [{ attachment: { contentType: 'application/pdf', url: pdfBinaryRef, title: 'Informe SOM' } }],
      context: { related: [{ reference: srRef }] },
    });
  } catch (err) {
    console.error('som-report: no se pudo generar el PDF/DocumentReference:', err instanceof Error ? err.message : err);
  }

  // 5) DiagnosticReport final.
  const dr = await medplum.createResource<DiagnosticReport>(
    construirDiagnosticReport({ pacienteRef, serviceRequestRef: srRef, secciones, pdfBinaryRef }),
  );

  // 6) ServiceRequest → completed + aviso al paciente.
  await medplum.updateResource<ServiceRequest>({ ...sr, status: 'completed' });
  await notificar(medplum, event.secrets, pacienteRef, secciones);

  return { ok: true, diagnosticReportId: dr.id, riskAssessmentId: riskAssessment.id };
}

/** DocumentReference de los estudios adjuntos (supportingInfo) como texto. */
async function cargarEstudios(medplum: MedplumClient, sr: ServiceRequest): Promise<string[]> {
  const refs = (sr.supportingInfo ?? [])
    .map((r) => r.reference)
    .filter((r): r is string => Boolean(r) && r!.startsWith('DocumentReference/'));
  const out: string[] = [];
  for (const ref of refs) {
    try {
      const doc = await medplum.readResource('DocumentReference', ref.split('/')[1]!);
      out.push(doc.type?.text ?? doc.description ?? doc.content?.[0]?.attachment?.title ?? ref);
    } catch {
      out.push(ref);
    }
  }
  return out;
}

// ───────────────────────────── extracción de datos ─────────────────────────────

function edadDe(p?: Patient): number | undefined {
  if (!p?.birthDate) {
    return undefined;
  }
  const nac = new Date(p.birthDate);
  if (Number.isNaN(nac.getTime())) {
    return undefined;
  }
  const ms = Date.now() - nac.getTime();
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000));
}

const LOINC = {
  sbp: ['8480-6'],
  colTotal: ['2093-3'],
  hdl: ['2085-9'],
  egfr: ['33914-3', '48642-3', '48643-1', '62238-1', '98979-8'],
  imc: ['39156-5'],
};

function valorObs(obs: Observation[], codigos: string[]): number | undefined {
  // El más reciente con valor numérico para alguno de los códigos LOINC.
  const candidatos = obs
    .filter((o) => o.code?.coding?.some((c) => c.system?.includes('loinc') && codigos.includes(c.code ?? '')))
    .filter((o) => typeof o.valueQuantity?.value === 'number')
    .sort((a, b) => (b.effectiveDateTime ?? '').localeCompare(a.effectiveDateTime ?? ''));
  return candidatos[0]?.valueQuantity?.value;
}

function tieneDiabetes(condiciones: Condition[]): boolean {
  return condiciones.some((c) => /diab/i.test(c.code?.text ?? c.code?.coding?.[0]?.display ?? ''));
}

function esFumador(condiciones: Condition[], obs: Observation[]): boolean {
  if (condiciones.some((c) => /fumad|tabaq|smok|tobacco/i.test(c.code?.text ?? c.code?.coding?.[0]?.display ?? ''))) {
    return true;
  }
  // Estado de tabaquismo (LOINC 72166-2): "current ... smoker".
  return obs.some(
    (o) =>
      o.code?.coding?.some((c) => c.code === '72166-2') &&
      /current|fumador actual|every day|some day/i.test(o.valueCodeableConcept?.text ?? o.valueCodeableConcept?.coding?.[0]?.display ?? ''),
  );
}

function enTratamientoHta(medicacion: MedicationRequest[]): boolean {
  return medicacion.some((m) =>
    /enalapril|losart|valsart|amlodip|ramipril|hidroclorotiaz|atenolol|bisoprolol|telmisart|perindopril|antihipertensiv/i.test(
      m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? '',
    ),
  );
}

function enEstatina(medicacion: MedicationRequest[]): boolean {
  return medicacion.some((m) =>
    /statina|atorvast|rosuvast|simvast|pravast|estatina/i.test(
      m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? '',
    ),
  );
}

/** Arma la entrada de PREVENT si hay datos base suficientes; si no, undefined. */
function construirEntradaPrevent(
  paciente: Patient | undefined,
  condiciones: Condition[],
  obs: Observation[],
  medicacion: MedicationRequest[],
): EntradaPrevent | undefined {
  const edad = edadDe(paciente);
  const sexoRaw = paciente?.gender;
  const sexo = sexoRaw === 'female' || sexoRaw === 'male' ? sexoRaw : undefined;
  const sbp = valorObs(obs, LOINC.sbp);
  const colesterolTotalMgDl = valorObs(obs, LOINC.colTotal);
  const hdlMgDl = valorObs(obs, LOINC.hdl);
  const egfr = valorObs(obs, LOINC.egfr);
  const imc = valorObs(obs, LOINC.imc);

  if (!edad || !sexo || sbp == null || colesterolTotalMgDl == null || hdlMgDl == null || egfr == null) {
    return undefined;
  }
  return {
    sexo,
    edad,
    colesterolTotalMgDl,
    hdlMgDl,
    sbp,
    egfr,
    imc,
    diabetes: tieneDiabetes(condiciones),
    fumador: esFumador(condiciones, obs),
    tratamientoHta: enTratamientoHta(medicacion),
    estatina: enEstatina(medicacion),
  };
}

function textoCondition(c: Condition): string {
  return c.code?.text ?? c.code?.coding?.[0]?.display ?? 'Condición sin descripción';
}
function textoObservation(o: Observation): string {
  const nombre = o.code?.text ?? o.code?.coding?.[0]?.display ?? 'Observación';
  const valor =
    o.valueQuantity != null
      ? `${o.valueQuantity.value ?? ''} ${o.valueQuantity.unit ?? ''}`.trim()
      : o.valueCodeableConcept?.text ?? o.valueString ?? '';
  return valor ? `${nombre}: ${valor}` : nombre;
}
function textoMedication(m: MedicationRequest): string {
  return m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? 'Medicación';
}

// ───────────────────────────── Claude ─────────────────────────────

async function redactarSecciones(
  contexto: ContextoClinico,
  secrets: BotEvent['secrets'],
): Promise<Partial<Secciones>> {
  const claude = clienteClaude(secrets);
  if (!claude) {
    console.warn('som-report: falta ANTHROPIC_API_KEY; se emite el informe sin análisis de Claude.');
    return seccionesFallback(contexto);
  }
  try {
    const resp = await claude.messages.create({
      model: MODELO_CLAUDE_SOM,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: construirPromptUsuario(contexto) }],
    });
    if (resp.stop_reason === 'refusal') {
      console.error('som-report: Claude declinó redactar el informe.');
      return seccionesFallback(contexto);
    }
    const secciones = parsearSecciones(textoRespuesta(resp.content));
    return Object.keys(secciones).length > 0 ? secciones : seccionesFallback(contexto);
  } catch (err) {
    console.error('som-report: error llamando a Claude:', err instanceof Error ? err.message : err);
    return seccionesFallback(contexto);
  }
}

/** Secciones mínimas cuando Claude no está disponible (no deja el informe vacío). */
function seccionesFallback(contexto: ContextoClinico): Partial<Secciones> {
  return {
    'executive-summary':
      'Análisis automático no disponible en este momento. Un cardiólogo revisará la solicitud manualmente.',
    'risk-assessment': contexto.resumenRiesgo,
    'pending-studies': 'Pendiente de revisión médica.',
  };
}

async function notificar(
  medplum: MedplumClient,
  secrets: BotEvent['secrets'],
  pacienteRef: string,
  secciones: Partial<Secciones>,
): Promise<void> {
  const resumen = secciones['executive-summary']?.slice(0, 300) ?? '';
  const cuerpo =
    'Segunda Opinión Médica: tu informe ya está disponible en el portal. ' +
    (resumen ? `\n\nResumen: ${resumen}` : '');
  try {
    // Sin `to`: el aviso (con el resumen clínico) va al teléfono del paciente, nunca
    // al de Recepción — la recepción no ve contenido clínico (privacidad por diseño).
    await enviarWhatsApp(medplum, secrets, {
      template: 'som-informe-listo',
      pacienteRef,
      about: pacienteRef,
      body: cuerpo,
    });
  } catch (err) {
    console.error('som-report: no se pudo notificar al paciente:', err instanceof Error ? err.message : err);
  }
}
