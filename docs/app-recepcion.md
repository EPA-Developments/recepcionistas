# App de Recepción (frontend)

SPA en **React + Vite + Mantine v7** (TypeScript) que consume el backend Medplum.
Vive en `app/`. Toda la lógica de negocio está en los Bots / `src/lib`: el front
**solo orquesta** (busca, muestra, llama bots por nombre vía `app/src/lib/bots.ts`).

## Correr en local

```bash
npm run dev        # levanta Vite en http://localhost:5173 (alias del workspace app)
npm run build:app  # build de producción
npm run app:typecheck
```

Config por env (prefijos expuestos al browser: `MEDPLUM_`, `GOOGLE_`,
`RECAPTCHA_`; ver `app/vite.config.ts`). La principal es `MEDPLUM_BASE_URL`
(default `https://api.medplum.com.ar/`). La sesión se persiste en `localStorage`,
así que el login sobrevive al refresh. **Sin login** se muestra el formulario de
ingreso; el resto del UI requiere sesión.

La app de recepción se publica en `https://recepcion.segundaopinionmedica.org`.
Al servir detrás de un dominio, `server.allowedHosts` ya permite
`.segundaopinionmedica.org` (p. ej. `recepcion.segundaopinionmedica.org`) y
`.medplum.com.ar`.

## Login con Google (Gmail)

El login (`app/src/pages/SignInPage.tsx`) muestra el botón **"Sign in with
Google"** cuando está seteado `GOOGLE_CLIENT_ID` (env de Vite). Para que
funcione end-to-end:

1. Crear un **OAuth Client ID** (tipo Web) en Google Cloud Console, con el
   dominio de la app (p. ej. `https://recepcion.segundaopinionmedica.org`) en
   *Authorized JavaScript origins*.
2. Cargar el **mismo Client ID** en el proyecto Medplum (Project Settings →
   Google Client ID), para que el servidor acepte el token de Google.
3. El usuario debe **existir en Medplum con ese mismo email**: Google
   autentica, no crea usuarios nuevos (el alta sigue siendo por invitación).

## Estructura

- `app/src/pages/` — una por vista (Agenda, Solicitudes, Mensajes, WhatsApp,
  Controles GLP-1, Atender, Reportes).
- `app/src/components/` — `Shell` (layout + nav + tema + campanita), `CampanaWhatsApp`,
  `Timeline`, `ProximosTurnos`, `ReservaModal`, `SeguimientoGlp1`,
  `AgendarControlModal`, etc.
- `app/src/lib/` — orquestación: `bots.ts` (llamadas a los Bots por nombre),
  `timeline.ts`, `estados.ts`.
- `app/src/theme.ts` — tema Mantine (primario `somAzul`, tono 6 = `#007ce8`;
  tipografía grande).

## Vistas (pestañas del header)

