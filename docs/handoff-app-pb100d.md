# Handoff — App del paciente: "Pedir un turno" con Plan Bienestar 100 Días® y teleconsulta

Prompt de arranque para una sesión de Claude Code sobre **`EPA-Developments/app`**
(portal del paciente). Contrato de datos: [`plan-bienestar.md`](plan-bienestar.md).

## Prompt (pegar en la sesión de `EPA-Developments/app`)

```markdown
# Claude Code — App del paciente SOM (EPA-Developments/app) · "Pedir un turno": Plan Bienestar 100 Días® y teleconsulta

## Contexto
Portal del paciente de Segunda Opinión Médica (https://app.segundaopinionmedica.org), sobre Medplum
https://api.medplum.com.ar/, proyecto 7ce5e559-f315-4538-abf2-61fa4922f996.

En el backend de Recepción (EPA-Developments/recepcionistas) ya están:
- El catálogo de consultas por especialidad, cada una PRESENCIAL y por TELECONSULTA:
  DBT / Endocrino, Nutrición, Cardiología, Cardiología con especialidad (Insuficiencia
  Cardíaca, Hemodinamia, Electrofisiología, Medicina Nuclear, Prevención CV, Rehabilitación
  CV), Tisioneumonología, Neurología y Ginecología. Tienen cargo: ARS 150.000 (extensión
  `precio-ars`), igual presencial y por teleconsulta.
- El Plan Bienestar 100 Días® (marca registrada del Dr. Alejandro Sergio D'Alessandro): tres
  consultas programadas incluidas en el plan (inicial = día 1, día 50 y final = día 100; ± 7
  días), presenciales o por teleconsulta. Recepción las agenda; el paciente puede pedirlas.
- Teleconsulta por Jitsi: cada turno trae su link. Exige un consentimiento de teleconsulta
  (genérico, uno por paciente) que se firma en ESTE portal.

OBJETIVO: rehacer "Pedir un turno" (GetCarePage) con dos caminos —Teleconsulta primero, porque es
el más usado, y Presencial— y, dentro de cada uno, el Plan Bienestar y las consultas por
especialidad. Todo sale de FHIR (data-driven): nada de listas de servicios escritas a mano.

## Antes de empezar
1. Sumá EPA-Developments/recepcionistas a la sesión (solo lectura). Leé de `som-base`:
   - `docs/plan-bienestar.md`: reglas, recursos FHIR y el Consent de teleconsulta.
   - `src/config/catalogo.ts` (grupos y orden), `src/lib/plan-bienestar.ts`
     (`leerTareaConsultaPlan`, `resumenPlanBienestar`) y `src/lib/teleconsulta.ts`
     (`construirConsentimientoTeleconsulta`, `modalidadDe`, `teleconsultaUrlDe`).
2. Patrones de este repo: `src/fhir/solicitudes.ts` (crearSolicitud), `src/fhir/bienestar.ts` +
   `src/components/PlanBienestar100.tsx`, `src/fhir/consentimiento.ts`, `src/pages/MyAppointments.tsx`.

## Contrato FHIR ("…" = https://segundaopinionmedica.org/fhir)
1. CATÁLOGO (lectura; la policy del paciente ya lo permite, ver Tarea 4):
   `ActivityDefinition?status=active&context=http://terminology.hl7.org/CodeSystem/v3-ActCode|VR`
   (teleconsulta) o `…|AMB` (presencial).
   - Código del servicio: `identifier` con system `…/CodeSystem/servicio` (p. ej. `NEUROLOGIA`).
   - Nombre: `title` ("Consulta de Neurología"). En teleconsulta mostrá "Teleconsulta de
     Neurología" (reemplazá el "Consulta" inicial).
   - Grupo: el `topic` con system `…/CodeSystem/grupo-especialidad`. Orden: dbt-endocrino,
     nutricion, cardiologia, cardiologia-especialidad, tisioneumonologia, neurologia, ginecologia.
   - Las que NO tienen grupo no van en "Consultas por especialidad": la del Plan Bienestar
     (`CONSULTA_PB100D`, trae `useContext` `program` = `…/CodeSystem/care-plans|plan-bienestar-100`)
     y el control GLP-1.
   - Precio: extensión `…/StructureDefinition/precio-ars` (ARS 150.000 en las consultas por
     especialidad). Si es 0 y hay `…/StructureDefinition/valor-referencia-ars`, es una consulta
     incluida en el plan: mostrá "Incluida en tu plan"; si es 0 sin referencia, "con cargo" sin monto.
