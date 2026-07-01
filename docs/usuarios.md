# Usuarios y roles

Cómo se controla quién ve qué. La privacidad de la historia clínica se garantiza
con **AccessPolicies** de Medplum (mínimo privilegio).

## Privacidad por diseño (recepción sin datos de salud)

La AccessPolicy **"Recepción — Operativo"** (`src/fhir/access-policies.ts`) **solo
lista recursos operativos**. En Medplum, los `resourceType` que **no** están en la
policy quedan **denegados**, así que la recepción NO puede ver:

`Observation`, `Condition`, `DiagnosticReport`, `DocumentReference`, `CarePlan`,
`MedicationRequest` (ni nada clínico no listado).

La recepción sí ve: agenda (`Appointment`/`Slot`/`Schedule`), pagos
(`Invoice`/`ChargeItem`), comunicación (`Communication`), CRM (`Task`), catálogo
(lectura), `Bot` (para invocarlos) y la ficha del paciente (`Patient`) **con el
`perfil-clinico` oculto**. El banner de seguridad es un `Flag` de solo lectura
(señal verde/rojo, sin detalle clínico).

> ⚠️ La policy protege a un usuario **solo si se le asigna** y **no es admin**
> (los admin saltean las AccessPolicies).

## Crear una recepcionista

1. Tener la policy actualizada en el servidor:
   ```bash
   npm run seed
   ```
2. En la app de Medplum (admin del proyecto): **Project → Admin → Users → Invite
   new user**:
   - Nombre y email.
   - **Role:** Practitioner.
   - **Access Policy:** `Recepción — Operativo`.
   - **Admin: NO.**
3. La persona recibe un email, setea su contraseña e ingresa en
   `recepcion.medplum.com.ar`.

## Otros roles (definidos en el seed)

| AccessPolicy | Para quién | Alcance |
|---|---|---|
| Recepción — Operativo | Recepcionistas | Operativo, sin historia clínica |
| Director Médico — Clínico completo | Dr. Conrado López Alonso | Todo |
| Médico Prescriptor — Clínico + prescripción | Dalessandro / Dos Santos | Clínico + autoriza IV/TB |
| Enfermería — Clínico limitado | Enfermería | Órdenes del día + ejecución |
| Terapeuta — Propio | Terapeutas | Sus turnos + registrar sesión |
| **Paciente — Portal** | Pacientes (portal) | **Solo lo suyo:** su `Patient`, `Appointment`, `Invoice`, `Coverage`, `Communication` (lectura) |

Los médicos/clínicos se invitan igual que la recepcionista, pero con su
AccessPolicy correspondiente.

## Pacientes y el portal

El **portal del paciente** es una app aparte (basada en FooMedical, repo
`biowellness/portal`, en `bio.medplum.com.ar`). Ahí el paciente puede
**auto-registrarse** ("Crear cuenta") e iniciar sesión. La AccessPolicy
**"Paciente — Portal"** (`src/fhir/access-policies.ts`) es la que limita a cada
paciente a ver **solo lo suyo** (`%patient`): sus turnos, pagos, plan y mensajes,
todo de lectura; nada clínico ni de otros pacientes.

Hay dos caminos para que un paciente tenga acceso, y conviene que ambos usen la
**misma** policy:

- **Auto-registro** (portal): el paciente se crea solo. Medplum le asigna el
  **default patient access policy** del proyecto → configurarlo como
  "Paciente — Portal".
- **Invitación desde recepción**: la recepción da de alta (`som-alta-paciente`) y/o
  invita al portal (`som-invitar-paciente`) por WhatsApp / email / QR. El bot ya
  asigna explícitamente "Paciente — Portal". Ver `docs/bots.md` (onboarding).

> El link de invitación apunta al **portal** (`PORTAL_BASE_URL`,
> default `bio.medplum.com.ar`), no a la app de recepción.

> Contrato de integración reception ↔ portal (checklist a verificar en el repo
> `biowellness/portal`): ver [`docs/portal-integracion.md`](portal-integracion.md).
