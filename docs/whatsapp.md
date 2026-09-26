# WhatsApp en Mensajes (Twilio)

WhatsApp **no es una bandeja aparte**: es un canal de las conversaciones de
**Mensajes**, como en el demo que mandó el Dr. D'Alessandro. Lo que el paciente escribe
por el portal o por WhatsApp cae en la misma conversación; Recepción responde en un solo
lugar y la respuesta sale por donde escribió el paciente.

Cuando escribe un **número nuevo** (alguien que no estaba en SOM), además queda un
**aviso** en la pestaña **WhatsApp** (el "Avisos" del demo) y suena la campanita. Desde
la tarjeta se le responde, se le completa la ficha o se marca resuelto.

Decisiones del Dr. D'Alessandro (26/09/2026):

| Tema | Decisión |
|---|---|
| ¿Dónde entra un WhatsApp? | En la **conversación abierta** del paciente; si no tiene, se abre una nueva con motivo «Otro motivo». El paciente también la ve en el portal. |
| ¿La respuesta sale por WhatsApp? | **Por donde escribió último el paciente** en esa conversación (y solo dentro de la ventana de 24 h de WhatsApp). Si escribió por el portal, queda en el portal. |
| ¿Qué avisa la campanita? | Solo **números nuevos** (alguien que no estaba en SOM): cada uno es un aviso pendiente de la pestaña **WhatsApp** hasta que se resuelve. |
| Pestaña **WhatsApp** | El "Avisos" del demo: una tarjeta por número nuevo con lo que escribió y lo que ya se le contestó; **Responder**, **Completar ficha**, **Ver conversación** y **Resolver**. Al completar la ficha, el aviso se resuelve solo. |
| Respuestas automáticas | **Acuse** cuando un WhatsApp abre una conversación nueva y **fuera de horario** (una vez por período cerrado), con los textos aprobados. |
| Adjuntos | Recepción adjunta PDF/fotos (hasta 15 MB) y ve las fotos en la burbuja: tiene acceso a `Binary` (Medplum no deja listarlos: solo se abre un archivo con su link). |

Código:
- Lógica pura y testeada: [`src/lib/whatsapp.ts`](../src/lib/whatsapp.ts) (teléfonos
  E.164, webhook de Twilio, hilos, a dónde responder),
  [`src/lib/contactos-whatsapp.ts`](../src/lib/contactos-whatsapp.ts) (el aviso de un
  número nuevo: `Task`, pestaña WhatsApp y campanita) y
  [`src/lib/auto-respuesta.ts`](../src/lib/auto-respuesta.ts) (ventana de 24 h, horario,
  qué responde solo el sistema). Textos: [`src/config/auto-respuesta.ts`](../src/config/auto-respuesta.ts).
- La bandeja: [`src/lib/mensajes.ts`](../src/lib/mensajes.ts) y la pantalla
  **Mensajes** (`app/src/pages/Mensajes.tsx`); los números nuevos: la pestaña
  **WhatsApp** (`app/src/pages/WhatsApp.tsx`) y la campanita
  (`app/src/components/CampanaWhatsApp.tsx`).
- Bots: `som-whatsapp-entrante` (webhook) y `som-whatsapp-responder` (la respuesta por
  WhatsApp); `enviarWhatsApp` (`src/bots/_shared.ts`) sigue mandando los avisos
  automáticos (confirmación, recordatorios, invitación) como mensajes sueltos.

## Cómo funciona

```
Paciente ─WhatsApp─► Twilio ─► som-whatsapp-entrante ─► conversación de Mensajes (sin leer)
                                     │                        │
                                     ├─ acuse / fuera de       └─ pestaña Mensajes (en vivo)
                                     │  horario (🤖)
                                     └─ número nuevo: aviso (Task) ─► pestaña WhatsApp + campanita
Recepción responde (en Mensajes o en la tarjeta de WhatsApp) ─► queda en el portal
        └─► som-whatsapp-responder ─► Twilio ─► Paciente (si escribió por WhatsApp)
                      ✓ ✓✓ ✓✓azul ◄─ StatusCallback ─► som-whatsapp-entrante
```

