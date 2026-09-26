# WhatsApp de Recepción (Twilio)

Recepción ve el WhatsApp de Segunda Opinión Médica **como en el teléfono**, pero
desde la app: lista de chats, conversación con los ✓✓, respuesta y una **campanita**
que avisa cuando alguien escribe para **iniciar una conversación**. Todo queda
registrado en Medplum (FHIR R4) y la lógica vive en el backend:

- Lógica pura y testeada: [`src/lib/whatsapp.ts`](../src/lib/whatsapp.ts)
  (teléfonos E.164, webhook de Twilio, ventana de 24 h, inicio de contacto, chats).
- Lo que lee la app: [`src/lib/whatsapp-chat.ts`](../src/lib/whatsapp-chat.ts).
- Bots: `som-whatsapp-entrante` (webhook), `som-whatsapp-responder`,
  `som-whatsapp-adjunto`, más el envío compartido `enviarWhatsApp`
  (`src/bots/_shared.ts`) que usan confirmaciones, recordatorios e invitaciones.
- App: pestaña **WhatsApp** (`app/src/pages/WhatsApp.tsx`) y campanita
  (`app/src/components/CampanaWhatsApp.tsx`).

## Cómo funciona

```
Paciente ──WhatsApp──► Twilio ──POST──► som-whatsapp-entrante ──► Communication (sin leer)
                                                                        │
Recepción ◄── campanita / pestaña WhatsApp (revisa cada 15 s) ◄────────┘
    │
    └─ responde ──► som-whatsapp-responder ──► Twilio ──► Paciente
                                                  │
                            estados ✓ ✓✓ ✓✓ azul ◄┘ (StatusCallback → som-whatsapp-entrante)
```

1. **Llega un mensaje.** Twilio llama a `som-whatsapp-entrante`, que:
   - descarta lo que no viene de la cuenta de SOM (`AccountSid` ≠ `TWILIO_ACCOUNT_SID`);
   - no duplica si Twilio reintenta (identifier `MessageSid`);
   - busca al paciente por el número, **en cualquiera de las formas en que puede
     estar tipeado en la ficha** (`+549…`, `11 2233-4455`, `011 15 2233-4455`, …);
   - si nadie tiene ese número, crea un **contacto nuevo**: un `Patient` lead del CRM
     (`origen-lead = whatsapp`, `ciclo-vida-cliente = lead`) con el nombre del perfil
     de WhatsApp como apodo (`name.use = nickname`) o, si no tiene, el número;
   - guarda fotos, audios y documentos en `Binary` (hasta 10 MB);
   - marca **inicio de contacto** si no hubo ningún WhatsApp con ese paciente (de ida
     o de vuelta) en las últimas 24 h: el contacto nuevo o el que vuelve a escribir.
2. **La campanita** (arriba, al lado del modo oscuro) muestra los inicios de contacto
   que nadie leyó, uno por persona, con un aviso emergente al llegar ("Abrir el chat")
   y, si Recepción lo activa, un aviso del escritorio cuando la pestaña está oculta.
   La pestaña **WhatsApp** cuenta todos los mensajes sin leer y el título del
   navegador también (`(3) Segunda Opinión Médica · Recepción`).
3. **Abrir un chat** lo marca leído (solo si la pestaña está a la vista) y apaga el
   aviso. Un contacto nuevo sigue con la etiqueta **Nuevo** hasta que alguien le
   responde.
4. **Responder:** `som-whatsapp-responder` decide si se puede (ver la ventana de
   24 h), responde **al número desde el que escribió** y registra el mensaje con la
   recepcionista como remitente. Enter envía; Shift+Enter, salto de línea.
