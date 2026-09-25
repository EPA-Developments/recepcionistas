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
 * (`EPA-Developments/app`, `docs/medplum/bot-som-interface.md`). No tocar estos
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
  // CRM (segmentos / campañas: bots recomputar-segmentos y enviar-campana)
  perfilInteres: `${BASE}/StructureDefinition/perfil-interes`,
  cicloVidaCliente: `${BASE}/StructureDefinition/ciclo-vida-cliente`,
  // SOM — Segunda Opinión Médica (contrato con el portal).
  /** Origen de la solicitud SOM (de dónde la disparó el paciente: web/app/etc.). */
  somOrigin: `${SOM_BASE}/StructureDefinition/som-origin`,
  /** Contenedor de las secciones del informe SOM (sub-extensiones por sección). */
  somSections: `${SOM_BASE}/StructureDefinition/som-sections`,
  // Patient Journey (contrato con el portal, `app/src/fhir/onboarding.ts`)
  /** Origen del paciente (`reception` | `referral`): lo setea el backend al invitar. Ausente = auto-registrado. */
  patientOrigin: `${SOM_BASE}/StructureDefinition/patient-origin`,
  /** Fecha en que el paciente completó la Bienvenida/Onboarding. La escribe el PORTAL: el backend no la toca. */
  onboardingCompleted: `${SOM_BASE}/StructureDefinition/onboarding-completed`,
  // Estadificación CKM (AHA 2023, Ndumele) — en el RiskAssessment del informe SOM.
  /** Estadío CKM: `0` | `1` | `2` | `3` | `4a` | `4b`. */
  ckmStage: `${SOM_BASE}/StructureDefinition/ckm-stage`,
  /** false si faltaban datos básicos: el estadío es "al menos" el indicado. */
  ckmStageCompleto: `${SOM_BASE}/StructureDefinition/ckm-stage-completo`,
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
  // CRM (segmentos / campañas)
  /** Identifier de campaña en cada Communication enviada (tracking). */
  campania: `${BASE}/Identifier/campania`,
  /** Identifier que marca un Group como segmento del CRM. */
  segmento: `${BASE}/Identifier/segmento`,
  categoriaComunicacion: `${BASE}/CodeSystem/categoria-comunicacion`,
  rasgoSegmento: `${BASE}/CodeSystem/rasgo-segmento`,
  cicloVidaCliente: `${BASE}/CodeSystem/ciclo-vida-cliente`,
  gateTerapia: `${BASE}/CodeSystem/gate-terapia`,
  // Programas de seguimiento (GLP-1)
  /**
   * CarePlan.category de los planes de cuidado de SOM. Compartido con la app del
   * paciente (EPA-Developments/app), que ya lo usa para el Plan Bienestar
   * (`plan-bienestar-100`); el seguimiento GLP-1 es `seguimiento-glp1`.
   */
  planCuidado: `${BASE}/CodeSystem/care-plans`,
  /** Identifier de los recursos de un programa GLP-1 (CarePlan, Goal, pedidos, tareas). */
  programaGlp1: `${BASE}/Identifier/programa-glp1`,
  /** Estudios por slug del catálogo de biomarcadores (ServiceRequest.code). */
  biomarcador: `${BASE}/CodeSystem/biomarcador`,
  // Biomarcadores del portal (ObservationDefinition; `app/src/fhir/biomarkers.ts`).
  /** Biomarcadores sin código LOINC del catálogo del portal. No es el `biomarcador` del GLP-1. */
  biomarker: `${SOM_BASE}/CodeSystem/biomarker`,
  /** Panel del portal al que pertenece cada ObservationDefinition (p. ej. `metabolico`). */
  panelBiomarcador: `${SOM_BASE}/CodeSystem/panel-biomarcador`,
  /**
   * Tipo de rango de referencia de la ObservationDefinition. Este backend publica
   * solo `convencional` (salud convencional: AHA/ACC, ADA, KDIGO); nunca `funcional`.
   */
  tipoRango: `${SOM_BASE}/CodeSystem/tipo-rango`,
  // Documentos y consentimientos que manda el paciente desde el portal.
  /** DocumentReference.category de lo que sube el paciente (p. ej. `resultado-laboratorio`). */
  documento: `${SOM_BASE}/CodeSystem/documento`,
  /** Consent.policyRule del procesamiento de datos de salud (Ley 25.326). */
  consentimiento: `${SOM_BASE}/CodeSystem/consentimiento`,
} as const;

