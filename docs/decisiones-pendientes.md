# Decisiones pendientes

Definiciones que dependen del negocio u otras fuentes. Las **bloqueantes**
frenan una parte del avance; el resto se resuelve en paralelo.

## Catálogo Segunda Opinión Médica — ⚠️ BLOQUEANTE para cobrar

El catálogo vigente son las **consultas de segunda opinión de cardiología y
subespecialidades** (Hemodinamia, Electrofisiología, Medicina Nuclear,
Prevención CV, Rehabilitación CV), en `src/config/catalogo.ts`. El catálogo
anterior, ajeno a SOM (servicios/combos/paquetes/membresías/contraindicaciones y
sus bots/UI), **se retiró del código**.

| # | Pendiente | Detalle |
|---|---|---|
| 1 | **Lista de precios oficial** | Todas las consultas están con `precioARS: 0` (nota "Precio PENDIENTE"). No se inventan precios: cargar los valores reales cuando estén. |
| 2 | **Duración de cada consulta** | Provisional 45 min. Confirmar con la operación (¿varía por subespecialidad? ¿telemedicina?). |
| 3 | **Consultorios / salas reales** | `src/config/recursos.ts` tiene una lista PROVISIONAL (2 consultorios + telemedicina + sala de rehabilitación). Confirmar la lista real. |
| 4 | **Honorarios profesionales (split)** | Hoy todo es `SOM_100`. Definir cómo se reparte el honorario del especialista por consulta. |
| 5 | **¿Paquetes / seguimiento?** | ¿Existe algo como "paquete de seguimiento" con el mismo especialista, o cada segunda opinión es un evento único? Si existe, se modela con sus reglas oficiales (no se reutiliza el modelo anterior). |
| 6 | **Médicos / especialistas** | `src/config/medicos.ts` conserva los 3 médicos actuales. Confirmar el staff real de especialistas por subespecialidad y la atención bilingüe (inglés-español). |
| 7 | **Contraindicaciones clínicas** | La tabla de contraindicaciones del catálogo anterior se retiró. Si el flujo de segunda opinión necesita señales clínicas de seguridad, las define el equipo médico. El banner verde/rojo (Flags) sigue operativo. |

## Agenda

Horario de atención: L-V 08-22, Sáb 08-20 (`src/config/horario.ts`) — heredado;
confirmar si aplica a la operación de segunda opinión. Para cargar la agenda:
`npm run seed -- --with-slots --dias=14`.

## Integraciones / cuentas (en paralelo)

| Cuenta | Para qué | Estado |
|---|---|---|
| WhatsApp Business (Twilio + WABA de EPA Bienestar IA) | Confirmaciones y recordatorios. **Código listo** para texto libre; falta cargar los Project Secrets de la cuenta Twilio de SOM (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` = número de la WABA), aprobar las plantillas en Meta y soportar el envío por plantilla (`ContentSid`) para mensajes fuera de la ventana de 24 h. | A gestionar (cuenta + código) |
| AWS SES | Email transaccional (vía `medplum.sendEmail()`). **Código listo**; falta remitente verificado en SES. | A gestionar (cuenta) |
| MercadoPago | Cobro de señas/consultas (tokeniza tarjetas; no guardamos datos de tarjeta). Credenciales nuevas de la cuenta SOM como Project Secret (`MERCADOPAGO_ACCESS_TOKEN`) + URL del webhook en MP. | A gestionar (cuenta) |
| Portal del paciente | URL pública del portal SOM en el Project Secret `PORTAL_BASE_URL` (obligatorio para invitar pacientes). | A definir |

## Infra

| Tema | Detalle | Estado |
|---|---|---|
| Servidor y proyecto Medplum | `https://api.medplum.com.ar/`, proyecto SOM `7ce5e559-f315-4538-abf2-61fa4922f996` (`MEDPLUM_BASE_URL` / `MEDPLUM_PROJECT_ID`). Seed, deploy de bots y diagnósticos abortan si las credenciales del `.env` son de otro proyecto. | Definido |
| Credenciales del proyecto SOM | ClientApplication admin del proyecto SOM en el `.env` local (nunca en el repo) para `npm run seed` / `npm run deploy:bots`. | A gestionar |
