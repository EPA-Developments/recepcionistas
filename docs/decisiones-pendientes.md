# Decisiones pendientes

Definiciones que dependen del negocio u otras fuentes. Las **bloqueantes**
frenan una parte del avance; el resto se resuelve en paralelo.

## Catálogo Segunda Opinión Médica — ⚠️ BLOQUEANTE para cobrar

El catálogo vigente son las **consultas de segunda opinión de cardiología y
subespecialidades** (Hemodinamia, Electrofisiología, Medicina Nuclear,
Prevención CV, Rehabilitación CV), en `src/config/catalogo.ts`. El catálogo de
wellness spa de BioWellness (servicios/combos/paquetes/membresías/
contraindicaciones y sus bots/UI) **se retiró del código**.

| # | Pendiente | Detalle |
|---|---|---|
| 1 | **Lista de precios oficial** | Todas las consultas están con `precioARS: 0` (nota "Precio PENDIENTE"). No se inventan precios: cargar los valores reales cuando estén. |
| 2 | **Duración de cada consulta** | Provisional 45 min. Confirmar con la operación (¿varía por subespecialidad? ¿telemedicina?). |
| 3 | **Consultorios / salas reales** | `src/config/recursos.ts` tiene una lista PROVISIONAL (2 consultorios + telemedicina + sala de rehabilitación). Confirmar la lista real. |
| 4 | **Honorarios profesionales (split)** | Hoy todo es `SOM_100`. Definir cómo se reparte el honorario del especialista por consulta. |
| 5 | **¿Paquetes / seguimiento?** | ¿Existe algo como "paquete de seguimiento" con el mismo especialista, o cada segunda opinión es un evento único? Si existe, se modela con sus reglas oficiales (no se resucita el modelo BioWellness). |
| 6 | **Médicos / especialistas** | `src/config/medicos.ts` conserva los 3 médicos actuales. Confirmar el staff real de especialistas por subespecialidad y la atención bilingüe (inglés-español). |
| 7 | **Contraindicaciones clínicas** | La tabla HBOT/IHHT era de BioWellness y se retiró. Si el flujo de segunda opinión necesita señales clínicas de seguridad, las define el equipo médico. El banner verde/rojo (Flags) sigue operativo. |

## Agenda

Horario de atención: L-V 08-22, Sáb 08-20 (`src/config/horario.ts`) — heredado;
confirmar si aplica a la operación de segunda opinión. Para cargar la agenda:
`npm run seed -- --with-slots --dias=14`.

## Integraciones / cuentas (en paralelo)

| Cuenta | Para qué | Estado |
|---|---|---|
| WhatsApp Business (Twilio) | Confirmaciones y recordatorios. **Código listo**; falta cargar los Project Secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`) y aprobar la plantilla de mensaje. | A gestionar (cuenta) |
| AWS SES | Email transaccional (vía `medplum.sendEmail()`). **Código listo**; falta remitente verificado en SES. | A gestionar (cuenta) |
| MercadoPago | Cobro de señas/consultas (tokeniza tarjetas; no guardamos datos de tarjeta). | A gestionar |

## Infra

| Tema | Detalle | Estado |
|---|---|---|
| Medplum Cloud → self-hosted | Arrancamos en Cloud; migrar a self-hosted (Docker, datos en Argentina) cuando esté estable. Diseñado para no acoplarse a features propietarias. | Decidido (Cloud para arrancar) |
| Proyecto Medplum canónico | Definir `MEDPLUM_PROJECT_ID`/credenciales del proyecto SOM antes de `npm run seed` / `npm run deploy:bots`. | A definir |
