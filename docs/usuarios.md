# Usuarios y roles

Cómo se controla quién ve qué. La privacidad de la historia clínica se garantiza
con **AccessPolicies** de Medplum (mínimo privilegio).

## Privacidad por diseño (recepción sin datos de salud)

La AccessPolicy **"Recepción — Operativo"** (`src/fhir/access-policies.ts`) **solo
lista recursos operativos**. En Medplum, los `resourceType` que **no** están en la
policy quedan **denegados**, así que la recepción NO puede ver:

`Observation`, `Condition`, `DiagnosticReport`, `DocumentReference`, `CarePlan`,
`Goal`, `ServiceRequest`, `MedicationRequest` (ni nada clínico no listado).

La recepción sí ve: agenda (`Appointment`/`Slot`/`Schedule`), pagos
(`Invoice`/`ChargeItem`), comunicación (`Communication`), CRM y tareas (`Task`,
incluidos los controles GLP-1 a agendar: semana, ventana y si lleva laboratorio),
catálogo (lectura), **solo los bots de Recepción** (`BOTS_RECEPCION`: para
ejecutar un bot hay que poder leerlo; el que arma el plan GLP-1 queda fuera) y la
ficha del paciente (`Patient`) **con el `perfil-clinico` oculto**. El banner de
seguridad es un `Flag` de solo lectura (señal verde/rojo, sin detalle clínico).

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
   `recepcion.segundaopinionmedica.org`.

## Otros roles (definidos en el seed)

| AccessPolicy | Para quién | Alcance |
|---|---|---|
| Recepción — Operativo | Recepcionistas | Operativo, sin historia clínica |
| Director Médico — Clínico completo | Dirección médica | Todo |
| **Paciente SOM — Portal** | Pacientes (portal) | **Solo lo suyo** (`%patient`): autogestión de su ficha, vitales, cuestionarios, documentos y mensajes; lectura de turnos, pagos, solicitudes, informes y sus programas de seguimiento (`CarePlan`, `Goal`) |

Los roles clínicos del equipo médico de SOM están **por definir** (los del
catálogo anterior se retiraron). Los médicos se invitan igual que la
recepcionista, con la AccessPolicy que corresponda. Hoy el bot que arma el
programa GLP-1 (`som-glp1-plan`) lo ejecuta "Director Médico — Clínico completo".

## Pacientes y el portal

El **portal del paciente** es una app aparte (repo `EPA-Developments/app`, ver
[`som.md`](som.md)), publicada en `https://app.segundaopinionmedica.org`.
Ahí el paciente puede **auto-registrarse** ("Crear cuenta") e iniciar sesión. La
AccessPolicy **"Paciente SOM — Portal"** (`src/fhir/access-policies.ts`) es la que
limita a cada paciente a ver **solo lo suyo** (`%patient`); nunca datos de otros
pacientes.

Hay dos caminos para que un paciente tenga acceso, y conviene que ambos usen la
**misma** policy:

- **Auto-registro** (portal): el paciente se crea solo. Medplum le asigna el
  **default patient access policy** del proyecto → configurarlo como
  "Paciente SOM — Portal".
- **Invitación desde recepción**: la recepción da de alta (`som-alta-paciente`) y/o
  invita al portal (`som-invitar-paciente`) por WhatsApp / email / QR. El bot ya
  asigna explícitamente "Paciente SOM — Portal". Ver `docs/bots.md` (onboarding).

> El link de invitación apunta al **portal** (`https://app.segundaopinionmedica.org`;
> el Project Secret `PORTAL_BASE_URL` lo pisa por entorno), no a la app de recepción.

> Contrato de integración recepción ↔ portal (checklist a verificar en el repo
> del portal): ver [`docs/portal-integracion.md`](portal-integracion.md).
