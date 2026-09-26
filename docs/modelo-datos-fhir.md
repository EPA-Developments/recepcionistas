# Modelo de datos FHIR R4

Recursos FHIR estándar con extensiones custom donde el estándar no cubre el caso.
Las extensiones viven bajo el namespace
`https://segundaopinionmedica.org/fhir/StructureDefinition/...` (ver `src/fhir/identifiers.ts`).
Naming: **kebab-case**.

## Recursos y extensiones

| Recurso FHIR | Uso | Extensiones custom |
|---|---|---|
| **Patient** | Ficha del paciente / lead del CRM | `tipo-cliente`, `perfil-clinico`, `origen-lead`, `perfil-interes`, `ciclo-vida-cliente`, `patient-origin` (lo escribe la invitación), `onboarding-completed` (lo escribe el portal) |
| **Practitioner** | Médicos | `split-porcentaje`, `tipo-contrato` |
| **Schedule / Slot** | Disponibilidad de consultorios/salas y de la agenda de teleconsultas | `recurso-fisico` |
| **Appointment** | Turno reservado (`serviceType` = servicio del catálogo; `specialty` SNOMED; consulta del Plan Bienestar: `supportingInformation` → su Task y su CarePlan) | `ocupantes`, `item-tipo`, `item-codigo`, `modalidad` (v3-ActCode `AMB`/`VR`), `teleconsulta-url` |
| **Encounter** | Visita ejecutada (check-in/out); `class` `AMB` o `VR` según la modalidad | — |
| **ActivityDefinition** | Catálogo: consultas por especialidad, la del Plan Bienestar y el control GLP-1. `topic` = especialidad (SNOMED) + grupo (`CodeSystem/grupo-especialidad`); `useContext` `workflow` = modalidades (v3-ActCode) y `program` = Plan Bienestar. Lo lee el portal | `precio-usd`, `precio-ars`, `regla-pricing-recurso`, `split-som` |
| **Invoice / ChargeItem** | Cobros y splits | `monto-split-som`, `tc-aplicado`, `es-sena`, `medio-pago` |
| **Communication** | Mensajes (conversaciones con el paciente por el portal y **WhatsApp**: topic + hijas con `partOf`), avisos automáticos por WhatsApp (sueltos, `category` `canal\|whatsapp`, identifier `twilio-message-sid`), emails y campañas del CRM (identifier `campania`) | `canal`, `template-usado`, `telefono-whatsapp`, `estado-entrega`, `inicio-contacto`, `auto-respuesta`, `borrador-usado` ([`whatsapp.md`](whatsapp.md)) |
| **Group** | Segmentos del CRM (identifier `segmento`; criterios en `characteristic`) | — |
| **Location** | Recurso físico (consultorio/sala) | (identificado por `SYSTEM.recursoCodigo`) |
| **Basic** | Configuración (TC vigente) | `tc-aplicado` |
| **ServiceRequest / RiskAssessment / DiagnosticReport** | Contrato SOM con el portal (solicitud + informe; el `RiskAssessment` va con `basedOn` = la solicitud, probabilidades PREVENT 0–1 y el estadío CKM de la AHA) | `som-origin` (`valueCode` `self`\|`referral`), `som-sections`, `ckm-stage`, `ckm-stage-completo` |
| **DocumentReference / Observation / DiagnosticReport** (laboratorio) | PDF de laboratorio que manda el paciente (category `CodeSystem/documento\|resultado-laboratorio`) → una `Observation` por analito (LOINC / `CodeSystem/biomarker`, UCUM) + informe LAB (LOINC 11502-2) ligado en `context.related` | — |
| **ObservationDefinition** | Rangos de biomarcadores del portal (panel `CodeSystem/panel-biomarcador`), **solo convencionales** (`CodeSystem/tipo-rango\|convencional`; AHA/ACC, NCEP, ADA); fuente: `src/config/biomarcadores.ts` | — |
| **CarePlan** (Plan Bienestar 100 Días®) | Inscripción (category `care-plans\|plan-bienestar-100`, `period` de 100 días: contrato del portal) con `instantiatesCanonical` a su plantilla y una actividad por consulta programada (`CodeSystem/consulta-plan-bienestar`); las consultas extra van como `activity.reference` | — |
| **PlanDefinition** | Plantillas: seguimiento GLP-1 (`PlanDefinition/seguimiento-glp1`) y Plan Bienestar 100 Días® (`PlanDefinition/plan-bienestar-100`, 3 consultas con sus desfasajes) | — |
| **CarePlan / Goal** | Programa GLP-1 del paciente y su meta de peso | (category `CodeSystem/care-plans`, compartido con la app del paciente) |
| **ServiceRequest** (laboratorio) | Pedidos de estudios del programa GLP-1, por semana | (code `CodeSystem/biomarcador`) |
| **Task** | Solicitudes de turno (con `modalidad`), controles GLP-1 y consultas del Plan Bienestar a agendar, indicación GLP-1, revisar un PDF de laboratorio y los **avisos a Recepción** de números nuevos por WhatsApp (`whatsapp-nuevo-contacto`: `focus` = la conversación, `reasonReference` = el primer mensaje, identifier `Identifier/aviso-recepcion` uno por número, resuelto con `businessStatus` `CodeSystem/resolucion-aviso`; ver [`whatsapp.md`](whatsapp.md)) | (code `CodeSystem/task-tipo`) |
| **Consent** | Consentimiento de teleconsulta (genérico, lo escribe el portal): `policyRule` `CodeSystem/consentimiento\|teleconsulta` | — |
| **AuditEvent** | Log regulatorio (nativo Medplum) | — |