/** Códigos de negocio puntuales. */
export const COD = {
  /** Task.code de una solicitud de turno creada desde el portal del paciente. */
  solicitudTurno: 'solicitud-turno',
  /** ServiceRequest.code de una solicitud de segunda opinión cardiológica. */
  somCardiology: 'som-cardiology',
  /** CarePlan.category del programa de seguimiento de tratamiento GLP-1. */
  seguimientoGlp1: 'seguimiento-glp1',
  /** Task del equipo médico: completar la indicación GLP-1 (molécula y titulación). */
  indicacionGlp1: 'indicacion-glp1',
  /** Task de Recepción: agendar un control del programa GLP-1 dentro de su ventana. */
  agendarControlGlp1: 'agendar-control-glp1',
  /** CarePlan.category del Plan Bienestar de 100 días (contrato con el portal). */
  planBienestar100: 'plan-bienestar-100',
  /** DocumentReference.category del PDF de laboratorio que manda el paciente. */
  resultadoLaboratorio: 'resultado-laboratorio',
  /** Task del equipo: revisar a mano un PDF de laboratorio que no se pudo procesar. */
  revisarLaboratorio: 'revisar-laboratorio',
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

/**
 * Código LOINC del consentimiento informado firmado ("Patient Consent"): un
 * DocumentReference `status=current` del paciente. Sin él no se procesa nada
 * clínico ni se envía al LLM (contrato con el portal, `bot-som-interface.md`).
 */
export const LOINC_CONSENTIMIENTO = '59284-0';

/** Código LOINC del informe de laboratorio ("Laboratory report"). */
export const LOINC_INFORME_LABORATORIO = '11502-2';

/**
 * Modelo de Claude que usan los bots SOM (informe y laboratorio). Fijado por el
 * contrato con el portal (`bot-som-interface.md`); cambiarlo en los dos repos.
 */
export const MODELO_CLAUDE_SOM = 'claude-sonnet-4-6';

/**
 * Modelo de Claude que transcribe los PDF de laboratorio (`som-procesar-laboratorio`).
 * El contrato no lo fija: se usa el modelo actual más capaz de la línea Opus, con
 * salida estructurada y respaldo del servidor ante una negativa.
 */
export const MODELO_CLAUDE_LABORATORIO = 'claude-opus-5';

/** Nombres canónicos de los bots SOM (deben coincidir con el portal y el deploy). */
export const BOT_SOM_SOLICITAR = 'som-solicitar';
export const BOT_SOM_REPORT = 'bot-som-report';
/** Interno: procesa el PDF de laboratorio que manda el paciente (lo dispara una Subscription). */
export const BOT_SOM_LABORATORIO = 'som-procesar-laboratorio';
/** Recepción: inscribe al paciente en el Plan Bienestar de 100 días (crea el CarePlan). */
export const BOT_BIENESTAR_INSCRIBIR = 'som-bienestar-inscribir';

/** Programa de seguimiento GLP-1: plantilla (PlanDefinition) y bots. */
export const PLAN_GLP1_URL = `${BASE}/PlanDefinition/seguimiento-glp1`;
export const PLAN_GLP1_VERSION = '1';
/** Recepción: inscribe al paciente (pide la indicación al equipo médico). */
export const BOT_GLP1_INSCRIBIR = 'som-glp1-inscribir';
/** Equipo médico: con la indicación, arma o recalcula el plan. Recepción NO lo ejecuta. */
export const BOT_GLP1_PLAN = 'som-glp1-plan';

/** Clave del recurso de configuración de Tipo de Cambio (Basic). */
export const CONFIG_TC_ID = 'config-tipo-cambio';

/** Moneda de lista del catálogo. */
export const MONEDA_LISTA = 'USD' as const;
