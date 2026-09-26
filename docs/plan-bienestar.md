# Plan Bienestar 100 Días® y teleconsulta

> **Plan Bienestar 100 Días®** es marca registrada del Dr. Alejandro Sergio
> D'Alessandro. La interacción prefijada del plan la definió con el Dr. Alejandro
> Barbagelata (Segunda Opinión Médica).

> Principio: **el sistema calcula, Recepción agenda.** Las fechas de las consultas,
> sus ventanas y los avisos salen del plan. Recepción ve solo tareas operativas (qué
> consulta, entre qué fechas), nunca el plan clínico.

## Qué incluye

| | Detalle |
|---|---|
| **Consultas programadas** (incluidas en el plan: sin cargo ni seña) | Inicial (día 1), día 50 y final (día 100). Hoy las atienden el Dr. Barbagelata (martes y jueves 14–18, presencial en el Consultorio 1 o teleconsulta), la Dra. Gold (presencial martes y jueves 9–12 en el Consultorio 1; teleconsulta miércoles y viernes 08–12) y el Dr. D'Alessandro (presencial martes y jueves 9–12 en el Consultorio 2; teleconsulta lunes, miércoles y viernes 16–20), cada uno con su agenda (R-22). |
| **Evaluaciones del portal** (días 0, 30, 60 y 100) | Son **evaluaciones** (biomarcadores y cuestionarios que carga la paciente en la app), no consultas: no se agendan ni cuentan como las tres consultas programadas. Confirmado el 26/09/2026. |
| **Día 1** | Es el de la consulta inicial. Al agendarla, el sistema corre el plan a esa fecha y recalcula las otras dos. |
| **Ventanas** (R-20) | Día 50 y día 100, ± 7 días. |
| **Modalidad** (R-21) | Cada consulta puede ser **presencial** o por **teleconsulta** (Jitsi). La teleconsulta es el camino principal. |
| **Consultas fuera de lo programado** | Las consultas por especialidad del catálogo: **con cargo** y sin límite. |
| **Recordatorios** | Cuando se abre la ventana de una consulta, y otro si a mitad de ventana sigue sin agendar (con alerta a Recepción). Los de siempre a 48 h y 2 h de cada turno, con el link si es teleconsulta. |

**Especialidades** (catálogo, `src/config/catalogo.ts`), cada una presencial y por
teleconsulta:

| Grupo | Consultas | Especialidad (SNOMED CT, `c80-practice-codes`) |
|---|---|---|
| DBT / Endocrino | Diabetología y Endocrinología | 394583002 Endocrinology |
| Nutrición | Nutrición | — (no tiene código en ese value set) |
| Cardiología | Cardiología | 394579002 Cardiology |
| Cardiología con especialidad | Insuficiencia Cardíaca, Hemodinamia, Electrofisiología, Medicina Nuclear, Prevención CV, Rehabilitación CV | 394579002 Cardiology (Medicina Nuclear: 394649004 Nuclear medicine) |
| Tisioneumonología | Tisioneumonología | 418112009 Pulmonary medicine |
| Neurología | Neurología | 394591006 Neurology |
| Ginecología | Ginecología | 394586005 Gynecology |

Precios (lista del 26/09/2026): consulta por especialidad **ARS 150.000**, el mismo precio
presencial y por teleconsulta. Las tres consultas del plan están incluidas (la paciente
no paga ni deja seña); el plan las presupuesta en ARS 100.000 cada una, que el catálogo
publica como `valor-referencia-ars` (informativo).

## El modelo: tres datos separados

| Dato | Valores | Dónde vive (FHIR R4) |
|---|---|---|
| **Qué** se atiende | la consulta del plan o una consulta de especialidad | catálogo: `ActivityDefinition` (`topic` = especialidad + grupo) |
| **Cómo** | presencial / teleconsulta | turno y visita: HL7 v3-ActCode `AMB` / `VR` (extensión `modalidad` y `Encounter.class`); en el catálogo, `useContext` tipo `workflow` |
| **Quién paga** | incluida en el plan / con cargo | `useContext` tipo `program` en la consulta del plan; seña del 50% en el resto |

Así los dos caminos del portal (presencial / teleconsulta) y las vistas de agenda
son **filtros** sobre los mismos datos: no hay "Teleconsulta de X" duplicada en el
catálogo (`nombreSegunModalidad` arma el nombre).

## Flujo

