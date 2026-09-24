# Bots de Medplum

Los Bots concentran la inteligencia: el front solo orquesta. Son funciones
TypeScript que se bundlean a un único módulo CJS (`exports.handler`) y se
deployan al runtime **`awslambda`** de Medplum (configurable con la env
`BOT_RUNTIME_VERSION`).

## Los bots

| Bot | Qué hace | Cómo se invoca |
|---|---|---|
| `som-calcular-cobro` | Calcula el cobro (USD→ARS al TC, splits) y emite `Invoice`. | `executeBot` desde el front (pantalla Atender). |
| `som-validar-turno` | Valida un turno (capacidad de recursos, ventana de reserva). | `executeBot` al reservar/confirmar. |
| `som-reservar-turno` | Valida y, si está OK, **crea** el turno (`Appointment` + `Slot` ocupado). Con `tareaId` agenda un control GLP-1: valida su ventana (R-19) y completa la tarea. | `executeBot` desde el front (Reservar turno / Agendar control). |
| `som-estado-turno` | Check-in/out: cambia el estado del turno, gestiona el `Encounter` y libera la sala al completar/cancelar. | `executeBot` desde el front (clic en el turno). |
| `som-pagar-sena` | Registra la seña (50%), confirma el turno (pending→booked) y envía WhatsApp de confirmación. | `executeBot` (clic en turno tentativo). |
| `som-link-mercadopago` | Genera un link de MercadoPago por el monto de la seña (si está configurado el token). | `executeBot` (botón en turno tentativo). |
| `som-webhook-mercadopago` | Webhook de MP: verifica el pago contra la API de MP y confirma el turno automáticamente al acreditarse. | URL pública que llama MercadoPago. |
| `som-recordatorios` | **Cron:** recuerda los turnos confirmados a 48 h y 2 h por WhatsApp. | `cronTimer` del Bot (cada ~30 min). |
| `som-alta-paciente` | Alta de cliente: crea/actualiza el `Patient` (dedupe por DNI/email/teléfono). | `executeBot` (Atender → Nuevo paciente). |
| `som-invitar-paciente` | Invita al paciente al **portal** (invite de Medplum) y entrega el link por WhatsApp/email/QR. **Requiere admin.** | `executeBot` (Atender → Invitar al portal). |
| `som-limpiar-demo` | **Cron:** borra los datos demo (tag `demo`) con más de 48 h. | `cronTimer` del Bot (cada ~1 h). |
| `som-enviar-whatsapp` | Envía WhatsApp (Twilio) y registra `Communication`. | `executeBot` por evento o manual. |
| `som-solicitar-turno` | **Portal:** crea una solicitud de turno (`Task` `code=solicitud-turno`) del paciente y avisa a Recepción por WhatsApp (`RECEPCION_WHATSAPP_TO`). No reserva: Recepción confirma. | `executeBot` desde el **portal** del paciente (único bot que puede ejecutar). |
| `som-recomputar-segmentos` | **CRM:** recalcula los miembros de los segmentos del embudo (origen del lead / red social, perfil, ciclo de vida, biomarcadores). | `cronTimer` o `executeBot` con un `Group`. Ver [`crm.md`](crm.md). |
| `som-enviar-campana` | **CRM:** envía una campaña a un segmento (email; WhatsApp queda pendiente de plantilla) y registra una `Communication` por destinatario. **Requiere admin** para email. | `executeBot`. Ver [`crm.md`](crm.md). |
| `som-glp1-inscribir` | **GLP-1 (Recepción):** inscribe al paciente en el seguimiento: deja un `Task` `indicacion-glp1` al equipo médico (idempotente; si ya está activo, devuelve cuántos controles faltan agendar). | `executeBot` (Atender → Seguimiento GLP-1 → Inscribir). Ver [`glp1.md`](glp1.md). |
| `som-solicitar` | **Portal (SOM):** crea la `ServiceRequest` de segunda opinión. Valida consentimiento firmado (LOINC 59284-0), que quien ejecuta sea el mismo paciente y que los adjuntos sean suyos. `runAsUser` **desactivado**. | `executeBot` desde el **portal** (whitelisteado en la policy del paciente). Ver [`som.md`](som.md). |
| `bot-som-report` | **Interno (SOM):** PREVENT → `RiskAssessment`, informe con Claude → `DiagnosticReport` + PDF, `ServiceRequest` → `completed`, aviso al paciente. Sin consentimiento no llama a Claude. | `Subscription` sobre `ServiceRequest?status=active&code=…som-cardiology` (la crea `deploy:bots`). |
| `som-procesar-laboratorio` | **Interno (SOM):** transcribe el PDF de laboratorio que manda el paciente (Claude) a `Observation` + `DiagnosticReport` y lo liga al documento; si no puede, avisa al paciente y deja un `Task` `revisar-laboratorio`. | `Subscription` (solo *create*) sobre `DocumentReference?category=…/documento\|resultado-laboratorio` (la crea `deploy:bots`). |
| `som-bienestar-inscribir` | **Plan Bienestar (Recepción):** crea el `CarePlan` `plan-bienestar-100` (100 días) que lee el portal. Idempotente. No cobra. | `executeBot` (Atender → Plan Bienestar). |
| `som-glp1-plan` | **GLP-1 (equipo médico):** con la indicación (molécula, esquema de titulación, fecha de inicio) arma o recalcula el programa: `CarePlan`, `Goal`, pedidos de laboratorio y tareas de agenda de Recepción. **Recepción no puede ejecutarlo.** | `executeBot` / app de Medplum (input JSON). Ver [`glp1.md`](glp1.md). |

