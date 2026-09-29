/**
 * AccessPolicies de Medplum (Documento de Requerimientos §3, mínimo privilegio).
 *
 * Pieza central: la recepcionista con acceso "Operativo". Privacidad por diseño:
 * sólo lista recursos operativos; los recursos clínicos (Observation, Condition,
 * DiagnosticReport, DocumentReference, CarePlan, MedicationRequest) NO se listan,
 * por lo que quedan denegados por defecto. La recepción ve el banner de seguridad
 * (Flag), nunca el detalle clínico.
 */
import type { AccessPolicy } from '@medplum/fhirtypes';
import {
  BOT_BIENESTAR_INSCRIBIR,
  BOT_BORRADOR_RESPUESTA,
  BOT_GLP1_INSCRIBIR,
  BOT_GLP1_PLAN,
  BOT_TELECONSULTA_TOKEN,
  BOT_WEBHOOK_MERCADOPAGO,
  BOT_WHATSAPP_ENTRANTE,
  BOT_WHATSAPP_RESPONDER,
  EXT,
} from './identifiers.js';

/**
 * Bots que Recepción puede ejecutar (los que usa la app de recepción, más la
 * validación de turno). Nada más: los bots clínicos (p. ej. `som-glp1-plan`) y los
 * de administración quedan fuera. Si la app llama un bot nuevo, sumarlo acá (lo
 * verifica `tests/seed.test.ts`).
 */
export const BOTS_RECEPCION = [
  'som-calcular-cobro',
  'som-validar-turno',
  'som-reservar-turno',
  'som-estado-turno',
  'som-pagar-sena',
  'som-link-mercadopago',
  'som-enviar-whatsapp',
  'som-alta-paciente',
  'som-invitar-paciente',
  BOT_GLP1_INSCRIBIR,
  BOT_BIENESTAR_INSCRIBIR,
  BOT_BORRADOR_RESPUESTA,
  BOT_WHATSAPP_RESPONDER,
] as const;

/** Recepcionista — acceso Operativo: agenda, check-in/out, pagos, comunicación, CRM. */
export const POLICY_RECEPCIONISTA: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: 'Recepción — Operativo',
  resource: [
    // Agenda
    { resourceType: 'Appointment' },
    { resourceType: 'Schedule', readonly: true },
    { resourceType: 'Slot' },
    // Check-in / check-out (datos operativos del Encounter, sin contenido clínico)
    { resourceType: 'Encounter' },
    // Pagos
    { resourceType: 'Invoice' },
    { resourceType: 'ChargeItem' },
    { resourceType: 'PaymentReconciliation' },
    { resourceType: 'Account' },
    // Comunicación (Mensajes con el portal y WhatsApp, avisos por email)
    { resourceType: 'Communication' },
    // Archivos de Mensajes: Recepción adjunta PDF/fotos y ve los que manda el paciente
    // (decisión del Dr. D'Alessandro, 26/09/2026, como el demo). Medplum no deja buscar
    // ni listar Binary: solo se abre un archivo teniendo su link.
    { resourceType: 'Binary' },
    // CRM / leads
    { resourceType: 'Task' },
    // Banner de seguridad (señal binaria; sin detalle clínico)
    { resourceType: 'Flag', readonly: true },
    // Ficha del paciente: demografía y datos comerciales; se oculta lo clínico.
    {
      resourceType: 'Patient',
      hiddenFields: [`Patient.extension('${EXT.perfilClinico}')`],
    },
    // Catálogo y profesionales (sólo lectura, para mostrar precios y quién atiende)
    { resourceType: 'ActivityDefinition', readonly: true },
    { resourceType: 'PlanDefinition', readonly: true },
    { resourceType: 'Practitioner', readonly: true },
    { resourceType: 'PractitionerRole', readonly: true },
    { resourceType: 'Location', readonly: true },
    { resourceType: 'HealthcareService', readonly: true },
    // Bots: solo los de Recepción (lectura = poder invocarlos).
    ...BOTS_RECEPCION.map((nombre) => ({ resourceType: 'Bot', readonly: true, criteria: `Bot?name=${nombre}` })),
  ],
};

/**
 * Webhooks públicos (Twilio, MercadoPago): cada uno tiene su ClientApplication dedicada,
 * cuyas credenciales agrega nginx al reenviar al `$execute` del bot (la URL pública no las
 * lleva). Cada policy solo deja ejecutar su bot (que corre con su propia identidad): si la
 * clave se filtrara, no da acceso a ningún dato.
 */
