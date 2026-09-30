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
| `som-reservar-turno` | Valida y, si está OK, **crea** el turno (`Appointment`) **ocupando** las franjas libres (`Slot` `free` → `busy`, con `If-Match`) del profesional y, si es presencial, del consultorio (R-07, R-22). Se pide por `medicoCodigo` + `inicio` (o por `slotId`, la franja libre que eligió la paciente); `recursoCodigo` sigue valiendo para la reserva por sala. La **modalidad** la da el recurso (la agenda virtual es teleconsulta) o el pedido: la teleconsulta exige el consentimiento firmado y lleva el link de Jitsi (R-21). Con `tareaId` agenda un control GLP-1 (ventana, R-19) o una consulta del **Plan Bienestar 100 Días®** (ventana, R-20; la inicial fija el día 1; incluida → confirmada sin seña) y completa la tarea. | `executeBot` desde el front (Reservar turno / Agendar control / Agendar consulta del plan). |
| `som-estado-turno` | Check-in/out: cambia el estado del turno, gestiona el `Encounter` (`class` AMB/VR según la modalidad) y libera la sala al completar/cancelar. En una consulta del Plan Bienestar marca la actividad del plan; si se cancela, la tarea vuelve a quedar por agendar. | `executeBot` desde el front (clic en el turno). |
| `som-pagar-sena` | Registra la seña (50%), confirma el turno (pending→booked) y envía WhatsApp de confirmación. | `executeBot` (clic en turno tentativo). |
| `som-link-mercadopago` | Genera un link de MercadoPago (Checkout Pro) por el monto de la seña. Antes valida la credencial (Access Token, no Public Key) y el monto (no hay link por $0); si MercadoPago la rechaza (401 / 403 PolicyAgent) lee la cuenta y dice qué corregir. Con `{ diagnosticar: true }` solo revisa credencial y cuenta (`npm run mercadopago:test`). | `executeBot` (botón en turno tentativo). |
| `som-webhook-mercadopago` | Webhook de MP: verifica el pago contra la API de MP y confirma el turno automáticamente al acreditarse. | URL pública de nginx (`/webhooks/som/mercadopago`) que llama MercadoPago. |
| `som-recordatorios` | **Cron:** recuerda los turnos confirmados a 48 h y 2 h por WhatsApp (en teleconsulta, con el link) y manda los avisos de las consultas del **Plan Bienestar** (se abrió la ventana; a mitad de ventana, segundo aviso + alerta a Recepción). | `cronTimer` del Bot (cada ~30 min). |
| `som-alta-paciente` | Alta de cliente: crea/actualiza el `Patient` (dedupe por DNI/email/teléfono; el teléfono en cualquiera de sus formas y sin unir DNIs distintos, así completa el **número nuevo** que llegó por WhatsApp sin duplicarlo y **resuelve su aviso** de la pestaña WhatsApp, `ficha-completada`). | `executeBot` (Atender → Nuevo paciente; Mensajes y WhatsApp → Completar ficha). |
| `som-invitar-paciente` | Invita al paciente al **portal** (invite de Medplum) y entrega el link por WhatsApp/email/QR. **Requiere admin.** | `executeBot` (Atender → Invitar al portal). |
| `som-limpiar-demo` | **Cron:** borra los datos demo (tag `demo`) con más de 48 h. | `cronTimer` del Bot (cada ~1 h). |
| `som-enviar-whatsapp` | Envía WhatsApp (Twilio) y registra `Communication`. | `executeBot` por evento o manual. |
| `som-whatsapp-entrante` | **Webhook de Twilio:** el WhatsApp entra en la **conversación abierta** del paciente en Mensajes (o abre una, motivo «Otro motivo»); un número nuevo es un lead del CRM y deja un **aviso** a Recepción (`Task` `whatsapp-nuevo-contacto`, uno por número: pestaña WhatsApp y campanita); guarda adjuntos en `Binary`; **responde solo** (acuse / fuera de horario); y registra los estados de entrega (✓✓). Idempotente por `MessageSid`; rechaza otro `AccountSid`. | URL que llama Twilio (ClientApplication dedicada, ver [`whatsapp.md`](whatsapp.md)). |
| `som-whatsapp-responder` | **Mensajes (Recepción):** después de responder, decide si la respuesta sale también por WhatsApp — solo si el último mensaje del paciente llegó por ahí y la **ventana de 24 h** sigue abierta — y la manda (texto y adjuntos) al número desde el que escribió; marca la burbuja (📱, ✓). | `executeBot` (Mensajes → Enviar). |
| `som-reservar-portal` | **Portal (R-23):** la paciente elige una franja libre de un profesional y el bot **reserva** con las reglas de Recepción (reutiliza `som-reservar-turno`): consulta del plan con su tarea → **confirmada** sin seña; consulta con cargo → **tentativa** con la franja retenida 30 min y el link de MercadoPago de la seña (queda en `link-pago-sena` y sale por WhatsApp). Sin link (MercadoPago caído o sin configurar) no vence y avisa a Recepción. Solo para sí misma (`requester`); nunca devuelve el link de la videollamada antes de la seña. | `executeBot` desde el **portal** de la paciente. |
| `som-vencer-reservas` | **Cron (R-23):** cancela las reservas tentativas del portal cuya retención venció sin seña, libera sus franjas y avisa a la paciente. No toca los tentativos de Recepción (sin vencimiento). `If-Match`: si el webhook la confirmó en el medio, no la pisa. | `cronTimer` del Bot (cada ~5 min). |
| `som-solicitar-turno` | **Portal:** crea una solicitud de turno (`Task` `code=solicitud-turno`) del paciente, presencial o teleconsulta (`modalidad`; la teleconsulta exige el consentimiento de teleconsulta, R-21), y avisa a Recepción por WhatsApp (`RECEPCION_WHATSAPP_TO`). No reserva: Recepción confirma. Alternativa en texto libre a `som-reservar-portal`. | `executeBot` desde el **portal** del paciente. |
| `som-teleconsulta-entrar` | **Portal (R-21):** la paciente entra a la videollamada de su teleconsulta. Con el turno confirmado y la sala abierta (`ENTRADA_TELECONSULTA_MIN` = 15 min antes, provisional, hasta el fin) devuelve el link de Jitsi del turno y marca la presencia (el turno pasa a `arrived` y se abre el `Encounter` `VR`, como el check-in de `som-estado-turno`). Tentativa → `pagar: true`; antes de hora → `abre`. La paciente entra **sin token**, como invitada que espera al profesional (decisión del 29/09/2026, [`decisiones-pendientes.md`](decisiones-pendientes.md), Jitsi 2b): el link es el mismo que el del WhatsApp. | `executeBot` desde el **portal** (`{ appointmentId }`). |
| `som-teleconsulta-cancelar` | **Portal (R-14, R-20, R-22):** la paciente cancela su teleconsulta. Sin `confirmar` solo informa qué pasa (con < 24 h la sesión se consume y la seña no vuelve; con ≥ 24 h no se pierde); con `confirmar: true` cancela (motivo `pat`) vía `som-estado-turno` (libera las franjas; la consulta del plan vuelve a quedar por agendar) y, si tenía la seña paga, avisa a Recepción por WhatsApp. | `executeBot` desde el **portal** (`{ appointmentId, confirmar? }`). |
| `som-teleconsulta-pago` | **Portal (R-23):** vuelve a abrir el pago de la seña de una teleconsulta tentativa: devuelve el link guardado (`link-pago-sena`) o lo genera con `som-link-mercadopago`. Vencida, paga o incluida en el plan → `ok: false` con el motivo. | `executeBot` desde el **portal** (`{ appointmentId }`). |
| `som-teleconsulta-token` | **Dashboard del profesional:** el token firmado (JWT) para entrar a la sala de Jitsi **como moderador** (abre la sala, admite a la paciente, la puede cerrar). Quién pide lo dice `requester`, nunca el input: sólo un `Practitioner` que sea `participant` del turno; a cualquier otro le contesta lo mismo que si el turno no existiera. Turno confirmado (`booked`/`arrived`/`checked-in`), link del mismo Jitsi que `JITSI_BASE_URL`, ventana de 15 min antes a 1 h después del fin. El token vence con la sala y no se guarda. Sin `JITSI_APP_ID`/`JITSI_APP_SECRET` devuelve `sinConfigurar: true` y el dashboard entra con el link, sin moderar. Recepción **no** lo ejecuta. | `executeBot` desde el **dashboard** (`{ appointmentId }`). |
| `som-recomputar-segmentos` | **CRM:** recalcula los miembros de los segmentos del embudo (origen del lead / red social, perfil, ciclo de vida, biomarcadores). | `cronTimer` o `executeBot` con un `Group`. Ver [`crm.md`](crm.md). |
| `som-enviar-campana` | **CRM:** envía una campaña a un segmento (email; WhatsApp queda pendiente de plantilla) y registra una `Communication` por destinatario. **Requiere admin** para email. | `executeBot`. Ver [`crm.md`](crm.md). |
| `som-glp1-inscribir` | **GLP-1 (Recepción):** inscribe al paciente en el seguimiento: deja un `Task` `indicacion-glp1` al equipo médico (idempotente; si ya está activo, devuelve cuántos controles faltan agendar). | `executeBot` (Atender → Seguimiento GLP-1 → Inscribir). Ver [`glp1.md`](glp1.md). |
| `som-solicitar` | **Portal (SOM):** crea la `ServiceRequest` de segunda opinión. Valida consentimiento firmado (LOINC 59284-0), que quien ejecuta sea el mismo paciente y que los adjuntos sean suyos. `runAsUser` **desactivado**. | `executeBot` desde el **portal** (whitelisteado en la policy del paciente). Ver [`som.md`](som.md). |
| `bot-som-report` | **Interno (SOM):** PREVENT → `RiskAssessment`, informe con Claude → `DiagnosticReport` + PDF, `ServiceRequest` → `completed`, aviso al paciente. Sin consentimiento no llama a Claude. | `Subscription` sobre `ServiceRequest?status=active&code=…som-cardiology` (la crea `deploy:bots`). |
| `som-procesar-laboratorio` | **Interno (SOM):** transcribe el PDF de laboratorio que manda el paciente (Claude) a `Observation` + `DiagnosticReport` y lo liga al documento; si no puede, avisa al paciente y deja un `Task` `revisar-laboratorio`. | `Subscription` (solo *create*) sobre `DocumentReference?category=…/documento\|resultado-laboratorio` (la crea `deploy:bots`). |
| `som-bienestar-inscribir` | **Plan Bienestar 100 Días® (Recepción):** crea el `CarePlan` `plan-bienestar-100` (100 días) que lee el portal, con sus tres consultas programadas, y una `Task` `agendar-consulta-pb100d` por consulta. Idempotente (a un plan viejo le suma las tareas que falten). No cobra. | `executeBot` (Atender → Plan Bienestar 100 Días®). Ver [`plan-bienestar.md`](plan-bienestar.md). |
| `som-bienestar-dia0` | **Plan Bienestar 100 Días® (Recepción):** lo operativo del menú del equipo, **sin valores clínicos**: el **día 0** (qué datos pide el catálogo firmado para el estadío de la persona, si están cargados / a medias / vencidos / faltan y quién los carga), el estado del **plan clínico** (`pb100d-ckm`: desde cuándo, día X, pasos completados) y el **material** para el paciente (títulos de sus pasos y el aviso por WhatsApp). Lee lo clínico con su identidad y devuelve sólo "falta el laboratorio", nunca el resultado ni el estadío. Sólo lectura. | `executeBot` (Atender → tarjeta "día 0 y material"). Ver [`plan-bienestar.md`](plan-bienestar.md#menú-del-equipo). |
| `som-borrador-respuesta` | **Mensajes (Recepción) — "Sugerir":** con la conversación y el contexto operativo del paciente (nombre, motivo, próximo turno, programas, consentimiento; nunca historia clínica) redacta con Claude el **borrador** de la respuesta. No envía nada ni escribe datos del paciente (solo el registro de uso de IA, ver abajo); la recepcionista lo revisa y toca Enviar (la respuesta queda marcada `borrador-usado` = `sin-editar`/`editado`). Si es clínico o una posible urgencia, no redacta y lo dice. | `executeBot` (Mensajes → Sugerir). |
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

> **Chequeo de la puesta en marcha:** `npm run puesta-en-marcha` (sólo lectura) lista qué
> hay en el proyecto y qué falta, con el comando que lo arregla: bots creados, roles al día
> con el repo, catálogo del seed (instrumentos, programas, profesionales, agendas), recursos
> del monorepo del plan, Project Secrets por nombre (nunca valores) y el default patient
> access policy. Termina con código 1 si falta algo. La lógica está en
> `src/lib/puesta-en-marcha.ts`; el paso a paso completo, en el monorepo del plan
> (`docs/puesta-en-marcha.md`).

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

> Los bots que llaman a Claude (`bot-som-report`, `som-procesar-laboratorio`, `som-borrador-respuesta`)
> pueden tardar más que el timeout por defecto del Bot: subir `Bot.timeout` en
> Medplum si el log muestra cortes.

**Uso de IA.** Los tres bots que llaman a Claude dejan, por cada llamada, un
`AuditEvent` (type `…/CodeSystem/uso-ia|llamada-modelo`) ligado al recurso que la
originó, con modelo, tokens, esfuerzo (si el bot lo fija) y costo estimado; `outcome` 4
si la respuesta no sirvió. Del paciente solo guarda esa referencia.

| Bot | `subtype` | Ligado a |
|---|---|---|
| `som-procesar-laboratorio` | `laboratorio-pdf` | el `DocumentReference` del PDF |
| `som-borrador-respuesta` | `borrador-mensaje` | la conversación (`Communication`) |
| `bot-som-report` | `informe-som` | la solicitud (`ServiceRequest`) |

Resumen del mes: `npm run uso:ia -- AAAA-MM`. Si el servidor no acepta el registro, el bot sigue
igual (queda en su log). Lógica y precios en `src/lib/uso-ia.ts`.

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
| `TWILIO_WEBHOOK_URL` | todos los envíos de WhatsApp (`StatusCallback`: los ✓✓) y la firma de Twilio en `som-whatsapp-entrante`. Es la URL pública de nginx `https://api.medplum.com.ar/webhooks/som/twilio-whatsapp` (la guarda `npm run webhooks`; [`whatsapp.md`](whatsapp.md)) | obligatorio: sin él el webhook rechaza todo |
| `TWILIO_CONTENT_SID_AVISO` | los avisos (`enviarWhatsApp`): el `ContentSid` de la plantilla genérica `som_aviso` aprobada por Meta (lo guarda `npm run whatsapp:plantillas`) | para que los avisos lleguen fuera de la ventana de 24 h |
| `RECEPCION_WHATSAPP_TO` | `som-solicitar-turno` (aviso a Recepción de solicitudes nuevas), `som-recordatorios` (alerta de consultas del Plan Bienestar sin agendar), `som-reservar-portal` (reserva del portal sin link de pago), seña de un turno ya cancelado (`confirmarReserva`: hay que reintegrar) | opcional |
| `JITSI_BASE_URL` | `som-reservar-turno` (link de la videollamada de cada teleconsulta, p. ej. `https://meet.segundaopinionmedica.org`; solo `https`) | para el link de teleconsulta (sin él, el turno se agenda con advertencia y sin link) |
| `JITSI_APP_ID`, `JITSI_APP_SECRET` | `som-teleconsulta-token` (el profesional entra como moderador): el emisor (`iss`) y el secreto HS256 que valida el Jitsi. Van **los dos**, con `JITSI_BASE_URL`, o ninguno. La paciente no usa token | para que el profesional modere; la configuración del Jitsi está en [`decisiones-pendientes.md`](decisiones-pendientes.md) (Jitsi) |
| `MERCADOPAGO_ACCESS_TOKEN` | `som-link-mercadopago`, `som-webhook-mercadopago`. Va el **Access Token de producción** (`APP_USR-…`, varios bloques de números), **no** la Public Key | para cobrar por MP |
| `MP_WEBHOOK_URL` | `som-link-mercadopago` (`notification_url`): la URL pública `https://api.medplum.com.ar/webhooks/som/mercadopago` (la guarda `npm run webhooks`) | recomendado |
| `PORTAL_BASE_URL` | `som-invitar-paciente` (link al portal del paciente) y `som-link-mercadopago` (`back_urls`: después de pagar, el paciente vuelve al portal) | opcional (default `https://app.segundaopinionmedica.org`) |
| `APP_BASE_URL` | app de Recepción (reservado; hoy ningún bot la lee) | opcional (default `https://recepcion.segundaopinionmedica.org`) |
| `EMAIL_FROM` | `som-invitar-paciente` (remitente con marca) | opcional |
| `ANTHROPIC_API_KEY` | `bot-som-report` (redacción del informe), `som-procesar-laboratorio` (transcripción del PDF), `som-borrador-respuesta` ("Sugerir" en Mensajes) | opcional (sin él: informe mínimo / el PDF pasa al equipo / "Sugerir" avisa que está desactivado) |

**Regla de oro:** los helpers (`enviarWhatsApp` / `enviarEmail` en
`src/bots/_shared.ts`) **siempre** registran la `Communication`, pero **solo
envían** si está la configuración completa. Así se puede probar la lógica sin
spamear a nadie. Estados resultantes:

| Situación | Estado de la `Communication` | ¿Se envió? |
|---|---|---|
| Config completa + destinatario válido | `completed` | sí |
| Falta secreto / falta teléfono o email del paciente | `preparation` | no |
| El teléfono no es un celular válido para WhatsApp | `preparation` (con `statusReason`) | no |
| El proveedor (Twilio/SES) devuelve error | `entered-in-error` (WhatsApp: con el motivo en `statusReason`) | no |

WhatsApp: `enviarWhatsApp` pasa el teléfono de la ficha a **E.164** (`+549…`: WhatsApp
exige el 9 de celular; acepta `11 2233-4455`, `011 15 2233-4455`, etc.) y guarda el
`MessageSid` y sus ✓✓. Los avisos automáticos quedan como mensajes sueltos; las
conversaciones con el paciente (portal y WhatsApp) viven en **Mensajes**. Ver
[`whatsapp.md`](whatsapp.md).

### WhatsApp (Twilio + WABA de EPA Bienestar IA)

El envío sale por la cuenta **Twilio de SOM**, con la **WABA (WhatsApp Business
Account) de EPA Bienestar IA** conectada como *WhatsApp sender* en Twilio:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` (número de la WABA, formato `whatsapp:+549...`)
- `RECEPCION_WHATSAPP_TO` (número de Recepción, para el aviso de **solicitudes** del portal)

> Con la WABA real, los mensajes que inicia el negocio (confirmación,
> recordatorios, invitación) fuera de la ventana de 24 h de WhatsApp solo salen
> como **plantillas aprobadas por Meta** (si no, Twilio da 63016). Con el secret
> `TWILIO_CONTENT_SID_AVISO` (plantilla genérica `som_aviso`, `npm run whatsapp:plantillas`)
> los avisos salen con ella; sin él, como texto libre (solo llega dentro de la ventana de
> 24 h). Ver [`whatsapp.md`](whatsapp.md), «Plantillas de Meta».

El destinatario sale de `Patient.telecom` (teléfono/SMS). El WhatsApp se dispara
automático **al reservar** (turno tentativo), **al pagar la seña** (confirmado)
y en los **recordatorios** (ver abajo).

> **Diagnóstico de WhatsApp:** `npm run whatsapp:test -- +5491122334455` ejecuta el
> bot `som-enviar-whatsapp` en el server (lee los Project Secrets reales) y reporta
> el `status` de la `Communication`: `completed` (Twilio aceptó), `preparation`
> (falta algún secret) o `entered-in-error` (Twilio rechazó: sandbox/FROM/número).
> Después revisa el webhook de entrada (Project Secrets y `TWILIO_WEBHOOK_URL`, sin
> mostrar valores); `npm run webhooks` lo deja listo y prueba la URL pública (ver
> `docs/whatsapp.md`).

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

### MercadoPago: qué credencial va (y el 403 "PolicyAgent")

- **`MERCADOPAGO_ACCESS_TOKEN` = el Access Token de producción** de la aplicación
  de SOM: MercadoPago → *Tus integraciones* → la aplicación → *Credenciales de
  producción* → **Access Token** (`APP_USR-{app}-{fecha}-{hash}-{usuario}`). No
  la **Public Key** (`APP_USR-` + un UUID: es para el navegador), ni el Client
  ID / Client Secret. Sin comillas ni `Bearer` (igual el bot los limpia).
- Las **credenciales de producción** de la aplicación tienen que estar
  **activadas**, y la cuenta **habilitada para cobrar** (identidad validada,
  términos aceptados, cuenta de Argentina).
- **403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (`blocked_by: PolicyAgent`)** es
  la capa de autorización de MercadoPago: la credencial cargada no está
  autorizada para crear links de pago. El bot ya no muestra el JSON crudo: dice
  qué credencial hay cargada y qué ve en la cuenta (`GET /users/me`).
- **Diagnóstico:** `npm run mercadopago:test` ejecuta el bot en el servidor en
  modo diagnóstico (no crea links ni cobra): informa el tipo de credencial (sin
  mostrarla) y si la cuenta puede cobrar.
- **Seña $0:** si un servicio sigue sin precio (hoy, el control GLP-1) la seña es 0
  y MercadoPago no genera links por $0: el bot lo avisa (y verifica la credencial
  igual). La seña manual sigue funcionando.

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

Los especialistas, desde el dashboard clínico, ejecutan `BOTS_MEDICO` o
`BOTS_NUTRICION`: `som-teleconsulta-token` y `som-estado-turno` (entrar a la
teleconsulta y cerrarla), `puco-cobertura` y, sólo los médicos, `som-glp1-plan` y
`refeps-verify`. `puco-cobertura` y `refeps-verify` son del dashboard y se despliegan
desde ahí (`deploy-bots-server -- --solo`).

## Webhook de MercadoPago (confirmación automática)

Cuando el paciente paga la seña por el link, MercadoPago avisa a un **webhook** y el
turno se confirma solo (pending → booked) + WhatsApp.

1. `npm run deploy:bots` (crea y deploya `som-webhook-mercadopago`) y `npm run seed`
   (AccessPolicy "Webhook MercadoPago — pagos").
2. Cargar el secret `MERCADOPAGO_ACCESS_TOKEN` (el mismo del link).
3. **URL pública sin credenciales:** MercadoPago rechaza URLs con `usuario:clave@`, así que
   la autenticación la agrega **nginx** (misma receta que el webhook de WhatsApp, ver
   `docs/whatsapp.md`): MP llama a
   `https://api.medplum.com.ar/webhooks/som/mercadopago` y nginx reenvía al `$execute` del
   bot con el `Authorization` de la ClientApplication dedicada **`Webhook MercadoPago`**,
   que solo puede ejecutar ese bot. El bloque está en
   [`deploy/nginx-webhooks-som.conf`](../deploy/nginx-webhooks-som.conf).
4. `npm run webhooks` crea la ClientApplication, guarda esa URL en el secret
   **`MP_WEBHOOK_URL`** (el link de pago la manda como `notification_url` de cada
   preferencia) y prueba la URL pública con un evento que el bot ignora.
5. En MercadoPago (Tus integraciones → tu app → **Webhooks**, **modo productivo**, evento
   **Pagos**) configurar la misma URL. **Webhooks, no IPN:** IPN viaja en la query string y
   el bot recibe el cuerpo.

El bot toma el id del pago, hace `GET /v1/payments/{id}` con el token, y si está
`approved` **y cubre la seña** (en pesos y por el monto, con $1 de redondeo) confirma el
turno por su `external_reference` (= appointmentId). El Invoice registra lo que
MercadoPago dice que se pagó y el id del pago (`mp-<id>`). Es idempotente: MercadoPago
avisa el mismo pago varias veces y no se duplica nada. Un pago aprobado que **no cubre la
seña** (otro monto u otra moneda) no confirma el turno: Recepción recibe **una** alerta
por WhatsApp para reintegrarlo o cobrar la diferencia. Uno sobre un turno ya cancelado,
tampoco (alerta para reintegrar).

Después de pagar, MercadoPago devuelve al paciente al **portal** (`back_urls` =
`PORTAL_BASE_URL`), no a la app de Recepción.

### Probar de punta a punta (pago real)

```bash
npm run mercadopago:test                              # credencial y cuenta (no cobra)
npm run webhooks                                      # la URL pública llega al bot (no cobra)
npm run mercadopago:e2e -- [--telefono +549…]          # turno de prueba + link + espera el pago
npm run mercadopago:e2e -- --limpiar --turno <id>      # cancela el turno de prueba
npm run mercadopago:ordenes                           # los últimos pagos, cruzados con Medplum
npm run mercadopago:ordenes -- --pago <id>            # un pago + "Calidad de integración"
```

`mercadopago:ordenes` lee los pagos de la cuenta (`GET /v1/payments/search`; `--dias`,
`--limite`, `--turno <id>`) y, por cada uno, dice si el webhook lo **aplicó** en Medplum
(Invoice `mp-<id>` y estado del turno): un pago aprobado sin Invoice es una notificación
que no llegó o falló. Con `--pago <id>` muestra el detalle y lo que mira **"Calidad de
integración"** de MercadoPago (descripción, código y categoría del ítem, webhook,
`external_reference`…), con ✓/✗ según lo que llegó en ese pago, el **Order ID** (el que pide
el panel; no es el Payment ID) y la **aplicación** que creó el pago. Solo lee; el token sale
del Project Secret y no se imprime; el email del comprador se muestra enmascarado.

