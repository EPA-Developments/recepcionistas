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

- `app/src/pages/` — una por vista (Agenda, Solicitudes, Atender, Reportes).
- `app/src/components/` — `Shell` (layout + nav + tema), `Timeline`,
  `ProximosTurnos`, `ReservaModal`, etc.
- `app/src/lib/` — orquestación: `bots.ts` (llamadas a los Bots por nombre),
  `timeline.ts`, `estados.ts`.
- `app/src/theme.ts` — tema Mantine (primario `somAzul`, tono 6 = `#007ce8`;
  tipografía grande).

## Vistas (pestañas del header)

| Vista | Componente | Qué hace |
|---|---|---|
| **Agenda** | `AgendaDelDia` | Línea de tiempo del día por consultorio/sala, franjas libres clickeables para reservar y próximos turnos. |
| **Solicitudes** | `Solicitudes` | Cola de solicitudes de turno del portal del paciente, para confirmar. |
| **Atender paciente** | `Atender` | Busca al paciente y abre su ficha: banner de seguridad, reserva de turno (consulta de segunda opinión) y cobro. |
| **Reportes** | `Reportes` | Indicadores de gestión. |

El botón **"Atender"** de Solicitudes abre `Atender` con ese paciente ya cargado
(`pacienteInicialId`).

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
