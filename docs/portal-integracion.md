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
  El paciente **escribe** solo su autogestión (perfil, vitales, cuestionarios,
  documentos, mensajes) y **lee** su compartimento clínico/financiero
  (`Appointment`, `Invoice`, `DiagnosticReport`, `CarePlan`, `Goal`,
  `MedicationRequest`, `Immunization`, `Task`, `ServiceRequest`, `RiskAssessment`)
  más catálogo y agenda (`Schedule`/`Slot`/`HealthcareService`/`Practitioner`/…).
  `Goal` se sumó para el seguimiento GLP-1: actualizar el espejo del portal.
- **Reserva por *solicitud*.** El paciente pide desde el portal y se crea un
  `Task` (`code=solicitud-turno`) vía el bot **`som-solicitar-turno`** (lógica pura
  en `src/lib/solicitudes.ts`), que avisa a Recepción por WhatsApp (secret
  `RECEPCION_WHATSAPP_TO`). La app de recepción tiene la vista **"Solicitudes"**
  para confirmarlas con los bots de reserva. El paciente solo **lee** sus `Task` y
  solo puede **ejecutar** ese bot y `som-solicitar`: no escribe agenda.
- **Segunda opinión.** Bot `som-solicitar` (crea la `ServiceRequest`) y bot interno
  `bot-som-report` (informe), ver [`som.md`](som.md).
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
  duplica) con la AccessPolicy "Paciente SOM — Portal", y entrega el link mágico
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