## Deploy

Requiere el `.env` de la raíz (mismas credenciales que el seed):
`MEDPLUM_BASE_URL` (`https://api.medplum.com.ar/`), `MEDPLUM_CLIENT_ID`,
`MEDPLUM_CLIENT_SECRET` y `MEDPLUM_PROJECT_ID` (proyecto SOM
`7ce5e559-f315-4538-abf2-61fa4922f996`). La `ClientApplication` debe ser **admin
del proyecto** (para poder crear bots). Si las credenciales son de otro proyecto
que `MEDPLUM_PROJECT_ID`, el deploy (y el seed) abortan sin escribir nada.

```bash
npm run bots:bundle   # opcional: bundlea y muestra tamaños, sin conectarse
npm run deploy:bots   # crea (si faltan) + bundlea + deploya + guarda ids
```

`deploy:bots` hace, por cada bot:
1. lo busca por `name`; si no existe, lo crea (`POST admin/projects/{id}/bot`, runtime `awslambda`);
2. bundlea el source con esbuild (CJS, sin dependencias externas; compactado sin
   renombrar identificadores — el SDK de Anthropic pesa — y aborta si el bundle se
   acerca al límite de 1 MB de JSON de `$deploy`);
3. lo deploya (`POST Bot/{id}/$deploy`);
4. guarda los ids en `medplum.config.json`.

Además asegura (idempotente) las `Subscription` de los bots internos SOM:
`bot-som-report` (solicitud activa) y `som-procesar-laboratorio` (solo al crear el
documento, con la extensión `subscription-supported-interaction=create`).

> Los bots que llaman a Claude (`bot-som-report`, `som-procesar-laboratorio`)
> pueden tardar más que el timeout por defecto del Bot: subir `Bot.timeout` en
> Medplum si el log muestra cortes.

Es idempotente: reejecutar redeploya el código sobre los bots existentes. Los ids
de `medplum.config.json` son del proyecto SOM: arrancan vacíos y los completa el
primer `npm run deploy:bots`.

## Comunicaciones: secretos y comportamiento

En Medplum los bots leen secretos de `event.secrets`, **no** de `process.env`
(el `.env` de la raíz es solo para el seed/deploy, que corren en tu máquina). Los
secretos se cargan como **Project Secrets** en el panel de Medplum
(Project → Secrets). **Nada de credenciales en el código ni en el repo**: Twilio y
MercadoPago usan las credenciales propias de SOM.

