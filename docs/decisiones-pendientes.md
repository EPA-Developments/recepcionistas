# Decisiones pendientes

Definiciones que dependen del negocio u otras fuentes. Las **bloqueantes**
frenan una parte del avance; el resto se resuelve en paralelo.

## Catálogo Segunda Opinión Médica — ⚠️ BLOQUEANTE para cobrar

**Se arma de cero con los profesionales de SOM** (decisión del Dr. Alejandro
Barbagelata y el Dr. Alejandro Sergio D'Alessandro). Las **especialidades ya están
definidas** (`src/config/catalogo.ts`: DBT / Endocrino, Nutrición, Cardiología,
Cardiología con especialidad —Insuficiencia Cardíaca, Hemodinamia, Electrofisiología,
Medicina Nuclear, Prevención CV, Rehabilitación CV—, Tisioneumonología, Neurología y
Ginecología; cada una presencial y por teleconsulta), más la consulta del Plan
Bienestar 100 Días® y el control GLP-1. Faltan los **precios** y los
**profesionales**: `src/config/medicos.ts` sigue **vacío**. El catálogo anterior,
ajeno a SOM (servicios/combos/paquetes/membresías/contraindicaciones y sus bots/UI),
**se retiró del código**.

| # | Pendiente | Detalle |
|---|---|---|
| 1 | **Lista de precios oficial** | Todas las consultas por especialidad están con `precioARS: 0` (nota "Precio PENDIENTE"); la del Plan Bienestar va en 0 porque está incluida. No se inventan precios: los arman el Dr. D'Alessandro y el Dr. Barbagelata (¿distinto presencial y teleconsulta?). |
| 2 | **Duración de cada consulta** | Provisional 45 min. Confirmar con la operación (¿varía por especialidad? ¿la teleconsulta dura distinto?). |
| 3 | **Consultorios / salas reales** | `src/config/recursos.ts` tiene una lista PROVISIONAL (2 consultorios + agenda de teleconsultas + sala de rehabilitación). Confirmar la lista real. |
| 4 | **Honorarios profesionales (split)** | Hoy todo es `SOM_100`. Definir cómo se reparte el honorario del especialista por consulta. |
| 5 | **¿Paquetes / seguimiento?** | ¿Existe algo como "paquete de seguimiento" con el mismo especialista, o cada segunda opinión es un evento único? Si existe, se modela con sus reglas oficiales (no se reutiliza el modelo anterior). El primer programa de seguimiento ya modelado es el **GLP-1** (ver abajo). |
| 6 | **Profesionales de SOM** | `src/config/medicos.ts` está vacío: cargar los profesionales de SOM (especialidad, consultas que atiende, modalidad, horario). Las consultas del Plan Bienestar hoy las atienden el Dr. Barbagelata, la Dra. Gold y el Dr. D'Alessandro. La lista la están armando el Dr. D'Alessandro y el Dr. Barbagelata. |
| 7 | **Contraindicaciones clínicas** | La tabla de contraindicaciones del catálogo anterior se retiró. Si el flujo de segunda opinión necesita señales clínicas de seguridad, las define el equipo médico. El banner verde/rojo (Flags) sigue operativo. |

## Seguimiento GLP-1

Slice 1 hecho (programa + controles a agendar desde Recepción; ver
[`glp1.md`](glp1.md)). Para confirmar con el Dr. Alejandro Barbagelata y el Dr.
Alejandro Sergio D'Alessandro:

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **Cobro** | ¿Cada control se cobra aparte, va incluido en un programa, o no se cobra? Hoy `CONTROL_GLP1` está en el catálogo con precio 0 (PENDIENTE) y el turno sigue el flujo normal (tentativo hasta la seña). | A definir |
| 2 | **Ventana para agendar (R-19)** | Provisional: basal en los 7 días previos al inicio; el resto, desde la semana calculada hasta 7 días después (`VENTANA_CONTROL_GLP1_DIAS`). ¿Se acepta agendar antes? ¿Cuántos días de tolerancia? | A confirmar |
| 3 | **Dónde carga el médico la indicación** | Hoy: bot `som-glp1-plan` con input JSON (app de Medplum o API). Definir una pantalla o un `Questionnaire` para el equipo médico. | A definir |
| 4 | **Rol del equipo médico** | Hoy solo "Director Médico — Clínico completo" puede ejecutar `som-glp1-plan`. Definir el rol clínico de SOM (ver *Roles*). | A definir |
| 5 | **Módulo compartido con CKM** | `src/lib/glp1/titration.ts` y `eligibility.ts` son contratos interinos: traer los originales de la plataforma CKM para unificar (opción C). | Pendiente |
| 6 | **Biomarcadores** | Los estudios van con el slug del catálogo de biomarcadores (`CodeSystem/biomarcador`). Mapear cada slug a LOINC para interoperar con laboratorios. | Pendiente |
| 7 | **Oftalmología / función renal** | Hoy se agendan como parte del control de la misma semana (12 y 26). ¿Se hacen en SOM o se derivan? | A definir |
| 8 | **Nombre visible y duración** | "Seguimiento de tratamiento GLP-1 — Control", 45 min provisional, en consultorio. | A confirmar |
| 9 | **Metas del GLP-1 editables por el paciente** | La policy del portal le da escritura sobre todos sus `Goal` (el Plan Bienestar crea los suyos), así que técnicamente podría editar la meta del GLP-1 (el bot la reescribe al recalcular). Acotar la escritura a las metas del Plan Bienestar (p. ej. por su categoría), en los dos repos a la vez. | A definir |
| 10 | **App del paciente (slice 2)** | Mostrar el programa, la meta y el estado de cada control en el portal (`EPA-Developments/app`), con el contrato de [`glp1.md`](glp1.md). Prompt listo: [`handoff-app-glp1.md`](handoff-app-glp1.md). | Próximo slice |

## SOM — contrato con el portal

Implementado (ver [`som.md`](som.md)); queda para confirmar:

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **PREVENT: firma médica** | Coeficientes del modelo base generados desde `preventr` y verificados contra sus 12 valores de referencia; el `RiskAssessment` sale `preliminary` hasta la firma del equipo médico (el contrato del portal pide `final`). | A firmar |
| 2 | **Umbrales CKM (Guía AHA/ACC/ADA/ASN 2026) y biomarcadores** | Estadificación según la Tabla 4 (triglicéridos ≥ 150, CAC ≥ 100, PREVENT-CVD 10a ≥ 20 %) y plan según Tabla 8 / Figura 3. Confirmar: índice tobillo-brazo bajo ≤ 0,90 (la guía no fija valor), ApoB < 130 mg/dL y Lp(a) < 125 nmol/L (AHA/ACC 2018). | A confirmar |
| 2b | **Rangos funcionales ya cargados en el servidor** | Correr `npm run biomarcadores:convencional` (dry-run) y, revisado el listado, `-- --apply`. Las definiciones que queden sin rango convencional (p. ej. HOMA-IR) se decide si se retiran. El portal (`EPA-Developments/app`) todavía muestra rangos funcionales en su catálogo local: cambiarlo allá. | Pendiente |
| 3 | **`performer` de la solicitud SOM** | El contrato pide el `Practitioner` del Dr. Barbagelata "si está disponible": falta cargar los profesionales de SOM. | Bloqueado por catálogo |
| 4 | **Precio del Plan Bienestar** | Definido: las tres consultas programadas están incluidas en el plan (sin seña) y las de especialidad se cobran aparte. Falta el precio del plan y cuándo se cobra: `som-bienestar-inscribir` inscribe sin cobrar. | Precio en curso |
| 5 | **Modelo del bot de laboratorio** | `som-procesar-laboratorio` usa `claude-opus-5` (el contrato no lo fija; el informe sigue en `claude-sonnet-4-6` por contrato). Cambiar en `MODELO_CLAUDE_LABORATORIO`. | A confirmar |
| 6 | **Aplicar en el servidor** | `npm run seed` (policy + lípidos) y `npm run deploy:bots` (bots + Subscriptions) contra `7ce5e559-…`; Project Secret `ANTHROPIC_API_KEY`; revisar `Bot.timeout` de los bots con Claude. | Pendiente (credenciales) |

## Plan Bienestar 100 Días® y teleconsulta

Hecho (ver [`plan-bienestar.md`](plan-bienestar.md)): catálogo con modalidad, las tres
consultas del plan con sus ventanas (R-20), teleconsulta con Jitsi y consentimiento
(R-21), avisos del plan y la vista de Recepción. Queda:

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **Calendario: agendas por profesional** | Propuesta: una agenda (`Schedule`) por profesional (`PractitionerRole`) y otra por consultorio para lo presencial; los "calendarios" del Plan Bienestar (presencial / virtual) y de Especialidades son **vistas** de esas agendas, no agendas separadas (así no se da dos veces la misma hora). Retira la agenda virtual transitoria `R_TELEMEDICINA` (capacidad 1). | Próximo slice (necesita la lista de profesionales) |
| 2 | **Jitsi** | Cargar el Project Secret `JITSI_BASE_URL` (https). Si el Jitsi de SOM usa autenticación por token (JWT), sumar la firma del link (`JITSI_APP_ID` / `JITSI_APP_SECRET`). | A confirmar |
| 3 | **Texto del consentimiento de teleconsulta** | Genérico, uno por paciente; lo muestra y lo registra el portal (`Consent`). Lo redactan los médicos de SOM / legales. | A definir |
| 4 | **Portal del paciente** | "Pedir un turno" con los dos caminos, el consentimiento, el link en "Mis turnos" y el espejo de la policy (`ActivityDefinition` de solo lectura). Prompt listo: [`handoff-app-pb100d.md`](handoff-app-pb100d.md). | Próximo slice (portal) |
| 5 | **Horario de los avisos del plan** | Provisional de 9 a 20 h (`HORARIO_AVISOS_PROGRAMA`). | A confirmar |
| 6 | **Consulta inicial sin agendar** | No tiene ventana, así que el cron no avisa: la sigue Recepción desde la ficha. ¿Hace falta un recordatorio (p. ej. a los N días de la inscripción)? | A definir |

## Agenda

Horario de atención: L-V 08-22, Sáb 08-20 (`src/config/horario.ts`) — heredado y
marcado como **provisional** (`HORARIO_ES_PLACEHOLDER`): definir el horario real de
SOM (CABA). Para cargar la agenda:
`npm run seed -- --with-slots --dias=14`.

## Roles

Los roles (AccessPolicies) del catálogo anterior se retiraron; el seed deja
**Recepción — Operativo**, **Director Médico — Clínico completo** y **Paciente SOM
— Portal**. Los roles del equipo médico de SOM se definen nuevos.

## Integraciones / cuentas (en paralelo)

| Cuenta | Para qué | Estado |
|---|---|---|
| WhatsApp Business (Twilio + WABA de EPA Bienestar IA) | Confirmaciones, recordatorios y **WhatsApp dentro de Mensajes** (entrantes en la conversación del paciente, respuesta por el canal donde escribió, ✓✓, campanita de números nuevos, respuestas automáticas con los textos aprobados el 26/09/2026). **Código listo** para texto libre; falta cargar los Project Secrets de la cuenta Twilio de SOM (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` = número de la WABA, `TWILIO_WEBHOOK_URL`), crear la ClientApplication del webhook y configurar la URL en Twilio ([`whatsapp.md`](whatsapp.md)), aprobar las plantillas en Meta y soportar el envío por plantilla (`ContentSid`) para escribir primero o pasadas las 24 h. Después: validar la firma de Twilio al actualizar Medplum y unir fichas duplicadas (paciente que escribe desde otro número). | A gestionar (cuenta + código) |
| AWS SES | Email transaccional (vía `medplum.sendEmail()`). **Código listo**; falta remitente verificado en SES. | A gestionar (cuenta) |
| MercadoPago | Cobro de señas/consultas (tokeniza tarjetas; no guardamos datos de tarjeta). En el Project Secret `MERCADOPAGO_ACCESS_TOKEN` va el **Access Token de producción** de la cuenta SOM (no la Public Key), con las credenciales de producción activadas; + URL del webhook en MP. El link dio **403 PolicyAgent** (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`): la credencial cargada no está autorizada; revisar con `npm run mercadopago:test` (ver [`bots.md`](bots.md#mercadopago-qué-credencial-va-y-el-403-policyagent)). Además, con precios PENDIENTES la seña es $0 y no hay link. | A corregir (credencial) |
| URLs públicas | Portal del paciente `https://app.segundaopinionmedica.org` · app de recepción `https://recepcion.segundaopinionmedica.org` (`src/config/urls.ts`; los Project Secrets `PORTAL_BASE_URL` / `APP_BASE_URL` las pisan por entorno). | Definido |

## CRM (embudo de redes sociales)

Bots registrados (`som-recomputar-segmentos`, `som-enviar-campana`; ver
[`crm.md`](crm.md)). Falta definir:

| Tema | Detalle | Estado |
|---|---|---|
| Consentimiento de marketing | Ley 25.326 (datos de salud = sensibles) + *opt-in* de WhatsApp. Definir cómo se registra (p. ej. `Consent` desde el portal) y filtrar las campañas por él. | A definir |
| Fuentes del lead | Lista de `utm_source` (redes) y que el portal los guarde en `origen-lead` al registrar al paciente. | A definir |
| Plantillas de marketing | Aprobar en Meta (WABA de EPA Bienestar IA) y soportar el envío por plantilla (`ContentSid`). | A definir |

## Infra

| Tema | Detalle | Estado |
|---|---|---|
| Servidor y proyecto Medplum | `https://api.medplum.com.ar/`, proyecto SOM `7ce5e559-f315-4538-abf2-61fa4922f996` (`MEDPLUM_BASE_URL` / `MEDPLUM_PROJECT_ID`). Seed, deploy de bots y diagnósticos abortan si las credenciales del `.env` son de otro proyecto. | Definido |
| Credenciales del proyecto SOM | ClientApplication admin del proyecto SOM en el `.env` local (nunca en el repo) para `npm run seed` / `npm run deploy:bots`. | A gestionar |
