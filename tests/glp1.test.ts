import { describe, it, expect } from 'vitest';
import type { Task } from '@medplum/fhirtypes';
import { labsForVisit, monitoringPlan, responseReview } from '../src/lib/glp1/monitoring.js';
import { weeksToTherapeuticDose, type TitrationSchedule } from '../src/lib/glp1/titration.js';
import {
  calendarioGlp1,
  construirCarePlan,
  construirGoal,
  construirPedidosLaboratorio,
  construirPlanDefinitionGlp1,
  construirTareaIndicacion,
  construirTareasAgenda,
  diaLocal,
  estadoTarea,
  estadoVentana,
  fechaSugerida,
  hoyLocal,
  leerTareaControl,
  mismaVentanaTarea,
  ordenarControles,
  resumenSeguimiento,
  sincronizar,
  validarControlSinTarea,
  validarEntradaGlp1,
  validarTareaAgenda,
  validarVentanaControl,
  type EntradaPlanGlp1,
} from '../src/lib/glp1-plan.js';
import { COD, PLAN_GLP1_URL, SYSTEM } from '../src/fhir/identifiers.js';

/** Semaglutida en control de peso: 4 escalones de 4 semanas → dosis terapéutica en la semana 16. */
const PESO: EntradaPlanGlp1 = {
  pacienteRef: 'Patient/p1',
  fechaInicio: '2026-10-05',
  molecula: 'Semaglutida',
  indicacion: 'peso',
  titulacion: [
    { dosis: '0,25 mg semanal', semanas: 4 },
    { dosis: '0,5 mg semanal', semanas: 4 },
    { dosis: '1 mg semanal', semanas: 4 },
    { dosis: '1,7 mg semanal', semanas: 4 },
    { dosis: '2,4 mg semanal', semanas: 0, terapeutica: true },
  ],
};

/** DM2: dosis terapéutica en la semana 8 → revisión en la semana 20. */
const DM2: EntradaPlanGlp1 = {
  ...PESO,
  indicacion: 'dm2',
  titulacion: [
    { dosis: '0,25 mg semanal', semanas: 4 },
    { dosis: '0,5 mg semanal', semanas: 4 },
    { dosis: '1 mg semanal', semanas: 0, terapeutica: true },
  ],
};

function esquema(e: EntradaPlanGlp1): TitrationSchedule {
  return {
    indication: e.indicacion === 'dm2' ? 'dm2' : 'weight',
    molecule: e.molecula,
    steps: e.titulacion.map((s) => ({ dose: s.dosis, weeks: s.semanas, therapeutic: s.terapeutica })),
  };
}

describe('GLP-1 · módulo compartido (monitoring / titration)', () => {
  it('La revisión de respuesta cae 12 semanas después de la dosis terapéutica, no en una semana fija', () => {
    expect(weeksToTherapeuticDose(esquema(PESO))).toBe(16);
    expect(responseReview(esquema(PESO)).weeks).toBe(28);
    expect(responseReview(esquema(DM2)).weeks).toBe(20);
    expect(monitoringPlan({}, esquema(PESO)).map((v) => v.weeks)).toEqual([0, 4, 12, 26, 28]);
  });

  it('Con DM2 la semana 12 pide HbA1c y glucemia; en control de peso, no', () => {
    expect(labsForVisit(monitoringPlan({}, esquema(DM2)), 12)).toEqual(['hba1c', 'glucosa-en-ayunas']);
    expect(labsForVisit(monitoringPlan({}, esquema(PESO)), 12)).toEqual([]);
  });

  it('Retinopatía y enfermedad renal suman controles; los estudios de la misma semana no se repiten', () => {
    const plan = monitoringPlan({ hasRetinopathy: true, egfr: 45 }, esquema(PESO));
    expect(plan.map((v) => v.label)).toContain('Semana 12 · oftalmología');
    expect(plan.map((v) => v.label)).toContain('Semana 26 · función renal');
    const s26 = labsForVisit(plan, 26);
    expect(s26.filter((l) => l === 'creatinina')).toHaveLength(1);
  });

  it('Sin dosis terapéutica marcada no hay calendario', () => {
    expect(() => weeksToTherapeuticDose({ indication: 'weight', molecule: 'x', steps: [{ dose: '1', weeks: 4 }] })).toThrow();
  });
});

