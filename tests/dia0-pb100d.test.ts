/**
 * Día 0, plan clínico y material del Plan Bienestar 100 Días® vistos desde Recepción:
 * la lógica pura (`src/lib/dia0-pb100d.ts`) y el bot `som-bienestar-dia0` sobre un
 * Medplum en memoria. Lo que se prueba, sobre todo: Recepción recibe estados y fechas,
 * nunca valores clínicos ni el estadío.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CarePlan, Observation, QuestionnaireResponse, Resource, Task } from '@medplum/fhirtypes';
import { handler as dia0Bot } from '../src/bots/bienestar-dia0.js';
import { EVALUACIONES_CATALOGO } from '../src/config/evaluaciones-pb100d.js';
import {
  SYSTEM_EPA_PB100D,
  esCarePlanClinico,
  estadioValidadoDesdeFhir,
  evaluacionesDelMomento,
  evaluarDia0Operativo,
  materialOperativo,
  pasosDelPlanClinico,
  planClinicoOperativo,
  ultimaFechaCuestionario,
  ultimaFechaLoinc,
} from '../src/lib/dia0-pb100d.js';
import { fakeMedplum } from './fake-medplum.js';

const LOINC = 'http://loinc.org';
const HOY = '2026-09-25';
const ev = (input: unknown, secrets: Record<string, unknown> = {}) => ({ input, secrets }) as never;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

function obs(code: string, value: number, fecha: string, extra: Partial<Observation> = {}): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: 'Patient/p1' },
    code: { coding: [{ system: LOINC, code }] },
    valueQuantity: { value },
    effectiveDateTime: fecha,
    ...extra,
  };
}

function respuesta(sufijo: string, authored: string): QuestionnaireResponse {
  return {
    resourceType: 'QuestionnaireResponse',
    status: 'completed',
    subject: { reference: 'Patient/p1' },
    questionnaire: `https://epa-bienestar.ar/fhir/${sufijo}|1.0`,
    authored,
  };
}

function estadioValidado(n: string, fecha: string): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    subject: { reference: 'Patient/p1' },
    code: { coding: [{ system: SYSTEM_EPA_PB100D, code: 'estadio-ckm' }] },
    method: { coding: [{ system: SYSTEM_EPA_PB100D, code: 'estadio-ckm-validado' }] },
    valueCodeableConcept: { coding: [{ system: SYSTEM_EPA_PB100D, code: `estadio-ckm-${n}` }] },
    effectiveDateTime: fecha,
  };
}

const planClinico = (id: string, start: string, status: CarePlan['status'] = 'active'): CarePlan => ({
  resourceType: 'CarePlan',
  id,
  status,
  intent: 'plan',
  subject: { reference: 'Patient/p1' },
  instantiatesCanonical: ['https://epa-bienestar.ar/fhir/PlanDefinition/pb100d-ckm|1.0'],
  period: { start, end: '2027-01-03' },
});

function paso(id: string, carePlanId: string, tipo: string, titulo: string, momento: string, status: Task['status'] = 'requested'): Task {
  return {
    resourceType: 'Task',
    id,
    status,
    intent: 'plan',
    for: { reference: 'Patient/p1' },
    basedOn: [{ reference: `CarePlan/${carePlanId}` }],
    code: { coding: [{ system: SYSTEM_EPA_PB100D, code: tipo }], text: titulo },
    extension: [{ url: 'https://epa-bienestar.ar/fhir/StructureDefinition/catalogo-momento', valueCode: momento }],
  };
}

describe('Evaluaciones del catálogo por perfil', () => {
  it('el día 0 del estadío 2 sin condiciones tiene las 14 evaluaciones firmadas; el estadío 0, 17', () => {
    const e2 = evaluacionesDelMomento({ estadio: '2', condiciones: [] });
    expect(e2.map((e) => e.codigo)).toEqual([
      'E2-EVAL-01',
      'E2-EVAL-02',
      'E2-EVAL-03',
      'E2-EVAL-04',
      'E2-EVAL-05',
      'E2-EVAL-06',
      'E2-EVAL-13',
      'E2-EVAL-14',
      'E2-EVAL-15',
      'E2-EVAL-17',
      'E2-EVAL-18',
      'E2-EVAL-19',
      'E2-EVAL-20',
      'E2-EVAL-24',
    ]);
    expect(evaluacionesDelMomento({ estadio: '0', condiciones: [] })).toHaveLength(17);
    // Con una condición aparecen las que la piden.
    const conDbt = evaluacionesDelMomento({ estadio: '2', condiciones: ['dm2'] });
    expect(conDbt.length).toBeGreaterThan(e2.length);
  });

  it('el catálogo generado trae las 103 evaluaciones, todas con quién carga y detector', () => {
    expect(EVALUACIONES_CATALOGO).toHaveLength(103);
    for (const e of EVALUACIONES_CATALOGO) {
      expect(['persona', 'consultorio', 'laboratorio', 'equipo', 'sistema']).toContain(e.quien);
      expect(['loinc', 'cuestionario', 'fib4', 'prevent', 'le8', 'validacion', 'manual']).toContain(e.detector);
      if (e.detector === 'loinc') expect(e.codigosLoinc?.length).toBeGreaterThan(0);
      if (e.detector === 'cuestionario') expect(e.cuestionario).toMatch(/^Questionnaire\//);
    }
  });
});

describe('Detección sin valores', () => {
  it('ultimaFechaLoinc devuelve el código y la fecha más reciente, en orden de preferencia; ignora las anuladas', () => {
    const lista = [
      obs('39156-5', 31, '2026-08-01'),
      obs('39156-5', 30, '2026-09-01'),
      obs('39156-5', 99, '2026-09-20', { status: 'entered-in-error' }),
      obs('29463-7', 80, '2026-09-10'),
    ];
    expect(ultimaFechaLoinc(lista, ['39156-5', '29463-7'])).toEqual({ code: '39156-5', fecha: '2026-09-01' });
    expect(ultimaFechaLoinc(lista, ['29463-7'])).toEqual({ code: '29463-7', fecha: '2026-09-10' });
    expect(ultimaFechaLoinc(lista, ['8480-6'])).toBeUndefined();
    // Un componente (presión sistólica dentro del panel) también cuenta.
    const panel: Observation = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: LOINC, code: '85354-9' }] },
      effectiveDateTime: '2026-09-15',
      component: [{ code: { coding: [{ system: LOINC, code: '8480-6' }] }, valueQuantity: { value: 130 } }],
    };
    expect(ultimaFechaLoinc([panel], ['8480-6'])).toEqual({ code: '8480-6', fecha: '2026-09-15' });
  });

  it('ultimaFechaCuestionario reconoce el sufijo bajo cualquier base y con versión', () => {
    const r = [
      respuesta('Questionnaire/le8-diet-mepa-v1', '2026-09-02T10:00:00Z'),
      { ...respuesta('Questionnaire/le8-diet-mepa-v1', '2026-09-12T10:00:00Z'), questionnaire: 'https://otra.base/fhir/Questionnaire/le8-diet-mepa-v1' },
      { ...respuesta('Questionnaire/le8-diet-mepa-v1', '2026-09-20T10:00:00Z'), status: 'entered-in-error' as const },
    ];
    expect(ultimaFechaCuestionario(r, 'Questionnaire/le8-diet-mepa-v1')).toBe('2026-09-12T10:00:00Z');
    expect(ultimaFechaCuestionario(r, 'Questionnaire/pb100d-ahc-hrsn-v1')).toBeUndefined();
  });

  it('evaluarDia0Operativo: cargado, a medias, vencido y falta, agrupado por quién carga y sin ningún valor', () => {
    const r = evaluarDia0Operativo({
      perfil: { estadio: '2', condiciones: [] },
      hoy: HOY,
      edad: 58,
      observaciones: [
        obs('39156-5', 31.2, '2026-09-10'), // IMC → cargado
        obs('8480-6', 138, '2026-05-01'), // presión, hace > 90 días → vencido
        obs('2093-3', 220, '2026-09-10'), // colesterol total: sólo la alternativa del perfil lipídico → a medias
        obs('4548-4', 6.1, '2026-09-10'), // HbA1c → cargado
      ],
      respuestas: [respuesta('Questionnaire/pb100d-potenciadores-v1', '2026-09-11T10:00:00Z')],
      estadioValidado: '2',
    });
    expect(r).toMatchObject({ momento: 'dia-0', total: 14, completo: false });
    const por = Object.fromEntries(r.datos.map((d) => [d.codigo, d]));
    expect(por['E2-EVAL-01']).toMatchObject({ estado: 'cargado', fecha: '2026-09-10', quien: 'consultorio' });
    expect(por['E2-EVAL-02']).toMatchObject({ estado: 'vencido', fecha: '2026-05-01', detalle: expect.stringMatching(/hace más de 90 días/) });
    expect(por['E2-EVAL-04']).toMatchObject({ estado: 'parcial', detalle: 'Cargada sólo una alternativa' });
    expect(por['E2-EVAL-05']).toMatchObject({ estado: 'cargado', quien: 'laboratorio' });
    expect(por['E2-EVAL-06']).toMatchObject({ estado: 'falta' });
    expect(por['E2-EVAL-13']).toMatchObject({ estado: 'parcial', detalle: expect.stringMatching(/Faltan HDL, eGFR/) }); // PREVENT: faltan datos
    expect(por['E2-EVAL-14']).toMatchObject({ estado: 'cargado', fecha: '2026-09-11', quien: 'equipo' });
    expect(por['E2-EVAL-15']).toMatchObject({ estado: 'cargado', detalle: 'Estadío 2 validado' });
    expect(por['E2-EVAL-18']).toMatchObject({ estado: 'falta', detalle: expect.stringMatching(/^Sin /) });
    expect(por['E2-EVAL-20']).toMatchObject({ estado: 'parcial', detalle: expect.stringMatching(/de 8 dominios con dato$/) });
    expect(r.cargados).toBe(4);
    expect(r.faltan).toBe(10);
    expect(r.porQuien.map((g) => g.quien)).toEqual(['consultorio', 'laboratorio', 'persona', 'equipo', 'sistema']);
    expect(r.porQuien.find((g) => g.quien === 'laboratorio')?.datos.map((d) => d.codigo)).toEqual(['E2-EVAL-04', 'E2-EVAL-05', 'E2-EVAL-06']);
    // Nunca un valor clínico: ni 31.2, ni 138, ni 6.1.
    const texto = JSON.stringify(r);
    for (const valor of ['31.2', '138', '6.1', '220']) expect(texto).not.toContain(valor);
    expect(Object.keys(r.datos[0]!).sort()).toEqual(['codigo', 'estado', 'fecha', 'label', 'quien']);
  });

  it('sin estadío validado, la validación falta; con todo cargado, el día 0 queda completo', () => {
    const sinValidar = evaluarDia0Operativo({ perfil: { estadio: '0', condiciones: [] }, observaciones: [], respuestas: [], hoy: HOY });
    expect(sinValidar.datos.find((d) => d.codigo === 'E0-EVAL-09')).toMatchObject({ estado: 'falta', detalle: expect.stringMatching(/validar/) });
    expect(sinValidar.completo).toBe(false);

    const f = '2026-09-10';
    const completo = evaluarDia0Operativo({
      perfil: { estadio: '0', condiciones: [] },
      hoy: HOY,
      edad: 45,
      estadioValidado: '0',
      observaciones: [
        obs('39156-5', 24, f),
        obs('8280-0', 80, f),
        obs('8480-6', 118, f),
        obs('43396-1', 100, f),
        obs('2093-3', 180, f),
        obs('2085-9', 55, f),
        obs('4548-4', 5.2, f),
        obs('1558-6', 88, f),
        obs('9318-7', 10, f),
        obs('33914-3', 95, f),
        obs('55423-8', 200, f),
        obs('72166-2', 0, f),
        obs('93832-4', 7.5, f),
      ],
      respuestas: [
        respuesta('Questionnaire/pb100d-potenciadores-v1', f),
        respuesta('Questionnaire/pb100d-baseline', f),
        respuesta('Questionnaire/le8-diet-mepa-v1', f),
        respuesta('Questionnaire/pb100d-phq2-gad2-pss4-v1', f),
        respuesta('Questionnaire/pb100d-ahc-hrsn-v1', f),
      ],
    });
    expect(completo.datos.filter((d) => d.estado !== 'cargado')).toEqual([]);
    expect(completo).toMatchObject({ total: 17, cargados: 17, faltan: 0, completo: true });
  });

  it('el estadío validado es la última Observation validada del monorepo; la estimada no cuenta', () => {
    const estimada: Observation = {
      ...estadioValidado('3', '2026-09-20'),
      method: { coding: [{ system: SYSTEM_EPA_PB100D, code: 'estadio-ckm-estimado' }] },
    };
    expect(estadioValidadoDesdeFhir([estimada])).toBeUndefined();
    expect(estadioValidadoDesdeFhir([estadioValidado('1', '2026-08-01'), estimada, estadioValidado('2', '2026-09-01')])).toBe('2');
    expect(estadioValidadoDesdeFhir([{ ...estadioValidado('4', '2026-09-22'), status: 'entered-in-error' }])).toBeUndefined();
  });
});

describe('Plan clínico y material', () => {
  const pasos = [
    paso('t1', 'cp1', 'educacion', 'Leé qué es el riesgo cardiometabólico', 'dia-0', 'completed'),
    paso('t2', 'cp1', 'conducta', 'Caminá 30 minutos, 5 días por semana', 'continuo'),
    paso('t3', 'cp1', 'monitoreo', 'Medí tu presión en casa una vez por semana', 'semanal'),
    paso('t4', 'cp1', 'monitoreo', 'Laboratorio de control', 'dia-60'),
    paso('t5', 'cp1', 'derivacion', 'Derivación a Nefrología', 'evento'), // no es un paso de la persona
    paso('t6', 'cp1', 'conducta', 'Paso cancelado', 'continuo', 'cancelled'),
    paso('t7', 'cp-otro', 'conducta', 'De otro plan', 'continuo'),
  ];

  it('reconoce el CarePlan clínico por su PlanDefinition, bajo cualquier base, y el más reciente activo', () => {
    expect(esCarePlanClinico(planClinico('a', '2026-09-01'))).toBe(true);
    expect(esCarePlanClinico({ ...planClinico('b', '2026-09-01'), instantiatesCanonical: ['https://otra.base/fhir/PlanDefinition/menopausia-cardiovascular'] })).toBe(true);
    expect(esCarePlanClinico({ ...planClinico('c', '2026-09-01'), instantiatesCanonical: ['https://segundaopinionmedica.org/fhir/PlanDefinition/plan-bienestar-100'] })).toBe(false);
    expect(esCarePlanClinico({ resourceType: 'CarePlan', status: 'active', intent: 'plan', subject: { reference: 'Patient/p1' } })).toBe(false);

    const r = planClinicoOperativo([planClinico('viejo', '2026-01-01', 'completed'), planClinico('cp1', '2026-09-05')], pasos, HOY);
    expect(r).toEqual({ activo: true, inicio: '2026-09-05', fin: '2027-01-03', dia: 20, pasosTotal: 4, pasosCompletados: 1 });
    expect(planClinicoOperativo([], pasos, HOY)).toEqual({ activo: false, pasosTotal: 0, pasosCompletados: 0 });
  });

  it('los pasos son los del plan, de la persona, no cancelados', () => {
    expect(pasosDelPlanClinico(planClinico('cp1', '2026-09-05'), pasos).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(pasosDelPlanClinico(undefined, pasos)).toEqual([]);
  });

  it('el material: secciones por momento, próximos pendientes del momento actual y el aviso por WhatsApp', () => {
    const m = materialOperativo({
      nombre: 'Ana María Pérez',
      pasos: pasosDelPlanClinico(planClinico('cp1', '2026-09-05'), pasos),
      dia: 20,
      urlPortal: 'https://app.segundaopinionmedica.org',
    });
    expect(m.secciones.map((s) => [s.momento, s.pasos.length])).toEqual([
      ['dia-0', 1],
      ['continuo', 1],
      ['semanal', 1],
      ['dia-60', 1],
    ]);
    expect(m.secciones[0]).toMatchObject({ titulo: 'Día 0', pasos: [{ titulo: 'Leé qué es el riesgo cardiometabólico', completado: true }] });
    // Día 20: el momento actual es dia-30; van los continuos y semanales pendientes (el de día 60 no, el completado no).
    expect(m.proximos.map((p) => p.titulo)).toEqual(['Caminá 30 minutos, 5 días por semana', 'Medí tu presión en casa una vez por semana']);
    expect(m.textoWhatsApp).toBe(
      [
        'Hola Ana!',
        'Vas por el día 20 de 100 de tu Plan Bienestar 100 Días®.',
        'Tus próximos pasos:',
        '• Caminá 30 minutos, 5 días por semana',
        '• Medí tu presión en casa una vez por semana',
        'Los ves completos en tu portal: https://app.segundaopinionmedica.org',
        'Cualquier duda, escribinos por acá.',
      ].join('\n'),
    );
    expect(materialOperativo({ nombre: 'Ana', pasos: [] }).textoWhatsApp).toBe('Hola Ana!\nEmpezó tu Plan Bienestar 100 Días®.\nCualquier duda, escribinos por acá.');
  });
});

describe('Bot som-bienestar-dia0', () => {
  const base: Resource[] = [
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Pérez' }], birthDate: '1968-03-04', gender: 'female' },
  ];

  it('sin paciente válido, ok: false', async () => {
    const f = fakeMedplum(base);
    expect(await dia0Bot(f.medplum, ev({}))).toEqual({ ok: false, mensaje: expect.stringMatching(/Patient/) });
    expect((await dia0Bot(f.medplum, ev({ pacienteRef: 'Patient/nadie' }))).ok).toBe(false);
  });

  it('sin datos: estadío estimado, día 0 con todo por cargar, sin plan clínico ni material; nunca el estadío', async () => {
    const f = fakeMedplum(base);
    const r = await dia0Bot(f.medplum, ev({ pacienteRef: 'Patient/p1' }));
    expect(r.ok).toBe(true);
    expect(r.origenEstadio).toBe('estimado');
    expect(r.dia0).toMatchObject({ momento: 'dia-0', completo: false, cargados: 0 });
    expect(r.dia0!.total).toBeGreaterThan(0);
    expect(r.planClinico).toEqual({ activo: false, pasosTotal: 0, pasosCompletados: 0 });
    expect(r.material).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(['dia0', 'ok', 'origenEstadio', 'planClinico']);
  });

  it('con estadío validado, plan clínico y pasos: usa la lista de ese estadío y arma el material con el portal del secret', async () => {
    const f = fakeMedplum([
      ...base,
      { ...estadioValidado('2', '2026-09-10'), id: 'obs-estadio' },
      { ...obs('39156-5', 31, '2026-09-10'), id: 'obs-imc' },
      planClinico('cp1', '2026-09-05'),
      paso('t1', 'cp1', 'educacion', 'Leé qué es el riesgo cardiometabólico', 'dia-0', 'completed'),
      paso('t2', 'cp1', 'conducta', 'Caminá 30 minutos, 5 días por semana', 'continuo'),
    ]);
    const r = await dia0Bot(f.medplum, ev({ pacienteRef: 'Patient/p1' }, { PORTAL_BASE_URL: { name: 'PORTAL_BASE_URL', valueString: 'https://portal.test' } }));
    expect(r.ok).toBe(true);
    expect(r.origenEstadio).toBe('validado');
    expect(r.dia0!.datos.map((d) => d.codigo)).toContain('E2-EVAL-01');
    expect(r.dia0!.datos.find((d) => d.codigo === 'E2-EVAL-01')).toMatchObject({ estado: 'cargado', fecha: '2026-09-10' });
    expect(r.dia0!.datos.find((d) => d.codigo === 'E2-EVAL-15')).toMatchObject({ estado: 'cargado' });
    expect(r.planClinico).toEqual({ activo: true, inicio: '2026-09-05', fin: '2027-01-03', dia: 20, pasosTotal: 2, pasosCompletados: 1 });
    expect(r.material?.textoWhatsApp).toContain('Los ves completos en tu portal: https://portal.test');
    expect(r.material?.proximos.map((p) => p.titulo)).toEqual(['Caminá 30 minutos, 5 días por semana']);
    // El estadío validado no viaja: sólo el detalle "validado" de la evaluación.
    expect(JSON.stringify(r)).not.toMatch(/"estadio"/);
    // Otro momento del plan.
    const d30 = await dia0Bot(f.medplum, ev({ pacienteRef: 'Patient/p1', momento: 'dia-30' }));
    expect(d30.dia0?.momento).toBe('dia-30');
    expect(d30.dia0?.datos.every((d) => EVALUACIONES_CATALOGO.find((e) => e.codigo === d.codigo)?.momentos.includes('dia-30'))).toBe(true);
  });
});
