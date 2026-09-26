# Integración Recepción ↔ Portal del paciente

Contrato de integración entre **esta app (recepción)** y el **portal del paciente
de Segunda Opinión Médica** (repo `EPA-Developments/app`, ver [`som.md`](som.md)),
publicado en **`https://app.segundaopinionmedica.org`** (Project Secret
`PORTAL_BASE_URL` para otros entornos).

Las dos apps comparten el **mismo servidor y proyecto Medplum**
(`https://api.medplum.com.ar/`, proyecto `7ce5e559-f315-4538-abf2-61fa4922f996`).
La recepción es para el staff (con su AccessPolicy operativa); el portal es para
el paciente, que ve **solo lo suyo** vía la AccessPolicy **"Paciente SOM — Portal"**
(`src/fhir/access-policies.ts`).

## Qué pone la recepción del lado del backend

- **AccessPolicy "Paciente SOM — Portal".** Es la **fuente de verdad**: `npm run
  seed` la aplica por `name`, así que el espejo del portal
  (`docs/medplum/access-policy-paciente-portal.json`) debe quedar idéntico.
  El paciente **escribe** su autogestión (perfil, vitales, cuestionarios,
  documentos, mensajes, su `Consent` por estudio, el `Binary` de sus PDF y solo su
  obra social/prepaga `Coverage` type HIP) y lo que necesita el **Plan Bienestar** del portal, con
  escritura acotada (`CarePlan` del plan, `Goal`, `Task` `intent=plan`,
  `CareTeam`, `Condition` con los SNOMED del plan); **lee** su compartimento
  clínico/financiero (`Appointment`, `Coverage`, `Invoice`, `DiagnosticReport`,
  `CarePlan`, `MedicationRequest`, `Immunization`, `Task`, `ServiceRequest`,
  `RiskAssessment`) más `PlanDefinition`, catálogo (`ActivityDefinition`) y agenda
  (`Schedule`/`Slot`/`HealthcareService`/`Practitioner`/…).
  Sincronizada con el espejo en `EPA-Developments/app@091e20f`, más
  `ActivityDefinition` de solo lectura (el catálogo con modalidades, para "Pedir un
  turno"): **sumarlo al espejo del portal** ([`handoff-app-pb100d.md`](handoff-app-pb100d.md),
  tarea 4). `tests/seed.test.ts` la compara entera con la copia en `tests/fixtures/`,
  porque `npm run seed` pisa la del servidor.
- **Reserva por *solicitud*.** El paciente pide desde el portal y se crea un
  `Task` (`code=solicitud-turno`) vía el bot **`som-solicitar-turno`** (lógica pura
  en `src/lib/solicitudes.ts`), que avisa a Recepción por WhatsApp (secret
  `RECEPCION_WHATSAPP_TO`). La app de recepción tiene la vista **"Solicitudes"**
  para confirmarlas con los bots de reserva. El paciente solo **lee** sus `Task` y
  solo puede **ejecutar** ese bot y `som-solicitar`: no escribe agenda.
- **Mensajes.** El paciente abre una conversación desde "Mensajes" del portal
  (`Communication` topic con el motivo en `topic` — `SYSTEM.motivoMensaje` — y sus
  mensajes hijos con `partOf`, el modelo del ThreadInbox de Medplum). Recepción la
  atiende en la vista **"Mensajes"** (`src/lib/mensajes.ts`); cada respuesta que sigue a
  un mensaje del paciente le deja una Novedad `mensaje-nuevo` (`SYSTEM.notificacion`,
  `about` = la conversación) en la campanita. Contrato: `docs/medplum/notificaciones.md`
  del portal.
  **WhatsApp** es un canal de las mismas conversaciones ([`whatsapp.md`](whatsapp.md)):
  lo que el paciente escribe por WhatsApp entra como mensaje hijo de su conversación
  abierta (o de una nueva con motivo `otro`), con la extensión `canal = whatsapp`; las
  respuestas que salieron por WhatsApp llevan la misma extensión. Las **respuestas
  automáticas** (acuse / fuera de horario) son hijas con `sender.display` =
  «Segunda Opinión Médica · respuesta automática» (sin `reference`) y la extensión
  `auto-respuesta`: el portal las muestra como un mensaje más del equipo.
- **Segunda opinión.** Bot `som-solicitar` (crea la `ServiceRequest`; exige el
  consentimiento firmado) y bot interno `bot-som-report` (informe), ver [`som.md`](som.md).
- **Estudios de laboratorio en PDF.** Bot interno `som-procesar-laboratorio`: lo
  dispara el `DocumentReference` que sube el paciente y crea sus `Observation` +
  `DiagnosticReport` ("Ver resultados" en el portal). Ver [`som.md`](som.md).
- **Biomarcadores.** El seed publica las `ObservationDefinition` del panel
  Cardiometabólico (lípidos; `src/config/biomarcadores.ts`), que el portal usa como
  catálogo y rangos.
- **Plan Bienestar 100 Días®.** `som-bienestar-inscribir` (Recepción) crea el
  `CarePlan` `care-plans|plan-bienestar-100` que muestra la tarjeta de progreso, con
  sus tres consultas programadas (`Task` `agendar-consulta-pb100d`, legibles por el
  paciente). Ver [`plan-bienestar.md`](plan-bienestar.md).