describe('GLP-1 · validación de la indicación', () => {
  it('Acepta una indicación completa', () => {
    expect(validarEntradaGlp1(PESO).ok).toBe(true);
  });

  it('Rechaza fechas imposibles, titulación sin (o con dos) dosis terapéutica e indicación desconocida', () => {
    expect(validarEntradaGlp1({ ...PESO, fechaInicio: '2026-02-30' }).ok).toBe(false);
    expect(validarEntradaGlp1({ ...PESO, titulacion: [{ dosis: '1 mg', semanas: 4 }] }).ok).toBe(false);
    expect(
      validarEntradaGlp1({
        ...PESO,
        titulacion: [
          { dosis: '1 mg', semanas: 4, terapeutica: true },
          { dosis: '2 mg', semanas: 4, terapeutica: true },
        ],
      }).ok,
    ).toBe(false);
    expect(validarEntradaGlp1({ ...PESO, indicacion: 'obesidad' as never }).ok).toBe(false);
    expect(validarEntradaGlp1({ ...PESO, titulacion: [{ dosis: '1 mg', semanas: -1, terapeutica: true }] }).ok).toBe(false);
  });
});

describe('GLP-1 · calendario y ventanas (R-19)', () => {
  const cal = calendarioGlp1(PESO);

  it('Un control agendable por semana; el basal en los 7 días previos al inicio', () => {
    expect(cal.controles.map((c) => c.semana)).toEqual([0, 4, 12, 26, 28]);
    expect(cal.controles[0]?.ventana).toEqual({ desde: '2026-09-28', hasta: '2026-10-05' });
    expect(cal.controles[1]?.ventana).toEqual({ desde: '2026-11-02', hasta: '2026-11-09' });
    expect(cal.revision).toMatchObject({ semana: 28, fecha: '2027-04-19' });
  });

  it('Claves de visita estables y únicas (la revisión no depende de su semana)', () => {
    const conTodo = calendarioGlp1({ ...PESO, retinopatia: true, uacrMgG: 45 });
    const claves = conTodo.visitas.map((v) => v.clave);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves).toEqual(['basal', 'semana-4', 'semana-12', 'oftalmologia', 'semana-26', 'renal', 'revision']);
  });

  it('R-19: antes de la ventana bloquea, dentro pasa, después advierte (en hora de Argentina)', () => {
    const v = { desde: '2026-11-02', hasta: '2026-11-09' };
    // 23:30 del 1/11 en Argentina ya es 2/11 en UTC: igual bloquea.
    expect(validarVentanaControl(new Date('2026-11-01T23:30:00-03:00'), v).bloqueos[0]?.regla).toBe('R-19');
    expect(validarVentanaControl(new Date('2026-11-02T09:00:00-03:00'), v)).toMatchObject({ ok: true, advertencias: [] });
    expect(validarVentanaControl(new Date('2026-11-12T09:00:00-03:00'), v).advertencias).toHaveLength(1);
  });
});

