# Bloque 0 — Cimientos (versión técnica)

El Bloque 0 es la base bloqueante: va **primero y solo** (Documento de
Requerimientos v4, §8). Fuente de verdad del catálogo y precios: la **lista
oficial de Segunda Opinión Médica**. Hoy el catálogo son las consultas de
segunda opinión (cardiología + subespecialidades) con **precio PENDIENTE**: no se
inventan precios ni reglas; se cargan cuando estén definidos.

## Qué construye el Bloque 0

1. **Servidor Medplum + CI/CD.** Servidor `https://api.medplum.com.ar/`, proyecto
   SOM `7ce5e559-f315-4538-abf2-61fa4922f996`, sin acoplarse a features
   propietarias. CI con GitHub Actions; ramas `main` y `staging`.
2. **Perfiles FHIR y extensiones custom** (`src/fhir/extensions.ts`).
3. **Auth / roles / AccessPolicies** (`src/fhir/access-policies.ts`). Pieza
   central: la recepcionista con acceso *Operativo*, con privacidad por diseño.
4. **Seed del catálogo** (`src/seed/`): consultas (`ActivityDefinition`), TC
   (`Basic`), recursos (`Location` + `Schedule`), médicos (`Practitioner`),
   extensiones (`StructureDefinition`) y AccessPolicies.
5. **Los primeros Bots** (`src/bots/`): calcular cobro, validar turno, enviar
   WhatsApp.
6. **Harness de tests end-to-end** (`tests/`) con los casos AC del Anexo A.

## Arquitectura del código

La **lógica de negocio vive en funciones puras** (`src/lib/`) sin dependencias de
FHIR ni de red, lo que permite testearla de punta a punta sin servidor. Los
**Bots** (`src/bots/`) son finas envolturas que conectan esa lógica con Medplum y
las integraciones (Twilio, etc.). El **seed** traduce el catálogo de dominio
(`src/config/`) a recursos FHIR.

```
config (catálogo SOM)  ─►  lib (lógica pura)  ─►  bots (FHIR + integraciones)
                       └►  seed/builders (FHIR)  ─►  Medplum
```

## Definition of Done del Bloque 0

Del brief: **"stack verde, seed cargado, tests base en verde"**, y que una
secretaria pueda, en el entorno de prueba:

- [x] ver la agenda del día con los consultorios/salas y sus estados — motor de
      **Slots** (`generarSlots`) y **semáforo** verde/amarillo/rojo
      (`estadoRecurso`) listos; horario y consultorios/salas provisionales → la
      agenda se carga con `npm run seed -- --with-slots`;
- [x] ver el **banner de seguridad** verde/rojo sin acceder a la historia clínica
      (`Flag` de solo lectura, AccessPolicy de recepción);
- [x] que el sistema **calcule el monto a cobrar** incluido USD→ARS
      (`calcularCobro`, bot `som-calcular-cobro`);
- [x] que la agenda respete la **capacidad de cada consultorio/sala**
      (`validarCapacidadRecurso`, R-07);
- [x] enviar un **WhatsApp de confirmación** que quede registrado en la ficha
      (bot `som-enviar-whatsapp` → `Communication`).

Lo que falta para cerrar el primer punto (horario de atención y lista real de
consultorios/salas) está en [`decisiones-pendientes.md`](decisiones-pendientes.md).

## Cómo verificar

```bash
npm run verify                          # typecheck + tests (casos AC del Anexo A)
npm run seed -- --dry-run               # construye los recursos FHIR del seed sin Medplum
npm run seed -- --dry-run --with-slots  # + cuenta los Slot de la agenda (7 días)
npm run bots:bundle                     # bundlea los bots sin conectarse
npm run build:app                       # build de producción del front
```