> **"Calidad de integración" solo acepta Order IDs de pagos hechos con credenciales de SU
> aplicación** (si no: «Ingresá un Order ID válido»). La aplicación la define el Access Token
> cargado en `MERCADOPAGO_ACCESS_TOKEN`, no el servidor: para medir en una aplicación, cargar
> sus **Credenciales de prueba** (Access Token), hacer un pago con `mercadopago:e2e` y usar
> el Order ID que da `mercadopago:ordenes`. Con una credencial `TEST-` el link es el del
> sandbox y la prueba corre en modo prueba.

`mercadopago:e2e` verifica la credencial y `MP_WEBHOOK_URL`, reserva un turno tentativo
(la primera franja libre de un profesional desde mañana; **presencial** por defecto, porque
la teleconsulta exige el consentimiento que el paciente firma en el portal, R-21; o
`--modalidad teleconsulta`) para un paciente de prueba (tag demo; o
`--paciente Patient/<id>`), genera el link de la seña y **espera el
pago** (`--espera <min>`, 15 por defecto). Cuando el webhook confirma el turno, muestra el
Invoice (lo pagado y el id del pago) y el WhatsApp de confirmación. Con `--turno <id>`
retoma la espera o la verificación de un turno ya armado; `--limpiar` cancela el turno.
El script nunca cobra ni devuelve plata por su cuenta.