export const NOMBRE_POLICY_WEBHOOK_TWILIO = 'Webhook Twilio — WhatsApp entrante';

export const POLICY_WEBHOOK_TWILIO: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: NOMBRE_POLICY_WEBHOOK_TWILIO,
  resource: [{ resourceType: 'Bot', readonly: true, criteria: `Bot?name=${BOT_WHATSAPP_ENTRANTE}` }],
};

export const NOMBRE_POLICY_WEBHOOK_MERCADOPAGO = 'Webhook MercadoPago — pagos';

export const POLICY_WEBHOOK_MERCADOPAGO: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: NOMBRE_POLICY_WEBHOOK_MERCADOPAGO,
  resource: [{ resourceType: 'Bot', readonly: true, criteria: `Bot?name=${BOT_WEBHOOK_MERCADOPAGO}` }],
};

/** Director Médico — acceso clínico completo. */
export const POLICY_DIRECTOR_MEDICO: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: 'Director Médico — Clínico completo',
  resource: [{ resourceType: '*' }],
};

// ───────────────────── Especialistas (dashboard clínico) ─────────────────────
//
// Los profesionales del plantel que no son el Director Médico atienden desde el
// dashboard clínico (`EPA-Developments/dashboard-cardiometabolismo`, marca
// `segunda-opinion`): la ficha, la teleconsulta como moderador, las órdenes, las
// recetas y el informe. Hasta acá sólo el Director Médico podía, con `*`.
//
// DOS POLICIES Y NO UNA, porque el acceso sí difiere: la Ley 17.132 reserva la
// prescripción de medicamentos a médicos (y odontólogos), así que Nutrición lee la
// medicación y los pedidos pero no los escribe. Es la misma separación que ya tiene
// el dashboard en sus policies versionadas (`data/ckm/*-access-policy.json`). Todos
// los grupos médicos (Cardiología, Cardiología con especialidad, Tisioneumonología,
// Neurología, Ginecología, DBT/Endocrino) usan la misma: la especialidad la dice su
// `PractitionerRole` y el turno, no la policy.
//
// QUÉ SE DEJA AFUERA A PROPÓSITO:
//  - **La agenda se lee, no se escribe.** Es de Recepción. Entrar a la consulta
//    («En curso») y cerrarla van por `som-estado-turno`, que además cierra la
//    visita, libera las franjas y marca el Plan Bienestar; escribir el turno a mano
//    lo dejaría cerrado con el plan sin marcar.
//  - **Nada de facturación** (`Invoice`, `ChargeItem`, pagos, cuentas).
//  - **El informe de segunda opinión** (`DiagnosticReport`) y el riesgo
//    (`RiskAssessment`) los escribe `bot-som-report`: se leen.
//  - **Bots sólo por nombre**, como la policy de Recepción: nunca un `Bot` sin
//    criterio, que dejaría ejecutar cualquiera (los de pagos, los de WhatsApp).
//
// ALCANCE: todas las pacientes del proyecto, como el Director Médico. Acotar cada
// profesional a sus pacientes (por turno o por `CareTeam`) es otra decisión.
//
// LO QUE LEE EL DASHBOARD está fijado en `tests/seed.test.ts`: si la policy pierde un
// tipo que la app busca, esa pantalla responde 403 y se rompe sin avisar.

/** Bots del dashboard clínico que se despliegan en el proyecto SOM (`deploy-bots-server -- --solo`). */
export const BOT_PUCO_COBERTURA = 'puco-cobertura';
export const BOT_REFEPS_VERIFY = 'refeps-verify';

/**
 * Bots que ejecuta un médico desde el dashboard: entrar a la teleconsulta como
 * moderador, marcarla en curso y cerrarla, el programa GLP-1 (la indicación es
 * médica), la cobertura en el PUCO y la matrícula en REFEPS al emitir una receta.
 */
export const BOTS_MEDICO = [
  BOT_TELECONSULTA_TOKEN,
  'som-estado-turno',
  BOT_GLP1_PLAN,
  BOT_PUCO_COBERTURA,
  BOT_REFEPS_VERIFY,
] as const;

/** Los de Nutrición: los mismos menos lo que es prescribir (GLP-1 y REFEPS de la receta). */
export const BOTS_NUTRICION = [BOT_TELECONSULTA_TOKEN, 'som-estado-turno', BOT_PUCO_COBERTURA] as const;

const soloLectura = (...tipos: string[]) => tipos.map((resourceType) => ({ resourceType, readonly: true }));
const bots = (nombres: readonly string[]) =>
  nombres.map((nombre) => ({ resourceType: 'Bot', readonly: true, criteria: `Bot?name=${nombre}` }));

