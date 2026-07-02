/**
 * Sistemas (URLs canónicas) e identificadores FHIR de Segunda Opinión Médica.
 *
 * Convención: kebab-case para los nombres de extensión, bajo el namespace
 * `https://segundaopinionmedica.org/fhir/...`. Centralizado acá para que el seed, los
 * bots y los tests usen exactamente los mismos strings.
 */

const BASE = 'https://segundaopinionmedica.org/fhir';

/**
 * Namespace de Segunda Opinión Médica (SOM). El proyecto SOM corre sobre el MISMO
 * backend FHIR, pero su contrato (bots `som-solicitar` / `bot-som-report` y la
 * AccessPolicy del paciente) usa este namespace propio, acordado con el portal
 * (`drdalessandro/app`, `docs/medplum/bot-som-interface.md`). No tocar estos
 * strings sin sincronizar con el portal.
 */
const SOM_BASE = 'https://segundaopinionmedica.org/fhir';

/** URLs base de StructureDefinition de extensiones custom. */
export const EXT = {
  // Patient
  tipoCliente: `${BASE}/StructureDefinition/tipo-cliente`,
  perfilClinico: `${BASE}/StructureDefinition/perfil-clinico`,
  origenLead: `${BASE}/StructureDefinition/origen-lead`,
  // Practitioner
  splitPorcentaje: `${BASE}/StructureDefinition/split-porcentaje`,
  tipoContrato: `${BASE}/StructureDefinition/tipo-contrato`,
  // Schedule / Slot
  recursoFisico: `${BASE}/StructureDefinition/recurso-fisico`,
  // Appointment
  ocupantes: `${BASE}/StructureDefinition/ocupantes`,
  /** Tipo de ítem del turno (hoy solo "servicio"), para calcular la seña. */
  itemTipo: `${BASE}/StructureDefinition/item-tipo`,
  /** Código de catálogo del ítem del turno. */
  itemCodigo: `${BASE}/StructureDefinition/item-codigo`,
  // ActivityDefinition (catálogo)
  precioUsd: `${BASE}/StructureDefinition/precio-usd`,
  precioArs: `${BASE}/StructureDefinition/precio-ars`,
  reglaPricingRecurso: `${BASE}/StructureDefinition/regla-pricing-recurso`,
  splitSom: `${BASE}/StructureDefinition/split-som`,
  // Invoice / ChargeItem
  montoSplitSom: `${BASE}/StructureDefinition/monto-split-som`,
  tcAplicado: `${BASE}/StructureDefinition/tc-aplicado`,
  /** Marca de que el Invoice es una seña (depósito). */
  esSena: `${BASE}/StructureDefinition/es-sena`,
  /** Medio de pago elegido (efectivo / transferencia / tarjeta / mercadopago). */
  medioPago: `${BASE}/StructureDefinition/medio-pago`,
  // Communication
  canal: `${BASE}/StructureDefinition/canal`,
  templateUsado: `${BASE}/StructureDefinition/template-usado`,
  // Onboarding / invitación al portal
  /** Canal elegido para invitar al paciente al portal (whatsapp / email / qr). */
  canalInvitacion: `${BASE}/StructureDefinition/canal-invitacion`,
  // SOM — Segunda Opinión Médica (contrato con el portal).
  /** Origen de la solicitud SOM (de dónde la disparó el paciente: web/app/etc.). */
  somOrigin: `${SOM_BASE}/StructureDefinition/som-origin`,
  /** Contenedor de las secciones del informe SOM (sub-extensiones por sección). */
  somSections: `${SOM_BASE}/StructureDefinition/som-sections`,
} as const;

/** Sistemas de codificación / identificadores de negocio. */
export const SYSTEM = {
  servicioCodigo: `${BASE}/CodeSystem/servicio`,
  recursoCodigo: `${BASE}/CodeSystem/recurso-fisico`,
  medico: `${BASE}/CodeSystem/medico`,
  /** Identifier de Invoice (para deduplicar señas: manual o por pago MP). */
  invoice: `${BASE}/Identifier/invoice`,
  /** Identifier de Communication (para deduplicar recordatorios automáticos). */
  communication: `${BASE}/Identifier/communication`,
  /** Documento (DNI) del paciente, para deduplicar altas. */
  dni: `${BASE}/Identifier/dni`,
  /** Tag de datos de demostración (se autodestruyen a las 48 h). */
  demo: `${BASE}/demo`,
  config: `${BASE}/Identifier/config`,
  /** Tipo de Task (p. ej. solicitud de turno desde el portal). */
  taskTipo: `${BASE}/CodeSystem/task-tipo`,
  /** CodeSystem de servicios de Segunda Opinión Médica (ServiceRequest.code). */
  somServices: `${SOM_BASE}/CodeSystem/som-services`,
} as const;

/** Códigos de negocio puntuales. */
export const COD = {
  /** Task.code de una solicitud de turno creada desde el portal del paciente. */
  solicitudTurno: 'solicitud-turno',
  /** ServiceRequest.code de una solicitud de segunda opinión cardiológica. */
  somCardiology: 'som-cardiology',
} as const;

/** Claves EXACTAS de las secciones del informe SOM (sub-extensiones de `som-sections`). */
export const SOM_SECCIONES = [
  'executive-summary',
  'risk-assessment',
  'history-analysis',
  'studies-analysis',
  'conclusions',
  'pending-studies',
] as const;
export type SomSeccion = (typeof SOM_SECCIONES)[number];

/** Código LOINC del documento "Consultation note" (informe SOM en PDF). */
export const LOINC_INFORME = '11488-4';

/** Nombres canónicos de los bots SOM (deben coincidir con el portal y el deploy). */
export const BOT_SOM_SOLICITAR = 'som-solicitar';
export const BOT_SOM_REPORT = 'bot-som-report';

/** Clave del recurso de configuración de Tipo de Cambio (Basic). */
export const CONFIG_TC_ID = 'config-tipo-cambio';

/** Moneda de lista del catálogo. */
export const MONEDA_LISTA = 'USD' as const;
