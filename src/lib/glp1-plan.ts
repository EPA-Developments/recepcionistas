/**
 * Programa de seguimiento de tratamiento GLP-1 — armado del plan (lógica pura).
 *
 * Con la indicación del médico (molécula, indicación, esquema de titulación y los
 * datos que suman controles) y el calendario de `glp1/monitoring.ts`, arma los
 * recursos FHIR del programa:
 *  - CarePlan: esquema de titulación + una actividad por visita, con su ventana;
 *  - Goal: descenso ≥ 5 % del peso basal para la revisión de respuesta;
 *  - ServiceRequest: un pedido por estudio, agrupados por semana (`requisition`);
 *  - Task para Recepción: agendar el control de cada semana dentro de su ventana,
 *    SIN datos clínicos (solo semana, ventana y si trae laboratorio).
 *
 * La revisión de respuesta cae 12 semanas después de llegar a dosis terapéutica,
 * no en una semana fija: la calcula el sistema y se recalcula si cambia la
 * titulación (principio 1: Recepción nunca calcula fechas). R-19: ventana de
 * cada control.
 */
import type { CarePlan, CarePlanActivity, Goal, PlanDefinition, PlanDefinitionAction, ServiceRequest, Task } from '@medplum/fhirtypes';
import { CODIGO_CONTROL_GLP1 } from '../config/catalogo.js';
import { TZ } from '../config/horario.js';
import { VENTANA_CONTROL_GLP1_DIAS } from '../config/reglas.js';
import { COD, PLAN_GLP1_URL, PLAN_GLP1_VERSION, SYSTEM } from '../fhir/identifiers.js';
import {
  indicationSummary,
  labsForVisit,
  monitoringPlan,
  responseReview,
  type MonitoringVisit,
} from './glp1/monitoring.js';
import { weeksToTherapeuticDose, type TitrationSchedule } from './glp1/titration.js';
import type { ResultadoValidacion } from './reglas-turno.js';

/** Descenso mínimo de peso para continuar (ficha técnica; ver `responseReview`). */
const DESCENSO_MINIMO = 0.05;
const LOINC = 'http://loinc.org';
const LOINC_PESO = '29463-7';
const SNOMED = 'http://snomed.info/sct';
const SNOMED_LABORATORIO = '108252007';
const DIA_MS = 86_400_000;

export type IndicacionGlp1 = 'dm2' | 'peso';

export interface EscalonTitulacion {
  /** Dosis tal como la indica el médico (p. ej. "0,25 mg semanal"). */
  dosis: string;
  /** Semanas del escalón antes de pasar al siguiente. */
  semanas: number;
  /** Escalón en el que se alcanza la dosis terapéutica (uno solo). */
  terapeutica?: boolean;
}

/** Indicación del médico: entrada del bot `som-glp1-plan`. */
export interface EntradaPlanGlp1 {
  /** "Patient/123". */
  pacienteRef: string;
  /** Primera aplicación, 'AAAA-MM-DD'. */
  fechaInicio: string;
  molecula: string;
  /** `dm2`: esquema de diabetes tipo 2 · `peso`: esquema de control de peso. */
  indicacion: IndicacionGlp1;
  titulacion: EscalonTitulacion[];
  /** Retinopatía diabética (suma control oftalmológico). */
  retinopatia?: boolean;
  /** Albúmina/creatinina en orina, mg/g (> 0 suma control renal). */
  uacrMgG?: number;
  /** Filtrado glomerular estimado (< 60 suma control renal). */
  egfr?: number;
  /** Peso basal en kg: si está, la meta queda en kg. */
  pesoBasalKg?: number;
}