- **Con la credencial de la cuenta real de SOM el pago es real:** devolverlo desde el panel
  de MercadoPago (Actividad → el pago → Devolver).
- **Modo prueba (sin plata real):** si `MERCADOPAGO_ACCESS_TOKEN` es de un **usuario de
  prueba** de MercadoPago (`TESTUSER…`), el script lo detecta y sigue igual: se paga
  entrando al link (en incógnito) con un **comprador de prueba** —otro usuario de prueba,
  no el vendedor: Tus integraciones → Cuentas de prueba— y una **tarjeta de prueba** (Tus
  integraciones → Tarjetas de prueba) con titular **APRO** (aprobado) y DNI 12345678. Un
  usuario de prueba no sirve para cobrar de verdad: `mercadopago:test` lo marca.

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
- **Teleconsulta:** el recordatorio lleva el link de la videollamada (Jitsi).
- **Plan Bienestar 100 Días®** (R-20, [`plan-bienestar.md`](plan-bienestar.md)): para
  cada consulta del plan todavía sin agendar (la del día 50 y la final, una vez
  agendada la inicial), un aviso al paciente cuando se abre su ventana y, si a mitad
  de ventana sigue sin agendar, otro aviso + la tarea pasa a urgente + WhatsApp a
  Recepción (`RECEPCION_WHATSAPP_TO`). Solo de 9 a 20 h (Argentina); identifier
  `pb100d-{aviso}-{tarea}`.

