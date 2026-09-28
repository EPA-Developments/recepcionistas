/**
 * Alertas al médico y derivaciones del catálogo firmado del Plan Bienestar 100 Días®
 * (estadíos CKM 0 a 4) — lógica pura, sin FHIR ni red.
 *
 * Los ítems viven en `src/config/catalogo-pb100d.ts`, GENERADO desde el monorepo del
 * plan (`@epa/careplan-menopausia`, `npm run exportar:recepcion`): acá no se edita el
 * catálogo. Este módulo traduce lo que Recepción ya calcula —el estadío (`ckm.ts`), la
 * entrada clínica, el riesgo PREVENT (`prevent.ts`) y lo que se lee de la historia
 * (`ckm-fhir.ts`)— al vocabulario de condiciones del catálogo y elige los ítems que
 * aplican al paciente en el momento pedido.
 *
 * Reglas de derivación iguales a `condicionesDesdeCkm` del monorepo, con la entrada de
 * Recepción (probabilidades PREVENT 0–1, umbrales en `src/config/ckm.ts`). Lo que no
 * sale de un número ni de la historia (cuestionarios, eventos, medicación que se inicia)
 * lo registra el equipo y entra como `extras`.
 *
 * Soporte a la decisión para el médico: el sistema no prescribe.
 */
import {
  ALERTAS_CATALOGO,
  CONDICIONES_CATALOGO,
  ETIQUETA_ESTADIO_CATALOGO,
  FIRMA_CATALOGO_PB100D,
  type AlertaCatalogo,
  type CondicionCatalogo,
  type EstadioCatalogo,
  type MomentoCatalogo,
  type TipoAlertaCatalogo,
} from '../config/catalogo-pb100d.js';
import { UMBRALES_CKM as U, UMBRALES_PREVENT_GUIA as P } from '../config/ckm.js';
import type { EntradaCkm, EstadioCkm, ResultadoCkm } from './ckm.js';
import type { RiesgosPrevent } from './ckm-guia.js';

export type { AlertaCatalogo, CondicionCatalogo, EstadioCatalogo, MomentoCatalogo, TipoAlertaCatalogo };

/** Estadío del catálogo más las condiciones del paciente, en el orden del catálogo. */
export interface PerfilCatalogo {
  estadio: EstadioCatalogo;
  condiciones: CondicionCatalogo[];
}

/** Momentos del catálogo que se evalúan en el informe SOM: el día 0 y los eventos ya presentes. */
export const MOMENTOS_INFORME_SOM: readonly MomentoCatalogo[] = ['dia-0', 'evento'];

const def = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

const CONDICIONES = new Set<string>(CONDICIONES_CATALOGO);
const ORDEN = new Map<CondicionCatalogo, number>(CONDICIONES_CATALOGO.map((c, i) => [c, i]));

/** Condiciones de medicación: con cualquiera de ellas el paciente "toma medicación". */
const MEDICACION = new Set<CondicionCatalogo>([
  'toma-glp1',
  'toma-sglt2i',
  'toma-rasi-mra',
  'toma-estatina',
  'toma-antitrombotico',
  'toma-antihipertensivo',
  'farmaco-obesidad',
]);

/** Factores del estadío 2 que cuentan para "≥ 2 factores cardiometabólicos" (FIB-4, apnea). */
const FACTORES_ESTADIO_2: readonly CondicionCatalogo[] = ['dm2', 'hta', 'tg-altos', 'erc', 'sindrome-metabolico'];

/** ¿Es una condición del catálogo? (para filtrar lo que registra el equipo). */
export function esCondicionCatalogo(valor: string): valor is CondicionCatalogo {
  return CONDICIONES.has(valor);
}

/** Estadío del catálogo (`'0'`..`'4'`) desde el de la estadificación (4a/4b → 4). */
export function estadioCatalogo(estadio: EstadioCkm): EstadioCatalogo {
  return estadio === '4a' || estadio === '4b' ? '4' : estadio;
}