| Project Secret | Lo usa | ¿Obligatorio? |
|---|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | todos los envíos de WhatsApp | para enviar WhatsApp |
| `TWILIO_WHATSAPP_FROM` | ídem (número de la WABA de EPA Bienestar IA, `whatsapp:+54...`) | para enviar WhatsApp |
| `RECEPCION_WHATSAPP_TO` | `som-solicitar-turno` (aviso a Recepción de solicitudes nuevas) | opcional |
| `MERCADOPAGO_ACCESS_TOKEN` | `som-link-mercadopago`, `som-webhook-mercadopago` | para cobrar por MP |
| `MP_WEBHOOK_URL` | `som-link-mercadopago` (`notification_url`) | opcional |
| `PORTAL_BASE_URL` | `som-invitar-paciente` (link al portal del paciente) | opcional (default `https://app.segundaopinionmedica.org`) |
| `APP_BASE_URL` | `som-link-mercadopago` (`back_urls`) | opcional (default `https://recepcion.segundaopinionmedica.org`) |
| `EMAIL_FROM` | `som-invitar-paciente` (remitente con marca) | opcional |
| `ANTHROPIC_API_KEY` | `bot-som-report` (redacción del informe), `som-procesar-laboratorio` (transcripción del PDF) | opcional (sin él: informe mínimo / el PDF pasa al equipo) |

**Regla de oro:** los helpers (`enviarWhatsApp` / `enviarEmail` en
`src/bots/_shared.ts`) **siempre** registran la `Communication`, pero **solo
envían** si está la configuración completa. Así se puede probar la lógica sin
spamear a nadie. Estados resultantes:

| Situación | Estado de la `Communication` | ¿Se envió? |
|---|---|---|
| Config completa + destinatario válido | `completed` | sí |
| Falta secreto / falta teléfono o email del paciente | `preparation` | no |
| El proveedor (Twilio/SES) devuelve error | `entered-in-error` | no |

### WhatsApp (Twilio + WABA de EPA Bienestar IA)

