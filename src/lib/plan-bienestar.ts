/**
 * Plan Bienestar 100 Días® — programa (lógica pura, sin red).
 *
 * El portal del paciente (`EPA-Developments/app`, `src/fhir/bienestar.ts`) muestra la
 * tarjeta de progreso (día X/100, hitos, racha semanal) calculada client-side. Detecta
 * la inscripción por un `CarePlan` activo con category `care-plans|plan-bienestar-100`
 * y `period` de 100 días: ese contrato no cambia.
 *
 * La interacción prefijada del plan (`src/config/plan-bienestar.ts`) son tres consultas
 * programadas, incluidas en el plan. El sistema arma:
 *  - el `CarePlan`, con una actividad por consulta (fecha y ventana) e
 *    `instantiatesCanonical` a la plantilla `PlanDefinition/plan-bienestar-100`;
 *  - una `Task` por consulta para Recepción (`agendar-consulta-pb100d`), sin datos
 *    clínicos: qué consulta es y entre qué fechas se agenda.
 * El día 1 es el de la consulta inicial: al agendarla, el plan se corre a esa fecha y
 * las otras dos se recalculan (R-20). Recepción nunca calcula fechas.
 *
 * Cobro del plan: PENDIENTE (lista de precios SOM). Inscribir no cobra.
 */
import type { CarePlan, CarePlanActivity, PlanDefinition, PlanDefinitionAction, Task } from '@medplum/fhirtypes';
import { CODIGO_CONSULTA_PB100D } from '../config/catalogo.js';
import {
  CONSULTAS_PLAN_BIENESTAR,
  NOMBRE_PLAN_BIENESTAR,
  type ClaveConsultaPlan,
} from '../config/plan-bienestar.js';
import { TOLERANCIA_CONSULTA_PB100D_DIAS } from '../config/reglas.js';
import { COD, PLAN_BIENESTAR_URL, PLAN_BIENESTAR_VERSION, SYSTEM, urlServicio } from '../fhir/identifiers.js';
import { claveDe, diaLocal, estadoTarea, fmtDia, sumarDias, type EstadoRecurso, type Ventana } from './programas.js';
import type { ResultadoValidacion } from './reglas-turno.js';

export { sumarDias } from './programas.js';

