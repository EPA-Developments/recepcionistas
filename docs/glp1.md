# Seguimiento de tratamiento GLP-1

Programa de seguimiento de un tratamiento con GLP-1 (semaglutida, tirzepatida,
etc.), integrado a la Recepción y a la app del paciente. **Slice 1** de la
opción B: el programa vive en este repo, con el mismo módulo de calendario que la
plataforma CKM (`src/lib/glp1/`) para poder unificarlos después (opción C).

> Principio: **el sistema calcula el calendario, Recepción solo agenda.** La
> semana de cada control, su ventana y qué estudios lleva salen del esquema de
> titulación que indica el médico. Recepción no ve el plan clínico: solo tareas
> con semana, ventana y "traer laboratorio sí/no".

## Flujo

```
Recepción                    Equipo médico                   Sistema (bots)
─────────                    ─────────────                   ──────────────
Ficha → "Inscribir"  ──────────────────────────────────────▶ som-glp1-inscribir
                                                              └─ Task indicacion-glp1 (al equipo médico)
                             Carga la indicación ──────────▶ som-glp1-plan
                             (molécula, esquema,              ├─ CarePlan + Goal (meta de peso)
                              fecha de inicio)                ├─ ServiceRequest por estudio y semana
                                                              └─ Task agendar-control-glp1 por semana
Vista "GLP-1" / ficha
→ "Agendar" (día y hora) ──────────────────────────────────▶ som-reservar-turno (con tareaId)
                                                              ├─ valida R-07 + R-19 (ventana)
                                                              ├─ Appointment tentativo + WhatsApp
                                                              │   (pide traer el laboratorio si toca)
                                                              └─ completa la Task (output → Appointment)
                             Cambia la titulación ─────────▶ som-glp1-plan otra vez
                                                              └─ recalcula en el lugar (ver abajo)
```

1. **Inscripción (Recepción).** En *Atender paciente → Seguimiento de tratamiento
   GLP-1 → Inscribir*. El bot `som-glp1-inscribir` deja un `Task`
   `indicacion-glp1` para el equipo médico. Es idempotente: si ya hay una
   indicación pendiente o un programa activo, no crea nada y devuelve el estado.
