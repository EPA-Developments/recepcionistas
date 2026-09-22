# CLAUDE.md — Guía del repositorio

Contexto y convenciones para desarrollar en este repo (Segunda Opinión Médica · Recepción ·
Bloque 0). Backend **Medplum (FHIR R4)**, todo en **TypeScript**.

## Principios

1. **La recepción no calcula ni decide nada que el sistema pueda calcular o
   decidir.** Toda la lógica vive en el backend (`src/lib`, `src/bots`).
2. **Fuente de verdad del catálogo/precios: la lista oficial de Segunda Opinión
   Médica.** El catálogo hoy son las consultas de segunda opinión (cardiología +
   subespecialidades) con **precio pendiente**: no se inventan precios ni reglas;
   se cargan cuando estén definidos. (El Manual de Protocolos v9 era de
   BioWellness y ya no aplica.)
3. **Privacidad por diseño.** La recepción nunca ve la historia clínica completa;
   solo la señal binaria del banner de seguridad.
4. **Gobernanza.** Todo cambio de fondo en la arquitectura o en una regla de
   negocio *core* se consulta con Andrés antes de implementarlo.

## Arquitectura

- `src/domain` — tipos de dominio, agnósticos de FHIR.
- `src/config` — catálogo (consultas de segunda opinión), médicos, recursos
  (consultorios/salas), horario, TC, constantes de reglas.
- `src/lib` — **lógica pura** (sin FHIR ni red): `money`, `pricing`,
  `reglas-turno`. Es lo que se testea exhaustivamente.
- `src/fhir` — identificadores/URLs, extensiones (`StructureDefinition`),
  AccessPolicies.
- `src/bots` — Medplum Bots: envoltura fina sobre `src/lib` + integraciones.
- `src/seed` — builders FHIR + runner idempotente del seed.
- `tests` — casos AC del Anexo A + integridad del catálogo.

> Regla práctica: **la lógica de negocio nueva va en `src/lib` como función pura
> y se testea**; el bot solo orquesta (lee/escribe FHIR, llama integraciones).

## Convenciones

- **Idioma:** código, identificadores de negocio y docs en español.
- **Imports** relativos con extensión `.js` (ESM; `moduleResolution: Bundler`).
- **Extensiones FHIR:** kebab-case bajo `https://segundaopinionmedica.org/fhir/...`,
  centralizadas en `src/fhir/identifiers.ts`.
- **Reglas:** cada regla referencia su código `R-xx` y, si tiene, su caso `AC-xx`.
- **Dinero:** precios de lista en USD; conversión a ARS solo al cobrar
  (`usdAArs`), nunca hardcodear el TC (usar `resolverTC` / config FHIR).
- **Naming SOM (obligatorio):** ningún prefijo `bw-`/`bw_`/`BW_` (pasan a
  `som-`/`som_`/`SOM_`) y ninguna referencia a BioWellness fuera de este archivo.
  Verificación (debe dar vacío; también corre en CI):
  `git grep -niE '\bbw[-_]|biowellness|bio\.medplum' -- . ':!CLAUDE.md'`
- **Medplum:** `https://api.medplum.com.ar/`, proyecto SOM
  `7ce5e559-f315-4538-abf2-61fa4922f996` (`MEDPLUM_PROJECT_ID`: seed, deploy y
  diagnósticos abortan si las credenciales son de otro proyecto).

## Flujo de trabajo

- Ramas: `main` y `staging` con deploy automático (CI: `.github/workflows/ci.yml`).
- Gate de CI (y antes de pushear): `npm run verify` (typecheck + tests),
  `npm run seed -- --dry-run`, `npm run bots:bundle`, `npm run build:app` y el
  grep de naming SOM.
- Construcción por **slices verticales**: cada pieza se entrega "verde" (sus casos
  AC pasan) antes de seguir.

## Comandos

```bash
npm run verify             # typecheck + tests (gate)
npm run seed -- --dry-run  # construye el catálogo sin servidor (gate)
npm run bots:bundle        # bundlea los bots sin servidor (gate)
npm run build:app          # build del front (gate)
npm run seed               # carga el catálogo en Medplum (credenciales en .env)
npm run deploy:bots        # deploy de bots (medplum CLI)
```

## Secretos

Nunca commitear `.env` ni credenciales. El `.env` (ver `.env.example`) es solo
para los scripts locales (credenciales de la ClientApplication de Medplum). Los
bots leen sus credenciales de **Project Secrets** de Medplum: Twilio (WhatsApp por
la WABA de EPA Bienestar IA) y MercadoPago con credenciales propias de SOM, nada
hardcodeado (ver `docs/bots.md`).
El email se envía con `medplum.sendEmail()` (proveedor AWS SES configurado en el
servidor Medplum). MercadoPago tokeniza tarjetas: **nunca** almacenar números de
tarjeta.

## Pendientes

Ver [`docs/decisiones-pendientes.md`](docs/decisiones-pendientes.md).

El catálogo de wellness spa de BioWellness (servicios, combos, membresías,
paquetes, contraindicaciones) **se retiró del dominio** — Segunda Opinión Médica
no vende esos servicios. El catálogo vigente son las consultas de segunda
opinión de cardiología + subespecialidades, con **precios y reglas PENDIENTES**
de la lista oficial (bloqueante para cobrar de verdad; no frena la agenda).

Lo demás **no frena el desarrollo**: cargar los Project Secrets de Twilio/SES en
Medplum (para que confirmaciones y recordatorios **envíen** de verdad; sin ellos
las `Communication` quedan en `preparation`) y confirmar duración de consultas y
lista real de consultorios/salas.