### Cron de `som-recordatorios`

Configurar el `cronTimer` del Bot **una vez** (p. ej. `*/30 * * * *` = cada 30
min). Cuanto más seguido corra, más cerca de las 48 h / 2 h exactas sale el aviso;
la idempotencia evita duplicados. Necesita los mismos secretos de Twilio que
`som-enviar-whatsapp`.

## Agenda por profesional (R-22): `som-generar-agenda`

Cada profesional de `src/config/medicos.ts` tiene un `Schedule` propio (lo crea el
seed) y sus horarios libres salen de su `disponibilidad` semanal intersectada con el
horario del centro (`src/lib/agenda-profesional.ts`, puro y testeado). El cron los
materializa como `Slot` `free` de 30 min para los próximos 45 días
(`DIAS_AGENDA_ADELANTE`), y es lo que el portal lista para ofrecer horarios:
`Slot?schedule=Schedule/{id}&status=free&start=ge{ahora}`.

- **Idempotente:** identifier `{medico}@{inicio}` (sistema `CodeSystem/medico`) y
  `If-None-Exist`; una franja ya `busy` no se vuelve a crear libre.
- **Modalidades:** cada franja lleva la extensión `modalidad` (AMB / VR) según la
  disponibilidad (p. ej. presencial martes y jueves 9–12, teleconsulta el resto); el
  portal filtra por ella y la reserva la respeta. Si la disponibilidad cambia de
  modalidad, el cron corrige las franjas que siguen libres; las ocupadas no se tocan.