1. **Llega un WhatsApp.** `som-whatsapp-entrante`:
   - descarta lo que no viene de la cuenta de SOM (`AccountSid` ≠ `TWILIO_ACCOUNT_SID`)
     y no duplica si Twilio reintenta (identifier `MessageSid`);
   - busca al paciente por el número, en cualquiera de las formas en que puede estar en
     la ficha (`+549…`, `11 2233-4455`, `011 15 2233-4455`, …); si no existe, crea un
     **lead** del CRM (`origen-lead = whatsapp`) con el nombre del perfil de WhatsApp como
     apodo, marca el mensaje **inicio de contacto** y deja un **aviso** a Recepción (`Task`
     `whatsapp-nuevo-contacto`, uno por número: pestaña WhatsApp y campanita);
   - lo deja **sin leer** en la conversación abierta del paciente, o abre una nueva
     («Otro motivo»); guarda fotos, audios y documentos en `Binary` (hasta 10 MB);
   - **responde solo** si corresponde: fuera de horario, el aviso con el horario (una vez
     por período cerrado); si abrió una conversación nueva, el acuse. Nunca las dos.
     Si no pudo dejar el aviso a Recepción, igual responde y le pide a Twilio que
     reintente: el reintento deja el aviso sin repetir la respuesta automática.
2. **La campanita** (arriba) cuenta los avisos pendientes, con aviso emergente
   ("Ver en WhatsApp") y, si se activa, aviso del escritorio. Tocar un aviso lo abre
   marcado en la pestaña **WhatsApp** (ver abajo); se apaga cuando se resuelve.
3. **Mensajes** se ve como WhatsApp: lista con el último mensaje, hora y no leídos
   (ícono de WhatsApp si el paciente escribe por ahí, etiqueta **Nuevo** para un número
   nuevo); burbujas con 📱 WhatsApp / Portal, 🤖 Automática y los ✓✓; fotos, audios y
   videos dentro de la burbuja; 📎 para adjuntar. En vivo por la suscripción de Medplum
   (con refresco de respaldo).
4. **Responder:** la respuesta queda en el portal y la app le pide a
   `som-whatsapp-responder` que la mande. El bot decide: si el último mensaje del paciente
   llegó por WhatsApp y la **ventana de 24 h** sigue abierta, la manda (texto y adjuntos,
   al número desde el que escribió) y marca la burbuja con 📱 y ✓; si no, avisa
   "Quedó en la conversación, pero NO salió por WhatsApp" con el motivo.
5. **Los ✓✓:** cada envío pide sus estados a Twilio y el mismo webhook los guarda:
   🕓 en camino · ✓ enviado · ✓✓ entregado · ✓✓ azul leído · ⚠ no entregado (con el
   motivo, p. ej. "el número no tiene WhatsApp"). Nunca retroceden.

### La pestaña WhatsApp (números nuevos)

Es el "Avisos" del demo, solo con lo que existe en SOM: los WhatsApp de números nuevos.
Cada tarjeta es un aviso pendiente, del más nuevo al más viejo:

- **Quién y cuándo:** el nombre del perfil de WhatsApp (o el número, si no tiene), el
  teléfono, cuándo escribió y cuánto queda de la ventana de 24 h; etiquetas **Sin ficha**,
  **Sin responder** / **Respondido** (el acuse automático no cuenta como respuesta) y
  **DEMO** si es un dato de demostración.
- **La conversación**, con el fondo del chat de WhatsApp: los últimos 4 mensajes con las
  mismas burbujas que Mensajes (📱, 🤖, ✓✓); los anteriores, en «Ver conversación».
- **Responder:** la respuesta queda en su conversación de Mensajes, sale por WhatsApp
  (`som-whatsapp-responder`) y marca leído lo que escribió. **Sugerir** pide un borrador,
  como en Mensajes. Con la ventana cerrada no deja escribir y dice por qué (llamarlo o
  esperar a que vuelva a escribir: las plantillas de Meta están pendientes).
- **Completar ficha:** el alta con el teléfono y el nombre del perfil precargados. El bot
  `som-alta-paciente` encuentra el contacto por el número, le pone el nombre real y
  **resuelve el aviso solo** (`ficha-completada`); después se abre el paciente para
  seguir (reservar, invitar al portal…), como en el demo. Si esos datos ya eran de otra
  ficha, lo avisa: los próximos WhatsApp de ese número entran a esa ficha.