describe('GLP-1 · recursos FHIR del programa', () => {
  const cal = calendarioGlp1(DM2);
  const ahora = '2026-09-23T12:00:00.000Z';

  it('Tareas de Recepción: una por semana, con ventana y sin datos clínicos', () => {
    const tareas = construirTareasAgenda(DM2, cal, 'cp1', ahora);
    expect(tareas.map((t) => t.identifier?.[0]?.value)).toEqual([
      'cp1:semana-0',
      'cp1:semana-4',
      'cp1:semana-12',
      'cp1:semana-20',
      'cp1:semana-26',
    ]);
    const s12 = tareas[2]!;
    expect(s12.code?.coding?.[0]).toEqual({ system: SYSTEM.taskTipo, code: COD.agendarControlGlp1 });
    expect(s12.restriction?.period).toEqual({ start: '2026-12-28', end: '2027-01-04' });
    expect(s12.description).toBe('Control GLP-1 · semana 12 · agendar entre el 28/12/2026 y el 04/01/2027 · traer laboratorio');
    for (const t of tareas) {
      expect(t.description).not.toMatch(/semaglutida|hba1c|glucosa|mg/i);
    }
    expect(tareas[1]?.input?.find((i) => i.type?.text === 'requiere-laboratorio')?.valueBoolean).toBe(false);
  });

  it('Pedidos de laboratorio: uno por estudio, agrupados por semana', () => {
    const pedidos = construirPedidosLaboratorio(DM2, cal, 'cp1', ahora);
    const s12 = pedidos.filter((p) => p.requisition?.value === 'cp1:semana-12');
    expect(s12.map((p) => p.code?.coding?.[0]?.code)).toEqual(['hba1c', 'glucosa-en-ayunas']);
    expect(s12[0]?.code?.coding?.[0]?.system).toBe(SYSTEM.biomarcador);
    expect(s12[0]?.occurrencePeriod).toEqual({ start: '2026-12-28', end: '2027-01-04' });
    expect(pedidos.every((p) => p.basedOn?.[0]?.reference === 'CarePlan/cp1')).toBe(true);
  });

  it('Meta: 5 % del peso basal para la semana de revisión (en kg si hay peso basal)', () => {
    const g = construirGoal({ ...DM2, pesoBasalKg: 100 }, cal);
    expect(g.target?.[0]?.dueDate).toBe('2027-02-22');
    expect(g.target?.[0]?.detailQuantity).toMatchObject({ value: 95, comparator: '<=', unit: 'kg' });
    expect(construirGoal(DM2, cal).target?.[0]?.detailString).toBeTruthy();
  });

  it('CarePlan: instancia la plantilla, esquema de titulación + visitas', () => {
    const cp = construirCarePlan(DM2, cal, 'Goal/g1', ahora);
    expect(cp.instantiatesCanonical?.[0]).toBe(`${PLAN_GLP1_URL}|1`);
    expect(cp.category?.[0]?.coding?.[0]?.code).toBe(COD.seguimientoGlp1);
    expect(cp.activity?.[0]?.detail?.description).toBe(
      'Titulación: 0,25 mg semanal × 4 sem → 0,5 mg semanal × 4 sem → 1 mg semanal (dosis terapéutica). Dosis terapéutica desde la semana 8.',
    );
    expect(cp.activity).toHaveLength(1 + cal.visitas.length);
    expect(cp.note?.[0]?.text).toContain('semana 20');
  });

  it('Plantilla del catálogo: acciones del mismo calendario, revisión relativa a la dosis terapéutica', () => {
    const pd = construirPlanDefinitionGlp1('https://x/ActivityDefinition/CONTROL_GLP1');
    expect(pd.url).toBe(PLAN_GLP1_URL);
    expect(pd.action?.map((a) => a.id)).toEqual(['basal', 'semana-4', 'semana-12', 'revision', 'oftalmologia', 'semana-26', 'renal']);
    const s4 = pd.action?.find((a) => a.id === 'semana-4');
    expect(s4?.relatedAction?.[0]?.offsetDuration?.value).toBe(4);
    expect(pd.action?.find((a) => a.id === 'revision')?.relatedAction).toBeUndefined();
    expect(pd.action?.find((a) => a.id === 'revision')?.description).not.toMatch(/semana 0/);
  });
});

describe('GLP-1 · sincronización al recalcular', () => {
  const tarea = (clave: string, status: Task['status'], desde: string): Task => ({
    resourceType: 'Task',
    id: `t-${clave}`,
    status,
    intent: 'order',
    identifier: [{ system: SYSTEM.programaGlp1, value: clave }],
    restriction: { period: { start: desde, end: desde } },
  });

  it('Crea lo nuevo, actualiza lo pendiente que cambió, cancela lo que ya no va y nunca toca lo agendado', () => {
    const existentes = [
      tarea('cp:semana-4', 'requested', '2026-11-02'), // igual → nada
      tarea('cp:semana-20', 'requested', '2027-02-22'), // la revisión se movió → cancelar
      tarea('cp:semana-12', 'completed', '2026-12-28'), // ya agendado y cambió → revisar
      tarea('cp:semana-26', 'cancelled', '2027-04-05'), // vuelve → reabrir
    ];
    const deseados = [
      tarea('cp:semana-4', 'requested', '2026-11-02'),
      tarea('cp:semana-12', 'requested', '2026-12-30'),
      tarea('cp:semana-26', 'requested', '2027-04-05'),
      tarea('cp:semana-28', 'requested', '2027-04-19'),
    ];
    const plan = sincronizar(deseados, existentes, { estado: estadoTarea, mismoContenido: mismaVentanaTarea });
    expect(plan.crear.map((t) => t.identifier?.[0]?.value)).toEqual(['cp:semana-28']);
    expect(plan.actualizar.map((t) => t.id)).toEqual(['t-cp:semana-26']);
    expect(plan.cancelar.map((t) => t.id)).toEqual(['t-cp:semana-20']);
    expect(plan.aRevisar.map((t) => t.id)).toEqual(['t-cp:semana-12']);
  });
});