```
Recepción                          Sistema (bots)                               Paciente
─────────                          ──────────────                               ────────
Ficha → "Inscribir"  ────────────▶ som-bienestar-inscribir
                                    ├─ CarePlan plan-bienestar-100 (100 días,
                                    │   3 consultas; lo lee el portal)
                                    └─ Task agendar-consulta-pb100d × 3
"Agendar" consulta inicial ──────▶ som-reservar-turno (tareaId)
 (teleconsulta / presencial)        ├─ R-07, R-20, R-21 (consentimiento)
                                    ├─ Appointment booked: incluida, sin seña
                                    │   (+ link de Jitsi si es teleconsulta)
                                    ├─ día 1 = su fecha → recalcula día 50 y final
                                    └─ WhatsApp de confirmación ────────────────▶ 💬
cron som-recordatorios ──────────▶ se abrió la ventana del día 50 → aviso ─────▶ 💬
                                    mitad de ventana sin agendar → aviso ───────▶ 💬
                                    + tarea urgente + WhatsApp a Recepción
"Agendar" día 50 / final ────────▶ som-reservar-turno (ventana ± 7 días)
Check-in / Completó / Cancelar ──▶ som-estado-turno: Encounter AMB/VR; el plan
                                    marca la consulta; si se cancela, vuelve a
                                    quedar por agendar (no se pierde)
```

El paciente también puede **pedir** cualquier consulta desde el portal
(`som-solicitar-turno`, con `modalidad`); Recepción la confirma desde la ficha.

## Calendario (ejemplo: consulta inicial el 29/09/2026)

| Consulta | Día | Fecha | Ventana para agendar |
|---|---|---|---|
| Inicial | 1 | 29/09/2026 | — (su fecha marca el día 1) |
| Día 50 | 50 | 17/11/2026 | 10/11/2026 al 24/11/2026 |
| Final | 100 | 06/01/2027 | 30/12/2026 al 13/01/2027 |

El plan (`CarePlan.period`) queda del 29/09/2026 al 07/01/2027 (el portal muestra
día X/100).

## Reglas

| Regla | Qué | Dónde |
|---|---|---|
| **R-20** | La consulta del plan se agenda **solo desde su tarea**, en su ventana (antes: bloqueo; después: advertencia). La del día 50 y la final esperan a que esté agendada la inicial. Incluida en el plan: turno confirmado sin seña (el cobro de seña la rechaza). | `validarTareaConsultaPlan`, `validarVentanaConsultaPlan`, `validarConsultaPlanSinTarea` (`src/lib/plan-bienestar.ts`) |
| **R-21** | La modalidad la da el recurso (la agenda virtual es teleconsulta) o el pedido, al reservar por profesional; el servicio y el profesional tienen que ofrecerla; la teleconsulta exige el **consentimiento de teleconsulta** firmado. | `validarModalidadServicio`, `validarConsentimientoTeleconsulta` (`src/lib/teleconsulta.ts`), `som-reservar-turno`, `som-solicitar-turno` |
| **R-22** | Las consultas del plan las atienden los profesionales con `seguimientoPB100D` (hoy los tres cargados), cada uno con su agenda de horarios de 30 min; la reserva ocupa la franja libre del profesional (y del consultorio si es presencial). | `medicosSeguimientoPB100D` (`src/config/medicos.ts`), `src/lib/agenda-profesional.ts`, `som-reservar-turno`, cron `som-generar-agenda` — ver [`reglas-negocio.md`](reglas-negocio.md) |

## Teleconsulta

- **Jitsi de SOM.** Project Secret `JITSI_BASE_URL` (https, p. ej.
  `https://meet.segundaopinionmedica.org`). Cada turno tiene su sala `som-` + 128 bits
  aleatorios (el nombre no identifica al paciente) y queda en la extensión
  `teleconsulta-url` del `Appointment`. Sin el secret, el turno se agenda igual, con
  advertencia y sin link.
- **El link le llega al paciente** con la confirmación (consulta del plan: al agendar;
  con seña: al pagarla) y en los recordatorios de 48 h y 2 h.
