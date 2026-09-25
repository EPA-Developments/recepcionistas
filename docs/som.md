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
| `bot-som-report` | interno (lo dispara una `Subscription`) | Reúne Patient/Condition/Observation/MedicationRequest + DocumentReference, calcula **PREVENT** (AHA, 10 y 30 años) y el **estadío CKM con el plan de la Guía 2026** → `RiskAssessment`, redacta el informe con **Claude `claude-sonnet-4-6`** (6 secciones en la extensión `som-sections`), genera el PDF → `DocumentReference` (LOINC `11488-4`, `context.related` = la solicitud), pasa la `ServiceRequest` a `completed` y notifica al paciente. |
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
  multiplica por 100 para mostrar el %). Los 3 primeros lugares son los que lee el
  portal: "ASCVD a 10 años", "Insuficiencia cardíaca a 10 años", "ECV total a 30 años"
  (por texto y, si no, por posición; lo fija un test que copia su `extractPrevent`).
- Secciones del informe (claves EXACTAS de `som-sections`): `executive-summary`,
  `risk-assessment`, `history-analysis`, `studies-analysis`, `conclusions`,
  `pending-studies` (ver `SOM_SECCIONES` en `identifiers.ts`).
- Marco clínico del informe: cardiología **convencional** (AHA/ACC, KDIGO, ADA). El
  prompt de Claude le prohíbe usar parámetros o recomendaciones de medicina funcional.

## Estadificación CKM y PREVENT — Guía AHA/ACC/ADA/ASN 2026

Base: *2026 AHA/ACC/ADA/ASN Guideline for the Prevention, Detection, Evaluation, and
Management of Cardiovascular-Kidney-Metabolic Syndrome* (Ndumele CE, Rodriguez F, et
al. *Circulation* 2026; doi:10.1161/CIR.0000000000001453), que reemplaza a la
Presidential Advisory de 2023. Umbrales en `src/config/ckm.ts`; lógica pura en
`src/lib/ckm.ts` (estadío), `src/lib/ckm-guia.ts` (plan) y `src/lib/prevent.ts`.

### Estadíos (Tabla 4)

| Estadío | Criterios |
|---|---|
| 0 | Sin factores de riesgo CKM |
| 1 | IMC ≥ 25, cintura ≥ 88 cm (M) / ≥ 102 cm (V), o prediabetes (glucemia 100–125 mg/dL o HbA1c 5,7–6,4 %) |
| 2 | HTA (≥ 130/80 o tratamiento), **triglicéridos ≥ 150**, síndrome metabólico (AHA/NHLBI, ≥ 3 de 5), DM2 (glucemia ≥ 126 o HbA1c ≥ 6,5 %) o ERC de riesgo moderado-alto (KDIGO: G1–G2 con A2–A3, G3a con A1–A2, G3b con A1) |
| 3 | ECV subclínica con factores CKM — aterosclerosis: **calcio coronario ≥ 100**, aterosclerosis coronaria subclínica documentada o índice tobillo-brazo bajo sin claudicación; pre-IC: NT-proBNP ≥ 125, BNP ≥ 35, troponina T us ≥ 14 (M) / ≥ 22 (V), troponina I us ≥ 10 / ≥ 12 ng/L o ecocardiograma (Tabla 16) — o equivalentes de riesgo: ERC de muy alto riesgo (G3a-A3, G3b-A2/A3, G4–G5) o **PREVENT-CVD a 10 años ≥ 20 %** |
| 4a / 4b | ECV clínica (coronaria, IC, ACV/AIT, arterial periférica, FA) con factores CKM; 4b con falla renal (eGFR < 15 o diálisis crónica) |

- **Pre-IC por ecocardiograma (Tabla 16)**: volumen auricular izquierdo indexado
  ≥ 29 mL/m², masa del VI > 116 (V) / > 95 (M) g/m², espesor parietal relativo > 0,42,
  espesor de pared ≥ 12 mm, FEVI < 50 %, strain longitudinal global < 16 %, e′ septal
  < 7 cm/s, velocidad de IT > 2,8 m/s, PSAP > 35 mmHg, E/e′ ≥ 15.
- **Datos incompletos**: no se adivina. El resultado es el estadío que los datos
  demuestran; si faltan datos básicos es "al menos Estadío X" con la lista de lo que
  falta. La UACR se exige desde el Estadío 2 (como la guía). La ECV subclínica sin
  estudiar se informa aparte (no se pide a todos: ver el plan).
