# Handoff — App del paciente: seguimiento GLP-1 (slice 2)

Prompt de arranque para una sesión de Claude Code sobre **`EPA-Developments/app`**
(portal del paciente). Contrato de datos: [`glp1.md`](glp1.md) y el ejemplo
verificado [`ejemplos/glp1-paciente.json`](ejemplos/glp1-paciente.json).

## Prompt (pegar en la sesión de `EPA-Developments/app`)

```markdown
# Claude Code — App del paciente SOM (EPA-Developments/app) · Slice 2 GLP-1: "Mi seguimiento GLP-1"

## Contexto
Esta app es el portal del paciente de Segunda Opinión Médica (SOM, EPA Bienestar IA SAS):
https://app.segundaopinionmedica.org. Stack: React 19 + Mantine 8 + React Router 7 + @medplum/react,
sobre Medplum https://api.medplum.com.ar/, proyecto 7ce5e559-f315-4538-abf2-61fa4922f996.
ESTE es el repo canónico: el aviso "Repositorio congelado — movido a EPA-Developments/app" del
README es un resto de la unificación con drdalessandro/app (ver Tarea 0).

En el backend de Recepción (EPA-Developments/recepcionistas) ya está hecho el slice 1 del
seguimiento de tratamiento GLP-1:
- Recepción inscribe al paciente.
- El médico carga la indicación (molécula, esquema de titulación y fecha de inicio) con el bot
  `som-glp1-plan`.
- El sistema arma el programa: CarePlan, Goal (meta de peso), ServiceRequest (estudios de cada
  semana) y Task (un control por semana, con su ventana para agendar).
- Recepción agenda cada control: el turno es un Appointment y la tarea se completa.

La revisión de respuesta no es una semana fija: cae 12 semanas después de llegar a la dosis
terapéutica, y la calcula el sistema.

OBJETIVO de este slice: que el paciente vea su seguimiento en la app. Tiene que poder ver en qué
semana está, sus controles con fechas y estado, qué estudios llevar, su meta y su peso.
Todo es SOLO LECTURA.

## Antes de empezar
1. Sumá EPA-Developments/recepcionistas a la sesión (solo lectura). Leé esto de la rama
   `claude/determined-shannon-wq1wdx` (o de `som-base`, si ya se mergeó):
   - `docs/glp1.md`: flujo, calendario, recursos FHIR y la sección "App del paciente".
   - `docs/ejemplos/glp1-paciente.json`: EJEMPLO REAL de lo que vas a leer. Lo generan los bots
     y un test lo mantiene al día. Usalo como fixture.
   - `src/lib/glp1-plan.ts`: cómo se arma cada recurso.
   - `src/fhir/identifiers.ts`: systems y códigos.
2. En este repo, estos son los patrones a seguir:
   - `src/fhir/bienestar.ts` + `src/components/PlanBienestar100.tsx`: loader + tarjeta que no
     renderiza nada si el paciente no está inscripto.
   - `src/pages/care-plan/index.tsx`, `ActionItems.tsx` y `ActionItem.tsx`.
   - `src/pages/health-record/Measurement.tsx` (peso: LOINC 29463-7) y `src/components/LineChart.tsx`.
   - `src/pages/MyAppointments.tsx` (etiquetas de estado de los turnos).
   - `src/fhir/solicitudes.ts` y `src/fhir/bots.ts` (buscarBotSOM usa `name:exact`).
   - `docs/medplum/README.md` y `docs/medplum/access-policy-paciente-portal.json`.

## Contrato FHIR (solo lectura; "…" = https://segundaopinionmedica.org/fhir)
1. PROGRAMA: `CarePlan?subject=Patient/{id}&category=…/CodeSystem/care-plans|seguimiento-glp1&status=active`.
   Hay uno activo por paciente. Usa el mismo CodeSystem que el Plan Bienestar, con otro código.
   - `period.start` = fecha de inicio ('AAAA-MM-DD'). También trae `title`.
   - `activity[]` con `detail.kind='MedicationRequest'`: `productCodeableConcept.text` es la
     molécula y `description` el esquema de titulación (texto del equipo médico).
   - `activity[]` con `detail.kind='Appointment'`: una por visita (`code.text` y `scheduledPeriod`).
     Sus `description` están escritas para el equipo (propósito, controles, slugs): no las muestres
     tal cual.
   - `goal[0]` apunta a la meta.
   - `CarePlan.note` es para el equipo médico: NO se muestra nunca.
2. META: el Goal de `CarePlan.goal[0]`.
   - `target[0].measure` = LOINC 29463-7.
   - `detailQuantity` ("<= X kg") o `detailString` ("≤ 95 % del peso basal").
   - `target[0].dueDate` = fecha de la REVISIÓN DE RESPUESTA.
3. CONTROLES: `Task?patient=Patient/{id}&code=…/CodeSystem/task-tipo|agendar-control-glp1`, uno por semana.
   - `restriction.period.start/end` = ventana para agendar ('AAAA-MM-DD').
   - `input`: `semana` (valueInteger), `requiere-laboratorio` (valueBoolean), `servicio`
     ('CONTROL_GLP1').
   - `status` = `requested`: por agendar (lo coordina Recepción).
   - `status` = `completed`: agendado. `output[type.text='turno'].valueReference` apunta a
     `Appointment/{id}`.
   - `status` = `cancelled`: ya no corresponde porque el médico recalculó. NO se muestra.
   - La revisión es el control cuya `restriction.period.start` coincide con
     `Goal.target[0].dueDate`.
   - "Llevás N semanas" = días desde `period.start` / 7, redondeado para abajo. Es la misma
     numeración que los controles.
4. INDICACIÓN PENDIENTE: `Task` `…/CodeSystem/task-tipo|indicacion-glp1` con `status=requested`.
   El paciente está inscripto, pero el médico todavía no armó el plan.
5. ESTUDIOS: `ServiceRequest?subject=Patient/{id}&based-on=CarePlan/{cpId}` (ignorá los `revoked`).
   - `requisition.value` = '{cpId}:semana-{N}' agrupa los estudios de cada semana.
   - `code` es el SLUG de `…/CodeSystem/biomarcador` (catálogo CKM). OJO: no es tu
     `…/CodeSystem/biomarker`.
   - Nombres visibles de cada slug:
     hba1c = Hemoglobina glicosilada (HbA1c) · glucosa-en-ayunas = Glucemia en ayunas ·
     insulina-en-ayunas = Insulina (ayunas) · homa-ir = Índice HOMA-IR ·
     colesterol-total = Colesterol total · hdl-colesterol = Colesterol HDL ·
     ldl-colesterol = Colesterol LDL · trigliceridos = Triglicéridos · creatinina = Creatinina ·
     egfr-tfg-estimada = Filtrado glomerular estimado (eGFR) · ast-got = AST (TGO) ·
     alt-tgp = ALT (TGP).
   - Los 8 primeros ya están en `Biomarkers.data.ts` (LOINC 4548-4, 1558-6, 2484-4,
     biomarker|homa-ir, 2093-3, 2085-9, 13457-7, 2571-8), por si querés mostrar el último valor
     cargado. Creatinina, eGFR, AST y ALT no están: sumarlos es decisión del equipo médico.
6. TURNO: el Appointment del output.
   - `pending` = reservado, falta la seña. `booked` = confirmado. `fulfilled` = realizado.
   - Reusá las etiquetas de `MyAppointments.tsx`. Ahí ya aparece como "Seguimiento de tratamiento
     GLP-1 — Control".
7. PESO: `Observation?code=29463-7&patient=Patient/{id}`, igual que `Measurement.tsx`.

## Qué construir
TAREA 0 — README: reemplazá el encabezado "Repositorio congelado" por el del repo canónico y
conservá el resto.

TAREA 1 — `src/fhir/glp1.ts` (lógica, sin UI) + `src/fhir/glp1.test.ts`.
- Constantes de systems y códigos, con el comentario "deben coincidir con
  recepcionistas/src/fhir/identifiers.ts".
- `esCarePlanGlp1(carePlan)`.
- `cargarSeguimientoGlp1(medplum, patient)` devuelve una de tres cosas:
  - `undefined`: sin programa;
  - `{ estado: 'indicacion-pendiente' }`;
  - `{ estado: 'activo', … }` con todo lo que necesita la UI.
- Funciones puras para: semanas transcurridas; controles ordenados con su estado, estudios y turno;
  próximo control; revisión; formato de fechas 'AAAA-MM-DD' SIN corrimiento de zona horaria.
- Tests: copiá `docs/ejemplos/glp1-paciente.json` a `src/fhir/__fixtures__/` y cargalo en un
  `MockClient` conservando los ids (los recursos se referencian entre sí).

TAREA 2 — Página `src/pages/care-plan/SeguimientoGlp1.tsx`, ruta `care-plan/glp1`, dentro de
`CarePlanPage`.
- Encabezado: molécula, "Llevás N semanas de tratamiento" (o "Empezás el dd/mm") y el esquema tal
  como lo escribió el equipo, con "Seguí siempre las indicaciones de tu médico".
- Próximo paso: el próximo control, con su ventana y su estado.
- Tus controles: nombre ("Control inicial", "Semana 4", …, "Revisión de tu respuesta al
  tratamiento"), "entre el dd/mm y el dd/mm" y el estado:
  - "Por agendar: Recepción te va a contactar";
  - "Agendado: mié 30/09 10:00 · Reservado";
  - "Realizado".
  Si el control lleva laboratorio, agregá "Traé los resultados de: …" con los nombres visibles.
  Para la revisión, una línea amable: es cuando tu equipo evalúa cómo venís, 12 semanas después
  de llegar a tu dosis.
- Tu meta y tu peso:
  - la meta: "llegar a 87,4 kg o menos para el 22/02/2027", o "bajar al menos un 5 % de tu peso
    inicial";
  - gráfico de peso con LineChart y una línea de meta cuando la meta está en kg;
  - último peso y su fecha;
  - botón "Cargar mi peso" que lleve a `/health-record/vitals/weight`.
- "¿Dudas o síntomas? Escribile a tu equipo", que lleve a `/Communication`.
- Estados vacíos:
  - sin programa: explicación breve y un enlace a Mensajes;
  - indicación pendiente: "Tu médico está preparando tu plan de seguimiento".

TAREA 3 — Tarjeta en Inicio: `src/components/SeguimientoGlp1Card.tsx`, con el mismo patrón que
`PlanBienestar100` (no renderiza nada si no hay programa). Muestra las semanas y el próximo control
con su estado, y lleva a `/care-plan/glp1`.

TAREA 4 — Integración:
- Ruta en `src/Router.tsx`.
- Ítem "Seguimiento GLP-1" en el menú de `care-plan/index.tsx`. Idealmente solo si hay programa;
  si complica, dejalo fijo y que la página tenga su estado vacío.
- En `ActionItems.tsx`, el CarePlan GLP-1 navega a `/care-plan/glp1`.
- En `ActionItem.tsx`, el CarePlan GLP-1 redirige a `/care-plan/glp1`. NUNCA con ResourceTable
  crudo: mostraría la nota clínica.

TAREA 5 (opcional) — "Pedir turno para este control", solo en controles por agendar:
- Llamá a `crearSolicitud(medplum, patient, { servicio: 'Control GLP-1 · semana N',
  servicioCodigo: 'CONTROL_GLP1', nota: 'Ventana: del … al …' })`.
- Requiere el bot `som-solicitar-turno` actualizado (acepta `servicio`/`servicioCodigo`; ver
  `src/lib/solicitudes.ts` en recepcionistas). Antes rechazaba todo pedido del portal con "Elegí
  una terapia para tu solicitud".
- Si ese bot todavía no está desplegado, dejá esta tarea para después.

## Reglas
- SOLO LECTURA. No escribas CarePlan, Goal, Task, ServiceRequest ni Appointment del programa. Lo
  único que el paciente escribe es su peso, en la pantalla que ya existe.
- AccessPolicy: el espejo `docs/medplum/access-policy-paciente-portal.json` ya da lectura de todo
  esto, no hace falta tocarlo. La fuente de verdad es `recepcionistas/src/fhir/access-policies.ts`,
  que quedó idéntica al espejo (`tests/seed.test.ts` fija sus entradas). Si cambiás uno, cambiá
  el otro.
- EL SISTEMA CALCULA, LA APP MUESTRA. Ventanas, semanas de control y estudios se leen de los
  recursos; no se recalculan acá. Solo valen cálculos de presentación: semanas transcurridas,
  días que faltan, cambio de peso.
- SEGURIDAD CLÍNICA:
  - no mostrar `CarePlan.note`;
  - no interpretar la respuesta ("no te está funcionando");
  - no sugerir dosis;
  - no inventar contenido clínico ni alertas de síntomas: derivar a Mensajes.
  El tono es amable, en voseo y sin jerga.
- FECHAS: 'AAAA-MM-DD' es una fecha local. `new Date('2026-10-05')` la corre un día en Argentina.
  Formateá sin conversión y usá TZ America/Argentina/Buenos_Aires.
- NAMING SOM: nada nuevo con el prefijo `bw` (con guion o guion bajo, en cualquier caso) ni
  menciones a la marca anterior. Verificá tus archivos con
  `git grep -niE '\bbw[-_]|bio[w]ellness|bio\.medplum'`. Los hits que ya existen en el repo
  (14 en 6 archivos, más el logo de la marca anterior en `src/img/`) van en un PR aparte.
- ESTILO del repo:
  - encabezado SPDX "Copyright Segunda Opinión Médica";
  - Mantine 8, color `segundaOpinion`, `showErrorNotification`;
  - carga con `useEffect` + estado, no `.read()` (re-suspende);
  - textos en español;
  - `src/vendor/plan-bienestar/` NO se edita.
- GOBERNANZA: todo cambio de fondo se consulta con el Dr. Alejandro Barbagelata y el Dr. Alejandro
  Sergio D'Alessandro.

## Criterios de aceptación
- AC-1 Paciente con programa activo: la tarjeta de Inicio muestra las semanas y el próximo control
  (ventana + estado), y lleva a `/care-plan/glp1`.
- AC-2 Con el fixture, la página lista los controles de las semanas 0, 4, 12, 20 y 26, en orden:
  - basal: agendado el 30/09/2026 a las 10:00, reservado;
  - el resto: por agendar;
  - ventana de la semana 12: del 28/12/2026 al 04/01/2027.
- AC-3 La semana 20 aparece como revisión de respuesta, con la meta ≤ 87,4 kg para el 22/02/2027.
- AC-4 El basal muestra los 12 estudios con nombre visible. La semana 4 no lleva laboratorio.
- AC-5 No aparecen Task cancelados ni ServiceRequest revocados.
- AC-6 Estados vacíos:
  - indicación pendiente: aparece el estado de "plan en preparación";
  - sin programa: no hay tarjeta y la página lo explica.
- AC-7 El CarePlan GLP-1 nunca se ve crudo: "Pasos del plan" y `/care-plan/action-items/:id` llevan
  a la página nueva. `CarePlan.note` no aparece en ningún lado.
- AC-8 Ninguna fecha se corre un día. Probalo con `TZ=America/Argentina/Buenos_Aires` en los tests.
- AC-9 El peso se grafica con la línea de meta cuando está en kg, y "Cargar mi peso" lleva a la
  pantalla existente.
- AC-10 Pasan `npm test`, `npm run build` y `npm run lint`, y el grep de naming sobre los archivos
  nuevos da vacío.

## Verificación y entrega
- Gate local (el repo no tiene CI): `npm test`, `npm run build` (tsc + vite build) y
  `npm run lint`. OJO: `lint` corre con `--fix`, revisá el diff.
- Tests: loader y helpers contra el fixture. Render de la página y de la tarjeta con MockClient.
- Revisión visual: `npm run dev` con los datos del fixture, o con un paciente de prueba cuando el
  slice 1 esté desplegado. Sacá capturas en mobile y en desktop.
- Trabajá en una rama, abrí un PR contra main y NO mergees. En la descripción poné qué hiciste, las
  capturas, cómo lo probaste y las preguntas abiertas.

## Dependencias
Los datos reales aparecen recién cuando pasa todo esto: se mergea el slice 1 de recepcionistas, se
corren `npm run seed` y `npm run deploy:bots`, y un médico ejecuta `som-glp1-plan` para el paciente.
Hasta entonces, desarrollá contra el fixture, y la app tiene que funcionar con los estados vacíos.

## Fuera de alcance
- Editar el plan o reservar directo.
- Recordatorios y notificaciones.
- La pantalla del médico.
- La unificación con la plataforma CKM.
- La limpieza de naming heredado.
- Cambios de AccessPolicy.
```