describe('GLP-1 · tarea de Recepción al agendar', () => {
  const [basal] = construirTareasAgenda(PESO, calendarioGlp1(PESO), 'cp1', '2026-09-23T12:00:00.000Z');

  it('Devuelve la ventana si la tarea es del paciente, está pendiente y es del servicio correcto', () => {
    expect(validarTareaAgenda(basal!, { pacienteRef: 'Patient/p1', servicioCodigo: 'CONTROL_GLP1' })).toEqual({
      ok: true,
      ventana: { desde: '2026-09-28', hasta: '2026-10-05' },
      requiereLaboratorio: true,
    });
  });

  it('Rechaza otro paciente, otro servicio o una tarea ya resuelta', () => {
    expect(validarTareaAgenda(basal!, { pacienteRef: 'Patient/otro', servicioCodigo: 'CONTROL_GLP1' }).ok).toBe(false);
    expect(validarTareaAgenda(basal!, { pacienteRef: 'Patient/p1', servicioCodigo: 'CARDIOLOGIA' }).ok).toBe(false);
    expect(validarTareaAgenda({ ...basal!, status: 'completed' }, { pacienteRef: 'Patient/p1', servicioCodigo: 'CONTROL_GLP1' }).ok).toBe(false);
  });
});

describe('GLP-1 · R-19 sin tarea', () => {
  it('El control GLP-1 no se agenda suelto; el resto de los servicios no se ve afectado', () => {
    const r = validarControlSinTarea('CONTROL_GLP1');
    expect(r.ok).toBe(false);
    expect(r.bloqueos[0]?.regla).toBe('R-19');
    expect(validarControlSinTarea('CARDIOLOGIA')).toEqual({ ok: true, bloqueos: [], advertencias: [] });
  });
});

describe('GLP-1 · vista de Recepción', () => {
  const tareas = construirTareasAgenda(PESO, calendarioGlp1(PESO), 'cp1', '2026-09-23T12:00:00.000Z');
  const semanaDe = (t: Task) => leerTareaControl(t).semana;

  it('Lee de la tarea solo lo operativo: semana, ventana, laboratorio y servicio', () => {
    const s4 = tareas.find((t) => semanaDe(t) === 4)!;
    expect(leerTareaControl(s4)).toEqual({
      semana: 4,
      ventana: { desde: '2026-11-02', hasta: '2026-11-09' },
      requiereLaboratorio: false,
      servicio: 'CONTROL_GLP1',
    });
    expect(leerTareaControl(tareas[0]!).requiereLaboratorio).toBe(true);
  });

  it('Estado de la ventana y fecha sugerida para agendar', () => {
    const v = { desde: '2026-11-02', hasta: '2026-11-09' };
    expect(estadoVentana(v, '2026-11-01')).toBe('proxima');
    expect(estadoVentana(v, '2026-11-02')).toBe('abierta');
    expect(estadoVentana(v, '2026-11-09')).toBe('abierta');
    expect(estadoVentana(v, '2026-11-10')).toBe('vencida');
    expect(fechaSugerida(v, '2026-10-20')).toBe('2026-11-02');
    expect(fechaSugerida(v, '2026-11-05')).toBe('2026-11-05');
  });

  it('"Hoy" es el día de Argentina, no el de UTC', () => {
    expect(hoyLocal(new Date('2026-11-02T02:00:00Z'))).toBe('2026-11-01');
    expect(hoyLocal(new Date('2026-11-02T03:00:00Z'))).toBe('2026-11-02');
    expect(diaLocal('2026-09-23T00:30:00.000Z')).toBe('2026-09-22');
  });

  it('La cola va por inicio de ventana', () => {
    expect(ordenarControles([...tareas].reverse()).map(semanaDe)).toEqual(tareas.map(semanaDe));
  });

  it('Resume el seguimiento del paciente desde sus tareas', () => {
    const indicacion = construirTareaIndicacion('Patient/p1', '2026-09-23T12:00:00.000Z');
    expect(resumenSeguimiento([])).toMatchObject({ estado: 'sin-seguimiento', agendados: 0 });
    expect(resumenSeguimiento([indicacion])).toMatchObject({ estado: 'esperando-indicacion', pendientes: [] });

    const [basal, ...resto] = tareas;
    const r = resumenSeguimiento([{ ...basal!, status: 'completed' }, ...resto, { ...indicacion, status: 'completed' }]);
    expect(r.estado).toBe('por-agendar');
    expect(r.agendados).toBe(1);
    expect(r.pendientes.map(semanaDe)).toEqual(resto.map(semanaDe));

    const cerradas = tareas.map((t) => ({ ...t, status: 'completed' as const }));
    expect(resumenSeguimiento(cerradas)).toMatchObject({ estado: 'al-dia', agendados: tareas.length });
    // Las canceladas (recalculadas) no cuentan.
    expect(resumenSeguimiento(tareas.map((t) => ({ ...t, status: 'cancelled' as const }))).estado).toBe('sin-seguimiento');
  });
});
