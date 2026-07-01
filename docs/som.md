# SOM — Segunda Opinión Médica (sobre el mismo backend FHIR)

Segunda Opinión Médica (SOM, Dr. Barbagelata · segundaopinionmedica.org) es un
proyecto de **salud cardiovascular convencional** que corre sobre el MISMO backend
Medplum (FHIR R4) que la recepción de Segunda Opinión Médica. Esta primera entrega agrega el
**contrato de backend** que el portal (`drdalessandro/app`, PR #2) ya espera, sin
tocar las piezas existentes de Segunda Opinión Médica (se reusan los patrones, no se duplican).

## Namespace

Las piezas SOM usan su propio namespace, acordado con el portal:
`https://segundaopinionmedica.org/fhir/...` (ver `src/fhir/identifiers.ts`).

## Bots

| Bot | Quién lo ejecuta | Qué hace |
|---|---|---|
| `som-solicitar` | el paciente (whitelisteado en su AccessPolicy) | Crea una `ServiceRequest` (`status=active`, `code=som-services\|som-cardiology`) con `reasonCode.text=motivo`, `supportingInfo`=cuestionario+estudios y extensión `som-origin`. Clona la mecánica de `som-solicitar-turno`. |
| `bot-som-report` | interno (lo dispara una `Subscription`) | Reúne Patient/Condition/Observation/MedicationRequest + DocumentReference, calcula **PREVENT (AHA 2023)** → `RiskAssessment`, redacta el informe con **Claude `claude-sonnet-4-6`** (6 secciones en la extensión `som-sections`), genera el PDF → `DocumentReference` (LOINC `11488-4`), pasa la `ServiceRequest` a `completed` y notifica al paciente. |

`bot-som-report` se dispara con una `Subscription` sobre
`ServiceRequest?status=active&code=…som-services|som-cardiology`, que `npm run
deploy:bots` crea/asegura (idempotente) apuntando al bot. El bot es idempotente:
si la `ServiceRequest` ya tiene un `DiagnosticReport`, no reprocesa.

> Endurecer ambos bots con `runAsUser` en Medplum para que el `subject`/`requester`
> no se pueda falsificar.

## AccessPolicy del paciente

`POLICY_PACIENTE_PORTAL` (`src/fhir/access-policies.ts`) suma, de **solo lectura**,
`ServiceRequest?subject=%patient` y `RiskAssessment?subject=%patient`, y un segundo
Bot ejecutable `Bot?name=som-solicitar`. Debe quedar idéntica al espejo del portal
(`app/docs/medplum/access-policy-paciente-portal.json`).

## Secciones del informe (claves EXACTAS de `som-sections`)

`executive-summary`, `risk-assessment`, `history-analysis`, `studies-analysis`,
`conclusions`, `pending-studies` (ver `SOM_SECCIONES` en `identifiers.ts`).

## ⚠️ Pendientes / a validar

- **Coeficientes PREVENT (`src/lib/prevent.ts`) — validación clínica pendiente.**
  Están transcriptos del modelo base de Khan 2024 (Circulation) y marcados con
  `PENDIENTE_VALIDACION`; el `RiskAssessment` se emite `status=preliminary` con una
  nota. **No usar como valor definitivo sin la firma del equipo médico** (igual que
  el CodeSystem de contraindicaciones). Confirmar contra una calculadora de
  referencia (ACC) antes de producción.
- **Escala de `RiskAssessment.prediction.probabilityDecimal`.** Se emite en
  **porcentaje (0–100)**. Confirmar con el portal que es la escala esperada.
- **Precios/reglas del catálogo cardiovascular.** El catálogo ya son las consultas
  de segunda opinión de cardiología y sus subespecialidades (Hemodinamia,
  Electrofisiología, Medicina Nuclear, Prevención CV, Rehabilitación CV), pero con
  **precio PENDIENTE** (`precioARS: 0`): faltan la **lista de precios y las reglas**
  oficiales (no se inventan). Combos, membresías y paquetes quedan vacíos hasta que
  se definan para el modelo cardiovascular. Confirmar también la **duración** de cada
  consulta y la **lista real de consultorios/salas** (hoy provisional).
- **Proyecto Medplum canónico.** Definir el `MEDPLUM_PROJECT_ID`/credenciales del
  proyecto SOM antes de `npm run seed` / `npm run deploy:bots`. Esta entrega es solo
  código (no se seedeó ni deployó).
