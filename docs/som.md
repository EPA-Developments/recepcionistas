# SOM — Segunda Opinión Médica (sobre el mismo backend FHIR)

Segunda Opinión Médica (SOM, Dr. Barbagelata · segundaopinionmedica.org) es un
proyecto de **salud cardiovascular convencional** que corre sobre el MISMO backend
Medplum (FHIR R4) que esta recepción (`https://api.medplum.com.ar/`, proyecto
`7ce5e559-f315-4538-abf2-61fa4922f996`). Acá vive el **contrato de backend** que el
portal (`EPA-Developments/app`; originalmente `drdalessandro/app`) espera, reusando
los patrones de la recepción (no se duplican).

Fuente del contrato: `app/docs/medplum/bot-som-interface.md` y el kickoff
`app/docs/som-backend-recepcionistas-kickoff.md` (sincronizado con `app@091e20f`).

## Namespace

Las piezas SOM usan su propio namespace, acordado con el portal:
`https://segundaopinionmedica.org/fhir/...` (ver `src/fhir/identifiers.ts`).

## Bots

| Bot | Quién lo ejecuta | Qué hace |
|---|---|---|
| `som-solicitar` | el paciente (whitelisteado en su AccessPolicy) | Crea una `ServiceRequest` (`status=active`, `code=som-services\|som-cardiology`) con `reasonCode.text=motivo`, `supportingInfo`=cuestionario+estudios y extensión `som-origin` (`valueCode` `self`\|`referral`). |
| `bot-som-report` | interno (lo dispara una `Subscription`) | Reúne Patient/Condition/Observation/MedicationRequest + DocumentReference, calcula **PREVENT (AHA 2023)** → `RiskAssessment`, redacta el informe con **Claude `claude-sonnet-4-6`** (6 secciones en la extensión `som-sections`), genera el PDF → `DocumentReference` (LOINC `11488-4`, `context.related` = la solicitud), pasa la `ServiceRequest` a `completed` y notifica al paciente. |
| `som-procesar-laboratorio` | interno (lo dispara una `Subscription`, solo *create*) | Transcribe el PDF de laboratorio que manda el paciente ("Enviar estudios en PDF") → una `Observation` por analito + `DiagnosticReport` LAB; lo liga al documento (`context.related`). Ver abajo. |

`npm run deploy:bots` crea/asegura (idempotente) las dos `Subscription`:

- `ServiceRequest?status=active&code=…som-services|som-cardiology` → `bot-som-report`.
- `DocumentReference?category=…/CodeSystem/documento|resultado-laboratorio` →
  `som-procesar-laboratorio`, con `subscription-supported-interaction = create`
  (el bot actualiza ese mismo documento al terminar).

Los tres bots son idempotentes: si la solicitud ya tiene `DiagnosticReport` o el
documento ya tiene su informe en `context.related`, no reprocesan.

### `som-solicitar`: controles del lado del servidor

`runAsUser` va **desactivado** (con la policy del paciente, `ServiceRequest` es de
solo lectura y la creación daría `Forbidden`): el bot escribe con su propia
identidad, así que valida todo él mismo:

1. **Consentimiento informado firmado** (`DocumentReference` del paciente,
   `status=current`, `type=http://loinc.org|59284-0`). Si falta devuelve
   `{ ok: false, mensaje: 'Antes de pedir tu Segunda Opinión necesitamos que firmes el consentimiento informado.' }`
   y no crea nada (no se dispara el informe ni sale nada hacia el LLM).
2. **Quién ejecuta**: si Medplum informa `requester` y es un paciente, tiene que ser
   el mismo de `pacienteRef` (el staff sí puede cargar la solicitud de un paciente).
   Si el servidor no manda `requester`, rigen los demás controles.
3. **Adjuntos propios**: el `QuestionnaireResponse` y los `DocumentReference` tienen
   que tener `subject` = el paciente.

### Consentimiento antes del LLM

`bot-som-report` y `som-procesar-laboratorio` vuelven a verificar el consentimiento
antes de mandar datos a Claude (defensa en profundidad): sin él, el informe sale con
las secciones mínimas de revisión manual y el PDF de laboratorio no se procesa.

## AccessPolicy del paciente

`POLICY_PACIENTE_PORTAL` (`src/fhir/access-policies.ts`) es **idéntica** al espejo
del portal (`app/docs/medplum/access-policy-paciente-portal.json`); `tests/seed.test.ts`
la compara con la copia en `tests/fixtures/`. Además de lo anterior, el paciente:

- **lee** `ServiceRequest?subject=%patient` y `RiskAssessment?subject=%patient`;
- **ejecuta** `Bot?name=som-solicitar` (y `som-solicitar-turno`);
- **escribe** su `Consent` (autorización por estudio), el `Binary` de su PDF
  (`Binary?_compartment=%patient`) y solo su obra social/prepaga
  (`Coverage` `type=v3-ActCode|HIP`).

## Informe: RiskAssessment y secciones

