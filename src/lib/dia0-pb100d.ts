/**
 * Día 0 del Plan Bienestar 100 Días® visto desde Recepción: qué datos pide el catálogo
 * firmado para el estadío de la persona y si están cargados, **sin valores clínicos**
 * (Recepción ve "falta el laboratorio", nunca el resultado). Lógica pura, sin red.
 *
 * Las evaluaciones y su clasificación (quién carga cada dato y cómo se detecta) vienen
 * GENERADAS del monorepo del plan (`src/config/evaluaciones-pb100d.ts`); el perfil
 * (estadío y condiciones) es el de `ckm-catalogo.ts`. El bot `som-bienestar-dia0` corre
 * esto con su identidad y devuelve sólo lo operativo a la app de recepción, cuya policy
 * no lee lo clínico.
 *
 * También lee, del mismo modo, el plan clínico (`pb100d-ckm`) y arma el material para el
 * paciente (los títulos de sus pasos, sin datos clínicos).
 */
import type { CarePlan, Observation, QuestionnaireResponse, Task } from '@medplum/fhirtypes';
import { ETIQUETA_MOMENTO_CATALOGO, type MomentoCatalogo } from '../config/catalogo-pb100d.js';
import {
  ETIQUETA_QUIEN_CARGA,
  EVALUACIONES_CATALOGO,
  VIGENCIA_DIA_0_DIAS,
  type EvaluacionCatalogoPb100d,
  type QuienCargaEvaluacion,
} from '../config/evaluaciones-pb100d.js';
import { NOMBRE_PLAN_BIENESTAR } from '../config/plan-bienestar.js';
import type { PerfilCatalogo } from './ckm-catalogo.js';
import { sumarDias } from './programas.js';

export type { QuienCargaEvaluacion };

export type EstadoDatoDia0 = 'cargado' | 'parcial' | 'vencido' | 'falta';

export const ETIQUETA_ESTADO_DATO: Record<EstadoDatoDia0, string> = {
  cargado: 'Cargado',
  parcial: 'A medias',
  vencido: 'Vencido',
  falta: 'Falta',
};

export interface DatoDia0 {
  codigo: string;
  label: string;
  quien: QuienCargaEvaluacion;
  estado: EstadoDatoDia0;
  /** Fecha (AAAA-MM-DD) de la última carga, si hay. Nunca el valor. */
  fecha?: string;
  /** Qué falta, en palabras ("Faltan AST y plaquetas"). Nunca el valor. */
  detalle?: string;
}

export interface GrupoDia0 {
  quien: QuienCargaEvaluacion;
  etiqueta: string;
  datos: DatoDia0[];
}

export interface ResumenDia0 {
  momento: string;
  total: number;
  cargados: number;
  faltan: number;
  completo: boolean;
  datos: DatoDia0[];
  porQuien: GrupoDia0[];
}

const LOINC = 'http://loinc.org';
/** CodeSystem del monorepo del plan (estadío validado, tipo de ítem de las Tasks). */
export const SYSTEM_EPA_PB100D = 'https://epa-bienestar.ar/fhir/CodeSystem/plan-bienestar-100-dias';
/** PlanDefinition del plan clínico (la vigente y la anterior), en cualquier base. */
const SUFIJOS_PLAN_CLINICO = ['PlanDefinition/pb100d-ckm', 'PlanDefinition/menopausia-cardiovascular'];
const SUFIJO_EXT_MOMENTO = '/StructureDefinition/catalogo-momento';

const ORDEN_QUIEN: QuienCargaEvaluacion[] = ['consultorio', 'laboratorio', 'persona', 'equipo', 'sistema'];

/** ¿La evaluación aplica al perfil? Igual que los ítems (`aplicaAlerta`). */
export function aplicaEvaluacion(e: EvaluacionCatalogoPb100d, perfil: PerfilCatalogo): boolean {
  const tiene = new Set<string>(perfil.condiciones);
  if (!e.estadios.includes(perfil.estadio)) return false;
  if ((e.condiciones ?? []).some((c) => !tiene.has(c))) return false;
  if (e.algunaDe && e.algunaDe.length > 0 && !e.algunaDe.some((c) => tiene.has(c))) return false;
  return !(e.excluye ?? []).some((c) => tiene.has(c));
}