## Decisiones de modelado

- **Catálogo:** los servicios se modelan como `ActivityDefinition` (precio en
  `precio-usd`/`precio-ars`) y los profesionales como `Practitioner`. Las
  especialidades las definieron el Dr. D'Alessandro y el Dr. Barbagelata (12
  consultas + la del Plan Bienestar + el control GLP-1); precios y profesionales
  siguen PENDIENTES.
- **Modalidad (R-21):** presencial / teleconsulta es un atributo del turno (código
  estándar v3-ActCode, el mismo de `Encounter.class`), no un servicio aparte. Ver
  [`plan-bienestar.md`](plan-bienestar.md).
- **Programas de seguimiento:** `PlanDefinition` (plantilla, la carga el seed) →
  `CarePlan` por paciente (`instantiatesCanonical`) con su `Goal`, los pedidos de
  laboratorio (`ServiceRequest`) y las tareas de agenda (`Task`) que ve
  Recepción. Primer programa: GLP-1 ([`glp1.md`](glp1.md)).
- **Recursos físicos:** `Location` + `Schedule` (uno por recurso). Hoy: 2
  consultorios, la agenda de teleconsultas (virtual, transitoria hasta las agendas
  por profesional) y la sala de rehabilitación (lista provisional).
- **Tipo de cambio:** recurso `Basic` con identifier `config-tipo-cambio` y la
  extensión `tc-aplicado`; el bot de cobro lo lee como TC vigente (configurable
  por el admin).
- **Banner de seguridad:** señal binaria verde/rojo basada en `Flag` activos del
  paciente; el detalle clínico nunca se expone a recepción.

## Privacidad por diseño

La `AccessPolicy` de recepción (*Operativo*) **solo lista recursos operativos**
(agenda, cobros, comunicación, CRM, catálogo). Los recursos clínicos
(`Observation`, `Condition`, `DiagnosticReport`, `DocumentReference`, `CarePlan`,
`Goal`, `ServiceRequest`, `MedicationRequest`) **no se listan**, por lo que quedan
denegados por defecto. La historia clínica completa queda reservada al equipo
médico (Ley 26.529 / 25.326). De un programa de seguimiento, Recepción solo ve
sus `Task` (semana, ventana y si lleva laboratorio).

## Retirado (catálogo anterior)

Los `PlanDefinition` de combos/membresías/paquetes, `Coverage`/`Contract` (planes de
membresía) y el `CodeSystem` de contraindicaciones eran de un catálogo anterior,
ajeno a SOM, y se retiraron del dominio (hoy `PlanDefinition` solo se usa para
programas de seguimiento como el GLP-1) junto con
`src/config/{combos,membresias,paquetes,contraindicaciones}.ts`. Si el modelo
de segunda opinión necesita paquetes/seguimiento o contraindicaciones clínicas,
se remodelan con las definiciones oficiales — ver
[`decisiones-pendientes.md`](decisiones-pendientes.md).