- **Advertencias**: HTA por una sola lectura y ERC por un solo valor (la guía pide
  ≥ 2 lecturas y ≥ 2 mediciones separadas ≥ 3 meses); péptidos natriuréticos con ERC.

### PREVENT (modelo base, 10 y 30 años)

- ECV total (PREVENT-CVD), ASCVD e IC a 10 y 30 años. Coeficientes **generados** desde
  la tabla de la implementación de referencia `preventr` (CRAN) — no transcriptos a
  mano — y verificados en `tests/prevent.test.ts` contra sus 12 valores de referencia
  (mujer y varón, 10 y 30 años).
- Rangos válidos como la calculadora de la AHA: 30–79 años (30 años: solo 30–59), CT
  130–320 y HDL 20–100 mg/dL, PAS 90–180, eGFR 15–140, IMC 18,5–39,9 (IC). Fuera de
  rango no se estima y se informa el motivo.
- **No se usa con ECV clínica** (Estadío 4, Figura 4 de la guía).

### Plan según la guía (`ckm-guia.ts`)

- **Seguimiento (Figura 3)**: IMC, cintura y PA anual; lípidos, glucemia y eGFR cada
  ≤ 5 años (Estadío 0), cada 2–3 años (Estadío 1; glucemia anual con prediabetes) y
  anual con UACR desde el Estadío 2; ERC de muy alto riesgo cada 3–6 meses.
- **Evaluaciones**: UACR desde el Estadío 2; pre-IC (NT-proBNP/BNP, troponina us en
  obesidad) con PREVENT-HF 10a ≥ 5 %; calcio coronario con PREVENT-ASCVD 10a 3 % a
  < 10 % si hay incertidumbre; completar los datos de PREVENT.
- **Umbrales para decisiones del médico (Tabla 8 y secciones 5.5)**: PREVENT-CVD
  ≥ 7,5 % con DM2 → priorizar SGLT2i / terapia GLP-1; PA ≥ 140/90, o ≥ 130/80 con DM2,
  ERC o PREVENT-CVD ≥ 7,5 % → tratamiento farmacológico (meta < 130/80);
  PREVENT-ASCVD ≥ 5 % → hipolipemiante (3 % a < 5 % o 30 años ≥ 10 %: considerar);
  ERC con DM2 o albuminuria → RASi + SGLT2i. Es soporte a la decisión: el sistema no
  prescribe.
- **Potenciadores (Tabla 9)** detectados en la historia: enfermedades inflamatorias o
  autoinmunes, apnea del sueño, depresión/ansiedad, menopausia prematura, resultados
  adversos del embarazo, SOP, disfunción eréctil, antecedentes familiares de diabetes
  o falla renal, PCR us ≥ 2 mg/L.

### Datos y dónde queda

- `src/lib/ckm-fhir.ts` lee la historia por LOINC (incluidos los componentes del panel
  de PA 85354-9, BNP, FEVI), con unidades normalizadas a UCUM; problemas por ICD-10 /
  SNOMED CT (AIT y revascularización coronaria incluidos) con respaldo por texto; el
  calcio coronario, el índice tobillo-brazo y el ecocardiograma de la Tabla 16 por su
  nombre.
- Todo va en el MISMO `RiskAssessment` (el portal toma el primero con `basedOn` = la
  solicitud): `prediction[]` con lugares fijos (ASCVD 10a, IC 10a, ECV total 30a, ECV
  total 10a, ASCVD 30a, IC 30a; un desenlace no estimado ocupa su lugar sin
  probabilidad y con `rationale`, para que el portal nunca muestre un valor ajeno),
  extensiones `ckm-stage` / `ckm-stage-completo` y notas con el estadío y el plan.
  También van al prompt de Claude y al informe de respaldo (`pending-studies` lista
  las evaluaciones que sugiere la guía).

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

- **Firma médica (Gobernanza).** PREVENT (coeficientes ya verificados contra la
  implementación de referencia) y los umbrales CKM de la Guía 2026 siguen marcados
  `PENDIENTE_VALIDACION`: el `RiskAssessment` sale `status=preliminary` con una nota
  hasta la firma del equipo médico (el contrato pide `final`; el portal no filtra por
  estado).
- **A confirmar**: índice tobillo-brazo "bajo" (la guía no fija el valor; se usa
  ≤ 0,90); umbrales de ApoB (< 130 mg/dL) y Lp(a) (< 125 nmol/L) de los biomarcadores
  (AHA/ACC 2018). Ascendencia asiática: no se aplican sus umbrales (la ficha no la
  registra).
- **Modelos PREVENT con UACR / HbA1c / SDI** (complementos del modelo base): no se
  usan todavía.
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
