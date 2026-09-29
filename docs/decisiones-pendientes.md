# Decisiones pendientes

Definiciones que dependen del negocio u otras fuentes. Las **bloqueantes**
frenan una parte del avance; el resto se resuelve en paralelo.

## Catálogo Segunda Opinión Médica — ⚠️ BLOQUEANTE para cobrar

**Se arma de cero con los profesionales de SOM** (decisión del Dr. Alejandro
Barbagelata y el Dr. Alejandro Sergio D'Alessandro). Las **especialidades ya están
definidas** (`src/config/catalogo.ts`: DBT / Endocrino, Nutrición, Cardiología,
Cardiología con especialidad —Insuficiencia Cardíaca, Hemodinamia, Electrofisiología,
Medicina Nuclear, Prevención CV, Rehabilitación CV—, Tisioneumonología, Neurología y
Ginecología; cada una presencial y por teleconsulta), más la consulta del Plan
Bienestar 100 Días® y el control GLP-1. Faltan los **precios** y los
**profesionales**: `src/config/medicos.ts` sigue **vacío**. El catálogo anterior,
ajeno a SOM (servicios/combos/paquetes/membresías/contraindicaciones y sus bots/UI),
**se retiró del código**.

| # | Pendiente | Detalle |
|---|---|---|
| 1 | ~~Lista de precios oficial~~ | **Definida (26/09/2026, Dr. D'Alessandro):** consulta por especialidad ARS 150.000, el mismo precio presencial y por teleconsulta y para todos los profesionales (`PRECIO_CONSULTA_ESPECIALIDAD_ARS`). La del Plan Bienestar sigue en 0 (incluida); el plan la presupuesta en ARS 100.000 (`valor-referencia-ars`, informativo). Sigue pendiente el precio del control GLP-1 (ver abajo). |
| 2 | ~~Duración de cada consulta~~ | **Definida (26/09/2026):** 30 min para toda consulta, presencial o teleconsulta (`DURACION_CONSULTA_MIN`), sobre la grilla de 30. El control GLP-1 queda en 45 min provisionales. |
| 3 | **Consultorios / salas reales** | `src/config/recursos.ts` tiene una lista PROVISIONAL (2 consultorios + agenda de teleconsultas + sala de rehabilitación). Confirmar la lista real. |
| 4 | **Honorarios profesionales (split)** | Hoy todo es `SOM_100`. Definir cómo se reparte el honorario del especialista por consulta. |
| 5 | **¿Paquetes / seguimiento?** | ¿Existe algo como "paquete de seguimiento" con el mismo especialista, o cada segunda opinión es un evento único? Si existe, se modela con sus reglas oficiales (no se reutiliza el modelo anterior). El primer programa de seguimiento ya modelado es el **GLP-1** (ver abajo). |
| 6 | **Profesionales de SOM** | `src/config/medicos.ts` está vacío: cargar los profesionales de SOM (especialidad, consultas que atiende, modalidad, horario). Las consultas del Plan Bienestar hoy las atienden el Dr. Barbagelata, la Dra. Gold y el Dr. D'Alessandro. La lista la están armando el Dr. D'Alessandro y el Dr. Barbagelata. |
| 7 | **Contraindicaciones clínicas** | La tabla de contraindicaciones del catálogo anterior se retiró. Si el flujo de segunda opinión necesita señales clínicas de seguridad, las define el equipo médico. El banner verde/rojo (Flags) sigue operativo. |

## Seguimiento GLP-1

Slice 1 hecho (programa + controles a agendar desde Recepción; ver
[`glp1.md`](glp1.md)). Para confirmar con el Dr. Alejandro Barbagelata y el Dr.
Alejandro Sergio D'Alessandro:

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **Cobro** | ¿Cada control se cobra aparte, va incluido en un programa, o no se cobra? Hoy `CONTROL_GLP1` está en el catálogo con precio 0 (PENDIENTE) y el turno sigue el flujo normal (tentativo hasta la seña). | A definir |
| 2 | **Ventana para agendar (R-19)** | Provisional: basal en los 7 días previos al inicio; el resto, desde la semana calculada hasta 7 días después (`VENTANA_CONTROL_GLP1_DIAS`). ¿Se acepta agendar antes? ¿Cuántos días de tolerancia? | A confirmar |
| 3 | **Dónde carga el médico la indicación** | Hoy: bot `som-glp1-plan` con input JSON (app de Medplum o API). Definir una pantalla o un `Questionnaire` para el equipo médico. | A definir |
| 4 | **Rol del equipo médico** | **Hecho (29/09/2026):** "Profesional SOM — Médico" ejecuta `som-glp1-plan` (Nutrición no: la indicación es médica). Ver *Roles*. | Hecho |
| 5 | **Módulo compartido con CKM** | `src/lib/glp1/titration.ts` y `eligibility.ts` son contratos interinos: traer los originales de la plataforma CKM para unificar (opción C). | Pendiente |
| 6 | **Biomarcadores** | Los estudios van con el slug del catálogo de biomarcadores (`CodeSystem/biomarcador`). Mapear cada slug a LOINC para interoperar con laboratorios. | Pendiente |
| 7 | **Oftalmología / función renal** | Hoy se agendan como parte del control de la misma semana (12 y 26). ¿Se hacen en SOM o se derivan? | A definir |
| 8 | **Nombre visible y duración** | "Seguimiento de tratamiento GLP-1 — Control", 45 min provisional, en consultorio. | A confirmar |
| 9 | **Metas del GLP-1 editables por el paciente** | La policy del portal le da escritura sobre todos sus `Goal` (el Plan Bienestar crea los suyos), así que técnicamente podría editar la meta del GLP-1 (el bot la reescribe al recalcular). Acotar la escritura a las metas del Plan Bienestar (p. ej. por su categoría), en los dos repos a la vez. | A definir |
| 10 | **App del paciente (slice 2)** | Mostrar el programa, la meta y el estado de cada control en el portal (`EPA-Developments/app`), con el contrato de [`glp1.md`](glp1.md). Prompt listo: [`handoff-app-glp1.md`](handoff-app-glp1.md). | Próximo slice |

## SOM — contrato con el portal

Implementado (ver [`som.md`](som.md)); queda para confirmar:

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **PREVENT: firma médica** | Coeficientes del modelo base generados desde `preventr` y verificados contra sus 12 valores de referencia; el `RiskAssessment` sale `preliminary` hasta la firma del equipo médico (el contrato del portal pide `final`). | A firmar |
| 2 | **Umbrales CKM (Guía AHA/ACC/ADA/ASN 2026) y biomarcadores** | Estadificación según la Tabla 4 (triglicéridos ≥ 150, CAC ≥ 100, PREVENT-CVD 10a ≥ 20 %) y plan según Tabla 8 / Figura 3. Confirmar: índice tobillo-brazo bajo ≤ 0,90 (la guía no fija valor), ApoB < 130 mg/dL y Lp(a) < 125 nmol/L (AHA/ACC 2018). | A confirmar |
| 2b | **Rangos funcionales ya cargados en el servidor** | Correr `npm run biomarcadores:convencional` (dry-run) y, revisado el listado, `-- --apply`. Las definiciones que queden sin rango convencional (p. ej. HOMA-IR) se decide si se retiran. El portal (`EPA-Developments/app`) todavía muestra rangos funcionales en su catálogo local: cambiarlo allá. | Pendiente |
| 3 | **`performer` de la solicitud SOM** | El contrato pide el `Practitioner` del Dr. Barbagelata "si está disponible": falta cargar los profesionales de SOM. | Bloqueado por catálogo |
| 4 | **Precio del Plan Bienestar** | Definido: las tres consultas programadas están incluidas en el plan (sin seña) y las de especialidad se cobran aparte. Falta el precio del plan y cuándo se cobra: `som-bienestar-inscribir` inscribe sin cobrar. | Precio en curso |
| 5 | **Modelo del bot de laboratorio** | `som-procesar-laboratorio` usa `claude-opus-5` (el contrato no lo fija; el informe sigue en `claude-sonnet-4-6` por contrato). Cambiar en `MODELO_CLAUDE_LABORATORIO`. | A confirmar |
| 6 | **Aplicar en el servidor** | `npm run seed` (policy + lípidos) y `npm run deploy:bots` (bots + Subscriptions) contra `7ce5e559-…`; Project Secret `ANTHROPIC_API_KEY`; revisar `Bot.timeout` de los bots con Claude. | Pendiente (credenciales) |

## Plan Bienestar 100 Días® y teleconsulta

Hecho (ver [`plan-bienestar.md`](plan-bienestar.md)): catálogo con modalidad, las tres
consultas del plan con sus ventanas (R-20), teleconsulta con Jitsi y consentimiento
(R-21), avisos del plan y la vista de Recepción. Queda:

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **Calendario: agendas por profesional** | **Hecho (R-22):** una agenda (`Schedule`) por profesional (`PractitionerRole`) y otra por consultorio para lo presencial; los "calendarios" del Plan Bienestar y de Especialidades son **vistas** de esas agendas (no se da dos veces la misma hora); la reserva ocupa franjas con escritura condicional; cron `som-generar-agenda`. Queda retirar la agenda virtual transitoria `R_TELEMEDICINA` cuando los profesionales tengan disponibilidad. | Hecho; retiro de `R_TELEMEDICINA` pendiente |
| 1b | **Disponibilidad y consultorio de cada profesional** | **Hecho (26/09/2026,** `src/config/medicos.ts`**):** Dr. Barbagelata martes y jueves 14–18 (presencial en el Consultorio 1 o teleconsulta); Dra. Gold presencial martes y jueves 9–12 (Consultorio 1) y teleconsulta miércoles y viernes 08–12; Dr. D'Alessandro presencial martes y jueves 9–12 (Consultorio 2) y teleconsulta lunes, miércoles y viernes 16–20. Cada franja lleva su modalidad. Todas caen dentro del horario placeholder del centro (ver *Agenda*). | Hecho |
| 2 | **Jitsi: el profesional entra como moderador** | **Código listo (29/09/2026):** `som-teleconsulta-token` le da al profesional del turno un token de moderador; la paciente entra sin token (fila 2b). Para activarlo: **(1)** desplegar el bot y cargar `JITSI_APP_ID` y `JITSI_APP_SECRET` (con `JITSI_BASE_URL`); **(2)** configurar el Jitsi como dice la fila 2b. Mientras el Jitsi no pida token, nada cambia: los dos entran con el link y el dashboard avisa que el profesional no modera. Los especialistas lo ejecutan con su policy ("Profesional SOM — Médico" / "— Nutrición"). | Código listo; falta configurar |
| 2b | **Cómo entra la paciente: como invitada** | **Decidido (29/09/2026): opción (b).** La paciente entra **sin token**, por el link del WhatsApp o por el portal (es el mismo), y **espera hasta que entra el profesional**, que es el único con token y el que modera. Nunca viaja un token de paciente en un link. El Jitsi tiene que: validar tokens HS256 con ese emisor y secreto (`aud` `jitsi`, `iss` = `JITSI_APP_ID`, `sub` = el host, `room` = la sala); **aceptar invitados sin token** que esperan a que un usuario con token abra la sala; y dar moderador a quien trae token (el token manda `context.user.moderator: true` y `affiliation: owner`). Si el Jitsi es `docker-jitsi-meet`, eso es, a verificar en la instalación: `ENABLE_AUTH=1`, `AUTH_TYPE=jwt`, `JWT_APP_ID` y `JWT_APP_SECRET` iguales a los secretos del proyecto, y `ENABLE_GUESTS=1`. Si además se quiere que el profesional **admita** a la paciente (y no que entre sola apenas él abre la sala), se activa la sala de espera (lobby). | Decidido; falta configurar el Jitsi |
| 3 | **Texto del consentimiento de teleconsulta** | Genérico, uno por paciente; lo muestra y lo registra el portal (`Consent`). Lo redactan los médicos de SOM / legales. | A definir |
| 4 | **Portal del paciente** | "Pedir un turno" con los dos caminos, Especialidad → Profesional → Horario → **Reservar** (`som-reservar-portal`, R-23: confirmada si es del plan, tentativa con link de la seña si no), el consentimiento, el link en "Mis turnos" y el espejo de la policy (`ActivityDefinition`, `PractitionerRole`, `Location`, bot `som-reservar-portal`). Prompt listo: [`handoff-app-pb100d.md`](handoff-app-pb100d.md). | Backend listo; portal en curso |
| 7 | **Anticipación y ventana de la reserva desde el portal** | Hoy: anticipación mínima = la retención (30 min, `ANTICIPACION_MINIMA_PORTAL_MIN`, provisional) y sin ventana máxima (la agenda se publica 45 días). La R-13 heredada (48 h para `PUBLICO`) no se aplica al portal. ¿Anticipación mínima real (p. ej. 2 h o 24 h)? ¿Ventana máxima? | A definir con los médicos |
| 11 | **Teleconsulta desde el portal: cuándo abre la sala** | `som-teleconsulta-entrar` deja entrar desde 15 min antes del turno (`ENTRADA_TELECONSULTA_MIN`, provisional) hasta el fin. ¿Cuántos minutos antes? | A confirmar con los médicos |
| 12 | **Reprogramar la teleconsulta desde el portal** | No hay regla para que la paciente mueva su turno sola (cuántas veces, hasta cuándo, qué pasa con la seña). Mientras tanto no hay bot: cancela (R-14) y reserva otro horario, o pide el cambio a Recepción (`som-solicitar-turno`). | A definir con los médicos |
| 13 | **Link de la videollamada antes de la seña** | `som-reservar-turno` deja `teleconsulta-url` en el turno desde que se crea (también tentativo) y la paciente lee su `Appointment`: el portal no lo muestra hasta la confirmación (usa `som-teleconsulta-entrar`), pero el dato está. Si se quiere ocultar de verdad, generar el link recién al confirmar (`confirmarReserva`). | A decidir |
| 5 | **Horario de los avisos del plan** | Provisional de 9 a 20 h (`HORARIO_AVISOS_PROGRAMA`). | A confirmar |
| 6 | **Consulta inicial sin agendar** | No tiene ventana, así que el cron no avisa: la sigue Recepción desde la ficha. ¿Hace falta un recordatorio (p. ej. a los N días de la inscripción)? | A definir |
| 8 | **Precio de las derivaciones no médicas del catálogo firmado** | Las derivaciones del catálogo por estadío CKM (27/09/2026) están en el catálogo con `soloDesdeTarea` (R-20). Nefrología, Hepatología, Oftalmología y Cirugía Vascular son consultas médicas por especialidad y toman el precio de lista (ARS 150.000, R-17). Psicología, Trabajo Social, Podología, Farmacia Clínica y Kinesiología no están en la lista oficial: quedan con precio 0 y nota PENDIENTE. ¿Se cobran aparte, van incluidas en el plan o no se cobran? Sin precio firmado no se cobra. | A definir con los médicos |
| 9 | **Código SNOMED de Cirugía Vascular** | `c80-practice-codes` no trae un código de cirugía vascular verificado: la especialidad va solo con texto. Confirmar el código en el navegador oficial de SNOMED CT antes de codificarla. | A confirmar |
| 10 | **Condiciones del catálogo que registra el equipo** | El motor de alertas (`ckm-catalogo.ts`) deriva lo que sale de la estadificación, la historia y PREVENT. STOP-BANG, AHC-HRSN, PSS-4, ancestría asiática, fragilidad, LDL fuera de meta, eventos ("se inicia RASi", procedimiento, síntomas nuevos) y la respuesta a 100 días (peso/cintura, Tabla 47) las carga el equipo o llegan con la app del plan (fase 4). Definir dónde las registra el médico (Questionnaire o Condition). | Fase 4 |

## Agenda

Horario de atención: L-V 08-22, Sáb 08-20 (`src/config/horario.ts`) — heredado y
marcado como **provisional** (`HORARIO_ES_PLACEHOLDER`): definir el horario real de
SOM (CABA). Para cargar la agenda (salas y profesionales con disponibilidad):
`npm run seed -- --with-slots --dias=14`; en producción la mantiene el cron
`som-generar-agenda` (45 días hacia adelante).

## Roles

Los roles (AccessPolicies) del catálogo anterior se retiraron; el seed deja
**Recepción — Operativo**, **Director Médico — Clínico completo**, **Profesional SOM
— Médico**, **Profesional SOM — Nutrición** (29/09/2026, los especialistas en el
dashboard clínico; ver [`usuarios.md`](usuarios.md)) y **Paciente SOM — Portal**.

| # | Tema | Detalle | Estado |
|---|---|---|---|
| 1 | **¿Cada profesional ve sólo sus pacientes?** | Hoy las dos policies de especialistas ven todas las pacientes del proyecto, como el Director Médico. Acotarlo (por turno, por `CareTeam` o por derivación) es posible pero cambia cómo se comparte una paciente entre especialistas: decidirlo con la dirección médica. | A decidir |
| 2 | **`som-estado-turno` no mira quién lo ejecuta** | Los especialistas lo necesitan para marcar la consulta en curso y cerrarla, pero el bot acepta cualquier estado, también `cancelled`, que tiene efecto sobre la seña. Si hace falta, que un `Practitioner` sólo pueda poner `checked-in` y `fulfilled`. | A decidir |

## Integraciones / cuentas (en paralelo)

| Cuenta | Para qué | Estado |
|---|---|---|
| WhatsApp Business (Twilio + WABA de EPA Bienestar IA) | Confirmaciones, recordatorios y **WhatsApp dentro de Mensajes** (entrantes en la conversación del paciente, respuesta por el canal donde escribió, ✓✓, pestaña **WhatsApp** con los avisos de números nuevos y campanita, respuestas automáticas con los textos aprobados el 26/09/2026). **Código listo** para texto libre; falta cargar los Project Secrets de la cuenta Twilio de SOM (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` = número de la WABA, `TWILIO_WEBHOOK_URL`), agregar los bloques de `deploy/nginx-webhooks-som.conf` al nginx del API, correr `npm run webhooks` y configurar la URL pública en Twilio ([`whatsapp.md`](whatsapp.md)), **aprobar los textos de las plantillas de Meta** (`src/config/plantillas-whatsapp.ts`: la genérica, una por aviso al paciente con el mismo texto que hoy, las dos respuestas automáticas y «tenés una respuesta nueva» para responder pasadas las 24 h; ver `whatsapp.md` § 6) y mandarlas con `npm run whatsapp:plantillas -- --aplicar` (el envío por plantilla ya está: cada `TWILIO_CONTENT_SID_<PLANTILLA>` aprobado hace que ese aviso llegue fuera de la ventana de 24 h). La firma de Twilio ya se valida (servidor Medplum ≥ 4.2). Después: unir fichas duplicadas (paciente que escribe desde otro número). | A gestionar (cuenta + código) |
| AWS SES | Email transaccional (vía `medplum.sendEmail()`). **Código listo**; falta remitente verificado en SES. | A gestionar (cuenta) |
| MercadoPago | Cobro de señas/consultas (tokeniza tarjetas; no guardamos datos de tarjeta). En el Project Secret `MERCADOPAGO_ACCESS_TOKEN` va el **Access Token de producción** de la cuenta SOM (no la Public Key), con las credenciales de producción activadas; + URL pública del webhook en MP (`/webhooks/som/mercadopago`, nginx; `npm run webhooks`). El link dio **403 PolicyAgent** (`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`): la credencial cargada no está autorizada; revisar con `npm run mercadopago:test` (ver [`bots.md`](bots.md#mercadopago-qué-credencial-va-y-el-403-policyagent)). Con la lista de precios cargada, la seña de una consulta por especialidad es ARS 75.000. **Probado de punta a punta el 27/09/2026 en modo prueba** (vendedor y comprador de prueba de la aplicación EPA-SAS): link de la seña → pago aprobado → webhook público → turno confirmado e Invoice (`npm run mercadopago:e2e`; verificación con `npm run mercadopago:ordenes -- --pago <id>`, que también da el Order ID para "Calidad de integración"). El secret tiene hoy el Access Token del **vendedor de prueba**: para cobrar de verdad falta cargar el Access Token de producción de la cuenta real de SOM. Pendiente decidir si la preferencia manda nombre y apellido del paciente (mejora la aprobación de pagos; es un dato personal que va a MercadoPago). | A corregir (credencial) |
| URLs públicas | Portal del paciente `https://app.segundaopinionmedica.org` · app de recepción `https://recepcion.segundaopinionmedica.org` (`src/config/urls.ts`; los Project Secrets `PORTAL_BASE_URL` / `APP_BASE_URL` las pisan por entorno). | Definido |

## CRM (embudo de redes sociales)

Bots registrados (`som-recomputar-segmentos`, `som-enviar-campana`; ver
[`crm.md`](crm.md)). Falta definir:

| Tema | Detalle | Estado |
|---|---|---|
| Consentimiento de marketing | Ley 25.326 (datos de salud = sensibles) + *opt-in* de WhatsApp. Definir cómo se registra (p. ej. `Consent` desde el portal) y filtrar las campañas por él. | A definir |
| Fuentes del lead | Lista de `utm_source` (redes) y que el portal los guarde en `origen-lead` al registrar al paciente. | A definir |
| Plantillas de marketing | Aprobar en Meta (WABA de EPA Bienestar IA) y soportar el envío por plantilla (`ContentSid`). | A definir |

## Infra

| Tema | Detalle | Estado |
|---|---|---|
| Servidor y proyecto Medplum | `https://api.medplum.com.ar/`, proyecto SOM `7ce5e559-f315-4538-abf2-61fa4922f996` (`MEDPLUM_BASE_URL` / `MEDPLUM_PROJECT_ID`). Seed, deploy de bots y diagnósticos abortan si las credenciales del `.env` son de otro proyecto. | Definido |
| Credenciales del proyecto SOM | ClientApplication admin del proyecto SOM en el `.env` local (nunca en el repo) para `npm run seed` / `npm run deploy:bots`. | A gestionar |
