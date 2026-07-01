# Decisiones pendientes

Definiciones que dependen de Andrés u otras fuentes. Las **bloqueantes** frenan
una parte del avance; el resto se resuelve en paralelo.

## Rebrand de dominio: de catálogo BioWellness a modelo Segunda Opinión Médica — ⚠️ BLOQUEANTE

Pedido: reemplazar el modelo actual (Servicios, Combos, Paquetes, Membresías —
heredado de BioWellness/wellness spa) por el modelo real de Segunda Opinión
Médica: **Usuarios** (pacientes/clientes) vinculados a **Profesionales**
(médicos de cabecera), que a su vez solicitan una **Segunda Opinión Médica** a
especialistas de primera línea en subespecialidades, con atención bilingüe
(inglés-español).

Es un cambio de arquitectura/regla de negocio *core* (principio 4 del
CLAUDE.md), no un ajuste visual. Afecta: `src/config/{catalogo,combos,
paquetes,membresias}.ts`, el motor de pricing (`src/lib/pricing.ts`), los bots
`reservar-combo`, `cobro-membresias`, `asignar-plan`, y la página "Planes y
sesiones" (`app/src/pages/PlanesSesiones.tsx`, `panelPlanes.ts`) del lado
recepción. **No se toca hasta confirmar con Andrés** — el sitio público
(segundaopinionmedica.org) bloquea el scraping automático (403) y la búsqueda
web solo trajo datos fragmentarios (consulta 1:1 por Zoom, ejemplo de precio
~USD 500, sin catálogo de precios fijo visible).

Antes de tocar código, definir:

| # | Pregunta | Por qué importa |
|---|---|---|
| 1 | ¿Cuáles son las subespecialidades de "segunda opinión" a modelar (cardiología, oncología, etc.)? | Reemplaza el catálogo de servicios (`src/config/catalogo.ts`). |
| 2 | ¿Cómo se relacionan Usuario ↔ Profesional (médico de cabecera) ↔ Especialista? ¿El profesional de cabecera "deriva" la solicitud, o el usuario elige directo al especialista? | Define el modelo de dominio (`src/domain/types.ts`) y el flujo de turnos. |
| 3 | ¿Hay un precio fijo por consulta de segunda opinión (¿variable por especialista?), o se coordina caso a caso como sugiere el sitio? | Reemplaza `pricing.ts`/paquetes/membresías; decide si sigue existiendo lógica de "combos". |
| 4 | ¿Sigue existiendo algo parecido a "paquetes" o "membresías" (ej. seguimiento con el mismo especialista), o cada segunda opinión es un evento único? | Decide si se elimina o se adapta `paquetes.ts`/`membresias.ts`. |
| 5 | ¿Qué pasa con los datos/bots actuales de BioWellness (IHHT, HBOT, masajes) — se borran, se archivan, o convive con el nuevo modelo durante una migración? | Alcance del borrado vs. convivencia temporal. |
| 6 | Atención bilingüe: ¿implica algo en el modelo de datos (idioma preferido del usuario/profesional) o es solo un atributo operativo del centro? | Puede requerir un campo nuevo en `Usuario`/`Profesional`. |

## Agenda — RESUELTO ✅ (2026-06-20)

| # | Decisión | Definición confirmada por Andrés |
|---|---|---|
| 1 | **Horario de atención** | Lunes a Viernes 08:00–22:00 · Sábados 08:00–20:00 · Domingo cerrado · franja de 30 min (`src/config/horario.ts`). |
| 2 | **Lista definitiva de salas y equipos** | Los 13 recursos del Requerimientos §6.2, confirmados sin cambios (`src/config/recursos.ts`). |

> Para cargar la agenda real en Medplum: `npm run seed -- --with-slots --dias=14`
> (genera ~4.264 franjas: 13 salas × 2 semanas).

## Catálogo (v9)

| Tema | Detalle | Estado |
|---|---|---|
| Ciclos/duración IHHT | v9 define IHHT Express (30 min, 3 ciclos) y Premium (60 min, 6-7 ciclos), a confirmar con el equipo médico. | A confirmar |
| Paquetes de IHHT | El changelog v9 no recalculó los paquetes de IHHT. Se generan paquetes de **IHHT Express** (base USD 60). ¿Se ofrecen también de IHHT Premium? | A confirmar |
| Descuento BIO OXYGEN | Pasó de ~21% a 20% por el recálculo v9. Validar que se mantiene en 20%. | A confirmar |
| FM en masajes/osteopatía | ¿El 20% FM aplica a masajes/osteopatía sueltos? Hoy `fmAplica = false` para ellos. | A confirmar |
| Insumos Regenerar (cascada TB) | La cascada de IV/TB (R-08) necesita el costo de insumo por terapia (lista Regenerar) para el neto real de BW. Hoy se pasa como parámetro. | A confirmar |

## Clínico

| Tema | Detalle | Estado |
|---|---|---|
| Tabla de contraindicaciones | Ni v8 ni v9 la incluyen. Se cargó un **borrador estándar HBOT/IHHT** (`src/config/contraindicaciones.ts`, todas `borradorPendienteRevision`). | ⚠️ Validar con Director Médico |
| Rol/alcance Dr. López Alonso | Pendiente de reunión. No frena la recepción. | A confirmar |
| Precio consulta Dr. Conrado (Director) | **PROVISORIO: ARS 150.000** en `src/config/medicos.ts` (`precioProvisorio`). Dalessandro y Dos Santos = ARS 120.000 (confirmados). | ⚠️ Confirmar monto |
| Split / honorario de consultas | Hoy la consulta se cobra entera (split `SOM_100`). Falta definir cómo se reparte el honorario del médico. | A definir |

## Gestión de sesiones — CERRADO ✅

El bloque está implementado, testeado y deployado: dashboard "Planes y sesiones"
(saldo en riesgo), pre-agenda de membresías (serie 2x/3x) y recordatorios de turno
(24h/1h) + saldo en riesgo por WhatsApp y email (`som-recordatorios`, cron horario).
Ver [`docs/app-recepcion.md`](app-recepcion.md) y [`docs/bots.md`](bots.md).

> **Para que los avisos se envíen** (hoy quedan registrados como `Communication` en
> estado `preparation` hasta que estén las cuentas) falta lo de abajo + configurar
> el `cronTimer` del Bot `som-recordatorios` (`0 * * * *`).

## Integraciones / cuentas (en paralelo)

| Cuenta | Para qué | Estado |
|---|---|---|
| WhatsApp Business (Twilio) | Confirmaciones y recordatorios. **Código listo y deployado**; falta cargar los Project Secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`) y aprobar la plantilla de mensaje. | A gestionar (cuenta) |
| AWS SES | Email transaccional (vía `medplum.sendEmail()`). **Código listo**; falta remitente verificado en SES. | A gestionar (cuenta) |
| MercadoPago | Cobro de membresías/sesiones (tokeniza tarjetas; no guardamos datos de tarjeta). | A gestionar |

## Infra

| Tema | Detalle | Estado |
|---|---|---|
| Medplum Cloud → self-hosted | Arrancamos en Cloud; migrar a self-hosted (Docker, datos en Argentina) cuando esté estable. Diseñado para no acoplarse a features propietarias. | Decidido (Cloud para arrancar) |