- **Ver conversación:** la abre en Mensajes. **Resolver:** lo saca de la lista (queda
  quién y cuándo).

Se actualiza en vivo (suscripción de Medplum a los avisos y a los mensajes), cada 30 s y
al volver a la ventana. Completar la ficha desde **Mensajes** también resuelve el aviso.

### La ventana de 24 h

WhatsApp solo deja mandar **texto libre** dentro de las 24 h del último mensaje del
paciente; después, solo **plantillas aprobadas por Meta** (pendientes). El encabezado de
la conversación muestra cuánto queda ("Ventana WhatsApp · 3 h 20 min", naranja cuando
faltan menos de 2 h) y, con la ventana cerrada, avisa antes de escribir.

### Respuestas automáticas

| Cuándo | Texto (aprobado) |
|---|---|
| Un WhatsApp abre una conversación nueva | «¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. En breve te responde alguien de Recepción.» |
| Llega un WhatsApp con el centro cerrado (una vez por período cerrado) | «¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. Ahora estamos fuera del horario de atención (lunes a viernes de 8 a 22 y sábados de 8 a 20). Te respondemos apenas abramos.» |

El horario es el de la agenda ([`config/horario.ts`](../src/config/horario.ts), hoy
**provisorio**): al cargar el real, el texto y el momento del aviso se ajustan solos.
Las automáticas no le quitan al paciente el aviso del portal cuando después responde una
persona.

### Privacidad por diseño

- El aviso del informe SOM (con resumen clínico) sale como aviso suelto con la etiqueta
  de confidencialidad HL7 `R`; no entra en ninguna conversación de Mensajes.
- Recepción accede a los archivos (`Binary`) por decisión del 26/09/2026, como el demo:
  Medplum no permite buscarlos ni listarlos, así que solo abre un archivo si tiene su
  link (los de una conversación que ya ve).
- El token de Twilio solo viaja a `api.twilio.com`: media de otro host no se descarga.

## Puesta en marcha

### 1. Bots y seed

```bash
npm run deploy:bots   # som-whatsapp-entrante y som-whatsapp-responder
npm run seed          # extensiones nuevas + AccessPolicy "Webhook Twilio — WhatsApp entrante"
                      # + la policy de Recepción (bots nuevos y acceso a archivos)
```

### 2. Una ClientApplication solo para Twilio

En Medplum (Project Admin → **Clients** → New): nombre `Webhook Twilio`. En su
membership, asignar la AccessPolicy **"Webhook Twilio — WhatsApp entrante"**: solo puede
ejecutar `som-whatsapp-entrante` (el bot corre con su propia identidad), así que si la URL
se filtrara no da acceso a ningún dato. Copiar su **Client ID** y **Client Secret**.

### 3. La URL del webhook

```
https://<clientId>:<clientSecret>@api.medplum.com.ar/fhir/R4/Bot/<id de som-whatsapp-entrante>/$execute?_medplum-prompt-basic-auth=1
```

- `npm run whatsapp:test` la imprime con el id real del bot.
- **`?_medplum-prompt-basic-auth=1` es obligatorio:** Twilio manda el primer pedido
  **sin** credenciales y solo las agrega si el servidor responde 401 con
  `WWW-Authenticate: Basic`; Medplum manda ese encabezado solo con ese parámetro.

### 4. Twilio Console

- **Número de WhatsApp de SOM** (Messaging → Senders → WhatsApp senders → el número):
  en *Webhook URL for incoming messages*, la URL del paso 3 (POST). Si el número está en
  un *Messaging Service*, configurarla en el servicio (Integration → *Send a webhook*).
- **Sandbox** (para probar): Messaging → Try it out → Send a WhatsApp message →
  *Sandbox settings* → *When a message comes in*.

### 5. Project Secrets (Medplum → Project → Secrets)

| Secret | Para qué |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | enviar, bajar la media y validar que el webhook es de la cuenta de SOM |
| `TWILIO_WHATSAPP_FROM` | el número de WhatsApp de SOM (`whatsapp:+54…`) |
| `TWILIO_WEBHOOK_URL` | la URL del paso 3: sin ella no hay ✓✓ |
| `RECEPCION_WHATSAPP_TO` | opcional: el número que recibe los avisos internos (no se vuelve paciente si escribe) |

### 6. Probar

