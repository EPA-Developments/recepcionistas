/**
 * Solicitud de Segunda Opinión Médica (SOM) desde el portal del paciente.
 *
 * Modelo análogo al de `solicitudes.ts` (solicitud de turno), pero para SOM: el
 * paciente **pide** una segunda opinión cardiológica adjuntando un cuestionario y
 * sus estudios; el bot `som-solicitar` crea una `ServiceRequest` (status `active`)
 * que dispara —vía Subscription— al bot interno `bot-som-report`.
 *
 * Lógica pura (sin FHIR ni red): valida la entrada y arma el texto. El bot
 * orquesta (crea la `ServiceRequest`). El contrato de entrada lo fija el portal
 * (`drdalessandro/app`, `docs/medplum/bot-som-interface.md`) y NO se negocia.
 */
export interface SolicitudSom {
  /** Paciente que solicita, ej. "Patient/123". */
  pacienteRef: string;
  /** Respuesta del cuestionario clínico, ej. "QuestionnaireResponse/abc". */
  questionnaireResponseRef?: string;
  /** Estudios adjuntos, ej. ["DocumentReference/1", "DocumentReference/2"]. */
  documentReferences?: string[];
  /** Motivo de consulta en texto libre (lo escribe el paciente). */
  motivo?: string;
  /** Origen de la solicitud (de dónde la disparó: web/app/derivación). */
  origin?: string;
}

export interface SolicitudSomValidacion {
  ok: boolean;
  error?: string;
}

const RE_PATIENT_REF = /^Patient\/[A-Za-z0-9\-.]+$/;
const RE_QR_REF = /^QuestionnaireResponse\/[A-Za-z0-9\-.]+$/;
const RE_DOCREF = /^DocumentReference\/[A-Za-z0-9\-.]+$/;
const MAX_MOTIVO = 2000;

/** Valida la solicitud antes de crear la ServiceRequest. No decide nada clínico. */
export function validarSolicitudSom(s: SolicitudSom): SolicitudSomValidacion {
  if (!s.pacienteRef || !RE_PATIENT_REF.test(s.pacienteRef)) {
    return { ok: false, error: 'Falta el paciente de la solicitud.' };
  }
  if (s.questionnaireResponseRef && !RE_QR_REF.test(s.questionnaireResponseRef)) {
    return { ok: false, error: 'La referencia al cuestionario no es válida.' };
  }
  for (const d of s.documentReferences ?? []) {
    if (!RE_DOCREF.test(d)) {
      return { ok: false, error: `Adjunto inválido: ${d}.` };
    }
  }
  if ((s.motivo?.length ?? 0) > MAX_MOTIVO) {
    return { ok: false, error: 'El motivo de consulta es demasiado largo.' };
  }
  // Hace falta al menos algo de contexto clínico: motivo, cuestionario o estudios.
  if (!s.motivo?.trim() && !s.questionnaireResponseRef && (s.documentReferences?.length ?? 0) === 0) {
    return { ok: false, error: 'Contanos tu motivo de consulta o adjuntá tus estudios.' };
  }
  return { ok: true };
}

/** Referencias de `supportingInfo` de la ServiceRequest: cuestionario + estudios. */
export function supportingInfoRefs(s: SolicitudSom): string[] {
  const refs: string[] = [];
  if (s.questionnaireResponseRef) {
    refs.push(s.questionnaireResponseRef);
  }
  for (const d of s.documentReferences ?? []) {
    refs.push(d);
  }
  return refs;
}

/** Resumen humano de la solicitud (para `ServiceRequest.note` / aviso a Recepción). */
export function resumenSolicitudSom(s: SolicitudSom, nombrePaciente?: string): string {
  const quien = nombrePaciente?.trim() || 'Un paciente';
  const adjuntos = s.documentReferences?.length ?? 0;
  const partes = [`${quien} solicitó una segunda opinión cardiológica`];
  if (s.motivo?.trim()) {
    partes.push(`Motivo: ${s.motivo.trim()}`);
  }
  if (adjuntos > 0) {
    partes.push(`Adjuntó ${adjuntos} estudio${adjuntos === 1 ? '' : 's'}`);
  }
  return partes.join('. ') + '.';
}