/** Condiciones de riesgo PREVENT según la Tabla 8 (probabilidades 0–1). */
export function condicionesDesdePrevent(r: RiesgosPrevent): CondicionCatalogo[] {
  const out: CondicionCatalogo[] = [];
  if (def(r.ascvd10)) {
    if (r.ascvd10 >= P.ascvd10aIniciarHipolipemiante) out.push('prevent-ascvd-5');
    if (r.ascvd10 >= P.ascvd10aConsiderarHipolipemiante && r.ascvd10 < P.ascvd10aIniciarHipolipemiante) {
      out.push('prevent-ascvd-3-5');
    }
    if (r.ascvd10 >= P.ascvd10aEvaluarSubclinica.desde && r.ascvd10 < P.ascvd10aEvaluarSubclinica.hasta) {
      out.push('prevent-ascvd-3-10');
    }
  }
  if (def(r.ascvd30) && r.ascvd30 >= P.ascvd30aConsiderarHipolipemiante) out.push('prevent-ascvd-30-10');
  if (def(r.ecv10)) {
    if (r.ecv10 >= P.ecv10aPriorizar) out.push('prevent-cvd-7-5');
    if (r.ecv10 >= P.ecv10aEstadio3) out.push('prevent-alto');
  }
  if (def(r.ic10) && r.ic10 >= P.ic10aEvaluarPreIc) out.push('prevent-hf-5');
  return out;
}

/** Bandas de edad que condicionan ítems (30–59 PREVENT a 30 años; ≥ 40 y ≥ 50 estatina y cardioprotector; 65–79 fragilidad). */
export function condicionesDesdeEdad(edad: number): CondicionCatalogo[] {
  const out: CondicionCatalogo[] = [];
  if (edad >= 30 && edad <= 59) out.push('edad-30-59');
  if (edad >= 40 && edad <= 79) out.push('edad-40-79');
  if (edad >= 50 && edad <= 79) out.push('edad-50-79');
  if (edad >= 65 && edad <= 79) out.push('edad-65-79');
  return out;
}

const criterio = (ckm: ResultadoCkm, prefijo: string): boolean => ckm.criterios.some((c) => c.startsWith(prefijo));

/**
 * Condiciones del catálogo que se derivan de la estadificación, de los datos medidos y
 * del riesgo PREVENT, más las que registra el equipo (`extras`). Sin duplicados, en el
 * orden del catálogo.
 */