- **Cambió la disponibilidad:** las franjas libres que quedaron fuera del nuevo
  horario no se borran solas (podrían tener reservas); se revisan a mano.
- **Sin cron:** `npm run seed -- --with-slots --dias=N` crea las mismas franjas, y la
  reserva por `medicoCodigo` + `inicio` materializa la franja en el momento si cae en
  la disponibilidad del profesional.

### Cron de `som-generar-agenda`

Configurar el `cronTimer` del Bot **una vez**, diario (p. ej. `15 3 * * *`). No
necesita secretos. Un profesional sin `disponibilidad` cargada no genera horarios
(sale en la respuesta como `sinDisponibilidad`) y no es reservable.

## Reserva desde el portal (R-23): `som-reservar-portal` y `som-vencer-reservas`

La paciente arma "Especialidad → Profesional → Horario" leyendo el catálogo, los
`PractitionerRole` y los `Slot` libres, y reserva con `som-reservar-portal`
(`{ pacienteRef, servicioCodigo, slotId, modalidad, tareaId? }`; contrato completo en
[`handoff-app-pb100d.md`](handoff-app-pb100d.md)). El bot valida quién ejecuta
(`requester` = la paciente), que la consulta sea reservable desde el portal (por
especialidad, o la del plan con su tarea; el control GLP-1 lo agenda Recepción), la
anticipación mínima, y delega la reserva en `som-reservar-turno` (R-07, R-20, R-21, R-22).