2. PLAN BIENESTAR (lectura): el paciente está inscripto si tiene un `CarePlan` activo con
   category `…/CodeSystem/care-plans|plan-bienestar-100` (igual que hoy). Sus consultas son
   `Task?patient=Patient/{id}&code=…/CodeSystem/task-tipo|agendar-consulta-pb100d`:
   - `input` `consulta` (`inicial` | `mitad` | `final`) y `dia` (1, 50, 100);
     `restriction.period` = ventana (la inicial solo tiene `start`); `status` `requested` =
     por agendar, `completed` = agendada (`output` → el `Appointment`).
   - La del día 50 y la final se piden recién con la inicial agendada (marca el día 1).
3. PEDIR: el mismo bot `som-solicitar-turno`, con dos campos nuevos (los viejos siguen andando):
   `{ pacienteRef, servicio: '<nombre visible>', servicioCodigo: '<código>', modalidad: 'teleconsulta' | 'presencial', preferenciaInicio?, preferenciaTexto?, nota? }`.
   Para una consulta del plan: `servicioCodigo: 'CONSULTA_PB100D'` y en `servicio` cuál es
   ("Consulta del día 50 del Plan Bienestar 100 Días®").
   El bot rechaza la teleconsulta si falta el consentimiento: `{ ok: false, mensaje }`.
4. CONSENTIMIENTO DE TELECONSULTA: `Consent?patient=Patient/{id}&status=active` y buscá el que
   tenga `policyRule.coding` = `…/CodeSystem/consentimiento|teleconsulta`. Si no está, antes de
   pedir una teleconsulta mostrá el texto (lo redactan los médicos de SOM; hasta tenerlo, un
   placeholder marcado PENDIENTE) y creá el `Consent` con el shape de
   `construirConsentimientoTeleconsulta` (en `policyRule.text`, el texto aceptado). Es distinto
   del consentimiento informado de la segunda opinión (DocumentReference LOINC 59284-0).
5. TURNOS: en `Appointment`, la modalidad está en la extensión `…/StructureDefinition/modalidad`
   (`valueCoding` v3-ActCode `VR` = teleconsulta, `AMB` = presencial) y el link en
   `…/StructureDefinition/teleconsulta-url` (`valueUrl`). El profesional va en `participant`
   (`Practitioner`) y en la extensión `…/StructureDefinition/profesional` (`valueString` = su código).
6. PROFESIONALES Y HORARIOS (lectura; R-22, para el flujo Especialidad → Profesional → Horario
   que reemplaza a "Preferencia de horario" en texto libre):
   - Quiénes atienden una consulta: `PractitionerRole?active=true&role=…/CodeSystem/servicio|<código>`
     (`practitioner.display` = nombre; `specialty` SNOMED; la extensión `…/StructureDefinition/modalidad`
     aparece una vez por modalidad que atiende; `code` con `…/CodeSystem/rol-profesional|seguimiento-pb100d`
     = atiende las consultas del plan). El código del profesional: `identifier` `…/CodeSystem/medico`
     (`ROL_<código>` → `<código>`).
   - Su agenda: `Schedule?identifier=…/CodeSystem/medico|SCH_<código>`; horarios libres:
     `Slot?schedule=Schedule/{id}&status=free&start=ge{ahora}&_sort=start&_count=200` (franjas de
     30 min, `start`/`end` con offset `-03:00`). Cada franja trae la extensión
     `…/StructureDefinition/modalidad` una vez por modalidad en que se puede reservar (`VR`
     teleconsulta, `AMB` presencial): filtrá por la modalidad elegida (una franja sin esa extensión
     admite las dos). Mostrá solo los que caen dentro de la ventana de la consulta del plan
     (Contrato 2). Un profesional sin franjas libres todavía no tiene
     disponibilidad cargada: no se ofrece.