- **Teleconsulta.** Las consultas se piden presenciales o por teleconsulta
  (`modalidad` en `som-solicitar-turno`). La teleconsulta exige el consentimiento de
  teleconsulta (un `Consent` que registra el portal) y el turno trae el link de Jitsi.
  Contrato y tareas del portal: [`handoff-app-pb100d.md`](handoff-app-pb100d.md).
- **Seguimiento GLP-1.** El programa del paciente (`CarePlan` + `Goal`), el estado
  de cada control (`Task` `agendar-control-glp1`, con su turno en `output`) y los
  estudios de cada semana (`ServiceRequest` con `basedOn` el `CarePlan`). Es lo
  que muestra la app del paciente en el slice 2; contrato en
  [`glp1.md`](glp1.md#app-del-paciente-slice-2-y-unificación-con-ckm). Las
  solicitudes de segunda opinión se distinguen por su `code`
  (`som-services|som-cardiology`).
- **Alta de paciente** (`som-alta-paciente`): la recepción crea el `Patient`
  (dedupe por DNI/email/teléfono). No da login.
- **Invitación al portal** (`som-invitar-paciente`, requiere admin): hace el
  *invite* de Medplum (`sendEmail:false`, `upsert:true` → reusa el `Patient`, no
  duplica) con la AccessPolicy "Paciente SOM — Portal", marca el origen del paciente
  (`patient-origin`: `reception`, o `referral` si lo derivó un colega; el portal elige
  Bienvenida u Onboarding con eso), y entrega el link mágico
  `https://app.segundaopinionmedica.org/setpassword/{id}/{secret}` por
  **WhatsApp / email / QR**.
- **Auto-registro** (portal, "Crear cuenta"): el paciente se crea solo. Medplum le
  asigna el **default patient access policy** del proyecto.

Para activarlo en el proyecto: `npm run seed` + `npm run deploy:bots` + Project
Secrets (`RECEPCION_WHATSAPP_TO` y los de Twilio; ver [`bots.md`](bots.md)).

## Checklist a verificar en el repo del portal

1. **Mismo proyecto Medplum.** El portal debe registrar/loguear contra el proyecto
   `7ce5e559-f315-4538-abf2-61fa4922f996` en `https://api.medplum.com.ar/`. Si
   fuera otro proyecto, los `Patient` no se comparten y la integración no funciona.
   → revisar config del `MedplumClient` / `projectId` / variables de entorno.

2. **Ruta pública `/setpassword/:id/:secret`.** El link de invitación cae ahí: la
   página hace `POST auth/setpassword` y redirige a `/signin`.

   <details><summary>Referencia de implementación</summary>

   ```tsx
   // SetPasswordPage.tsx (portal)
   import { PasswordInput, Button, Title, Stack, Alert } from '@mantine/core';
   import { normalizeErrorString } from '@medplum/core';
   import { Document, Form, Logo, useMedplum } from '@medplum/react';
   import { useState } from 'react';
   import { useParams, useNavigate } from 'react-router-dom';

   export function SetPasswordPage(): JSX.Element {
     const { id, secret } = useParams() as { id: string; secret: string };
     const medplum = useMedplum();
     const navigate = useNavigate();
     const [error, setError] = useState<string>();
     return (
       <Document width={450}>
         <Form onSubmit={async (formData) => {
           if (formData.password !== formData.confirm) { setError('No coinciden'); return; }
           try {
             await medplum.post('auth/setpassword', { id, secret, password: formData.password });
             navigate('/signin');
           } catch (err) { setError(normalizeErrorString(err)); }
         }}>
           <Stack><Logo size={32} /><Title>Elegí tu contraseña</Title>
             <PasswordInput name="password" label="Nueva contraseña" required />
             <PasswordInput name="confirm" label="Repetir contraseña" required />
             {error && <Alert color="red">{error}</Alert>}
             <Button type="submit">Guardar</Button>
           </Stack>
         </Form>
       </Document>
     );
   }
   ```
   ```tsx
   // en el router del portal (zona pública, sin guard de sesión):
   <Route path="/setpassword/:id/:secret" element={<SetPasswordPage />} />
   ```
   Referencia canónica: `medplum/packages/app/src/SetPasswordPage.tsx` (open source).
   </details>

3. **Default patient access policy = "Paciente SOM — Portal".** Para que el
   auto-registrado y el invitado queden con el **mismo** alcance. `npm run
   diagnostico-acceso -- --apply` lo configura en el proyecto.

4. **Recursos que lee/escribe el portal = los de la policy.** Si el portal
   necesita algo que la policy no concede, se agrega en
   `src/fhir/access-policies.ts` (fuente de verdad) y se actualiza el espejo.

5. **URL del portal** = `https://app.segundaopinionmedica.org` (si otro entorno
   usa otra URL, cargarla en el Project Secret `PORTAL_BASE_URL`).

6. **Branding/seguridad.** Tema SOM; verificar `recaptchaSiteKey`/`googleClientId`
   si el registro los usa.

## Acceso al repo del portal desde Claude Code

El portal canónico es **`EPA-Developments/app`** (`drdalessandro/app` quedó
congelado como archivo histórico). Como es del mismo owner que este repo, una
sesión de Claude Code on the web puede sumar los dos repos a la vez. Doc:
https://code.claude.com/docs/en/claude-code-on-the-web