/** Las evaluaciones del catálogo que aplican al perfil en un momento del plan. */
export function evaluacionesDelMomento(perfil: PerfilCatalogo, momento: string = 'dia-0'): EvaluacionCatalogoPb100d[] {
  return EVALUACIONES_CATALOGO.filter((e) => e.momentos.includes(momento) && aplicaEvaluacion(e, perfil));
}

const anulada = (o: Observation): boolean => o.status === 'entered-in-error' || o.status === 'cancelled';
const fechaObs = (o: Observation): string => o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.issued ?? o.meta?.lastUpdated ?? '';

function conValor(o: Observation, code: string): boolean {
  if ((o.code?.coding ?? []).some((c) => c.system === LOINC && c.code === code) && o.valueQuantity?.value !== undefined) return true;
  return (o.component ?? []).some(
    (comp) => (comp.code?.coding ?? []).some((c) => c.system === LOINC && c.code === code) && comp.valueQuantity?.value !== undefined,
  );
}

/** La fecha de la última Observation del primer código que tenga alguna (los códigos van en orden de preferencia). */
export function ultimaFechaLoinc(obs: Observation[], codigos: readonly string[]): { code: string; fecha: string } | undefined {
  for (const code of codigos) {
    let mejor: string | undefined;
    for (const o of obs) {
      if (anulada(o) || !conValor(o, code)) continue;
      const f = fechaObs(o);
      if (mejor === undefined || f >= mejor) mejor = f;
    }
    if (mejor !== undefined) return { code, fecha: mejor };
  }
  return undefined;
}

/** La fecha de la última respuesta de un Questionnaire (sufijo bajo cualquier base). */
export function ultimaFechaCuestionario(respuestas: QuestionnaireResponse[], sufijo: string): string | undefined {
  let mejor: string | undefined;
  for (const r of respuestas) {
    if (r.status === 'entered-in-error') continue;
    const url = r.questionnaire?.split('|')[0] ?? '';
    if (!url.endsWith(`/${sufijo}`)) continue;
    const f = r.authored ?? r.meta?.lastUpdated ?? '';
    if (mejor === undefined || f >= mejor) mejor = f;
  }
  return mejor;
}

const fechaCorta = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(desde);
  const b = Date.parse(hasta);
  return Number.isNaN(a) || Number.isNaN(b) ? Number.POSITIVE_INFINITY : (b - a) / 86_400_000;
}

interface Ctx {
  hoy: string;
  vigenciaDias: number;
  obs: Observation[];
  respuestas: QuestionnaireResponse[];
  estadioValidado?: string;
  edad?: number;
}

type Deteccion = Pick<DatoDia0, 'estado' | 'fecha' | 'detalle'>;

function conVigencia(ctx: Ctx, fecha: string): Deteccion {
  if (!fecha) return { estado: 'cargado' };
  const dia = fecha.slice(0, 10);
  if (diasEntre(fecha, `${ctx.hoy}T23:59:59Z`) > ctx.vigenciaDias) {
    return { estado: 'vencido', fecha: dia, detalle: `Última carga ${fechaCorta(fecha)}, hace más de ${ctx.vigenciaDias} días` };
  }
  return { estado: 'cargado', fecha: dia };
}

function porCuestionario(ctx: Ctx, sufijo: string, nombre: string): Deteccion {
  const f = ultimaFechaCuestionario(ctx.respuestas, sufijo);
  return f === undefined ? { estado: 'falta', detalle: `Sin ${nombre}` } : conVigencia(ctx, f);
}

const NOMBRE_LOINC: Record<string, string> = {
  '1920-8': 'AST',
  '1742-6': 'ALT',
  '777-3': 'plaquetas',
  '2093-3': 'colesterol total',
  '2085-9': 'HDL',
  '8480-6': 'presión sistólica',
  '33914-3': 'eGFR',
};

function porPartes(ctx: Ctx, partes: ReadonlyArray<readonly string[]>, todoCargado: string): Deteccion {
  const faltan = partes.filter((codigos) => !ultimaFechaLoinc(ctx.obs, codigos)).map((codigos) => NOMBRE_LOINC[codigos[0]!] ?? codigos[0]!);
  if (faltan.length === partes.length) return { estado: 'falta', detalle: faltan.join(', ') };
  if (faltan.length > 0) return { estado: 'parcial', detalle: `Faltan ${faltan.join(', ')}` };
  return { estado: 'cargado', detalle: todoCargado };
}