- **Consentimiento (genérico).** Uno por paciente, lo firma en el portal. Es un
  `Consent` (el backend no lo crea; lo verifica):

  ```json
  {
    "resourceType": "Consent",
    "status": "active",
    "scope": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/consentscope", "code": "treatment" }] },
    "category": [{ "coding": [{ "system": "http://loinc.org", "code": "59284-0", "display": "Patient Consent" }] }],
    "patient": { "reference": "Patient/{id}" },
    "performer": [{ "reference": "Patient/{id}" }],
    "dateTime": "2026-09-25T12:00:00.000Z",
    "policyRule": {
      "coding": [{
        "system": "https://segundaopinionmedica.org/fhir/CodeSystem/consentimiento",
        "code": "teleconsulta",
        "display": "Consentimiento de teleconsulta (telemedicina)"
      }],
      "text": "<texto que aceptó el paciente>"
    },
    "provision": { "type": "permit" }
  }
  ```

  No es el consentimiento informado de la segunda opinión (`DocumentReference` LOINC
  59284-0): son independientes. Builder de referencia:
  `construirConsentimientoTeleconsulta` (`src/lib/teleconsulta.ts`).
- **Agenda virtual transitoria.** Hasta tener las agendas por profesional, las
  teleconsultas se agendan en `R_TELEMEDICINA` ("Teleconsulta (videollamada)", capacidad
  1: una a la vez). Con la lista de profesionales, la teleconsulta ocupa solo la agenda
  de su profesional.

## Recursos FHIR

Namespace `https://segundaopinionmedica.org/fhir` (`src/fhir/identifiers.ts`).

| Recurso | Qué es | Claves |
|---|---|---|
| `PlanDefinition` | Plantilla del plan (la carga el seed) | `url` `…/PlanDefinition/plan-bienestar-100`, 3 `action` (`inicial`, `mitad`, `final`; desfasajes 42–56 y 92–106 días después de la inicial), `copyright` con la marca registrada |
| `ActivityDefinition` | Catálogo: 12 consultas por especialidad, la consulta del plan (`CONSULTA_PB100D`) y el control GLP-1 | `topic` (SNOMED + `CodeSystem/grupo-especialidad`), `useContext` `workflow` (v3-ActCode `AMB`/`VR`) y `program` (la del plan). Buscable: `ActivityDefinition?context=http://terminology.hl7.org/CodeSystem/v3-ActCode\|VR` |
| `CarePlan` | El plan del paciente | category `care-plans\|plan-bienestar-100` y `period` de 100 días (contrato del portal, sin cambios); `instantiatesCanonical` a la plantilla; una `activity` por consulta (`detail.code` `CodeSystem/consulta-plan-bienestar`, ventana en `scheduledPeriod`, estado `not-started` → `scheduled` → `completed`) y las consultas extra como `activity.reference` → `Appointment` |
| `Task` | Tarea de Recepción: agendar una consulta del plan | `code` `task-tipo\|agendar-consulta-pb100d`, identifier `…/Identifier/programa-bienestar\|{carePlanId}:{consulta}`, `basedOn` el CarePlan, `restriction.period` (ventana), `input` `consulta`/`dia`/`servicio`, `output` → `Appointment` |
| `PractitionerRole` / `Schedule` / `Slot` | El profesional y su agenda (R-22) | `PractitionerRole.code` incluye `rol-profesional\|seguimiento-pb100d` y `servicio\|CONSULTA_PB100D`; `Schedule` identifier `CodeSystem/medico\|SCH_{codigo}`; `Slot` libres de 30 min (`status=free`), identifier `{codigo}@{inicio}`, con la extensión `modalidad` (AMB / VR) una vez por modalidad en que se puede reservar. Horarios disponibles: `Slot?schedule=Schedule/{id}&status=free&start=ge{ahora}` (filtrar por la modalidad elegida) |
| `Appointment` | El turno | `serviceType` (`CodeSystem/servicio`), `specialty` (SNOMED), `participant` → Practitioner, `slot` → sus franjas, extensiones `modalidad` (v3-ActCode), `profesional` y `teleconsulta-url`; consulta del plan: `status=booked` y `supportingInformation` → Task + CarePlan |
| `Encounter` | La visita | `class` = `AMB` o `VR` según la modalidad |
| `Consent` | Consentimiento de teleconsulta | `policyRule` `CodeSystem/consentimiento\|teleconsulta` |
| `Communication` | Avisos | identifier `pb100d-{apertura\|mitad}-{tarea}` (idempotencia) |

## Portal del paciente

Contrato y tareas para `EPA-Developments/app`: [`handoff-app-pb100d.md`](handoff-app-pb100d.md).
Lo que ya lee el portal no cambia: la tarjeta de progreso sigue detectando el plan por
category y período. La policy del paciente ahora lee `ActivityDefinition` (el
catálogo), para armar "Pedir un turno" sin listas escritas a mano.

## Pendientes

Ver [`decisiones-pendientes.md`](decisiones-pendientes.md#plan-bienestar-100-días-y-teleconsulta).
