# Recepcionistas — Segunda Opinión Médica

Herramienta de Recepción de Segunda Opinión Médica (Ciudad Autónoma de Buenos Aires,
CABA). **Bloque 0 (Cimientos)**: la base sobre la que se apoya la pantalla de la
recepción. Backend **Medplum (FHIR R4)**.

> Principio rector: *"Las Recepcionistas nunca calculan ni deciden nada que el
> sistema pueda calcular o decidir por ellas."* Toda la inteligencia vive en el
> backend (catálogo, motor de precios, reglas de agenda y bots).

## Estado actual (Bloque 0)

| Pieza | Estado |
|---|---|
| Andamiaje TypeScript + tooling | ✅ |
| Catálogo | ⚠️ se arma de cero con los profesionales de SOM (hoy: consultas de ejemplo sin precio y sin profesionales) |
| Motor de precios (USD→ARS, split SOM_100) | ✅ con tests |
| Motor de reglas de agenda (R-07, R-13, R-14, R-19) | ✅ con tests |
| Extensiones FHIR + AccessPolicies (recepción) | ✅ |
| Bots: calcular-cobro · validar-turno · enviar-whatsapp | ✅ + deploy (`npm run deploy:bots`) |
| Seed del catálogo (idempotente) | ✅ (`--dry-run` sin servidor) |
| Motor de agenda: Slots + semáforo de salas | ✅ con tests (config provisoria) |
| Front de recepción (React + Vite) | ✅ login, agenda + semáforo, atención, reserva de turnos |
| Reserva de turnos (valida + crea Appointment/Slot) | ✅ bot `som-reservar-turno` |
| Check-in / check-out + estados en el timeline | ✅ bot `som-estado-turno` |
| Reserva con seña 50% (confirma turno) + WhatsApp | ✅ bots `som-pagar-sena` / `som-link-mercadopago` |
| Webhook de MercadoPago (confirma turno al pagar) | ✅ bot `som-webhook-mercadopago` |
| Reportes / tablero (turnos, ingresos, ocupación) | ✅ pantalla Reportes |
| CRM: segmentos + campañas (embudo de redes sociales) | ✅ bots `som-recomputar-segmentos` / `som-enviar-campana` (WhatsApp: pendiente de plantillas) |
| Seguimiento de tratamiento GLP-1 (programa + controles a agendar) | ✅ slice 1: bots `som-glp1-inscribir` / `som-glp1-plan`, pestaña GLP-1 ([`docs/glp1.md`](docs/glp1.md)); app del paciente: slice 2 |
| Harness de tests | ✅ |
| CI (GitHub Actions) | ✅ |
| Horario (L-V 08-22, Sáb 08-20) + consultorios/salas | ⚠️ provisional, confirmar con la operación |

Ver [`docs/decisiones-pendientes.md`](docs/decisiones-pendientes.md) para lo que falta definir.

## Requisitos

- Node.js ≥ 20 (probado en 22)
- Credenciales (ClientApplication) del proyecto SOM en el servidor Medplum
  `https://api.medplum.com.ar/` — proyecto `7ce5e559-f315-4538-abf2-61fa4922f996`
- Project Secrets cargados en Medplum (Twilio/WABA, MercadoPago, portal): ver
  [`docs/bots.md`](docs/bots.md). Nunca credenciales en el repo.

## Puesta en marcha

```bash
npm install
cp .env.example .env       # completar credenciales
npm run verify             # typecheck + tests
npm run seed -- --dry-run  # construye el catálogo sin conectarse a Medplum
npm run bots:bundle        # bundlea los bots sin conectarse
npm run build:app          # build del front
npm run seed               # carga el catálogo en Medplum (requiere credenciales)
```

## Scripts

| Script | Qué hace |
|---|---|
| `npm run typecheck` | Chequeo de tipos (tsc) |
| `npm run test` | Tests (vitest) |
| `npm run verify` | typecheck + test (gate de CI, junto con seed `--dry-run`, `bots:bundle` y `build:app`) |
| `npm run seed` | Carga el catálogo en Medplum (idempotente) |
| `npm run seed -- --dry-run` | Construye todos los recursos sin servidor |
| `npm run seed -- --with-slots [--dias=N]` | (Opcional) materializa `Slot` libres en Medplum. El front NO lo necesita. |
| `npm run limpiar` | Lista Schedules ajenos/duplicados (dry-run); `-- --apply` los borra |
| `npm run dev` | **Levanta el front de recepción en http://localhost:5173** |
| `npm run build:app` | Build de producción del front |
| `npm run bots:bundle` | Bundlea los Bots y muestra tamaños (sin conectarse) |
| `npm run deploy:bots` | Crea + bundlea + deploya los Bots a Medplum (ver `docs/bots.md`) |