- `RiskAssessment.basedOn` = la `ServiceRequest` (el portal busca
  `RiskAssessment?subject=…` y filtra por `basedOn`).
- `prediction[].probabilityDecimal` es una **probabilidad 0–1** (el portal la
  multiplica por 100 para mostrar el %); `outcome.text` = "ASCVD a 10 años",
  "Insuficiencia cardíaca a 10 años", "ECV total a 30 años" (el portal reconoce cada
  desenlace por ese texto; lo fija un test).
- Secciones del informe (claves EXACTAS de `som-sections`): `executive-summary`,
  `risk-assessment`, `history-analysis`, `studies-analysis`, `conclusions`,
  `pending-studies` (ver `SOM_SECCIONES` en `identifiers.ts`).
- Marco clínico del informe: cardiología **convencional** (AHA/ACC, KDIGO, ADA). El
  prompt de Claude le prohíbe usar parámetros o recomendaciones de medicina funcional.

## Estadificación CKM (AHA 2023, Ndumele)

El informe estadifica el síndrome Cardiovascular-Renal-Metabólico según la
Presidential Advisory de la AHA (Ndumele CE, et al. *Circulation* 2023;148:1606–1635):

| Estadío | Criterio (umbrales en `src/config/ckm.ts`) |
|---|---|
| 0 | Sin factores CKM |
| 1 | IMC ≥ 25, cintura ≥ 88 cm (M) / ≥ 102 cm (V), o prediabetes (glucemia 100–125, HbA1c 5,7–6,4 %) |
| 2 | Triglicéridos ≥ 135, HTA (≥ 130/80 o tratamiento), diabetes, síndrome metabólico, o ERC de riesgo moderado/alto (KDIGO) |
| 3 | ECV subclínica con sustrato CKM (calcio coronario > 0, NT-proBNP ≥ 125, troponina us ≥ 14/22 T o ≥ 10/12 I por sexo) o equivalentes de riesgo: ERC de muy alto riesgo (KDIGO) o riesgo PREVENT a 10 años ≥ 20 % |
| 4a / 4b | ECV clínica (coronaria, IC, ACV, arterial periférica, FA) con sustrato CKM; 4b con falla renal (eGFR < 15 o diálisis) |

- **Datos**: `src/lib/ckm-fhir.ts` los lee de la historia por LOINC (con los
  componentes del panel de presión 85354-9 y unidades normalizadas a UCUM), los
  problemas activos por ICD-10 / SNOMED CT (con respaldo por texto) y la medicación
  antihipertensiva. El calcio coronario se reconoce por su nombre (no tiene un LOINC
  de uso extendido).
- **Datos incompletos**: no se adivina. El resultado es el estadío que los datos
  demuestran; si faltan datos básicos, es "al menos Estadío X" con la lista de lo que
  falta. NT-proBNP/troponina y calcio coronario se informan como "ECV subclínica no
  evaluada" (no se piden a todos).
- **Dónde queda**: en el MISMO `RiskAssessment` de PREVENT (el portal toma el primero
  con `basedOn` = la solicitud): extensiones `ckm-stage` (`0`…`4b`) y
  `ckm-stage-completo` (boolean), y una `note` con criterios y faltantes. También va
  al prompt de Claude y a la sección `risk-assessment` del informe de respaldo.
- Los mismos datos codificados alimentan PREVENT (la diabetes ya no se infiere de un
  texto que diga "prediabetes").

## Laboratorio en PDF (`som-procesar-laboratorio`)

1. Lee el PDF del `DocumentReference`: por `url` (`medplum.download`) o embebido en
   `attachment.data` (base64, hasta que el servidor deje crear el `Binary`).
2. **Claude `claude-opus-5`** transcribe (salida estructurada; `fallbacks: "default"`
   ante una negativa) nombre, valor, unidad, rango del laboratorio y fecha de
   extracción. El **catálogo de códigos sale de las `ObservationDefinition` del
   servidor** (LOINC o `CodeSystem/biomarker`): Claude solo elige una clave de ese
   catálogo o `null`; un analito fuera del catálogo se guarda con su nombre
   (`code.text`), sin inventar códigos. UCUM solo si la unidad coincide con la del
   catálogo.
3. Crea una `Observation` por analito (`status=final`, category `laboratory`,
   `referenceRange` del informe, `derivedFrom` = el documento) y el
   `DiagnosticReport` (LAB, LOINC `11502-2`, `result` = las Observation,
   `presentedForm` = el PDF si está por `url`).
4. Suma `DiagnosticReport/<id>` a `DocumentReference.context.related`: el portal
   pasa de "En proceso" a "Ver resultados".
5. Si no se puede leer (o falta `ANTHROPIC_API_KEY`): `Communication` al paciente
   ("te vamos a contactar por Mensajes") y `Task` `revisar-laboratorio` al equipo.
   Para reprocesar, ejecutar el bot con el `DocumentReference` como entrada.

## Patient Journey y Plan Bienestar