| Vista | Componente | Qué hace |
|---|---|---|
| **Agenda** | `AgendaDelDia` | Línea de tiempo del día por consultorio/sala y la agenda de teleconsultas, franjas libres clickeables para reservar (en la fila de teleconsultas, solo los servicios que se ofrecen por videollamada) y próximos turnos. El turno muestra si es teleconsulta y su link. |
| **Solicitudes** | `Solicitudes` | Cola de solicitudes de turno del portal del paciente, para confirmar. |
| **Mensajes** | `Mensajes` | Bandeja de las conversaciones que abren los pacientes desde "Mensajes" del portal (con motivo obligatorio). *Abiertas / Cerradas*, paciente + motivo + último mensaje + sin leer; a la derecha la conversación y la respuesta (Enter envía, Shift+Enter salto de línea). Abrirla marca leído lo del paciente; responder le deja una Novedad `mensaje-nuevo` en la campanita del portal (una por tanda). **"Sugerir"** pide al bot `som-borrador-respuesta` un borrador (Claude) que cae en el campo de respuesta; nada sale sin tocar Enviar. **"Nueva conversación"**: Recepción le escribe primero a un paciente (paciente + motivo + mensaje; también le llega el aviso). "Ver paciente" abre `Atender`; "Cerrar conversación" / "Reabrir". Se refresca cada 20 s; la pestaña muestra los mensajes sin leer (cada 60 s). Lógica en `src/lib/mensajes.ts`. |
| **WhatsApp** | `WhatsApp` | El WhatsApp de SOM **como en el teléfono**: lista de chats (buscar, *Todos / No leídos / Contactos nuevos*), conversación con separadores de día, ✓✓ de entrega y lectura, adjuntos (se ven al tocar "Ver", vía `som-whatsapp-adjunto`) y respuesta (Enter envía; la manda `som-whatsapp-responder`, que solo deja dentro de las 24 h del último mensaje del paciente). Al lado, el contacto: **Completar ficha** para un contacto nuevo (alta prellenada con el número), **Abrir en Atender** y hasta cuándo se puede responder. Los avisos automáticos se ven "Automático · …" y los que llevan información clínica, 🔒 sin contenido. Chat abierto: cada 5 s; lista: cada 15 s. Ver [`whatsapp.md`](whatsapp.md). |
| **GLP-1** | `ControlesGlp1` | Controles del seguimiento GLP-1 por agendar (todos los pacientes), ordenados por ventana y filtrables (*En ventana / Vencidos / Próximos*), con aviso de "traer laboratorio" y la lista de inscriptos que esperan la indicación médica. "Agendar" abre `AgendarControlModal` (consultorio, día y hora; el resto lo pone la tarea). Ver [`glp1.md`](glp1.md). |
| **Atender paciente** | `Atender` | Busca al paciente y abre su ficha: banner de seguridad, reserva de turno (**Teleconsulta / Presencial** y consulta por especialidad), **Plan Bienestar 100 Días®** (inscribir y agendar sus tres consultas con `AgendarConsultaPlanModal`: modalidad, dónde, día y hora dentro de la ventana; ver [`plan-bienestar.md`](plan-bienestar.md)), seguimiento GLP-1 (inscribir / agendar controles) y cobro. |
| **Reportes** | `Reportes` | Indicadores de gestión. |

**Campanita (WhatsApp):** en el encabezado, avisa cada WhatsApp de **inicio de
contacto** sin leer (alguien escribe y no había conversación abierta): contador,
sacudón al llegar uno nuevo, aviso emergente con "Abrir el chat" y, si se activa, aviso
del escritorio con la pestaña oculta. Tocar un aviso abre ese chat. Se revisa cada
15 s; la pestaña WhatsApp y el título del navegador muestran los mensajes sin leer.

El botón **"Atender"** de Solicitudes (**"Ficha"** de GLP-1 y **"Ver paciente"** de Mensajes) abre `Atender`
con ese paciente ya cargado (`pacienteInicialId`).

En pantallas de menos de 1200 px el header oculta el subtítulo "Recepción" y el
nombre del usuario para que entren las pestañas.

## Modo oscuro / claro

Toggle **sol/luna** en el header (arriba a la derecha, junto a "Salir"). Se apoya
en el dark mode nativo de Mantine v7.

- `app/src/main.tsx`: `defaultColorScheme="light"` + `ColorSchemeScript` (evita el
  flash inicial).
- `app/src/components/Shell.tsx`: `useMantineColorScheme` / `useComputedColorScheme`.
- La preferencia **se persiste** en `localStorage` (`mantine-color-scheme-value`).
- Los colores de "chrome" (bordes, grilla del timeline, hover de filas/slots,
  input de fecha nativo) usan variables semánticas que se adaptan al tema
  (`--mantine-color-default-border`, `--mantine-color-default-hover`,
  `--mantine-color-somAzul-light`).

Para ver el tema **sin loguearte**, en la consola del navegador:

```js
localStorage.setItem('mantine-color-scheme-value', 'dark'); location.reload();
```

> Nota: el render claro/oscuro aún no se validó con captura en CI (el sandbox no
> tiene navegador). Se verifica a ojo corriendo `npm run dev`.

## Retirado

El dashboard "Planes y sesiones" (saldo de membresías/paquetes) y la pre-agenda
de series de sesiones eran de un catálogo anterior, ajeno a SOM, y se retiraron
junto con ese catálogo. Ver [`decisiones-pendientes.md`](decisiones-pendientes.md).