## Estructura

```
src/
  domain/      Tipos de dominio (agnósticos de FHIR)
  config/      Catálogo (consultas de cardiología + subespecialidades), médicos,
               recursos (consultorios/salas), horario, TC, constantes de reglas
  lib/         Lógica pura: money, pricing, reglas-turno, glp1-plan (testeable sin
               servidor); glp1/ = calendario GLP-1 compartido con la plataforma CKM
  fhir/        Identificadores, extensiones (StructureDefinition), AccessPolicies
  bots/        Medplum Bots: calcular-cobro, validar-turno, enviar-whatsapp
  seed/        Builders FHIR + runner del seed
tests/         Harness de tests (casos AC del Anexo A)
app/           Front de recepción (React 18 + Vite + Mantine + @medplum/react)
docs/          Documentación técnica (Bloque 0, reglas, modelo de datos, pendientes)
```

## Front de recepción (localhost:5173)

Pantalla simple y rápida para la recepción (no para programadores). Toda la
inteligencia vive en los Bots y el backend; el front solo orquesta.

```bash
npm install                       # instala backend + front (workspaces)
cp app/.env.example app/.env      # MEDPLUM_BASE_URL=https://api.medplum.com.ar/
npm run dev                       # abre http://localhost:5173
```

Pantallas del esqueleto:

- **Login** contra Medplum (SignInForm).
- **Agenda del día** — **vista timeline**: salas en filas, horas en columnas, cada
  turno como bloque en su franja (servicio + paciente), con línea de "ahora".
  **Clic en una franja libre** abre el formulario de reserva precargado con esa
  sala y hora. Autorefresco cada 60 s.
- **GLP-1** — controles del seguimiento de tratamiento GLP-1 por agendar (todos
  los pacientes), con ventana calculada por el sistema y aviso de "traer
  laboratorio". Ver [`docs/glp1.md`](docs/glp1.md).
- **Atender paciente** — búsqueda por nombre/DNI, banner de seguridad verde/rojo
  (sin ver la historia clínica), **reserva de turnos** (valida + crea vía bot
  `reservar-turno`), seguimiento GLP-1 (inscribir y agendar controles) y cobro
  **calculado por el bot** `calcular-cobro`.
- **Reportes** — tablero del día/mes: turnos por estado, ingresos (cobros y
  señas), ocupación por sala y WhatsApp enviados. Lee de Medplum.

> El cobro requiere los Bots desplegados (`npm run deploy:bots`). Si no están, la
> pantalla lo avisa con claridad: el front nunca calcula por su cuenta.

## Documentación

- [`docs/bloque-0.md`](docs/bloque-0.md) — alcance técnico y Definition of Done
- [`docs/som.md`](docs/som.md) — contrato SOM con el portal (solicitud + informe)
- [`docs/bots.md`](docs/bots.md) — los Bots, deploy, secretos y recordatorios
- [`docs/app-recepcion.md`](docs/app-recepcion.md) — la app de recepción: vistas y features (modo oscuro)
- [`docs/reglas-negocio.md`](docs/reglas-negocio.md) — reglas de agenda y pricing vigentes
- [`docs/modelo-datos-fhir.md`](docs/modelo-datos-fhir.md) — recursos y extensiones FHIR
- [`docs/usuarios.md`](docs/usuarios.md) — usuarios, roles y AccessPolicies
- [`docs/portal-integracion.md`](docs/portal-integracion.md) — integración con el portal del paciente
- [`docs/crm.md`](docs/crm.md) — CRM: embudo de redes sociales, segmentos y campañas
- [`docs/glp1.md`](docs/glp1.md) — seguimiento de tratamiento GLP-1: flujo, calendario, recursos FHIR y contrato con la app del paciente
- [`docs/decisiones-pendientes.md`](docs/decisiones-pendientes.md) — decisiones abiertas
- [`CLAUDE.md`](CLAUDE.md) — convenciones y guía para el desarrollo

---

Confidencial · EPA Bienestar IA SAS · 2026
