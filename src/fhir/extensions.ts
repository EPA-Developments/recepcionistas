/**
 * StructureDefinitions de las extensiones custom de Segunda Opinión Médica.
 * Se generan a partir de una tabla compacta (url, contexto, tipo de valor).
 * El seed las carga en Medplum para registrar el modelo de datos del Bloque 0.
 */
import type { StructureDefinition, ElementDefinition } from '@medplum/fhirtypes';
import { EXT } from './identifiers.js';

/** Tipo de valor permitido en value[x] de la extensión. */
type TipoValor = 'string' | 'boolean' | 'decimal' | 'integer' | 'code' | 'dateTime' | 'Money';

interface SpecExtension {
  url: string;
  nombre: string;
  /** Recursos FHIR donde aplica (context.expression). */
  contexto: string[];
  tipoValor: TipoValor;
  descripcion: string;
}

const SPECS: SpecExtension[] = [
  // Patient
  { url: EXT.tipoCliente, nombre: 'tipo-cliente', contexto: ['Patient'], tipoValor: 'code', descripcion: 'Tipo de cliente (público, etc.).' },
  { url: EXT.perfilClinico, nombre: 'perfil-clinico', contexto: ['Patient', 'CarePlan'], tipoValor: 'code', descripcion: 'Perfil clínico.' },
  { url: EXT.origenLead, nombre: 'origen-lead', contexto: ['Patient'], tipoValor: 'string', descripcion: 'Origen del lead para el CRM (red social / utm_source: instagram, facebook, …).' },
  { url: EXT.perfilInteres, nombre: 'perfil-interes', contexto: ['Patient'], tipoValor: 'code', descripcion: 'Perfil de interés comercial (segmentación del CRM).' },
  { url: EXT.cicloVidaCliente, nombre: 'ciclo-vida-cliente', contexto: ['Patient'], tipoValor: 'code', descripcion: 'Etapa del embudo del CRM (lead, contactado, paciente, …).' },
  // Practitioner
  { url: EXT.splitPorcentaje, nombre: 'split-porcentaje', contexto: ['Practitioner'], tipoValor: 'decimal', descripcion: 'Porcentaje de split del profesional.' },
  { url: EXT.tipoContrato, nombre: 'tipo-contrato', contexto: ['Practitioner'], tipoValor: 'code', descripcion: 'Tipo de contrato del profesional.' },
  // Schedule / Slot
  { url: EXT.recursoFisico, nombre: 'recurso-fisico', contexto: ['Schedule', 'Slot'], tipoValor: 'string', descripcion: 'Código del recurso físico al que pertenece la franja.' },
  // Appointment
  { url: EXT.ocupantes, nombre: 'ocupantes', contexto: ['Appointment'], tipoValor: 'integer', descripcion: 'Cantidad de ocupantes.' },
  // ActivityDefinition (catálogo)
  { url: EXT.precioUsd, nombre: 'precio-usd', contexto: ['ActivityDefinition'], tipoValor: 'decimal', descripcion: 'Precio de lista en USD.' },
  { url: EXT.reglaPricingRecurso, nombre: 'regla-pricing-recurso', contexto: ['ActivityDefinition'], tipoValor: 'code', descripcion: 'Regla de pricing del recurso.' },
  { url: EXT.splitSom, nombre: 'split-som', contexto: ['ActivityDefinition'], tipoValor: 'code', descripcion: 'Tipo de split de ingresos.' },
  // Invoice / ChargeItem
  { url: EXT.montoSplitSom, nombre: 'monto-split-som', contexto: ['Invoice', 'ChargeItem'], tipoValor: 'Money', descripcion: 'Monto que corresponde a SOM.' },
  { url: EXT.tcAplicado, nombre: 'tc-aplicado', contexto: ['Invoice', 'ChargeItem'], tipoValor: 'decimal', descripcion: 'Tipo de cambio aplicado al cobro.' },
  // Communication
  { url: EXT.canal, nombre: 'canal', contexto: ['Communication'], tipoValor: 'code', descripcion: 'Canal de la comunicación (whatsapp/email).' },
  { url: EXT.templateUsado, nombre: 'template-usado', contexto: ['Communication'], tipoValor: 'string', descripcion: 'Template usado para el mensaje.' },
  // SOM — Segunda Opinión Médica
  { url: EXT.somOrigin, nombre: 'som-origin', contexto: ['ServiceRequest'], tipoValor: 'code', descripcion: 'Origen de la solicitud SOM: self (el paciente) | referral (derivación de un colega).' },
  // Estadificación CKM (Guía AHA/ACC/ADA/ASN 2026)
  { url: EXT.ckmStage, nombre: 'ckm-stage', contexto: ['RiskAssessment'], tipoValor: 'code', descripcion: 'Estadío CKM (Guía AHA/ACC/ADA/ASN 2026, Tabla 4): 0 | 1 | 2 | 3 | 4a | 4b.' },
  { url: EXT.ckmStageCompleto, nombre: 'ckm-stage-completo', contexto: ['RiskAssessment'], tipoValor: 'boolean', descripcion: 'false si faltaban datos básicos: el estadío CKM es "al menos" el indicado.' },
  // Patient Journey del portal
  { url: EXT.patientOrigin, nombre: 'patient-origin', contexto: ['Patient'], tipoValor: 'code', descripcion: 'Origen del paciente: reception (invitado por Recepción) | referral (derivado por un colega). Ausente = auto-registrado.' },
  { url: EXT.onboardingCompleted, nombre: 'onboarding-completed', contexto: ['Patient'], tipoValor: 'dateTime', descripcion: 'Fecha en que el paciente completó la Bienvenida/Onboarding del portal (la escribe el portal).' },
];

function buildStructureDefinition(spec: SpecExtension): StructureDefinition {
  const valueElement: ElementDefinition = {
    id: 'Extension.value[x]',
    path: 'Extension.value[x]',
    min: 0,
    max: '1',
    type: [{ code: spec.tipoValor }],
  };
  return {
    resourceType: 'StructureDefinition',
    url: spec.url,
    name: toPascal(spec.nombre),
    title: spec.nombre,
    status: 'active',
    description: spec.descripcion,
    kind: 'complex-type',
    abstract: false,
    type: 'Extension',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Extension',
    derivation: 'constraint',
    context: spec.contexto.map((expression) => ({ type: 'element', expression })),
    differential: {
      element: [
        { id: 'Extension', path: 'Extension', short: spec.descripcion },
        { id: 'Extension.url', path: 'Extension.url', fixedUri: spec.url },
        valueElement,
      ],
    },
  };
}

function toPascal(kebab: string): string {
  return kebab
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

export const EXTENSIONES: StructureDefinition[] = SPECS.map(buildStructureDefinition);