/** Los ocho dominios LE8 y de dónde sale cada uno (LOINC o cuestionario del portal). */
const DOMINIOS_LE8: ReadonlyArray<{ loinc?: readonly string[]; cuestionario?: string }> = [
  { cuestionario: 'Questionnaire/le8-diet-mepa-v1' },
  { loinc: ['55423-8'], cuestionario: 'Questionnaire/le8-activity-evs-v1' },
  { loinc: ['72166-2'], cuestionario: 'Questionnaire/le8-tobacco-v1' },
  { loinc: ['93832-4'], cuestionario: 'Questionnaire/le8-sleep-psqi-v1' },
  { loinc: ['39156-5', '29463-7'] },
  { loinc: ['43396-1', '2093-3'] },
  { loinc: ['4548-4', '1558-6'] },
  { loinc: ['8480-6'] },
];

function porLe8(ctx: Ctx): Deteccion {
  const conDato = DOMINIOS_LE8.filter(
    (d) => (d.loinc && ultimaFechaLoinc(ctx.obs, d.loinc)) || (d.cuestionario && ultimaFechaCuestionario(ctx.respuestas, d.cuestionario)),
  ).length;
  if (conDato === DOMINIOS_LE8.length) return { estado: 'cargado', detalle: '8 de 8 dominios' };
  if (conDato > 0) return { estado: 'parcial', detalle: `${conDato} de 8 dominios con dato` };
  return { estado: 'falta', detalle: 'Ningún dominio con dato' };
}

function detectar(ctx: Ctx, e: EvaluacionCatalogoPb100d): Deteccion {
  switch (e.detector) {
    case 'loinc': {
      const codigos = e.codigosLoinc ?? [];
      const r = ultimaFechaLoinc(ctx.obs, codigos);
      if (!r && e.cuestionario) return porCuestionario(ctx, e.cuestionario, 'cuestionario del portal');
      if (!r) return { estado: 'falta' };
      const d = conVigencia(ctx, r.fecha);
      return r.code === codigos[0] || d.estado !== 'cargado' ? d : { ...d, estado: 'parcial', detalle: 'Cargada sólo una alternativa' };
    }
    case 'cuestionario':
      return porCuestionario(ctx, e.cuestionario ?? '', e.nombre ?? 'cuestionario');
    case 'fib4':
      return porPartes(ctx, [['1920-8'], ['1742-6'], ['777-3']], 'AST, ALT y plaquetas cargados');
    case 'prevent': {
      const d = porPartes(ctx, [['2093-3'], ['2085-9'], ['8480-6'], ['33914-3', '2160-0']], 'Se calcula con los datos cargados');
      if (ctx.edad === undefined) return { estado: d.estado === 'falta' ? 'falta' : 'parcial', detalle: `${d.detalle ?? 'Faltan datos'}${d.estado === 'cargado' ? '' : ','} fecha de nacimiento` };
      return d;
    }
    case 'le8':
      return porLe8(ctx);
    case 'validacion':
      return ctx.estadioValidado !== undefined
        ? { estado: 'cargado', detalle: `Estadío ${ctx.estadioValidado} validado` }
        : { estado: 'falta', detalle: 'Falta validar el estadío (equipo médico)' };
    case 'manual':
      return { estado: 'falta', detalle: 'Se registra a mano' };
  }
}

export interface EntradaDia0Operativo {
  perfil: PerfilCatalogo;
  observaciones: Observation[];
  respuestas: QuestionnaireResponse[];
  /** Estadío validado por el equipo, si lo hay ('0'..'4'). */
  estadioValidado?: string;
  edad?: number;
  hoy?: string;
  vigenciaDias?: number;
  momento?: string;
}