/** Lo que las dos disciplinas sólo leen. */
const LECTURA_COMUN = soloLectura(
  // Agenda (de Recepción).
  'Appointment',
  'Schedule',
  'Slot',
  // Lo que escriben otros: el informe y el riesgo (bot-som-report), la cobertura, los
  // mensajes con la paciente, sus documentos y archivos, y sus consentimientos.
  'DiagnosticReport',
  'RiskAssessment',
  'Coverage',
  'Communication',
  'DocumentReference',
  'Binary',
  'Consent',
  'Immunization',
  'DicomStudy',
  'ImagingStudy',
  // Catálogos y terminología.
  'Questionnaire',
  'ObservationDefinition',
  'ValueSet',
  'CodeSystem',
  'PlanDefinition',
  'ActivityDefinition',
  // Quién es quién.
  'Practitioner',
  'PractitionerRole',
  'Organization',
  'HealthcareService',
);

export const NOMBRE_POLICY_MEDICO = 'Profesional SOM — Médico';

/** Médicos del plantel: la ficha completa, prescribir y pedir estudios. */
export const POLICY_MEDICO: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: NOMBRE_POLICY_MEDICO,
  resource: [
    { resourceType: 'Patient' },
    { resourceType: 'Encounter' },
    { resourceType: 'ClinicalImpression' },
    { resourceType: 'Condition' },
    { resourceType: 'Observation' },
    { resourceType: 'AllergyIntolerance' },
    { resourceType: 'MedicationStatement' },
    { resourceType: 'MedicationRequest' },
    { resourceType: 'ServiceRequest' },
    { resourceType: 'CarePlan' },
    { resourceType: 'Goal' },
    { resourceType: 'NutritionOrder' },
    { resourceType: 'QuestionnaireResponse' },
    { resourceType: 'Task' },
    // El sello de la receta emitida.
    { resourceType: 'Provenance' },
    ...LECTURA_COMUN,
    ...bots(BOTS_MEDICO),
  ],
};

export const NOMBRE_POLICY_NUTRICION = 'Profesional SOM — Nutrición';

/**
 * Nutrición: la ficha, el módulo de nutrición y el plan, sin prescribir. La
 * medicación, los pedidos y los diagnósticos se leen; la identidad de la paciente
 * (documento, vínculos, médico de cabecera) también.
 */
export const POLICY_NUTRICION: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: NOMBRE_POLICY_NUTRICION,
  resource: [
    { resourceType: 'Patient', readonlyFields: ['identifier', 'link', 'generalPractitioner'] },
    { resourceType: 'Encounter' },
    { resourceType: 'ClinicalImpression' },
    { resourceType: 'Observation' },
    { resourceType: 'AllergyIntolerance' },
    { resourceType: 'MedicationStatement' },
    { resourceType: 'CarePlan' },
    { resourceType: 'Goal' },
    { resourceType: 'NutritionOrder' },
    { resourceType: 'QuestionnaireResponse' },
    { resourceType: 'Task' },
    ...soloLectura('Condition', 'MedicationRequest', 'ServiceRequest', 'Provenance'),
    ...LECTURA_COMUN,
    ...bots(BOTS_NUTRICION),
  ],
};

/** Nombre canónico de la policy del portal del paciente (lo usa el bot de invitación). */
export const NOMBRE_POLICY_PACIENTE = 'Paciente SOM — Portal';