2. **Indicación (equipo médico).** El médico ejecuta `som-glp1-plan` con la
   indicación (ver [Entrada](#entrada-de-som-glp1-plan)). El bot arma el
   programa y completa la tarea de indicación. Recepción **no** puede ejecutar
   este bot (su AccessPolicy solo habilita los bots de Recepción).
3. **Agenda (Recepción).** Los controles aparecen en la pestaña **GLP-1**
   (cola de todos los pacientes, con filtros *En ventana / Vencidos / Próximos*)
   y en la ficha del paciente. Al agendar, el bot de reserva valida la ventana
   (R-19) y la capacidad (R-07); el turno queda tentativo, como cualquier otro, y
   la tarea se completa.
4. **Recalcular.** Si cambia la titulación (o la fecha de inicio), el médico
   vuelve a ejecutar `som-glp1-plan`. Hay **un programa activo por paciente**: se
   actualiza en el lugar (mismo `CarePlan` y `Goal`), la revisión de respuesta se
   corre, las tareas y pedidos pendientes se actualizan o cancelan, y **lo ya
   agendado no se toca**: vuelve en `aRevisar` para reprogramarlo a mano.

## Calendario

Fuente única: `monitoringPlan` en `src/lib/glp1/monitoring.ts` (módulo
compartido con CKM). Semanas contadas desde la primera aplicación; `T` = semana
en la que se alcanza la dosis terapéutica (suma de los escalones previos).

| Control | Semana | Estudios (slugs del catálogo de biomarcadores) |
|---|---|---|
| Basal | 0 (antes de la 1.ª aplicación) | hba1c, glucosa, insulina, HOMA-IR, perfil lipídico, creatinina, eGFR, AST, ALT |
| Tolerancia y adherencia | 4 | — |
| Primer balance | 12 | hba1c y glucosa solo si la indicación es `dm2` |
| **Revisión de respuesta** | **T + 12** | hba1c, glucosa, creatinina, eGFR |
| Control completo | 26 | perfil metabólico + creatinina y eGFR |
| Oftalmología (si hay retinopatía) | 12 | — (fondo de ojo) |
| Función renal (si UACR > 0 o eGFR < 60) | 26 | creatinina, eGFR |

- **La revisión de respuesta no es fija:** cae 12 semanas después de llegar a
  la dosis terapéutica, cuando el resultado ya es interpretable. Criterio:
  descenso ≥ 5 % del peso basal (meta del `Goal`, LOINC 29463-7).
- Recepción agenda **un control por semana**: las visitas que caen la misma
  semana (p. ej. semana 12 + oftalmología) van en un solo turno, con los
  estudios unidos.

Ejemplos:

| Indicación | Titulación | T | Revisión | Controles a agendar |
|---|---|---|---|---|
| `dm2` | 0,25 mg ×4 → 0,5 mg ×4 → 1 mg | 8 | semana 20 | 0, 4, 12, 20, 26 |
| `peso` | 0,25 → 0,5 → 1 → 1,7 mg (×4 c/u) → 2,4 mg | 16 | semana 28 | 0, 4, 12, 26, 28 |

## Ventana para agendar (R-19, provisional)

| Control | Ventana |
|---|---|
| Basal | los 7 días previos a la fecha de inicio, hasta ese día |
| Resto | desde la semana calculada hasta 7 días después |

- **Antes de la ventana:** bloqueo. La semana la calcula el programa, y en el
  caso de la revisión de respuesta, antes no hay resultado interpretable.
- **Después de la ventana:** se agenda igual, con advertencia.
- **Control GLP-1 sin su tarea:** bloqueo. El servicio `CONTROL_GLP1` se agenda
  solo desde "GLP-1" o la ficha, para que el turno quede atado a su semana. Por
  eso no aparece en la reserva libre (agenda ni ficha).

Los 7 días (`VENTANA_CONTROL_GLP1_DIAS` en `src/config/reglas.ts`) están a
confirmar: ver [`decisiones-pendientes.md`](decisiones-pendientes.md).

## Entrada de `som-glp1-plan`

`EntradaPlanGlp1` (`src/lib/glp1-plan.ts`):

```json
{
  "pacienteRef": "Patient/123",
  "fechaInicio": "2026-10-05",
  "molecula": "Semaglutida",
  "indicacion": "dm2",
  "titulacion": [
    { "dosis": "0,25 mg semanal", "semanas": 4 },
    { "dosis": "0,5 mg semanal", "semanas": 4 },
    { "dosis": "1 mg semanal", "semanas": 0, "terapeutica": true }
  ],
  "retinopatia": false,
  "uacrMgG": 0,
  "egfr": 85,
  "pesoBasalKg": 92
}
```

- `indicacion`: `dm2` (esquema de diabetes tipo 2) o `peso` (control de peso).
- `titulacion`: escalones en orden; **uno solo** con `terapeutica: true`. El
  sistema no propone dosis ni esquemas: los indica el médico.
- `retinopatia`, `uacrMgG` y `egfr` son opcionales y suman controles.
  `pesoBasalKg` es opcional: si está, la meta del `Goal` queda en kg.
- Hoy se ejecuta desde la app de Medplum (Bot → *Execute*, input JSON) o por API
  (`POST Bot/{id}/$execute`) con un usuario del equipo médico. Una pantalla o
  `Questionnaire` para el médico queda pendiente.

Respuesta: `{ ok, carePlanId, goalId, recalculado, semanaRevision, controles[],
tareas{creadas, actualizadas, canceladas}, pedidos{creados, actualizados,
revocados}, aRevisar[] }`.

## Recursos FHIR

Namespace `https://segundaopinionmedica.org/fhir` (`src/fhir/identifiers.ts`).

| Recurso | Qué es | Claves |
|---|---|---|
| `PlanDefinition` | Plantilla del programa (la carga el seed). | `url` `…/PlanDefinition/seguimiento-glp1`, `version` 1; acciones → `ActivityDefinition` `CONTROL_GLP1` |
| `CarePlan` | El programa del paciente (uno activo por paciente). | `category` `…/CodeSystem/care-plans\|seguimiento-glp1` (mismo sistema que el Plan Bienestar de la app); `instantiatesCanonical` a la plantilla; actividad de medicación + una por visita (`scheduledPeriod` = ventana) |
| `Goal` | Meta: ≥ 5 % de descenso del peso basal en la revisión. | LOINC 29463-7; `dueDate` = fecha de la revisión |
| `ServiceRequest` | Un pedido por estudio y semana. | `code` `…/CodeSystem/biomarcador\|{slug}`; `category` SNOMED 108252007; `requisition` agrupa la semana; `basedOn` el `CarePlan`; `occurrencePeriod` = ventana |
| `Task` `agendar-control-glp1` | Lo que ve Recepción: un control por semana. | `code` `…/CodeSystem/task-tipo\|agendar-control-glp1`; `restriction.period` = ventana; `input`: `semana`, `requiere-laboratorio`, `servicio`; al agendar, `output` → `Appointment` |
| `Task` `indicacion-glp1` | Pedido al equipo médico al inscribir. | al armar el plan, `output` → `CarePlan` |
| `Appointment` | El turno del control. | servicio `CONTROL_GLP1` (consultorio) |

Upsert idempotente: tareas y pedidos llevan identifier
`…/Identifier/programa-glp1|{carePlanId}:semana-{N}` (los pedidos, además,
`:{slug}`). Al recalcular se crea lo nuevo, se actualiza lo pendiente que
cambió, se cancela (`Task.status=cancelled`, `ServiceRequest.status=revoked`) lo
pendiente que ya no va, y lo cerrado nunca se pisa.

## Privacidad

- **Recepción** lee y escribe `Task` y `Appointment`; **no** tiene `CarePlan`,
  `Goal`, `ServiceRequest` ni `MedicationRequest` en su AccessPolicy. Ve la
  semana, la ventana y si lleva laboratorio, nunca el esquema ni los estudios.
- **El paciente** lee su `CarePlan`, `Goal`, `ServiceRequest`, `Task` y
  `Appointment` (policy "Paciente SOM — Portal").
- **El equipo médico** (hoy "Director Médico — Clínico completo") ejecuta
  `som-glp1-plan` y ve todo.

## App del paciente (slice 2) y unificación con CKM

Contrato para el portal (`EPA-Developments/app`), todo de solo lectura:

- `CarePlan?subject=%patient&category=…/CodeSystem/care-plans|seguimiento-glp1&status=active`
  → el programa: título, esquema (actividad `MedicationRequest`), visitas con sus
  ventanas y la nota con la revisión de respuesta.
- `Goal` referenciado por el `CarePlan` → la meta de peso y la fecha de la
  revisión.
- `Task?patient=%patient&code=…/CodeSystem/task-tipo|agendar-control-glp1` →
  estado de cada control (`requested` = por agendar, `completed` = agendado, con
  `output` → `Appointment`).
- `ServiceRequest?subject=%patient&based-on=CarePlan/{id}` → los estudios de
  cada semana (agrupados por `requisition`).

Las solicitudes de segunda opinión se distinguen por su `code`
(`som-services|som-cardiology`): el portal no debe mezclarlas con estos pedidos.

Estudios: el `code` de los pedidos es el **slug** del catálogo de biomarcadores
de CKM (`…/CodeSystem/biomarcador`), que **no** es el catálogo de la app (LOINC,
o `…/CodeSystem/biomarker` para los que no tienen LOINC). Equivalencias
(los LOINC de la app son provisionales, ver su `Biomarkers.data.ts`):

| Slug | Nombre visible | Código en el catálogo de la app |
|---|---|---|
| `hba1c` | Hemoglobina glicosilada (HbA1c) | LOINC 4548-4 |
| `glucosa-en-ayunas` | Glucemia en ayunas | LOINC 1558-6 |
| `insulina-en-ayunas` | Insulina (ayunas) | LOINC 2484-4 |
| `homa-ir` | Índice HOMA-IR | `…/CodeSystem/biomarker\|homa-ir` |
| `colesterol-total` | Colesterol total | LOINC 2093-3 |
| `hdl-colesterol` | Colesterol HDL | LOINC 2085-9 |
| `ldl-colesterol` | Colesterol LDL | LOINC 13457-7 |
| `trigliceridos` | Triglicéridos | LOINC 2571-8 |
| `creatinina` | Creatinina | — (no está en el catálogo de la app) |
| `egfr-tfg-estimada` | Filtrado glomerular estimado (eGFR) | — |
| `ast-got` | AST (TGO) | — |
| `alt-tgp` | ALT (TGP) | — |

**Unificación con CKM (opción C):** `src/lib/glp1/` se mantiene igual al original
(solo cambian los imports). `titration.ts` y `eligibility.ts` son contratos
**interinos** con lo mínimo que usa `monitoring.ts`: al traer los originales se
reemplazan sin tocar el resto. El armado FHIR (`src/lib/glp1-plan.ts`) queda del
lado de SOM.

## Pendiente

Ver la sección *Seguimiento GLP-1* de
[`decisiones-pendientes.md`](decisiones-pendientes.md).