/** Qué falta para el momento del plan (día 0 por defecto), sin valores clínicos. */
export function evaluarDia0Operativo(d: EntradaDia0Operativo): ResumenDia0 {
  const momento = d.momento ?? 'dia-0';
  const ctx: Ctx = {
    hoy: d.hoy ?? new Date().toISOString().slice(0, 10),
    vigenciaDias: d.vigenciaDias ?? VIGENCIA_DIA_0_DIAS,
    obs: d.observaciones,
    respuestas: d.respuestas,
    ...(d.estadioValidado !== undefined ? { estadioValidado: d.estadioValidado } : {}),
    ...(d.edad !== undefined ? { edad: d.edad } : {}),
  };
  const datos: DatoDia0[] = evaluacionesDelMomento(d.perfil, momento).map((e) => ({
    codigo: e.codigo,
    label: e.label,
    quien: e.quien,
    ...detectar(ctx, e),
  }));
  const cargados = datos.filter((x) => x.estado === 'cargado').length;
  return {
    momento,
    total: datos.length,
    cargados,
    faltan: datos.length - cargados,
    completo: datos.length > 0 && cargados === datos.length,
    datos,
    porQuien: ORDEN_QUIEN.map((quien) => ({ quien, etiqueta: ETIQUETA_QUIEN_CARGA[quien], datos: datos.filter((x) => x.quien === quien) })).filter(
      (g) => g.datos.length > 0,
    ),
  };
}

// ───────────────────────────── estadío validado ─────────────────────────────

/**
 * El estadío que validó el equipo médico ('0'..'4'), si lo hay: la última Observation
 * `estadio-ckm` del monorepo con método `estadio-ckm-validado`. Lo que estima el portal
 * (método `estadio-ckm-estimado`) no cuenta.
 */
export function estadioValidadoDesdeFhir(obs: Observation[]): string | undefined {
  let mejor: Observation | undefined;
  for (const o of obs) {
    if (anulada(o)) continue;
    const esEstadio = (o.code?.coding ?? []).some((c) => c.system === SYSTEM_EPA_PB100D && c.code === 'estadio-ckm');
    const validado = (o.method?.coding ?? []).some((c) => c.system === SYSTEM_EPA_PB100D && c.code === 'estadio-ckm-validado');
    if (!esEstadio || !validado) continue;
    if (!mejor || fechaObs(o) >= fechaObs(mejor)) mejor = o;
  }
  const code = mejor?.valueCodeableConcept?.coding?.find((c) => c.system === SYSTEM_EPA_PB100D)?.code;
  const m = /^estadio-ckm-(\d)/.exec(code ?? '');
  return m ? m[1] : undefined;
}

// ───────────────────────────── plan clínico y material ─────────────────────────────

/** ¿Es el CarePlan clínico del plan (instancia `pb100d-ckm` o la definición anterior)? */
export function esCarePlanClinico(cp: CarePlan): boolean {
  return (cp.instantiatesCanonical ?? []).some((c) => SUFIJOS_PLAN_CLINICO.some((s) => (c.split('|')[0] ?? '').endsWith(`/${s}`)));
}

export interface PlanClinicoOperativo {
  activo: boolean;
  inicio?: string;
  fin?: string;
  /** Día del plan clínico (0 = alta). */
  dia?: number;
  pasosTotal: number;
  pasosCompletados: number;
}

function tipoDeTask(t: Task): string | undefined {
  return (t.code?.coding ?? []).find((c) => c.system === SYSTEM_EPA_PB100D)?.code;
}

/** Los pasos de la persona del plan clínico: educación, conducta y monitoreo. */
export function pasosDelPlanClinico(plan: CarePlan | undefined, tareas: Task[]): Task[] {
  if (!plan?.id) return [];
  const ref = `CarePlan/${plan.id}`;
  return tareas.filter(
    (t) =>
      (t.basedOn ?? []).some((b) => b.reference === ref) &&
      t.intent === 'plan' &&
      ['educacion', 'conducta', 'monitoreo'].includes(tipoDeTask(t) ?? '') &&
      t.status !== 'cancelled' &&
      t.status !== 'rejected' &&
      t.status !== 'entered-in-error',
  );
}

/** El plan clínico activo más reciente. */
export function planClinicoActivo(planes: CarePlan[]): CarePlan | undefined {
  return planes
    .filter((cp) => cp.status === 'active' && esCarePlanClinico(cp))
    .sort((a, b) => (b.period?.start ?? b.created ?? '').localeCompare(a.period?.start ?? a.created ?? ''))[0];
}

