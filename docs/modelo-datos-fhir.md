# Modelo de datos FHIR R4

Recursos FHIR estándar con extensiones custom donde el estándar no cubre el caso.
Las extensiones viven bajo el namespace
`https://segundaopinionmedica.org/fhir/StructureDefinition/...` (ver `src/fhir/identifiers.ts`).
Naming: **kebab-case**.

## Recursos y extensiones

| Recurso FHIR | Uso | Extensiones custom |
|---|---|---|
| **Patient** | Ficha del paciente / lead del CRM | `tipo-cliente`, `perfil-clinico`, `origen-lead`, `perfil-interes`, `ciclo-vida-cliente` |
| **Practitioner** | Médicos | `split-porcentaje`, `tipo-contrato` |
| **Schedule / Slot** | Disponibilidad de consultorios/salas | `recurso-fisico` |
| **Appointment** | Turno reservado | `ocupantes`, `item-tipo`, `item-codigo` |
| **Encounter** | Visita ejecutada (check-in/out) | — |
| **ActivityDefinition** | Catálogo (consultas de segunda opinión) | `precio-usd`, `precio-ars`, `regla-pricing-recurso`, `split-som` |
| **Invoice / ChargeItem** | Cobros y splits | `monto-split-som`, `tc-aplicado`, `es-sena`, `medio-pago` |
| **Communication** | WhatsApp, emails y campañas del CRM (identifier `campania`) | `canal`, `template-usado` |
| **Group** | Segmentos del CRM (identifier `segmento`; criterios en `characteristic`) | — |
| **Location** | Recurso físico (consultorio/sala) | (identificado por `SYSTEM.recursoCodigo`) |
| **Basic** | Configuración (TC vigente) | `tc-aplicado` |
| **ServiceRequest / RiskAssessment / DiagnosticReport** | Contrato SOM con el portal (solicitud + informe) | `som-origin`, `som-sections` |
| **PlanDefinition** | Plantilla del seguimiento GLP-1 (`PlanDefinition/seguimiento-glp1`) | — |
| **CarePlan / Goal** | Programa GLP-1 del paciente y su meta de peso | (category `CodeSystem/programa`) |
| **ServiceRequest** (laboratorio) | Pedidos de estudios del programa GLP-1, por semana | (code `CodeSystem/biomarcador`) |
| **Task** | Solicitudes de turno, controles GLP-1 a agendar, indicación GLP-1 | (code `CodeSystem/task-tipo`) |
| **AuditEvent** | Log regulatorio (nativo Medplum) | — |

## Decisiones de modelado

- **Catálogo:** los servicios se modelan como `ActivityDefinition` (precio en
  `precio-usd`/`precio-ars`) y los profesionales como `Practitioner`. El catálogo
  se arma **de cero con los profesionales de SOM**; hoy quedan 6 consultas de
  ejemplo (cardiología + subespecialidades) y el control del seguimiento GLP-1,
  sin precio y sin profesionales.
- **Programas de seguimiento:** `PlanDefinition` (plantilla, la carga el seed) →
  `CarePlan` por paciente (`instantiatesCanonical`) con su `Goal`, los pedidos de
  laboratorio (`ServiceRequest`) y las tareas de agenda (`Task`) que ve
  Recepción. Primer programa: GLP-1 ([`glp1.md`](glp1.md)).
- **Recursos físicos:** `Location` + `Schedule` (uno por recurso). Hoy: 2
  consultorios de cardiología, 1 de telemedicina y la sala de rehabilitación
  (lista provisional).
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