- **Consulta del plan** (incluida): queda `booked`, sin seña; WhatsApp de confirmación.
- **Consulta con cargo**: queda `pending` con `reserva-expira` = ahora + 30 min y
  `origen-reserva` = `portal`; se genera el link de MercadoPago de la seña (mismo
  código que `som-link-mercadopago`, idempotente por turno), se guarda en
  `link-pago-sena` y sale por WhatsApp con la hora límite. Al acreditarse, el webhook
  confirma el turno (`booked`).
- **Sin link** (MercadoPago sin configurar o caído): la reserva queda tentativa **sin
  vencimiento** (no es culpa de la paciente) y Recepción recibe un WhatsApp para cobrar
  la seña (`RECEPCION_WHATSAPP_TO`).
- **Vencimiento**: `som-vencer-reservas` cancela los `pending` con `reserva-expira`
  vencida (con `If-Match`, para no pisar una confirmación simultánea), libera las
  franjas y avisa a la paciente. Una **seña tardía** (webhook o manual) sobre un turno
  cancelado no lo revive: `confirmarReserva` no emite el Invoice, devuelve `rechazado`
  y avisa a Recepción para reintegrarla.

### Cron de `som-vencer-reservas`

Configurar el `cronTimer` del Bot **una vez**, cada pocos minutos (p. ej. `*/5 * * * *`).
Necesita los secretos de Twilio para avisar a la paciente (sin ellos, igual cancela y
libera; el aviso queda registrado sin enviar).

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