5. **Los ✓✓:** cada saliente pide a Twilio sus estados (`StatusCallback`) y el mismo
   webhook los guarda: 🕓 en camino · ✓ enviado · ✓✓ entregado · ✓✓ azul leído ·
   ⚠ no entregado (con el motivo en palabras de Recepción, p. ej. "pasaron más de
   24 h…"). Nunca retroceden aunque Twilio los mande desordenados.

En cada chat aparecen también los avisos **automáticos** (confirmación, recordatorios,
invitación al portal, avisos del Plan Bienestar), marcados "Automático · …".

### La ventana de 24 h (regla de WhatsApp)

WhatsApp solo deja mandar **texto libre** dentro de las 24 h del último mensaje del
paciente. Fuera de esa ventana (o si el paciente nunca escribió), solo **plantillas
aprobadas por Meta**, que están **pendientes** (ver
[decisiones pendientes](decisiones-pendientes.md)). La regla la aplica el bot, no la
app: la pantalla muestra hasta cuándo se puede responder ("hasta mañana a las 09:15")
y, con la ventana cerrada, bloquea el campo y explica por qué.

### Privacidad por diseño

- El aviso del informe SOM al paciente lleva su resumen clínico: sale con la etiqueta
  de confidencialidad HL7 `R` y en el chat de Recepción se ve
  "🔒 Aviso con información clínica (solo lo ve el paciente)", nunca el texto.
- Recepción **no** tiene acceso general a `Binary` (ahí también están los estudios
  del portal): los adjuntos del chat los entrega `som-whatsapp-adjunto`, solo si son
  de un mensaje de WhatsApp y no reservado. En la app, lo que puede traer código (un
  HTML, un SVG) se **descarga**, nunca se abre.
- El token de Twilio solo viaja a `api.twilio.com`: la media de otro host no se baja.

## Puesta en marcha

### 1. Bots y seed

```bash
npm run deploy:bots   # crea y deploya som-whatsapp-entrante, -responder y -adjunto
npm run seed          # extensiones nuevas + AccessPolicy "Webhook Twilio — WhatsApp entrante"
                      # + la policy de Recepción con los bots nuevos
```

### 2. Una ClientApplication solo para Twilio

En Medplum (Project Admin → **Clients** → New): nombre `Webhook Twilio`. En su
membership, asignar la AccessPolicy **"Webhook Twilio — WhatsApp entrante"**: solo
puede ejecutar `som-whatsapp-entrante` (el bot corre con su propia identidad), así que
si la URL se filtrara no da acceso a ningún dato. Copiar su **Client ID** y **Client
Secret**.

### 3. La URL del webhook

```
https://<clientId>:<clientSecret>@api.medplum.com.ar/fhir/R4/Bot/<id de som-whatsapp-entrante>/$execute?_medplum-prompt-basic-auth=1
```

- El id del bot está en `medplum.config.json` después del deploy.
- **`?_medplum-prompt-basic-auth=1` es obligatorio:** Twilio manda el primer pedido
  **sin** credenciales y solo las agrega si el servidor responde 401 con
  `WWW-Authenticate: Basic`. Medplum manda ese encabezado solo cuando la URL trae ese
  parámetro. Sin él, Twilio nunca se autentica.

### 4. Twilio Console

- **Número de WhatsApp de SOM** (Messaging → Senders → WhatsApp senders → el número):
  en *Webhook URL for incoming messages*, la URL del paso 3 (método POST). Si el número
  está en un *Messaging Service*, configurarla en el servicio (Integration → *Send a
  webhook*).
- **Sandbox** (para probar): Messaging → Try it out → Send a WhatsApp message →
  *Sandbox settings* → *When a message comes in*.
- No hace falta configurar el *Status callback* en la consola: cada envío lo pide con
  el secret `TWILIO_WEBHOOK_URL`.

### 5. Project Secrets (Medplum → Project → Secrets)

| Secret | Para qué |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | enviar, bajar la media y validar que el webhook es de la cuenta de SOM |
| `TWILIO_WHATSAPP_FROM` | el número de WhatsApp de SOM (`whatsapp:+54…`) |
| `TWILIO_WEBHOOK_URL` | **nuevo:** la URL del paso 3; sin ella los salientes no muestran ✓✓ |
| `RECEPCION_WHATSAPP_TO` | opcional: el número que recibe los avisos internos (no se vuelve paciente si escribe) |

### 6. Probar

1. `npm run whatsapp:test -- +549…` → envío (dice si falta un secret o qué rechazó
   Twilio).
2. Escribirle al WhatsApp de SOM desde un celular: en ≤ 15 s suena la campanita y el
   chat aparece en la pestaña **WhatsApp**. Responder desde ahí y ver llegar los ✓✓.
3. Para ver la pantalla con datos sin Twilio: `npm run datos-demo` (trae chats, un
   mensaje sin leer y un contacto nuevo para la campanita).

> En el *Debugger* de Twilio puede aparecer la advertencia **12300** (el webhook
> responde JSON, no TwiML). Es inofensiva: el mensaje ya quedó registrado.

## Modelo FHIR

| Qué | Cómo |
|---|---|
| Mensaje (entrante o saliente) | `Communication` suelta (sin `partOf`: no se mezcla con los hilos de **Mensajes** del portal), `category` = `https://segundaopinionmedica.org/fhir/CodeSystem/canal\|whatsapp` (así se busca el chat) + extensión `canal = whatsapp` |
| Entrante | `sender` = el `Patient`; `status` `in-progress` = sin leer → `completed` + `received` al leerlo (mismo criterio que Mensajes) |
| Saliente | `recipient` = el `Patient`; `sender` = quien respondió (si fue una persona); `template-usado` (`respuesta-recepcion` o el aviso automático) |
| Número del chat | extensión `telefono-whatsapp` (E.164): a dónde se responde |
| ✓✓ | extensión `estado-entrega`: `en-cola` \| `enviado` \| `entregado` \| `leido` \| `fallido` (+ `statusReason`) |
| Campanita | extensión `inicio-contacto = true` en el primer mensaje de una conversación |
| Id de Twilio | identifier `https://segundaopinionmedica.org/fhir/Identifier/twilio-message-sid` |
| Adjuntos | `payload.contentAttachment` → `Binary/<id>` con `securityContext` = el paciente |
| Reservado | `meta.security` = `v3-Confidentiality#R` |
| Contacto nuevo | `Patient` con `name.use = nickname`, `origen-lead = whatsapp`, `ciclo-vida-cliente = lead`; **Completar ficha** (alta) lo encuentra por el número y agrega el nombre real (`official`) sin duplicarlo |

## Límites y pendientes

- **Plantillas de Meta** (`ContentSid`): para escribir primero o fuera de las 24 h.
  Pendiente de aprobarlas; hasta entonces el bot lo explica y no envía.
- **Firma de Twilio** (`X-Twilio-Signature`): Medplum 3.3 no le pasa los encabezados
  al bot, así que la seguridad es la ClientApplication dedicada + el `AccountSid`. Al
  actualizar Medplum, validar la firma (o usar su webhook público con encabezados).
- **Contactos duplicados:** si un paciente registrado escribe desde un número que no
  está en su ficha, entra como contacto nuevo. Unir dos fichas queda para después.
- Media de más de 10 MB no se guarda (queda "no se pudo descargar"); para verla en el
  chat, hasta 4 MB. Los audios de WhatsApp (OGG/Opus) se escuchan en Chrome y Firefox.
- La lista de chats mira los últimos 500 mensajes de WhatsApp.