El envío sale por la cuenta **Twilio de SOM**, con la **WABA (WhatsApp Business
Account) de EPA Bienestar IA** conectada como *WhatsApp sender* en Twilio:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` (número de la WABA, formato `whatsapp:+549...`)
- `RECEPCION_WHATSAPP_TO` (número de Recepción, para el aviso de **solicitudes** del portal)

> Con la WABA real, los mensajes que inicia el negocio (confirmación,
> recordatorios, invitación) fuera de la ventana de 24 h de WhatsApp solo salen
> como **plantillas aprobadas por Meta**. Hoy el bot envía texto libre (`Body`):
> sirve en sandbox o dentro de la ventana de 24 h; el envío con plantillas
> (Twilio Content, `ContentSid`) queda pendiente.

El destinatario sale de `Patient.telecom` (teléfono/SMS). El WhatsApp se dispara
automático **al reservar** (turno tentativo), **al pagar la seña** (confirmado)
y en los **recordatorios** (ver abajo).

> **Diagnóstico de WhatsApp:** `npm run whatsapp:test -- +5491122334455` ejecuta el
> bot `som-enviar-whatsapp` en el server (lee los Project Secrets reales) y reporta
> el `status` de la `Communication`: `completed` (Twilio aceptó), `preparation`
> (falta algún secret) o `entered-in-error` (Twilio rechazó: sandbox/FROM/número).

### Email (AWS SES)

El email se envía con `medplum.sendEmail()`, que usa el proveedor **AWS SES
configurado en el servidor Medplum** — **no** hacen falta credenciales de SES en
el código ni en los Project Secrets. Solo hay que tener:

- un **remitente verificado** en SES (referencia local: `SES_FROM_EMAIL` en
  `.env.example`), y
- el `Patient.telecom` con un email (de ahí sale el destinatario).

Sin email en el paciente (o si SES falla), la `Communication` igual queda
registrada (`preparation` / `entered-in-error`).

Para el link de MercadoPago (seña), además: `MERCADOPAGO_ACCESS_TOKEN`. Si no
está, el flujo manual de seña sigue funcionando y el bot de link avisa que MP no
está configurado.

## Permisos del bot

El bot se crea con su propia `ProjectMembership`. Para mínimo privilegio se le
puede asignar una `AccessPolicy` acotada (p. ej. solo `Invoice`/`Communication`/
lectura de catálogo). Pendiente de afinar.

**Quién ejecuta qué:** para ejecutar un bot hay que poder leerlo. La policy de
Recepción solo habilita los bots de `BOTS_RECEPCION`
(`src/fhir/access-policies.ts`): los que llama la app de recepción, más
`som-validar-turno`. Los clínicos (`som-glp1-plan`) y los de administración
quedan fuera. Si la app empieza a llamar un bot nuevo, sumarlo ahí:
`tests/seed.test.ts` falla si falta.

## Webhook de MercadoPago (confirmación automática)

Cuando el paciente paga la seña por el link, MercadoPago avisa a un **webhook** y el
turno se confirma solo (pending → booked) + WhatsApp.

1. Crear el bot `som-webhook-mercadopago` (UI) y `npm run deploy:bots`.
2. Cargar el secret `MERCADOPAGO_ACCESS_TOKEN` (el mismo del link).
3. En MercadoPago (Tus integraciones → tu app → **Webhooks**, evento **Pagos**),
   configurar la **URL** del `$execute` del bot:
   `https://api.medplum.com.ar/fhir/R4/Bot/<id-de-som-webhook-mercadopago>/$execute`
   - Como MP no envía headers de auth, se usa una **ClientApplication dedicada** y
     se embeben las credenciales en la URL:
     `https://<clientId>:<clientSecret>@api.medplum.com.ar/fhir/R4/Bot/<id>/$execute`
   - (Esta parte la validamos juntos: confirmamos que MP acepte la URL con
     credenciales. El bot, además, **verifica el pago contra la API de MP**, así
     que no confía en el payload.)
4. (Opcional) Setear el secret `MP_WEBHOOK_URL` con esa URL: el link de pago la
   manda como `notification_url` por preferencia. Si no, alcanza con la config
   global del paso 3.

El bot toma el id del pago, hace `GET /v1/payments/{id}` con el token, y si está
`approved` confirma el turno por su `external_reference` (= appointmentId). Es
idempotente (los reintentos de MP no duplican la seña).

> **Retirado:** los bots de combos, de asignación de planes
> (membresías/paquetes) y de cobro recurrente eran de un catálogo anterior, ajeno
> a SOM, y se retiraron junto con `src/config/{combos,membresias,paquetes}.ts`.
> Ver [`decisiones-pendientes.md`](decisiones-pendientes.md).

## Recordatorios automáticos (48 h / 2 h)

`som-recordatorios` avisa por WhatsApp antes de cada turno **confirmado**
(`booked`): una vez ~48 h antes y otra ~2 h antes. La lógica de "qué recordatorio
toca" es pura (`src/lib/recordatorios.ts`, testeada): usa ventanas hacia abajo
(falta ≤ 2 h → recordatorio de 2 h; falta ≤ 48 h y > 2 h → el de 48 h), así que si
una corrida del cron se saltea, el siguiente tick lo manda igual.

- **Idempotente:** cada recordatorio queda como `Communication` con identifier
  `recordatorio-{tipo}-{turno}`. Antes de enviar, el bot busca ese identifier; si
  existe, no reenvía. Por eso es seguro correrlo cada pocos minutos.

### Cron de `som-recordatorios`

Configurar el `cronTimer` del Bot **una vez** (p. ej. `*/30 * * * *` = cada 30
min). Cuanto más seguido corra, más cerca de las 48 h / 2 h exactas sale el aviso;
la idempotencia evita duplicados. Necesita los mismos secretos de Twilio que
`som-enviar-whatsapp`.

## Alta e invitación de pacientes (onboarding)

Dos pasos **separados** (la recepción puede dar de alta sin invitar, e invitar
después):

