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
| `som-reservar-turno` | Valida y, si está OK, **crea** el turno (`Appointment` + `Slot` ocupado). | `executeBot` desde el front (Reservar turno). |
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

## Deploy

Requiere el `.env` de la raíz (mismas credenciales que el seed):
`MEDPLUM_BASE_URL`, `MEDPLUM_CLIENT_ID`, `MEDPLUM_CLIENT_SECRET`. La
`ClientApplication` debe ser **admin del proyecto** (para poder crear bots).

```bash
npm run bots:bundle   # opcional: bundlea y muestra tamaños, sin conectarse
npm run deploy:bots   # crea (si faltan) + bundlea + deploya + guarda ids
```

`deploy:bots` hace, por cada bot:
1. lo busca por `name`; si no existe, lo crea (`POST admin/projects/{id}/bot`, runtime `awslambda`);
2. bundlea el source con esbuild (CJS, sin dependencias externas);
3. lo deploya (`POST Bot/{id}/$deploy`);
4. guarda los ids en `medplum.config.json`.

Es idempotente: reejecutar redeploya el código sobre los bots existentes.

## Comunicaciones: secretos y comportamiento

En Medplum los bots leen secretos de `event.secrets`, **no** de `process.env`
(el `.env` de la raíz es solo para el seed/deploy, que corren en tu máquina). Los
secretos se cargan como **Project Secrets** en el panel de Medplum
(Project → Secrets).

**Regla de oro:** los helpers (`enviarWhatsApp` / `enviarEmail` en
`src/bots/_shared.ts`) **siempre** registran la `Communication`, pero **solo
envían** si está la configuración completa. Así se puede probar la lógica sin
spamear a nadie. Estados resultantes:

| Situación | Estado de la `Communication` | ¿Se envió? |
|---|---|---|
| Config completa + destinatario válido | `completed` | sí |
| Falta secreto / falta teléfono o email del paciente | `preparation` | no |
| El proveedor (Twilio/SES) devuelve error | `entered-in-error` | no |

### WhatsApp (Twilio)

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` (formato `whatsapp:+549...`)
- `RECEPCION_WHATSAPP_TO` (número de Recepción, para el aviso de **solicitudes** del portal)

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

> **Retirado:** los bots `som-reservar-combo` (combos), `som-asignar-plan`
> (membresías/paquetes) y `som-cobro-membresias` (cobro recurrente) eran del
> catálogo BioWellness y se retiraron junto con
> `src/config/{combos,membresias,paquetes}.ts`. Ver
> [`decisiones-pendientes.md`](decisiones-pendientes.md).

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
   duplica) y la AccessPolicy **"Paciente — Portal"**. Recupera el link mágico
   (`/setpassword/{id}/{secret}`) y lo entrega por el canal elegido:
   - **whatsapp** → Twilio;
   - **email** → mail Segunda Opinión Médica (SES, `medplum.sendEmail`);
   - **qr** → devuelve el link y el front lo dibuja como **QR** (client-side, el
     link nunca sale a un tercero).

   El link apunta al **portal del paciente** (FooMedical, `bio.medplum.com.ar`),
   no a la app de recepción. Se configura con el secret **`PORTAL_BASE_URL`**
   (default `https://bio.medplum.com.ar`).

### Requisitos para invitar

- `som-invitar-paciente` debe tener **admin del proyecto**. Lo necesita por **dos**
  motivos: (1) el *invite* es endpoint de administración; (2) **enviar email** vía
  `medplum.sendEmail()` también exige membership admin. El server Medplum gatea el
  endpoint de email con `project.features incluye "email"` **Y**
  `ctx.membership.admin === true` (verificado en el código de Medplum). Por eso el
  mismo bot admin cubre invite + email. Asignar admin a su `ProjectMembership` en
  Medplum (igual que se crean los bots). Sin admin, devuelve un aviso claro.
- Que el proyecto tenga la **feature `email`** habilitada (super admin).
- Que exista la AccessPolicy **"Paciente — Portal"** (corré `npm run seed`).
- Para alinear con el **auto-registro** del portal ("Crear cuenta"), conviene que
  el **default patient access policy** del proyecto Medplum sea también
  "Paciente — Portal" (así el paciente que se registra solo y el invitado quedan
  con el mismo alcance).

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