7. RESERVAR (R-23): bot `som-reservar-portal` (la paciente puede ejecutarlo), con
   `{ pacienteRef, servicioCodigo, slotId, modalidad: 'teleconsulta' | 'presencial', tareaId? }`
   (`tareaId` solo para una consulta del plan: la Task de Contrato 2). Respuesta:
   `{ ok, mensaje?, appointmentId, estado: 'confirmado' | 'tentativo', descripcion, inicio, fin,
      modalidad, medicoCodigo, incluida, senaARS?, linkPago?, expira?, sinLink?, advertencias? }`.
   - `confirmado` (consulta del plan, incluida): mostrá "Confirmada" y llevala a Mis turnos.
   - `tentativo` con `linkPago`: abrí el link de MercadoPago (Checkout Pro) y mostrá "Te guardamos el
     horario hasta las HH:mm" (`expira`, ISO; `senaARS` es la seña del 50 %). Al pagar, el webhook
     confirma solo el turno (`Appointment.status` `pending` → `booked`): releé el turno al volver de
     MP (`back_urls` apuntan a la app). El link también queda en la extensión
     `…/StructureDefinition/link-pago-sena` del Appointment, por si hay que retomarlo.
   - `tentativo` con `sinLink`: "Recepción te va a contactar para la seña" (no vence).
   - `ok: false`: `mensaje` está escrito para la paciente, mostralo tal cual (horario ocupado, muy
     pronto, sin consentimiento, tarea ajena, …) y recargá los horarios libres.
   Reglas que aplica: las de Recepción (R-07, R-20, R-21, R-22) y, además, solo puede reservar
   para sí misma, consultas por especialidad o la del plan con su tarea (el control GLP-1 no), y
   con al menos 30 minutos de anticipación (provisional).
   En Mis turnos: `origen-reserva` = `portal`; un `pending` con `reserva-expira` (dateTime) es
   tentativo hasta esa hora; si venció, el cron lo pasa a `cancelled` ("Venció la reserva: elegí
   otro horario"). `som-solicitar-turno` (Contrato 3) sigue disponible como alternativa en texto libre.

## Tareas
1. GetCarePage: dos tarjetas —"Consulta por videollamada" (primero) y "Consulta en el
   centro"—. Dentro de cada una: (a) si está inscripto, el bloque Plan Bienestar 100 Días® con
   sus tres consultas (estado, ventana, "Pedir"); (b) "Consultas por especialidad" agrupadas.
   Los estudios del listado actual (ECG, ecocardiograma, ergometría, Holter, MAPA, laboratorio)
   quedan en el camino presencial como "Estudios". Sacá los textos de membresías / Founding
   Members: en SOM no hay membresías.
2. Consentimiento de teleconsulta (Contrato 4), antes de la primera teleconsulta.
3. Mis turnos: badge "Teleconsulta" y botón "Entrar a la videollamada" con el link.
4. AccessPolicy: re-sincronizá el espejo `docs/medplum/access-policy-paciente-portal.json` con la
   fuente de verdad (`src/fhir/access-policies.ts` de recepcionistas; copia exacta en su
   `tests/fixtures/access-policy-paciente-portal.json`): suma `ActivityDefinition`,
   `PractitionerRole` y `Location` de lectura y el bot `Bot?name=som-reservar-portal`.
7. Reserva por horario (Contratos 6 y 7): dentro de cada camino, Especialidad → Profesional
   (`PractitionerRole`) → Horario (`Slot` libres de la modalidad, agrupados por día, hora de
   Argentina) → "Reservar" (`som-reservar-portal`). Pantalla de resultado según `estado`
   (confirmada / tentativa con botón "Pagar la seña" y cuenta regresiva hasta `expira` / sin link).
   Para la consulta del plan, el mismo flujo con `tareaId`. Reemplaza "Preferencia de horario".
5. Tarjeta del plan: nombre visible "Plan Bienestar 100 Días®" (el código `plan-bienestar-100`
   no cambia). En el hito "Reservá tu consulta", mostrá la próxima consulta del plan y su ventana.
6. Fixture GLP-1: actualizá `docs/ejemplos/glp1-paciente.json` desde recepcionistas (el turno
   ahora trae `serviceType` y la extensión `modalidad`; son agregados).
Tests con el mismo estilo de `src/fhir/*.test.ts`. Nada de precios ni profesionales inventados.
```