/**
 * Paciente SOM — Portal: el paciente accede **sólo a lo suyo** desde el portal
 * (https://app.segundaopinionmedica.org). Ve su agenda, plan, pagos y
 * mensajes, y —ejerciendo su derecho de acceso a sus propios datos— su historia
 * (laboratorio, biomarcadores, vacunas, medicación, plan de cuidado,
 * consentimientos). Lo no listado queda denegado; nunca ve datos de otros
 * pacientes. `%patient` se liga al perfil del usuario logueado (su propio Patient).
 *
 * Alcance dentro de su compartimento:
 *  - **Escribe** (autogestión): su perfil, las observaciones/vitales que él carga,
 *    sus respuestas de cuestionarios, sus documentos (consentimiento firmado, estudios
 *    en PDF y el `Binary` del archivo), la autorización por estudio (`Consent`), su
 *    obra social / prepaga (`Coverage` type HIP) y sus mensajes.
 *  - **Plan Bienestar** (módulo drop-in del portal): el paciente inicia su plan y
 *    tilda pasos, con escritura acotada: `CarePlan` solo el que instancia la
 *    PlanDefinition del plan, `Task` solo `intent=plan`, `Condition` solo los
 *    hallazgos SNOMED del plan, más sus `Goal` y su `CareTeam`.
 *  - **Sólo lee**: agenda, cobertura, facturas, sus programas de seguimiento
 *    (p. ej. GLP-1: `CarePlan`, `Task`, `ServiceRequest`) y su historia clínica
 *    (esa la genera el equipo médico, no el paciente).
 * Catálogo, agenda y profesionales (con su `PractitionerRole`: especialidad,
 * modalidades, disponibilidad) y consultorios: sólo lectura (para mostrar la oferta).
 *
 * Reservar un turno NO se hace escribiendo `Appointment` directo: la paciente ejecuta
 * `som-reservar-portal` (elige una franja libre de un profesional; el bot aplica las
 * reglas y deja el turno confirmado si está incluido en su plan o tentativo con el link
 * de la seña, R-23) o `som-solicitar-turno` (solicitud en texto, que confirma Recepción).
 * Por eso `Appointment` es de sólo lectura y el acceso a `Bot` está acotado a esos bots,
 * `som-solicitar` y los de su teleconsulta (`som-teleconsulta-entrar`, `-cancelar` y
 * `-pago`), que verifican que el turno sea suyo.
 *
 * IMPORTANTE — fuente de verdad: esta definición es la que aplica `npm run seed`
 * (upsert por `name`: pisa la del servidor). Debe quedar **idéntica** a su espejo en
 * el portal: `EPA-Developments/app` → `docs/medplum/access-policy-paciente-portal.json`
 * (sincronizada con ese archivo en `app@091e20f`; `tests/seed.test.ts` la compara
 * con la copia en `tests/fixtures/`). Si cambia una, cambiar la otra.
 */