export function condicionesCatalogo(
  ckm: ResultadoCkm,
  e: EntradaCkm,
  riesgos: RiesgosPrevent = {},
  extras: Iterable<string> = [],
): CondicionCatalogo[] {
  const out = new Set<CondicionCatalogo>();
  const agregar = (...cs: readonly CondicionCatalogo[]): void => {
    for (const c of cs) out.add(c);
  };

  // ── Estadío 1: adiposidad y prediabetes ──
  if ((def(e.imc) && e.imc >= U.imc) || (def(e.cintura) && e.sexo && e.cintura >= U.cintura[e.sexo])) {
    agregar('exceso-adiposidad');
  }
  if (def(e.imc)) {
    if (e.imc >= 30) agregar('imc-30');
    if (e.imc >= 27) agregar('imc-27');
    if (e.imc >= 23 && e.imc < 25) agregar('imc-23-25');
  }
  if (criterio(ckm, 'prediabetes')) agregar('prediabetes');

  // ── Estadío 2: factores metabólicos y renales ──
  if (criterio(ckm, 'diabetes')) agregar('dm2');
  if (def(e.hba1c) && e.hba1c > 10) agregar('hba1c-10');
  if (criterio(ckm, 'hipertensión') || criterio(ckm, 'presión arterial')) agregar('hta');
  if (e.tratamientoHta) agregar('toma-antihipertensivo', 'hta');
  if ((def(e.pas) && e.pas >= 180) || (def(e.pad) && e.pad >= 110)) agregar('pa-180-110');
  if (
    !out.has('hta') &&
    def(e.pas) &&
    e.pas >= 120 &&
    e.pas < U.hipertension.pas &&
    (!def(e.pad) || e.pad < U.hipertension.pad)
  ) {
    agregar('pa-elevada');
  }
  if (criterio(ckm, 'hipertrigliceridemia')) agregar('tg-altos');
  if (def(e.trigliceridos) && e.trigliceridos >= 500) agregar('tg-500');
  if (criterio(ckm, 'síndrome metabólico')) agregar('sindrome-metabolico');
  if (ckm.riesgoKdigo && ckm.riesgoKdigo !== 'bajo') agregar('erc');
  if (ckm.riesgoKdigo === 'muy-alto') agregar('erc-muy-alto-riesgo');
  const fallaRenal =
    e.dialisis === true || (def(e.egfr) && e.egfr < U.egfrFallaRenal) || e.ercDiagnosticada === 'G5' || criterio(ckm, 'falla renal');
  if (fallaRenal) agregar('erc', 'erc-muy-alto-riesgo', 'falla-renal');
  if (e.dialisis) agregar('dialisis');
  if (def(e.uacr)) {
    if (e.uacr >= 30) agregar('uacr-30');
    if (e.uacr >= 100) agregar('uacr-100');
    if (e.uacr >= 200) agregar('uacr-200');
  }
  if (def(e.egfr)) {
    if (e.egfr < U.kdigo.g3b) agregar('egfr-45');
    if (e.egfr < U.kdigo.g4) agregar('egfr-30');
  }

  // ── Estadío 3: ECV subclínica y equivalentes ──
  if (criterio(ckm, 'aterosclerosis subclínica')) agregar('aterosclerosis-subclinica');
  if (def(e.cac)) {
    if (e.cac === 0) agregar('cac-0');
    if (e.cac >= U.cac) agregar('cac-100');
    if (e.cac >= 1000) agregar('cac-1000');
  }
  if (def(e.itb) && e.itb <= U.itbBajo) agregar('itb-bajo');
  if (criterio(ckm, 'pre-IC')) agregar('pre-ic');
  if (criterio(ckm, 'PREVENT')) agregar('prevent-alto');
  const eco = e.ecocardiograma;
  const hayEco = Boolean(eco && Object.values(eco).some((v) => def(v as number | undefined)));
  if (!hayEco) agregar('sin-ecocardiograma');
  if (eco && ((def(eco.velocidadIt) && eco.velocidadIt > U.ecocardiograma.velocidadIt) || (def(eco.psap) && eco.psap > U.ecocardiograma.psap))) {
    agregar('hipertension-pulmonar');
  }
  agregar(...condicionesDesdePrevent(riesgos));

  // ── Estadío 4: ECV clínica documentada ──
  const ecv = new Set(e.ecvClinica ?? []);
  if (ecv.size > 0) agregar('ecv');
  if (ecv.has('coronaria')) agregar('coronaria');
  if (ecv.has('acv')) agregar('acv');
  if (ecv.has('arterial-periferica')) agregar('eap');
  if (ecv.has('fibrilacion-auricular')) agregar('fa');
  if (ecv.has('insuficiencia-cardiaca')) {
    agregar('ic');
    if (def(eco?.fevi)) {
      agregar(eco!.fevi! <= 40 ? 'hfref' : eco!.fevi! < 50 ? 'hfmref' : 'hfpef');
    }
  }

  // ── Edad, lo que registra el equipo y agregados ──
  if (def(e.edad)) agregar(...condicionesDesdeEdad(e.edad));
  for (const extra of extras) {
    if (esCondicionCatalogo(extra)) out.add(extra);
  }
  if (FACTORES_ESTADIO_2.filter((c) => out.has(c)).length >= 2) agregar('dos-o-mas-factores');
  if ([...out].some((c) => MEDICACION.has(c))) agregar('medicacion');

  return [...out].sort((a, b) => (ORDEN.get(a) ?? 0) - (ORDEN.get(b) ?? 0));
}

