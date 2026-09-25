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
import { BOT_BIENESTAR_INSCRIBIR, BOT_BORRADOR_RESPUESTA, BOT_GLP1_INSCRIBIR, EXT } from './identifiers.js';

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
    // Comunicación (WhatsApp / email)
    { resourceType: 'Communication' },
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
    { resourceType: 'Location', readonly: true },
    { resourceType: 'HealthcareService', readonly: true },
    // Bots: solo los de Recepción (lectura = poder invocarlos).
    ...BOTS_RECEPCION.map((nombre) => ({ resourceType: 'Bot', readonly: true, criteria: `Bot?name=${nombre}` })),
  ],
};

/** Director Médico — acceso clínico completo. */
export const POLICY_DIRECTOR_MEDICO: AccessPolicy = {
  resourceType: 'AccessPolicy',
  name: 'Director Médico — Clínico completo',
  resource: [{ resourceType: '*' }],
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
 * Catálogo, agenda y profesionales: sólo lectura (para mostrar la oferta).
 *
 * Reservar un turno NO se hace escribiendo `Appointment` directo: el modelo es de
 * **solicitud** (el paciente ejecuta solo el bot `som-solicitar-turno`, que crea un
 * `Task`, y Recepción confirma con los bots de reserva), por eso `Appointment` es de
 * sólo lectura y el acceso a `Bot` está acotado a ese único bot (y `som-solicitar`).
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

    // Planes de cuidado: lee todos los suyos (Plan Bienestar, seguimiento GLP-1, …);
    // escribe solo el Plan Bienestar, que inicia el propio paciente.
    { resourceType: 'CarePlan', readonly: true, criteria: 'CarePlan?subject=%patient' },
    {
      resourceType: 'CarePlan',
      criteria:
        'CarePlan?subject=%patient&instantiates-canonical=https://epa-bienestar.ar/fhir/PlanDefinition/menopausia-cardiovascular',
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
    { resourceType: 'Organization', readonly: true },
    { resourceType: 'Binary', readonly: true },

    // Reserva por solicitud: el paciente solo puede ejecutar ESTE bot (crea el Task
    // de solicitud y avisa a Recepción). No puede ejecutar ningún otro bot.
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-solicitar-turno' },
    // SOM: además puede ejecutar el bot que crea su solicitud de segunda opinión.
    { resourceType: 'Bot', readonly: true, criteria: 'Bot?name=som-solicitar' },
  ],
};

/**
 * Roles del seed. Los roles clínicos propios de SOM (equipo médico) se definen
 * aparte; los del catálogo anterior se retiraron.
 */
export const ACCESS_POLICIES: AccessPolicy[] = [POLICY_RECEPCIONISTA, POLICY_DIRECTOR_MEDICO, POLICY_PACIENTE_PORTAL];
