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

## Biomarcadores (panel Cardiometabólico)

Las `ObservationDefinition` de lípidos (Colesterol total, HDL, LDL, ApoB, Lp(a),
LDL-P, Triglicéridos; panel `metabolico`) viven en `src/config/biomarcadores.ts` y
las carga `npm run seed` (upsert por `system|code`: R4 no define search params para
`ObservationDefinition`, así que no duplica y reusa las que se hayan cargado a mano
con el Batch del portal). Unidades UCUM.

## ⚠️ Pendientes / a validar

- **Coeficientes PREVENT (`src/lib/prevent.ts`) — validación clínica pendiente.**
  Transcriptos del modelo base de Khan 2024 (Circulation) y marcados
  `PENDIENTE_VALIDACION`: el `RiskAssessment` se emite `status=preliminary` con una
  nota (el contrato pide `final`; el portal no filtra por estado). **No usar como
  valor definitivo sin la firma del equipo médico.** Confirmar contra una
  calculadora de referencia (ACC) antes de producción.
- **Colesterol total funcional (< 100 mg/dL)**: no se publica hasta que lo confirme
  el Dr. Barbagelata (¿errata por el objetivo de LDL?). El seed lo avisa.
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