/** Perfil del catálogo (estadío + condiciones) de un paciente estadificado. */
export function perfilCatalogo(
  ckm: ResultadoCkm,
  e: EntradaCkm,
  riesgos: RiesgosPrevent = {},
  extras: Iterable<string> = [],
): PerfilCatalogo {
  return { estadio: estadioCatalogo(ckm.estadio), condiciones: condicionesCatalogo(ckm, e, riesgos, extras) };
}

/**
 * ¿El ítem aplica al perfil? Estadío incluido, todas las `condiciones`, alguna de
 * `algunaDe` (si las hay) y ninguna de `excluye`.
 */
export function aplicaAlerta(item: AlertaCatalogo, perfil: PerfilCatalogo): boolean {
  const tiene = new Set(perfil.condiciones);
  if (!item.estadios.includes(perfil.estadio)) return false;
  if ((item.condiciones ?? []).some((c) => !tiene.has(c))) return false;
  if (item.algunaDe && item.algunaDe.length > 0 && !item.algunaDe.some((c) => tiene.has(c))) return false;
  return !(item.excluye ?? []).some((c) => tiene.has(c));
}

export interface FiltroAlertas {
  /** Momentos a incluir (un ítem entra si comparte alguno). Sin filtro: todos. */
  momentos?: readonly MomentoCatalogo[];
  /** Tipos a incluir. Sin filtro: alertas y derivaciones. */
  tipos?: readonly TipoAlertaCatalogo[];
}

/** Alertas y derivaciones del catálogo que aplican al perfil, en el orden del catálogo. */
export function alertasCatalogo(perfil: PerfilCatalogo, filtro: FiltroAlertas = {}): AlertaCatalogo[] {
  return ALERTAS_CATALOGO.filter(
    (a) =>
      (!filtro.tipos || filtro.tipos.includes(a.tipo)) &&
      (!filtro.momentos || a.momentos.some((m) => filtro.momentos!.includes(m))) &&
      aplicaAlerta(a, perfil),
  );
}

const evidencia = (a: AlertaCatalogo): string =>
  [a.fuente, a.cor ? `COR ${a.cor}` : '', a.loe ? `LOE ${a.loe}` : ''].filter(Boolean).join('; ');

/** Una línea por ítem: código, título, texto y evidencia. */
export function lineaAlerta(a: AlertaCatalogo): string {
  return `- ${a.codigo} · ${a.titulo}: ${a.texto} [${evidencia(a)}]`;
}

/**
 * Resumen legible (para la nota del RiskAssessment, el prompt y el informe de
 * respaldo): cuántas alertas y derivaciones aplican y cuáles.
 */
export function resumenAlertasCatalogo(alertas: readonly AlertaCatalogo[], perfil: PerfilCatalogo): string {
  const alertasMedico = alertas.filter((a) => a.tipo === 'alerta');
  const derivaciones = alertas.filter((a) => a.tipo === 'derivacion');
  const encabezado =
    `Catálogo del Plan Bienestar 100 Días® (firmado el ${FIRMA_CATALOGO_PB100D}), ` +
    `Estadío ${perfil.estadio} (${ETIQUETA_ESTADIO_CATALOGO[perfil.estadio]}): `;
  if (alertas.length === 0) {
    return `${encabezado}ningún ítem al médico aplica con los datos disponibles.`;
  }
  const lineas = [
    `${encabezado}${alertasMedico.length} alerta(s) al médico y ${derivaciones.length} derivación(es) aplican con los datos ` +
      'disponibles. Soporte a la decisión con su umbral y evidencia; el sistema no prescribe.',
  ];
  if (alertasMedico.length) lineas.push('Alertas al médico:', ...alertasMedico.map(lineaAlerta));
  if (derivaciones.length) lineas.push('Derivaciones:', ...derivaciones.map(lineaAlerta));
  return lineas.join('\n');
}