/** Lo operativo del plan clínico: si está, desde cuándo, en qué día va y cuántos pasos completó la persona. */
export function planClinicoOperativo(planes: CarePlan[], tareas: Task[], hoy: string): PlanClinicoOperativo {
  const plan = planClinicoActivo(planes);
  const pasos = pasosDelPlanClinico(plan, tareas);
  const base = { pasosTotal: pasos.length, pasosCompletados: pasos.filter((t) => t.status === 'completed').length };
  if (!plan) return { activo: false, ...base };
  const inicio = (plan.period?.start ?? plan.created)?.slice(0, 10);
  const dia = inicio ? Math.floor(diasEntre(`${inicio}T00:00:00Z`, `${hoy}T00:00:00Z`)) : undefined;
  return {
    activo: true,
    ...(inicio ? { inicio, fin: plan.period?.end?.slice(0, 10) ?? sumarDias(inicio, 100) } : {}),
    ...(dia !== undefined && Number.isFinite(dia) ? { dia } : {}),
    ...base,
  };
}

/** Los momentos de una Task del plan (extensión `catalogo-momento`, en cualquier base). */
export function momentosDeTask(t: Task): MomentoCatalogo[] {
  const validos = new Set<string>(Object.keys(ETIQUETA_MOMENTO_CATALOGO));
  return [
    ...new Set(
      (t.extension ?? [])
        .filter((e) => e.url?.endsWith(SUFIJO_EXT_MOMENTO))
        .map((e) => e.valueCode)
        .filter((c): c is MomentoCatalogo => c !== undefined && validos.has(c)),
    ),
  ];
}

const ORDEN_MOMENTOS: MomentoCatalogo[] = ['dia-0', 'continuo', 'semanal', 'mensual', 'dia-30', 'dia-60', 'dia-100', 'evento'];

function momentoActual(dia: number | undefined): MomentoCatalogo {
  if (dia === undefined || dia <= 14) return 'dia-0';
  if (dia <= 44) return 'dia-30';
  if (dia <= 79) return 'dia-60';
  return 'dia-100';
}

export interface PasoMaterial {
  titulo: string;
  completado: boolean;
  momentos: MomentoCatalogo[];
}

export interface MaterialOperativo {
  /** El aviso por WhatsApp: saludo, próximos pasos y el portal. Sin datos clínicos. */
  textoWhatsApp: string;
  secciones: Array<{ momento: MomentoCatalogo; titulo: string; pasos: PasoMaterial[] }>;
  proximos: PasoMaterial[];
}

/** El material para el paciente: sus pasos por momento y el aviso por WhatsApp. */
export function materialOperativo(d: { nombre: string; pasos: Task[]; dia?: number; urlPortal?: string; maximoProximos?: number }): MaterialOperativo {
  const pasos: PasoMaterial[] = d.pasos.map((t) => ({
    titulo: t.code?.text ?? t.code?.coding?.find((c) => c.display)?.display ?? t.description ?? 'Paso del plan',
    completado: t.status === 'completed',
    momentos: momentosDeTask(t),
  }));
  const secciones = ORDEN_MOMENTOS.map((momento) => ({
    momento,
    titulo: ETIQUETA_MOMENTO_CATALOGO[momento],
    pasos: pasos.filter((p) => (p.momentos[0] ?? 'continuo') === momento),
  })).filter((s) => s.pasos.length > 0);
  const actual = momentoActual(d.dia);
  const proximos = pasos
    .filter((p) => !p.completado && (p.momentos.includes(actual) || p.momentos.includes('continuo') || p.momentos.includes('semanal')))
    .slice(0, d.maximoProximos ?? 5);
  const lineas = [`Hola ${d.nombre.split(' ')[0] || d.nombre}!`];
  lineas.push(d.dia !== undefined && d.dia > 0 ? `Vas por el día ${d.dia} de 100 de tu ${NOMBRE_PLAN_BIENESTAR}.` : `Empezó tu ${NOMBRE_PLAN_BIENESTAR}.`);
  if (proximos.length) {
    lineas.push('Tus próximos pasos:');
    for (const p of proximos) lineas.push(`• ${p.titulo}`);
  }
  if (d.urlPortal) lineas.push(`Los ves completos en tu portal: ${d.urlPortal}`);
  lineas.push('Cualquier duda, escribinos por acá.');
  return { textoWhatsApp: lineas.join('\n'), secciones, proximos };
}