1. **Alta** (`som-alta-paciente`): crea el `Patient` (nombre, DNI, teléfono, email).
   Deduplica por DNI → email → teléfono (no crea duplicados). No da login.
   No requiere admin (la recepción ya escribe `Patient`).
2. **Invitación al portal** (`som-invitar-paciente`): le da acceso de login para ver
   **lo suyo** (turnos/plan/pagos). Usa el **invite de Medplum** con
   `sendEmail:false` + `upsert:true` (reusa el `Patient` existente por email, no
   duplica) y la AccessPolicy **"Paciente SOM — Portal"**. Recupera el link mágico
   (`/setpassword/{id}/{secret}`) y lo entrega por el canal elegido:
   - **whatsapp** → Twilio;
   - **email** → mail Segunda Opinión Médica (SES, `medplum.sendEmail`);
   - **qr** → devuelve el link y el front lo dibuja como **QR** (client-side, el
     link nunca sale a un tercero).

   El link apunta al **portal del paciente SOM**
   (`https://app.segundaopinionmedica.org`), no a la app de recepción. El Project
   Secret **`PORTAL_BASE_URL`** lo pisa por entorno (p. ej. staging).

### Requisitos para invitar

- `som-invitar-paciente` debe tener **admin del proyecto**. Lo necesita por **dos**
  motivos: (1) el *invite* es endpoint de administración; (2) **enviar email** vía
  `medplum.sendEmail()` también exige membership admin. El server Medplum gatea el
  endpoint de email con `project.features incluye "email"` **Y**
  `ctx.membership.admin === true` (verificado en el código de Medplum). Por eso el
  mismo bot admin cubre invite + email. Asignar admin a su `ProjectMembership` en
  Medplum (igual que se crean los bots). Sin admin, devuelve un aviso claro.
- Que el proyecto tenga la **feature `email`** habilitada (super admin).
- Que exista la AccessPolicy **"Paciente SOM — Portal"** (corré `npm run seed`).
- Para alinear con el **auto-registro** del portal ("Crear cuenta"), conviene que
  el **default patient access policy** del proyecto Medplum sea también
  "Paciente SOM — Portal" (así el paciente que se registra solo y el invitado
  quedan con el mismo alcance; `npm run diagnostico-acceso -- --apply` lo setea).

> **Diagnóstico de email:** `npm run email:test -- correo@dominio` prueba la cadena
> Medplum→SES. Si da `Forbidden`, la membership usada **no es admin** (requisito de
> Medplum para email). SES en sí se prueba aparte con la CLI de AWS
> (`aws sesv2 send-email …`).

## Datos de demostración (autodestrucción a las 48 h)

Para ver la app con datos (pacientes, turnos de consulta en varios estados, un
Flag de banner de seguridad, cobros y comunicaciones):

```bash
npm run datos-demo                       # limpia demo previa y genera datos nuevos
npm run datos-demo -- --limpiar          # borra TODOS los datos demo
npm run datos-demo -- --limpiar-vencidos # borra solo los demo de > 48 h
```

Todo lo creado lleva `meta.tag = demo` (system `https://segundaopinionmedica.org/demo`). La
limpieza borra **solo** lo etiquetado demo (por `_tag` + `_lastUpdated`); **nunca**
toca datos reales.

**Autodestrucción:** el bot **`som-limpiar-demo`** (cron, p. ej. `0 * * * *` cada
hora) borra los demo cuyo `_lastUpdated` supere las 48 h. Configurar su `cronTimer`
una vez en Medplum. Sin el cron, igual podés limpiar a mano con `--limpiar`.

> El bot que borra necesita permiso de borrado sobre esos tipos (admin de proyecto
> o una AccessPolicy con delete). La generación se hace por script, no por bot.

## Invocación desde el front

El front llama a los bots **por nombre** (`Bot?name=som-calcular-cobro` →
`executeBot`). Por eso los nombres de los bots no deben cambiarse sin actualizar
`app/src/lib/bots.ts`.