export const POLICY_PACIENTE_PORTAL: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: NOMBRE_POLICY_PACIENTE,
  resource: [
    // Compartimento propio — autogestión (lectura/escritura).
    { resourceType: 'Patient', criteria: 'Patient?_id=%patient.id' },
    { resourceType: 'Observation', criteria: 'Observation?subject=%patient' },
    { resourceType: 'QuestionnaireResponse', criteria: 'QuestionnaireResponse?subject=%patient' },
    { resourceType: 'DocumentReference', criteria: 'DocumentReference?subject=%patient' },
    { resourceType: 'Communication', criteria: 'Communication?subject=%patient' },
    // Autorización por estudio que manda (Ley 25.326; `Consent.policyRule` propia).
    { resourceType: 'Consent', criteria: 'Consent?patient=%patient' },
    // El PDF que sube desde "Enviar estudios en PDF" (Binary con securityContext = el
    // paciente, que lo pone en su compartimento).
    { resourceType: 'Binary', criteria: 'Binary?_compartment=%patient' },
    // Novedades en tiempo real del portal (campanita, Mensajes): su propia Subscription
    // WebSocket. No puede tocar las Subscriptions rest-hook de los bots.
    { resourceType: 'Subscription', criteria: 'Subscription?type=websocket' },

    // Planes de cuidado: lee todos los suyos (Plan Bienestar, seguimiento GLP-1, …);
    // escribe solo el Plan Bienestar, que inicia el propio paciente: la plantilla de
    // menopausia y la única por estadío CKM 0–4 (`pb100d-ckm`, catálogo firmado).
    { resourceType: 'CarePlan', readonly: true, criteria: 'CarePlan?subject=%patient' },
    {
      resourceType: 'CarePlan',
      criteria:
        'CarePlan?subject=%patient&instantiates-canonical=https://epa-bienestar.ar/fhir/PlanDefinition/menopausia-cardiovascular',
    },
    {
      resourceType: 'CarePlan',
      criteria: 'CarePlan?subject=%patient&instantiates-canonical=https://epa-bienestar.ar/fhir/PlanDefinition/pb100d-ckm',
    },
    // Sus metas (las del Plan Bienestar las crea él; la del GLP-1, el equipo médico).
    { resourceType: 'Goal', criteria: 'Goal?subject=%patient' },
    // Tareas: lee las suyas (solicitudes de turno, controles GLP-1); escribe solo los
    // pasos del Plan Bienestar (`intent=plan`). `patient` mapea a Task.for.
    { resourceType: 'Task', readonly: true, criteria: 'Task?patient=%patient' },
    { resourceType: 'Task', criteria: 'Task?patient=%patient&intent=plan' },
    { resourceType: 'CareTeam', criteria: 'CareTeam?subject=%patient' },
    // Condiciones: lee las suyas; escribe solo los hallazgos del Plan Bienestar
    // (menopausia, prematura, perimenopausia, posmenopausia, quirúrgica).
    { resourceType: 'Condition', readonly: true, criteria: 'Condition?subject=%patient' },
    {
      resourceType: 'Condition',
      criteria:
        'Condition?subject=%patient&code=http://snomed.info/sct|289903006,http://snomed.info/sct|373717006,http://snomed.info/sct|307409000,http://snomed.info/sct|76498008,http://snomed.info/sct|67207009',
    },
    // Plantillas de planes (elegibilidad del Plan Bienestar, programa GLP-1).
    { resourceType: 'PlanDefinition', readonly: true },

    // Compartimento propio — sólo lectura (lo gestiona Recepción / el equipo médico).
    { resourceType: 'Appointment', readonly: true, criteria: 'Appointment?actor=%patient' },
    { resourceType: 'Coverage', readonly: true, criteria: 'Coverage?beneficiary=%patient' },
    // Excepción: escribe SOLO su obra social / prepaga (type HIP, desde "Mis datos");
    // membresías y paquetes siguen de solo lectura.
    {
      resourceType: 'Coverage',
      criteria: 'Coverage?beneficiary=%patient&type=http://terminology.hl7.org/CodeSystem/v3-ActCode|HIP',
    },
    { resourceType: 'Invoice', readonly: true, criteria: 'Invoice?subject=%patient' },
    { resourceType: 'DiagnosticReport', readonly: true, criteria: 'DiagnosticReport?subject=%patient' },
    // SOM (solicitudes de segunda opinión) y pedidos de laboratorio de sus programas.
    { resourceType: 'ServiceRequest', readonly: true, criteria: 'ServiceRequest?subject=%patient' },
    { resourceType: 'RiskAssessment', readonly: true, criteria: 'RiskAssessment?subject=%patient' },
    { resourceType: 'MedicationRequest', readonly: true, criteria: 'MedicationRequest?patient=%patient' },
    { resourceType: 'Immunization', readonly: true, criteria: 'Immunization?patient=%patient' },

    // Catálogo, agenda y profesionales — sólo lectura (para mostrar la oferta).
    // ActivityDefinition: las consultas del catálogo con sus modalidades (presencial /
    // teleconsulta) y especialidades, para armar "Pedir un turno" sin listas a mano.
    { resourceType: 'ActivityDefinition', readonly: true },
    { resourceType: 'ObservationDefinition', readonly: true },
    { resourceType: 'Questionnaire', readonly: true },
    { resourceType: 'Schedule', readonly: true },
    { resourceType: 'Slot', readonly: true },
    { resourceType: 'HealthcareService', readonly: true },
    { resourceType: 'Practitioner', readonly: true },
    // Especialidad, modalidades, disponibilidad y consultorio de cada profesional
    // ("Especialidad → Profesional → Horario" en el portal).
    { resourceType: 'PractitionerRole', readonly: true },
    { resourceType: 'Location', readonly: true },
    { resourceType: 'Organization', readonly: true },
    { resourceType: 'Binary', readonly: true },

    // Reserva desde el portal (R-23): elige una franja libre y el bot reserva con las
    // reglas (confirmado si está incluido en su plan; tentativo + link de la seña si no).
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-reservar-portal' },
    // Solicitud en texto libre (crea el Task de solicitud y avisa a Recepción, que confirma).
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-solicitar-turno' },
    // SOM: además puede ejecutar el bot que crea su solicitud de segunda opinión.
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-solicitar' },
    // Su teleconsulta (R-21): entrar a la videollamada, cancelarla (R-14) y volver a abrir
    // el pago de la seña (R-23). Cada bot verifica que el turno sea de quien lo ejecuta.
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-teleconsulta-entrar' },
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-teleconsulta-cancelar' },
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-teleconsulta-pago' },
  ],
};

/**
 * Roles del seed (más las policies de los webhooks): Recepción, Director Médico, los
 * especialistas (Médico y Nutrición) y la paciente del portal.
 */
export const ACCESS_POLICIES: AccessPolicy[] = [
  POLICY_RECEPCIONISTA,
  POLICY_DIRECTOR_MEDICO,
  POLICY_MEDICO,
  POLICY_NUTRICION,
  POLICY_PACIENTE_PORTAL,
  POLICY_WEBHOOK_TWILIO,
  POLICY_WEBHOOK_MERCADOPAGO,
];
