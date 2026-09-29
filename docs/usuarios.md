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

Archivos (`Binary`): la recepción los sube y los abre desde **Mensajes** (adjuntos del
portal y de WhatsApp), por decisión del Dr. D'Alessandro (26/09/2026). Medplum no permite
buscar ni listar `Binary`: solo se abre un archivo teniendo su link, y los links a
estudios clínicos están en recursos que la recepción no puede leer.

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
| **Profesional SOM — Médico** | Médicos del plantel (Cardiología, Cardiología con especialidad, Tisioneumonología, Neurología, Ginecología, DBT/Endocrino) | La ficha completa en el dashboard clínico: escribe evolución, observaciones, diagnósticos, medicación, pedidos, planes y metas; **lee** agenda, informe de segunda opinión, cobertura, mensajes y documentos; ejecuta la teleconsulta (moderador y cierre), el GLP-1, PUCO y REFEPS. **Sin facturación** |
| **Profesional SOM — Nutrición** | Licenciadas/os en Nutrición | Lo mismo **sin prescribir ni pedir** (Ley 17.132): medicación, pedidos y diagnósticos se leen; no cambia la identidad de la paciente; teleconsulta y PUCO, sin GLP-1 ni REFEPS |
| **Paciente SOM — Portal** | Pacientes (portal) | **Solo lo suyo** (`%patient`): autogestión de su ficha, vitales, cuestionarios, documentos y mensajes; su Plan Bienestar (escritura acotada); lectura de turnos, pagos, solicitudes, informes y sus programas de seguimiento (`CarePlan`, `Goal`, `Task`) |

## Crear un especialista (dashboard clínico)

Los especialistas atienden desde el **dashboard clínico**
(`dashboard.segundaopinionmedica.org`), no desde la app de recepción. Hay dos
policies y no una porque el acceso sí difiere: Nutrición no prescribe.

1. `npm run seed` (deja las dos policies en el servidor).
2. **Project → Admin → Users → Invite new user**: nombre y email, **Role:
   Practitioner**, **Access Policy:** `Profesional SOM — Médico` o
   `Profesional SOM — Nutrición`, **Admin: NO**.
3. **El usuario tiene que quedar atado a SU `Practitioner`**, el que carga el seed
   (`src/config/medicos.ts`) y figura como `participant` en sus turnos. Si al
   invitarlo Medplum crea otro `Practitioner`, el profesional no va a poder entrar
   a sus teleconsultas como moderador: `som-teleconsulta-token` verifica que quien
   pide sea `participant` del turno. Se corrige en la `ProjectMembership` (su
   `profile`).

Alcance: las dos ven **todas** las pacientes del proyecto, como el Director Médico.
Acotar cada profesional a sus pacientes (por turno o por `CareTeam`) está pendiente
([`decisiones-pendientes.md`](decisiones-pendientes.md), *Roles*).

La agenda es de sólo lectura: entrar a la teleconsulta y cerrarla van por
`som-estado-turno`, que además cierra la visita, libera las franjas y marca el Plan
Bienestar. Lo que el dashboard lee y escribe está fijado en
`tests/policy-especialistas.test.ts`.

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