/** Duración del plan (contrato con el portal: `period.end = start + 100 días`). */
export const DIAS_PLAN_BIENESTAR = 100;

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha `YYYY-MM-DD` válida? */
export function esFechaValida(fecha: string | undefined): fecha is string {
  if (!fecha || !RE_FECHA.test(fecha)) {
    return false;
  }
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/** Período del plan: día 1 = `inicio`; fin = inicio + 100 días. */
export function periodoPlanBienestar(inicio: string): { start: string; end: string } {
  return { start: inicio, end: sumarDias(inicio, DIAS_PLAN_BIENESTAR) };
}

// ───────────────────────────── calendario ─────────────────────────────

export interface ConsultaCalendario {
  clave: ClaveConsultaPlan;
  /** Día del plan. */
  dia: number;
  titulo: string;
  /** Fecha objetivo ('AAAA-MM-DD'). */
  fecha: string;
  /** Ventana para agendar (R-20). La inicial no tiene: su fecha define el día 1. */
  ventana?: Ventana;
}

/** Las tres consultas del plan con su fecha y su ventana, para un día 1 dado. */
export function calendarioPlanBienestar(inicio: string): ConsultaCalendario[] {
  return CONSULTAS_PLAN_BIENESTAR.map((c) => {
    const fecha = sumarDias(inicio, c.dia - 1);
    if (c.clave === 'inicial') {
      return { ...c, fecha };
    }
    return {
      ...c,
      fecha,
      ventana: {
        desde: sumarDias(fecha, -TOLERANCIA_CONSULTA_PB100D_DIAS),
        hasta: sumarDias(fecha, TOLERANCIA_CONSULTA_PB100D_DIAS),
      },
    };
  });
}

/** "Consulta del día 50 del Plan Bienestar 100 Días®". */
export function tituloConsultaPlan(titulo: string): string {
  return `${titulo} del ${NOMBRE_PLAN_BIENESTAR}`;
}

function textoAgenda(c: Pick<ConsultaCalendario, 'clave' | 'ventana'>): string {
  return c.ventana
    ? `agendar entre el ${fmtDia(c.ventana.desde)} y el ${fmtDia(c.ventana.hasta)}`
    : 'agendar cuanto antes: su fecha marca el día 1 del plan';
}

// ───────────────────────────── CarePlan ─────────────────────────────

type EstadoActividad = NonNullable<CarePlanActivity['detail']>['status'];

function codigoConsulta(clave: ClaveConsultaPlan, titulo: string) {
  return { coding: [{ system: SYSTEM.consultaPlanBienestar, code: clave, display: titulo }], text: titulo };
}

/** Clave de la consulta programada de una actividad del plan (undefined en las demás). */
export function claveDeActividad(a: CarePlanActivity): ClaveConsultaPlan | undefined {
  const code = a.detail?.code?.coding?.find((c) => c.system === SYSTEM.consultaPlanBienestar)?.code;
  return CONSULTAS_PLAN_BIENESTAR.find((c) => c.clave === code)?.clave;
}

function actividadConsulta(c: ConsultaCalendario, status: EstadoActividad = 'not-started'): CarePlanActivity {
  return {
    detail: {
      kind: 'Appointment',
      instantiatesCanonical: [urlServicio(CODIGO_CONSULTA_PB100D)],
      code: codigoConsulta(c.clave, c.titulo),
      status,
      scheduledPeriod: c.ventana ? { start: c.ventana.desde, end: c.ventana.hasta } : { start: c.fecha },
      description: `Día ${c.dia} del plan. Incluida en el plan (sin cargo). Presencial o teleconsulta.`,
    },
  };
}

/** CarePlan de inscripción al Plan Bienestar (el shape que lee el portal + las consultas). */
export function construirCarePlanBienestar(pacienteRef: string, inicio: string, ahora = new Date()): CarePlan {
  return {
    resourceType: 'CarePlan',
    status: 'active',
    intent: 'plan',
    instantiatesCanonical: [`${PLAN_BIENESTAR_URL}|${PLAN_BIENESTAR_VERSION}`],
    category: [
      {
        coding: [{ system: SYSTEM.planCuidado, code: COD.planBienestar100, display: NOMBRE_PLAN_BIENESTAR }],
        text: NOMBRE_PLAN_BIENESTAR,
      },
    ],
    title: NOMBRE_PLAN_BIENESTAR,
    subject: { reference: pacienteRef },
    period: periodoPlanBienestar(inicio),
    created: ahora.toISOString(),
    activity: calendarioPlanBienestar(inicio).map((c) => actividadConsulta(c)),
  };
}

/**
 * El plan después de agendar una de sus consultas (R-20): la actividad queda
 * `scheduled` y, si es la inicial, el plan se corre a su fecha (nuevo día 1) y las
 * otras dos consultas se recalculan. Conserva el estado de las demás actividades y
 * las que no son consultas programadas (p. ej. consultas extra ligadas al plan).
 */
export function planTrasAgendar(cp: CarePlan, clave: ClaveConsultaPlan, fechaConsulta: string): CarePlan {
  const inicio = clave === 'inicial' ? fechaConsulta : (cp.period?.start?.slice(0, 10) ?? fechaConsulta);
  const estados = new Map<ClaveConsultaPlan, EstadoActividad>();
  for (const a of cp.activity ?? []) {
    const k = claveDeActividad(a);
    if (k && a.detail?.status) {
      estados.set(k, a.detail.status);
    }
  }
  estados.set(clave, 'scheduled');
  const programadas = calendarioPlanBienestar(inicio).map((c) => actividadConsulta(c, estados.get(c.clave)));
  const otras = (cp.activity ?? []).filter((a) => !claveDeActividad(a));
  return { ...cp, period: periodoPlanBienestar(inicio), activity: [...programadas, ...otras] };
}

/** Marca la actividad de una consulta del plan (p. ej. `completed` al terminar la visita). */
export function marcarActividad(cp: CarePlan, clave: ClaveConsultaPlan, status: EstadoActividad): CarePlan {
  return {
    ...cp,
    activity: (cp.activity ?? []).map((a) =>
      claveDeActividad(a) === clave && a.detail ? { ...a, detail: { ...a.detail, status } } : a,
    ),
  };
}

/** Suma al plan una consulta extra (con cargo) como actividad que referencia el turno. */
export function sumarConsultaExtra(cp: CarePlan, appointmentId: string, nombre: string): CarePlan {
  const ref = `Appointment/${appointmentId}`;
  if ((cp.activity ?? []).some((a) => a.reference?.reference === ref)) {
    return cp;
  }
  return { ...cp, activity: [...(cp.activity ?? []), { reference: { reference: ref, display: nombre } }] };
}

/** ¿El día ('AAAA-MM-DD') cae dentro del período del plan? */
export function dentroDelPlan(cp: CarePlan, dia: string): boolean {
  const desde = cp.period?.start?.slice(0, 10);
  const hasta = cp.period?.end?.slice(0, 10);
  return Boolean(desde && dia >= desde && (!hasta || dia <= hasta));
}

// ───────────────────────────── tareas de Recepción ─────────────────────────────

/** Descripción de la tarea de Recepción: sin datos clínicos. */
export function descripcionTareaConsulta(c: ConsultaCalendario): string {
  return `${NOMBRE_PLAN_BIENESTAR} · ${c.titulo} (día ${c.dia}) · ${textoAgenda(c)}`;
}

/** Una tarea por consulta programada: la ve Recepción en la ficha del paciente. */
export function construirTareasPlanBienestar(
  pacienteRef: string,
  carePlanId: string,
  calendario: ConsultaCalendario[],
  ahora: string,
): Task[] {
  return calendario.map((c) => ({
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    identifier: [{ system: SYSTEM.programaBienestar, value: `${carePlanId}:${c.clave}` }],
    code: {
      coding: [{ system: SYSTEM.taskTipo, code: COD.agendarConsultaPb100d }],
      text: `Agendar consulta del ${NOMBRE_PLAN_BIENESTAR}`,
    },
    description: descripcionTareaConsulta(c),
    for: { reference: pacienteRef },
    basedOn: [{ reference: `CarePlan/${carePlanId}` }],
    authoredOn: ahora,
    restriction: { period: c.ventana ? { start: c.ventana.desde, end: c.ventana.hasta } : { start: c.fecha } },
    input: [
      { type: { text: 'consulta' }, valueCode: c.clave },
      { type: { text: 'dia' }, valueInteger: c.dia },
      { type: { text: 'servicio' }, valueString: CODIGO_CONSULTA_PB100D },
    ],
  }));
}

export function esTareaConsultaPlan(t: Task): boolean {
  return t.code?.coding?.some((c) => c.code === COD.agendarConsultaPb100d) === true;
}

/** Clave de upsert de una tarea del plan (`{carePlanId}:{consulta}`). */
export function claveTareaPlan(t: Task): string | undefined {
  return claveDe(t, SYSTEM.programaBienestar);
}

/** Lo operativo de una tarea de consulta del plan (lo único que ve Recepción). */
export interface DatosConsultaPlan {
  clave?: ClaveConsultaPlan;
  dia?: number;
  titulo?: string;
  /** Desde cuándo se agenda ('AAAA-MM-DD'). */
  desde?: string;
  /** Ventana (la del día 50 y la final). */
  ventana?: Ventana;
  /** Código del servicio con el que se agenda. */
  servicio?: string;
  /** CarePlan del plan ("CarePlan/…"). */
  carePlanRef?: string;
}

export function leerTareaConsultaPlan(t: Task): DatosConsultaPlan {
  const input = (nombre: string) => t.input?.find((i) => i.type?.text === nombre);
  const clave = CONSULTAS_PLAN_BIENESTAR.find((c) => c.clave === input('consulta')?.valueCode);
  const desde = t.restriction?.period?.start?.slice(0, 10);
  const hasta = t.restriction?.period?.end?.slice(0, 10);
  return {
    clave: clave?.clave,
    dia: input('dia')?.valueInteger ?? clave?.dia,
    titulo: clave?.titulo,
    desde,
    ventana: desde && hasta ? { desde, hasta } : undefined,
    servicio: input('servicio')?.valueString,
    carePlanRef: t.basedOn?.find((b) => b.reference?.startsWith('CarePlan/'))?.reference,
  };
}

/** Tareas que faltan para completar las del plan (no toca las existentes). */
export function tareasFaltantes(deseadas: Task[], existentes: Task[]): Task[] {
  const ya = new Set(existentes.map(claveTareaPlan).filter(Boolean));
  return deseadas.filter((t) => !ya.has(claveTareaPlan(t)));
}

/**
 * Tareas pendientes de la consulta del día 50 y la final a actualizar tras correr el
 * plan (R-20). Las ya agendadas no se tocan.
 */
export function tareasARecalcular(existentes: Task[], deseadas: Task[]): Task[] {
  const porClave = new Map(deseadas.map((t) => [claveTareaPlan(t), t]));
  const cambios: Task[] = [];
  for (const ex of existentes) {
    const d = porClave.get(claveTareaPlan(ex));
    if (!d || leerTareaConsultaPlan(ex).clave === 'inicial' || estadoTarea(ex) !== 'pendiente') {
      continue;
    }
    const mismaVentana =
      ex.restriction?.period?.start === d.restriction?.period?.start && ex.restriction?.period?.end === d.restriction?.period?.end;
    if (!mismaVentana) {
      cambios.push({ ...ex, restriction: d.restriction, description: d.description, lastModified: d.authoredOn });
    }
  }
  return cambios;
}

// ───────────────────────────── agenda (R-20) ─────────────────────────────

const ok = (): ResultadoValidacion => ({ ok: true, bloqueos: [], advertencias: [] });
const bloqueo = (mensaje: string): ResultadoValidacion => ({
  ok: false,
  bloqueos: [{ regla: 'R-20', nivel: 'bloqueo', mensaje }],
  advertencias: [],
});

/**
 * R-20 · La consulta del día 50 y la final no se agendan antes de su ventana
 * (bloqueo) y, si se agendan después, se advierte. La inicial no tiene ventana.
 */
export function validarVentanaConsultaPlan(inicio: Date, datos: Pick<DatosConsultaPlan, 'titulo' | 'ventana'>): ResultadoValidacion {
  const v = datos.ventana;
  if (!v) {
    return ok();
  }
  const dia = diaLocal(inicio);
  const titulo = datos.titulo ?? 'La consulta';
  if (dia < v.desde) {
    return bloqueo(`${titulo} se agenda desde el ${fmtDia(v.desde)} (entre el ${fmtDia(v.desde)} y el ${fmtDia(v.hasta)}).`);
  }
  if (dia > v.hasta) {
    return {
      ok: true,
      bloqueos: [],
      advertencias: [{ regla: 'R-20', nivel: 'advertencia', mensaje: `Queda fuera de la ventana de la consulta (hasta el ${fmtDia(v.hasta)}).` }],
    };
  }
  return ok();
}

/** R-20 · La consulta del plan se agenda solo desde su tarea (queda atada a su día del plan). */
export function validarConsultaPlanSinTarea(servicioCodigo: string): ResultadoValidacion {
  return servicioCodigo === CODIGO_CONSULTA_PB100D
    ? bloqueo(`La consulta del ${NOMBRE_PLAN_BIENESTAR} se agenda desde el plan del paciente: cada una está atada a su día del plan.`)
    : ok();
}

/**
 * ¿Esta tarea se puede resolver con este turno? (R-20). La del día 50 y la final
 * esperan a que esté agendada la inicial, que define el día 1.
 */
export function validarTareaConsultaPlan(
  t: Task,
  opts: { pacienteRef: string; servicioCodigo: string; inicialAgendada: boolean },
): { ok: true; datos: DatosConsultaPlan } | { ok: false; error: string } {
  if (!esTareaConsultaPlan(t)) {
    return { ok: false, error: `La tarea no es una consulta del ${NOMBRE_PLAN_BIENESTAR}.` };
  }
  if (t.for?.reference !== opts.pacienteRef) {
    return { ok: false, error: 'La tarea es de otro paciente.' };
  }
  if (estadoTarea(t) !== 'pendiente') {
    return { ok: false, error: 'La tarea ya no está pendiente (ya se agendó o se canceló).' };
  }
  const datos = leerTareaConsultaPlan(t);
  if (!datos.clave) {
    return { ok: false, error: 'La tarea no indica qué consulta del plan es.' };
  }
  if (datos.servicio && datos.servicio !== opts.servicioCodigo) {
    return { ok: false, error: `Esta consulta se agenda con el servicio ${datos.servicio}.` };
  }
  if (datos.clave !== 'inicial' && !opts.inicialAgendada) {
    return { ok: false, error: 'Primero se agenda la consulta inicial: su fecha marca el día 1 del plan.' };
  }
  return { ok: true, datos };
}

// ───────────────────────────── vista de Recepción ─────────────────────────────

export interface ConsultaPlanVista {
  taskId?: string;
  clave: ClaveConsultaPlan;
  titulo: string;
  dia: number;
  estado: EstadoRecurso;
  desde?: string;
  ventana?: Ventana;
}

export interface ResumenPlanBienestar {
  /** `sin-plan`: sin tareas del plan · `por-agendar`: alguna pendiente · `al-dia`: todas agendadas o cerradas. */
  estado: 'sin-plan' | 'por-agendar' | 'al-dia';
  consultas: ConsultaPlanVista[];
}

/**
 * Estado del plan para la ficha de Recepción, a partir de sus tareas (Recepción no lee
 * el CarePlan): las tres consultas, en orden, con su estado y su ventana. Si hay
 * tareas de más de un plan, usa las del plan más reciente.
 */
export function resumenPlanBienestar(tareas: Task[]): ResumenPlanBienestar {
  const propias = tareas.filter(esTareaConsultaPlan);
  if (propias.length === 0) {
    return { estado: 'sin-plan', consultas: [] };
  }
  const reciente = [...propias].sort((a, b) => (b.authoredOn ?? '').localeCompare(a.authoredOn ?? ''))[0]!;
  const plan = leerTareaConsultaPlan(reciente).carePlanRef;
  const delPlan = propias.filter((t) => leerTareaConsultaPlan(t).carePlanRef === plan);
  const consultas: ConsultaPlanVista[] = [];
  for (const def of CONSULTAS_PLAN_BIENESTAR) {
    const t = delPlan.find((x) => leerTareaConsultaPlan(x).clave === def.clave);
    if (!t) {
      continue;
    }
    const d = leerTareaConsultaPlan(t);
    consultas.push({
      taskId: t.id,
      clave: def.clave,
      titulo: def.titulo,
      dia: def.dia,
      estado: estadoTarea(t),
      desde: d.desde,
      ventana: d.ventana,
    });
  }
  return { estado: consultas.some((c) => c.estado === 'pendiente') ? 'por-agendar' : 'al-dia', consultas };
}

// ───────────────────────────── plantilla (PlanDefinition) ─────────────────────────────

/**
 * Plantilla del plan para el catálogo: las tres consultas programadas, con el
 * desfasaje de la del día 50 y la final respecto de la inicial (± la tolerancia de
 * R-20). Cada consulta se agenda con el servicio `CONSULTA_PB100D`.
 */
export function construirPlanDefinitionBienestar(): PlanDefinition {
  const ucum = (value: number) => ({ value, unit: 'días', system: 'http://unitsofmeasure.org', code: 'd' });
  const action: PlanDefinitionAction[] = CONSULTAS_PLAN_BIENESTAR.map((c) => {
    const offset = c.dia - 1;
    return {
      id: c.clave,
      title: c.titulo,
      description:
        c.clave === 'inicial'
          ? 'Día 1 del plan: su fecha marca el inicio. Incluida en el plan; presencial o teleconsulta.'
          : `Día ${c.dia} del plan, ± ${TOLERANCIA_CONSULTA_PB100D_DIAS} días. Incluida en el plan; presencial o teleconsulta.`,
      code: [codigoConsulta(c.clave, c.titulo)],
      definitionCanonical: urlServicio(CODIGO_CONSULTA_PB100D),
      ...(c.clave === 'inicial'
        ? {}
        : {
            relatedAction: [
              {
                actionId: 'inicial',
                relationship: 'after-start' as const,
                offsetRange: {
                  low: ucum(offset - TOLERANCIA_CONSULTA_PB100D_DIAS),
                  high: ucum(offset + TOLERANCIA_CONSULTA_PB100D_DIAS),
                },
              },
            ],
          }),
    };
  });
  return {
    resourceType: 'PlanDefinition',
    url: PLAN_BIENESTAR_URL,
    version: PLAN_BIENESTAR_VERSION,
    name: 'PlanBienestar100Dias',
    title: NOMBRE_PLAN_BIENESTAR,
    status: 'active',
    publisher: 'Segunda Opinión Médica',
    copyright: `${NOMBRE_PLAN_BIENESTAR} es marca registrada del Dr. Alejandro Sergio D'Alessandro.`,
    type: {
      coding: [
        { system: 'http://terminology.hl7.org/CodeSystem/plan-definition-type', code: 'clinical-protocol', display: 'Clinical Protocol' },
      ],
    },
    description:
      `Programa de ${DIAS_PLAN_BIENESTAR} días con tres consultas programadas incluidas (días 1, 50 y 100), presenciales ` +
      'o por teleconsulta. El día 1 es el de la consulta inicial. Las consultas fuera de lo programado son las de ' +
      'especialidad del catálogo, con cargo.',
    action,
  };
}