- **`patient-origin`**: `som-invitar-paciente` lo escribe en el `Patient` al invitar
  (`valueCode` `reception`, o `referral` si Recepción tilda "Lo derivó un colega").
  Sin la extensión, el portal lo trata como auto-registrado. `onboarding-completed`
  lo escribe el portal: el backend no lo toca.
- **Plan Bienestar · 100 días**: `som-bienestar-inscribir` (Recepción) crea el
  `CarePlan` `care-plans|plan-bienestar-100`, `status=active`, `period.start` = día 1
  y `period.end` = inicio + 100 días. Hitos y racha los calcula el portal.

## Turnos (solicitud desde el portal)

`som-solicitar-turno` recibe `{ pacienteRef, servicio, servicioCodigo,
preferenciaInicio?, preferenciaTexto?, nota }` y solo acepta los `servicioCodigo` de
`SERVICIOS` del portal (`SERVICIOS_SOLICITABLES` en `src/lib/solicitudes.ts`:
`CONSULTA_CARDIO`, `EVALUACION_INICIAL`, `TELECONSULTA`, `ECG`, `ECOCARDIOGRAMA`,
`ERGOMETRIA`, `HOLTER`, `MAPA`, `MONITOREO_REMOTO`, `REHABILITACION_CV`,
`LABORATORIO_CARDIO`). El contrato anterior (`terapia`/`terapiaCodigo`) se sigue
aceptando para portales viejos.

## Biomarcadores (panel Cardiometabólico) — solo rangos convencionales

Las `ObservationDefinition` viven en `src/config/biomarcadores.ts` y las carga
`npm run seed` (upsert por `system|code`: R4 no define search params para
`ObservationDefinition`, así que no duplica y reusa las que ya estén en el servidor).
LOINC + UCUM, **solo rangos convencionales** con la guía citada:

| Biomarcador | Umbral | Fuente |
|---|---|---|
| Colesterol total | < 200 mg/dL | NCEP ATP III |
| HDL | ≥ 40 (V) / ≥ 50 (M) mg/dL | AHA/NHLBI (síndrome metabólico) |
| LDL | < 100 mg/dL (la meta depende del riesgo) | NCEP ATP III |
| Triglicéridos | < 150 mg/dL | NCEP ATP III |
| ApoB | < 130 mg/dL | AHA/ACC 2018 (factor que aumenta el riesgo) |
| Lp(a) | < 125 nmol/L | AHA/ACC 2018 (factor que aumenta el riesgo) |
| Glucemia en ayunas | 70–100 mg/dL | ADA |
| HbA1c | < 5,7 % | ADA |

Sin rangos `funcional` y sin LDL-P (no está en las guías). Para limpiar las
definiciones que ya estaban en el servidor con rangos funcionales:
`npm run biomarcadores:convencional` (lista, dry-run) y `-- --apply` (los quita,
conserva los convencionales; Medplum guarda el historial).

## ⚠️ Pendientes / a validar

- **Coeficientes PREVENT (`src/lib/prevent.ts`) — validación clínica pendiente.**
  Transcriptos del modelo base de Khan 2024 (Circulation) y marcados
  `PENDIENTE_VALIDACION`: el `RiskAssessment` se emite `status=preliminary` con una
  nota (el contrato pide `final`; el portal no filtra por estado). **No usar como
  valor definitivo sin la firma del equipo médico.** Confirmar contra una
  calculadora de referencia (ACC) antes de producción.
- **Umbrales CKM y biomarcadores** (`src/config/ckm.ts`, `biomarcadores.ts`): citados
  de las guías y marcados pendientes de firma médica. A confirmar: triglicéridos del
  Estadío 2 (Ndumele ≥ 135 vs ≥ 150 de la guía CKM 2026), calcio coronario (> 0 vs
  ≥ 100), y ApoB / Lp(a) con los umbrales AHA/ACC 2018 (antes 66–144 mg/dL y < 75 nmol/L).
- **PREVENT de ECV total a 10 años** no se calcula todavía: para el equivalente de
  riesgo del Estadío 3 se usan ASCVD e IC a 10 años (si alguno es ≥ 20 %, la ECV total
  también lo es); si ambos son < 20 % queda como dato faltante.
- **`performer` de la solicitud (Dr. Barbagelata)**: el contrato lo pide "si está
  disponible"; no hay profesionales cargados todavía (`src/config/medicos.ts`).
- **Catálogo nuevo.** Se arma de cero con los profesionales de SOM: profesionales,
  consultas, precios, duraciones, consultorios/salas y horario. No se inventan
  precios ni reglas (tampoco el precio del Plan Bienestar).
- **En el servidor** (requiere credenciales del proyecto SOM): `npm run seed`
  (policy + lípidos), `npm run deploy:bots` (bots + Subscriptions), Project Secret
  `ANTHROPIC_API_KEY`, y confirmar que el `ClientApplication` y las
  `ProjectMembership` de los pacientes son del proyecto `7ce5e559-…`
  (`npm run diagnostico-acceso`).