const RE_PATIENT_REF = /^Patient\/[A-Za-z0-9\-.]+$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** 'AAAA-MM-DD' válida (rechaza fechas imposibles como 2026-02-30). */
export function esFechaValida(f: string | undefined): f is string {
  if (!f || !RE_FECHA.test(f)) {
    return false;
  }
  const t = Date.parse(`${f}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === f;
}

export function esPacienteRef(ref: string | undefined): ref is string {
  return Boolean(ref && RE_PATIENT_REF.test(ref));
}

function numeroOpcionalValido(n: unknown, max: number): boolean {
  return n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max);
}

/** Valida la indicación antes de armar nada. No decide nada clínico. */
export function validarEntradaGlp1(e: Partial<EntradaPlanGlp1> | undefined): { ok: boolean; error?: string } {
  if (!esPacienteRef(e?.pacienteRef)) {
    return { ok: false, error: 'Falta el paciente (Patient/…).' };
  }
  if (!esFechaValida(e?.fechaInicio)) {
    return { ok: false, error: 'La fecha de inicio debe ser una fecha válida AAAA-MM-DD.' };
  }
  if (!e?.molecula?.trim() || e.molecula.length > 100) {
    return { ok: false, error: 'Falta la molécula.' };
  }
  if (e.indicacion !== 'dm2' && e.indicacion !== 'peso') {
    return { ok: false, error: 'La indicación es "dm2" o "peso".' };
  }
  const escalones = e.titulacion ?? [];
  if (escalones.length === 0) {
    return { ok: false, error: 'Falta el esquema de titulación.' };
  }
  for (const s of escalones) {
    if (!s?.dosis?.trim()) {
      return { ok: false, error: 'Cada escalón de la titulación necesita la dosis.' };
    }
    if (!Number.isInteger(s.semanas) || s.semanas < 0 || s.semanas > 104) {
      return { ok: false, error: 'Las semanas de cada escalón son un número entero entre 0 y 104.' };
    }
  }
  if (escalones.filter((s) => s.terapeutica).length !== 1) {
    return { ok: false, error: 'Marcá un solo escalón como dosis terapéutica.' };
  }
  if (!numeroOpcionalValido(e.uacrMgG, 100_000) || !numeroOpcionalValido(e.egfr, 300)) {
    return { ok: false, error: 'UACR y eGFR, si se informan, son números positivos.' };
  }
  if (e.pesoBasalKg !== undefined && !(numeroOpcionalValido(e.pesoBasalKg, 400) && e.pesoBasalKg > 0)) {
    return { ok: false, error: 'El peso basal, si se informa, va en kg (mayor que 0).' };
  }
  return { ok: true };
}

/** Esquema en el formato del módulo compartido (`glp1/titration.ts`). */
export function esquemaDeTitulacion(e: EntradaPlanGlp1): TitrationSchedule {
  return {
    indication: e.indicacion === 'dm2' ? 'dm2' : 'weight',
    molecule: e.molecula.trim(),
    steps: e.titulacion.map((s) => ({ dose: s.dosis.trim(), weeks: s.semanas, therapeutic: s.terapeutica === true })),
  };
}

// ───────────────────────────── calendario ─────────────────────────────

export interface Ventana {
  /** 'AAAA-MM-DD'. */
  desde: string;
  /** 'AAAA-MM-DD'. */
  hasta: string;
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export function fmtDia(fecha: string): string {
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Ventana para agendar el control de una semana (R-19, provisional): desde la
 * semana calculada y hasta `VENTANA_CONTROL_GLP1_DIAS` después; el basal, en los
 * días previos a la primera aplicación.
 */
export function ventanaDeSemana(fechaInicio: string, semana: number): Ventana {
  if (semana === 0) {
    return { desde: sumarDias(fechaInicio, -VENTANA_CONTROL_GLP1_DIAS), hasta: fechaInicio };
  }
  const fecha = sumarDias(fechaInicio, semana * 7);
  return { desde: fecha, hasta: sumarDias(fecha, VENTANA_CONTROL_GLP1_DIAS) };
}

/** Clave estable de una visita (no usa la semana, que la revisión de respuesta mueve). */
export function claveVisita(v: MonitoringVisit): string {
  if (v.weeks === 0) {
    return 'basal';
  }
  if (/revisi[oó]n de respuesta/i.test(v.label)) {
    return 'revision';
  }
  if (/oftalmolog/i.test(v.label)) {
    return 'oftalmologia';
  }
  if (/funci[oó]n renal/i.test(v.label)) {
    return 'renal';
  }
  return `semana-${v.weeks}`;
}

export interface VisitaGlp1 {
  clave: string;
  semana: number;
  titulo: string;
  proposito: string;
  controles: string[];
  /** Slugs del catálogo de biomarcadores. */
  estudios: string[];
  ventana: Ventana;
}

/** Lo que agenda Recepción: un control por semana (las visitas de la misma semana van juntas). */
export interface ControlAgendable {
  semana: number;
  ventana: Ventana;
  requiereLaboratorio: boolean;
  /** Estudios de la semana, sin repetir (para los pedidos; NO van a la tarea de Recepción). */
  estudios: string[];
}

export interface CalendarioGlp1 {
  semanasHastaTerapeutica: number;
  revision: { semana: number; fecha: string; criterio: string; antesDeConcluir: string[] };
  visitas: VisitaGlp1[];
  controles: ControlAgendable[];
}

export function calendarioGlp1(e: EntradaPlanGlp1): CalendarioGlp1 {
  const schedule = esquemaDeTitulacion(e);
  const plan = monitoringPlan({ hasRetinopathy: e.retinopatia, uacrMgG: e.uacrMgG, egfr: e.egfr }, schedule);
  const rev = responseReview(schedule);
  const semanas = [...new Set(plan.map((v) => v.weeks))].sort((a, b) => a - b);
  return {
    semanasHastaTerapeutica: weeksToTherapeuticDose(schedule),
    revision: {
      semana: rev.weeks,
      fecha: sumarDias(e.fechaInicio, rev.weeks * 7),
      criterio: rev.criterion,
      antesDeConcluir: rev.ifNotMet,
    },
    visitas: plan.map((v) => ({
      clave: claveVisita(v),
      semana: v.weeks,
      titulo: v.label,
      proposito: v.purpose,
      controles: v.checks,
      estudios: v.labs,
      ventana: ventanaDeSemana(e.fechaInicio, v.weeks),
    })),
    controles: semanas.map((semana) => {
      const estudios = labsForVisit(plan, semana);
      return { semana, ventana: ventanaDeSemana(e.fechaInicio, semana), requiereLaboratorio: estudios.length > 0, estudios };
    }),
  };
}

// ───────────────────────────── recursos FHIR ─────────────────────────────

function pacienteIdDe(ref: string): string {
  return ref.split('/')[1] ?? ref;
}

function etiquetaSemana(semana: number): string {
  return semana === 0 ? 'basal' : `semana ${semana}`;
}

/** Texto del esquema de titulación (plan, no receta). */
export function describirTitulacion(e: EntradaPlanGlp1, semanasHastaTerapeutica: number): string {
  const pasos = e.titulacion.map((s) =>
    s.terapeutica ? `${s.dosis.trim()} (dosis terapéutica)` : `${s.dosis.trim()} × ${s.semanas} sem`,
  );
  return `Titulación: ${pasos.join(' → ')}. Dosis terapéutica desde la semana ${semanasHastaTerapeutica}.`;
}

export function construirGoal(e: EntradaPlanGlp1, cal: CalendarioGlp1): Goal {
  const meta = e.pesoBasalKg
    ? {
        detailQuantity: {
          value: Math.round(e.pesoBasalKg * (1 - DESCENSO_MINIMO) * 10) / 10,
          comparator: '<=' as const,
          unit: 'kg',
          system: 'http://unitsofmeasure.org',
          code: 'kg',
        },
      }
    : { detailString: '≤ 95 % del peso basal' };
  return {
    resourceType: 'Goal',
    lifecycleStatus: 'active',
    identifier: [{ system: SYSTEM.programaGlp1, value: `${pacienteIdDe(e.pacienteRef)}:${e.fechaInicio}:meta-peso` }],
    description: {
      text: `Descenso de al menos 5 % del peso basal en la revisión de respuesta (semana ${cal.revision.semana}).`,
    },
    subject: { reference: e.pacienteRef },
    startDate: e.fechaInicio,
    target: [
      {
        measure: { coding: [{ system: LOINC, code: LOINC_PESO, display: 'Body weight' }] },
        ...meta,
        dueDate: cal.revision.fecha,
      },
    ],
    note: [{ text: cal.revision.criterio }],
  };
}

export function construirCarePlan(e: EntradaPlanGlp1, cal: CalendarioGlp1, goalRef: string, creado: string): CarePlan {
  const schedule = esquemaDeTitulacion(e);
  const medicacion: CarePlanActivity = {
    detail: {
      kind: 'MedicationRequest',
      status: 'in-progress',
      productCodeableConcept: { text: schedule.molecule },
      description: describirTitulacion(e, cal.semanasHastaTerapeutica),
    },
  };
  const visitas: CarePlanActivity[] = cal.visitas.map((v) => ({
    detail: {
      kind: 'Appointment',
      status: 'not-started',
      code: { text: v.titulo },
      scheduledPeriod: { start: v.ventana.desde, end: v.ventana.hasta },
      description:
        `${v.proposito} Controles: ${v.controles.join('; ')}.` +
        (v.estudios.length > 0 ? ` Estudios: ${v.estudios.join(', ')}.` : ''),
    },
  }));
  return {
    resourceType: 'CarePlan',
    status: 'active',
    intent: 'plan',
    identifier: [{ system: SYSTEM.programaGlp1, value: `${pacienteIdDe(e.pacienteRef)}:${e.fechaInicio}` }],
    instantiatesCanonical: [`${PLAN_GLP1_URL}|${PLAN_GLP1_VERSION}`],
    category: [{ coding: [{ system: SYSTEM.planCuidado, code: COD.seguimientoGlp1, display: 'Seguimiento de tratamiento GLP-1' }] }],
    title: `Seguimiento de tratamiento GLP-1 — ${indicationSummary(schedule.indication, schedule.molecule)}`,
    subject: { reference: e.pacienteRef },
    period: { start: e.fechaInicio },
    created: creado,
    goal: [{ reference: goalRef }],
    activity: [medicacion, ...visitas],
    note: [
      {
        text:
          `Revisión de respuesta en la semana ${cal.revision.semana} (desde el ${fmtDia(cal.revision.fecha)}): ` +
          `${cal.revision.criterio} Antes de concluir que no responde: ${cal.revision.antesDeConcluir.join(' ')}`,
      },
    ],
  };
}

/** Un pedido por estudio; los de la misma semana comparten `requisition`. */
export function construirPedidosLaboratorio(
  e: EntradaPlanGlp1,
  cal: CalendarioGlp1,
  carePlanId: string,
  ahora: string,
): ServiceRequest[] {
  return cal.controles.flatMap((c) =>
    c.estudios.map((slug) => ({
      resourceType: 'ServiceRequest' as const,
      status: 'active' as const,
      intent: 'order' as const,
      identifier: [{ system: SYSTEM.programaGlp1, value: `${carePlanId}:semana-${c.semana}:${slug}` }],
      requisition: { system: SYSTEM.programaGlp1, value: `${carePlanId}:semana-${c.semana}` },
      category: [{ coding: [{ system: SNOMED, code: SNOMED_LABORATORIO, display: 'Laboratory procedure' }] }],
      code: { coding: [{ system: SYSTEM.biomarcador, code: slug }], text: slug.replace(/-/g, ' ') },
      subject: { reference: e.pacienteRef },
      basedOn: [{ reference: `CarePlan/${carePlanId}` }],
      occurrencePeriod: { start: c.ventana.desde, end: c.ventana.hasta },
      authoredOn: ahora,
      note: [{ text: `Seguimiento GLP-1 · ${c.semana === 0 ? 'basal (antes de la primera aplicación)' : `semana ${c.semana}`}` }],
    })),
  );
}

/** "Control GLP-1 · basal" / "Control GLP-1 · semana 12". */
export function etiquetaControl(semana: number | undefined): string {
  return semana === undefined ? 'Control GLP-1' : `Control GLP-1 · ${etiquetaSemana(semana)}`;
}

/** Descripción de la tarea de Recepción: sin datos clínicos. */
export function descripcionTareaAgenda(c: ControlAgendable): string {
  return (
    `${etiquetaControl(c.semana)} · agendar entre el ${fmtDia(c.ventana.desde)} y el ${fmtDia(c.ventana.hasta)}` +
    (c.requiereLaboratorio ? ' · traer laboratorio' : '')
  );
}

/** Una tarea por semana con control: la ve Recepción en "Controles GLP-1". */
export function construirTareasAgenda(e: EntradaPlanGlp1, cal: CalendarioGlp1, carePlanId: string, ahora: string): Task[] {
  return cal.controles.map((c) => ({
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    identifier: [{ system: SYSTEM.programaGlp1, value: `${carePlanId}:semana-${c.semana}` }],
    code: { coding: [{ system: SYSTEM.taskTipo, code: COD.agendarControlGlp1 }], text: 'Agendar control GLP-1' },
    description: descripcionTareaAgenda(c),
    for: { reference: e.pacienteRef },
    basedOn: [{ reference: `CarePlan/${carePlanId}` }],
    authoredOn: ahora,
    restriction: { period: { start: c.ventana.desde, end: c.ventana.hasta } },
    input: [
      { type: { text: 'semana' }, valueInteger: c.semana },
      { type: { text: 'requiere-laboratorio' }, valueBoolean: c.requiereLaboratorio },
      { type: { text: 'servicio' }, valueString: CODIGO_CONTROL_GLP1 },
    ],
  }));
}

/** Tarea del equipo médico al inscribir: completar la indicación. */
export function construirTareaIndicacion(pacienteRef: string, ahora: string): Task {
  return {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    code: { coding: [{ system: SYSTEM.taskTipo, code: COD.indicacionGlp1 }], text: 'Completar indicación GLP-1' },
    description:
      'Seguimiento de tratamiento GLP-1: completar la indicación (molécula, indicación y esquema de titulación) ' +
      'para que el sistema arme el calendario de controles.',
    for: { reference: pacienteRef },
    authoredOn: ahora,
  };
}

// ───────────────────────────── sincronización (recalcular) ─────────────────────────────

type ConIdentifier = { id?: string; identifier?: Array<{ system?: string; value?: string }> };
export type EstadoRecurso = 'pendiente' | 'cerrado' | 'cancelado';

/** Clave de upsert de un recurso del programa (su identifier). */
export function claveDe(r: ConIdentifier): string | undefined {
  return r.identifier?.find((i) => i.system === SYSTEM.programaGlp1)?.value;
}

export interface PlanSincronizacion<T> {
  crear: T[];
  /** Con el contenido nuevo y el id del existente (pendientes que cambian o cancelados que vuelven). */
  actualizar: T[];
  /** Pendientes que ya no corresponden. */
  cancelar: T[];
  /** Ya cerrados (p. ej. control ya agendado) que cambiaron o ya no corresponden: revisar a mano. */
  aRevisar: T[];
}

/**
 * Qué hacer para llevar lo existente a lo deseado sin duplicar ni pisar lo ya
 * resuelto: crea lo nuevo, actualiza lo pendiente que cambió, cancela lo
 * pendiente que ya no va y NUNCA toca lo cerrado (lo informa para revisar).
 */
export function sincronizar<T extends ConIdentifier>(
  deseados: T[],
  existentes: T[],
  opts: { estado: (r: T) => EstadoRecurso; mismoContenido: (a: T, b: T) => boolean },
): PlanSincronizacion<T> {
  const porClave = new Map<string, T>();
  for (const r of existentes) {
    const k = claveDe(r);
    if (k) {
      porClave.set(k, r);
    }
  }
  const plan: PlanSincronizacion<T> = { crear: [], actualizar: [], cancelar: [], aRevisar: [] };
  const vistas = new Set<string>();
  for (const d of deseados) {
    const k = claveDe(d);
    const ex = k ? porClave.get(k) : undefined;
    if (k) {
      vistas.add(k);
    }
    if (!ex) {
      plan.crear.push(d);
      continue;
    }
    const estado = opts.estado(ex);
    if (estado === 'cancelado' || (estado === 'pendiente' && !opts.mismoContenido(ex, d))) {
      plan.actualizar.push({ ...d, id: ex.id });
    } else if (estado === 'cerrado' && !opts.mismoContenido(ex, d)) {
      plan.aRevisar.push(ex);
    }
  }
  for (const [k, ex] of porClave) {
    if (vistas.has(k)) {
      continue;
    }
    const estado = opts.estado(ex);
    if (estado === 'pendiente') {
      plan.cancelar.push(ex);
    } else if (estado === 'cerrado') {
      plan.aRevisar.push(ex);
    }
  }
  return plan;
}

export function estadoTarea(t: Task): EstadoRecurso {
  if (t.status === 'completed') {
    return 'cerrado';
  }
  return t.status === 'cancelled' || t.status === 'rejected' || t.status === 'failed' || t.status === 'entered-in-error'
    ? 'cancelado'
    : 'pendiente';
}

export function mismaVentanaTarea(a: Task, b: Task): boolean {
  const lab = (t: Task) => t.input?.find((i) => i.type?.text === 'requiere-laboratorio')?.valueBoolean;
  return (
    a.restriction?.period?.start === b.restriction?.period?.start &&
    a.restriction?.period?.end === b.restriction?.period?.end &&
    lab(a) === lab(b)
  );
}

export function estadoPedido(s: ServiceRequest): EstadoRecurso {
  if (s.status === 'completed') {
    return 'cerrado';
  }
  return s.status === 'revoked' || s.status === 'entered-in-error' ? 'cancelado' : 'pendiente';
}

export function mismoPeriodoPedido(a: ServiceRequest, b: ServiceRequest): boolean {
  return a.occurrencePeriod?.start === b.occurrencePeriod?.start && a.occurrencePeriod?.end === b.occurrencePeriod?.end;
}

// ───────────────────────────── agenda (R-19) ─────────────────────────────

const fmtFechaLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * R-19 · Un control del programa no se agenda antes de su ventana (la semana la
 * calcula el sistema; la revisión de respuesta no es interpretable antes) y, si
 * se agenda después, se advierte.
 */
export function validarVentanaControl(inicio: Date, ventana: Ventana): ResultadoValidacion {
  const dia = fmtFechaLocal.format(inicio);
  if (dia < ventana.desde) {
    return {
      ok: false,
      bloqueos: [
        { regla: 'R-19', nivel: 'bloqueo', mensaje: `Este control se agenda desde el ${fmtDia(ventana.desde)} (semana calculada por el programa).` },
      ],
      advertencias: [],
    };
  }
  if (dia > ventana.hasta) {
    return {
      ok: true,
      bloqueos: [],
      advertencias: [
        { regla: 'R-19', nivel: 'advertencia', mensaje: `Queda fuera de la ventana del control (hasta el ${fmtDia(ventana.hasta)}).` },
      ],
    };
  }
  return { ok: true, bloqueos: [], advertencias: [] };
}

/**
 * R-19 · El control GLP-1 se agenda solo desde su tarea ("Controles GLP-1"): así
 * cada turno queda atado a su semana del programa y se valida la ventana. El
 * resto de los servicios se reserva libremente.
 */
export function seAgendaSinTarea(servicioCodigo: string): boolean {
  return servicioCodigo !== CODIGO_CONTROL_GLP1;
}

/** R-19 · Bloquea el control GLP-1 reservado sin su tarea (ver `seAgendaSinTarea`). */
export function validarControlSinTarea(servicioCodigo: string): ResultadoValidacion {
  if (seAgendaSinTarea(servicioCodigo)) {
    return { ok: true, bloqueos: [], advertencias: [] };
  }
  return {
    ok: false,
    bloqueos: [
      {
        regla: 'R-19',
        nivel: 'bloqueo',
        mensaje: 'El control GLP-1 se agenda desde "Controles GLP-1": cada control está atado a su semana del programa.',
      },
    ],
    advertencias: [],
  };
}

/** Lo operativo de una tarea de control (lo único que ve Recepción). */
export interface DatosControl {
  semana?: number;
  ventana?: Ventana;
  requiereLaboratorio: boolean;
  /** Código del servicio con el que se agenda. */
  servicio?: string;
}

export function leerTareaControl(t: Task): DatosControl {
  const input = (nombre: string) => t.input?.find((i) => i.type?.text === nombre);
  const desde = t.restriction?.period?.start?.slice(0, 10);
  const hasta = t.restriction?.period?.end?.slice(0, 10);
  return {
    semana: input('semana')?.valueInteger,
    ventana: desde && hasta ? { desde, hasta } : undefined,
    requiereLaboratorio: input('requiere-laboratorio')?.valueBoolean === true,
    servicio: input('servicio')?.valueString,
  };
}

/**
 * ¿Esta tarea de Recepción se puede resolver con este turno? Devuelve la ventana
 * del control para validar la fecha (R-19).
 */
export function validarTareaAgenda(
  t: Task,
  opts: { pacienteRef: string; servicioCodigo: string },
): { ok: true; ventana: Ventana; requiereLaboratorio: boolean } | { ok: false; error: string } {
  const esControl = t.code?.coding?.some((c) => c.code === COD.agendarControlGlp1);
  if (!esControl) {
    return { ok: false, error: 'La tarea no es un control del programa GLP-1.' };
  }
  if (t.for?.reference !== opts.pacienteRef) {
    return { ok: false, error: 'La tarea es de otro paciente.' };
  }
  if (estadoTarea(t) !== 'pendiente') {
    return { ok: false, error: 'La tarea ya no está pendiente (ya se agendó o se canceló).' };
  }
  const datos = leerTareaControl(t);
  if (datos.servicio && datos.servicio !== opts.servicioCodigo) {
    return { ok: false, error: `Este control se agenda con el servicio ${datos.servicio}.` };
  }
  if (!datos.ventana) {
    return { ok: false, error: 'La tarea no tiene ventana de agenda.' };
  }
  return { ok: true, ventana: datos.ventana, requiereLaboratorio: datos.requiereLaboratorio };
}

// ───────────────────────────── vista de Recepción ─────────────────────────────

/** Día en Argentina ('AAAA-MM-DD') de un instante (Date o ISO). */
export function diaLocal(instante: Date | string): string {
  return fmtFechaLocal.format(typeof instante === 'string' ? new Date(instante) : instante);
}

/** Hoy en Argentina, 'AAAA-MM-DD'. */
export function hoyLocal(ahora: Date = new Date()): string {
  return diaLocal(ahora);
}

export type EstadoVentana = 'proxima' | 'abierta' | 'vencida';

/** Dónde está `hoy` ('AAAA-MM-DD') respecto de la ventana del control. */
export function estadoVentana(v: Ventana, hoy: string): EstadoVentana {
  if (hoy < v.desde) {
    return 'proxima';
  }
  return hoy > v.hasta ? 'vencida' : 'abierta';
}

/** Primer día en que se puede agendar el control: el inicio de la ventana, o hoy si ya empezó. */
export function fechaSugerida(v: Ventana, hoy: string): string {
  return hoy > v.desde ? hoy : v.desde;
}

/** Cola de Recepción: por inicio de ventana (lo más urgente primero) y, a igual fecha, por semana. */
export function ordenarControles(tareas: Task[]): Task[] {
  const clave = (t: Task) => leerTareaControl(t).ventana?.desde ?? '9999-12-31';
  return [...tareas].sort(
    (a, b) => clave(a).localeCompare(clave(b)) || (leerTareaControl(a).semana ?? 0) - (leerTareaControl(b).semana ?? 0),
  );
}

export type EstadoSeguimiento = 'sin-seguimiento' | 'esperando-indicacion' | 'por-agendar' | 'al-dia';

export interface ResumenSeguimiento {
  estado: EstadoSeguimiento;
  /** Controles por agendar, en orden. */
  pendientes: Task[];
  /** Controles ya agendados. */
  agendados: number;
}

/**
 * Estado del seguimiento de un paciente para la ficha de Recepción, a partir de
 * sus tareas (Recepción no lee el CarePlan): controles por agendar, esperando la
 * indicación del equipo médico, al día, o sin seguimiento.
 */
export function resumenSeguimiento(tareas: Task[]): ResumenSeguimiento {
  const esDe = (t: Task, codigo: string) => t.code?.coding?.some((c) => c.code === codigo) === true;
  const controles = tareas.filter((t) => esDe(t, COD.agendarControlGlp1));
  const pendientes = ordenarControles(controles.filter((t) => estadoTarea(t) === 'pendiente'));
  const agendados = controles.filter((t) => estadoTarea(t) === 'cerrado').length;
  const esperando = tareas.some((t) => esDe(t, COD.indicacionGlp1) && estadoTarea(t) === 'pendiente');
  const estado: EstadoSeguimiento =
    pendientes.length > 0 ? 'por-agendar' : esperando ? 'esperando-indicacion' : agendados > 0 ? 'al-dia' : 'sin-seguimiento';
  return { estado, pendientes, agendados };
}

// ───────────────────────────── plantilla (PlanDefinition) ─────────────────────────────

/**
 * Plantilla del programa para el catálogo. Las acciones salen del mismo
 * `monitoringPlan` (fuente única) con un esquema de referencia; la revisión de
 * respuesta se describe relativa a la dosis terapéutica.
 */
export function construirPlanDefinitionGlp1(activityDefinitionUrl: string): PlanDefinition {
  const referencia: TitrationSchedule = { indication: 'dm2', molecule: 'GLP-1', steps: [{ dose: '-', weeks: 0, therapeutic: true }] };
  const visitas = monitoringPlan({ hasRetinopathy: true, uacrMgG: 1 }, referencia);
  const condicion: Record<string, string> = {
    oftalmologia: ' Solo con retinopatía.',
    renal: ' Solo con albuminuria (UACR > 0) o eGFR < 60.',
  };
  const action: PlanDefinitionAction[] = visitas.map((v) => {
    const clave = claveVisita(v);
    const revision = clave === 'revision';
    return {
      id: clave,
      title: revision ? 'Revisión de respuesta (dosis terapéutica + 12 semanas)' : v.label,
      description: revision
        ? 'Decisión de continuar: 12 semanas después de llegar a dosis terapéutica, cuando el resultado ya es ' +
          'interpretable. La semana la calcula el sistema con el esquema de titulación de cada paciente.'
        : `${v.purpose}${condicion[clave] ?? ''}`,
      definitionCanonical: activityDefinitionUrl,
      ...(clave === 'basal' || revision
        ? {}
        : {
            relatedAction: [
              {
                actionId: 'basal',
                relationship: 'after-start' as const,
                offsetDuration: { value: v.weeks, unit: 'semanas', system: 'http://unitsofmeasure.org', code: 'wk' },
              },
            ],
          }),
    };
  });
  return {
    resourceType: 'PlanDefinition',
    url: PLAN_GLP1_URL,
    version: PLAN_GLP1_VERSION,
    name: 'SeguimientoGLP1',
    title: 'Programa de seguimiento de tratamiento GLP-1',
    status: 'active',
    type: {
      coding: [
        { system: 'http://terminology.hl7.org/CodeSystem/plan-definition-type', code: 'clinical-protocol', display: 'Clinical Protocol' },
      ],
    },
    description:
      'Controles de seguridad y de respuesta de un tratamiento con GLP-1. La revisión de respuesta cae 12 semanas ' +
      'después de alcanzar la dosis terapéutica: el calendario de cada paciente lo arma el bot som-glp1-plan con su ' +
      'esquema de titulación.',
    action,
  };
}