1. `npm run whatsapp:test -- +549…` → envío de prueba (dice si falta un secret o qué
   rechazó Twilio) y la URL del webhook.
2. Escribirle al WhatsApp de SOM desde un celular que no esté en SOM: llega el acuse,
   suena la campanita, el contacto aparece en la pestaña **WhatsApp** y la conversación
   en **Mensajes**. Responder desde la tarjeta y ver llegar los ✓✓; completar la ficha y
   ver que el aviso se resuelve.
3. Para ver las pantallas con datos sin Twilio: `npm run datos-demo` (un número nuevo con
   su acuse y su aviso en la pestaña WhatsApp, una conversación por WhatsApp con
   respuesta y una del portal).

> Tiempo real: la bandeja se actualiza al instante si el proyecto de Medplum tiene
> habilitadas las suscripciones por WebSocket; si no, cada 20 s (la pestaña WhatsApp y la
> campanita, cada 30 s y al volver a la ventana).
> En el *Debugger* de Twilio puede aparecer la advertencia **12300** (el webhook
> responde JSON, no TwiML): es inofensiva.

## Modelo FHIR

| Qué | Cómo |
|---|---|
| Conversación | `Communication` sin `partOf`, `subject` = el paciente, `topic` = el motivo (el mismo contrato que el portal). Las que abre un WhatsApp: motivo `otro` + extensión `canal = whatsapp` + identifier `communication\|conversacion-whatsapp-<paciente>` (evita abrir dos a la vez) |
| Mensaje del paciente por WhatsApp | hija (`partOf`), `sender` = el paciente, `status` `in-progress` = sin leer, extensión `canal = whatsapp`, `telefono-whatsapp` (a dónde se responde), identifier `twilio-message-sid`; `inicio-contacto = true` si es un número nuevo |
| Respuesta de Recepción | hija con `sender` = quien respondió; si salió por WhatsApp: `canal = whatsapp`, `telefono-whatsapp`, `estado-entrega` (✓✓) y un `twilio-message-sid` por mensaje de Twilio |
| Respuesta automática | hija con `sender.display` = «Segunda Opinión Médica · respuesta automática» y extensión `auto-respuesta` = `acuse` \| `fuera-de-horario` |
| Adjuntos | `payload.contentAttachment` → `Binary/<id>` con `securityContext` = el paciente |
| Aviso automático (confirmación, recordatorio, …) | `Communication` suelta (sin `partOf`), `category` `canal\|whatsapp`, con su `MessageSid` y ✓✓ |
| Número nuevo | `Patient` con `name.use = nickname`, `origen-lead = whatsapp`, `ciclo-vida-cliente = lead`; **Completar ficha** (alta) lo encuentra por el número y agrega el nombre real sin duplicarlo |
| Aviso de un número nuevo (pestaña WhatsApp, campanita) | `Task` `code` = `task-tipo\|whatsapp-nuevo-contacto`, `intent` `order`, `status` `requested` → `completed`; identifier `aviso-recepcion\|whatsapp-nuevo-contacto-<paciente>` (uno por número); `for`/`requester` = el lead, `focus` = su conversación, `reasonReference` = el primer mensaje; `input` `telefono`, `perfil`, `texto`. Resuelto: `businessStatus` `resolucion-aviso\|ficha-completada` o `\|resuelto`, `executionPeriod.end` y `owner` (quién, si fue una persona) |

## Límites y pendientes

- **Plantillas de Meta** (`ContentSid`): para escribirle primero a un paciente por
  WhatsApp o pasadas las 24 h. Hasta entonces, la respuesta queda en el portal y se avisa.
- **Firma de Twilio** (`X-Twilio-Signature`): Medplum 3.3 no le pasa los encabezados al
  bot; la seguridad es la ClientApplication dedicada + el `AccountSid`.
- **Fichas duplicadas:** si un paciente registrado escribe desde un número que no está en
  su ficha, entra como número nuevo (y deja su aviso). Unir fichas queda para después.
- La pestaña WhatsApp muestra solo los números nuevos: los otros avisos del demo (lista
  de espera, pagos, diferencias de caja) no existen en SOM.
- Media entrante de más de 10 MB no se guarda ("no se pudo descargar"); los audios de
  WhatsApp (OGG/Opus) se escuchan en Chrome y Firefox.
