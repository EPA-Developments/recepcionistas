/**
 * Estadificación CKM (Cardiovascular-Renal-Metabólico) de la AHA — lógica pura,
 * sin FHIR ni red. Umbrales y fuente en `src/config/ckm.ts` (Ndumele 2023).
 *
 * Estadíos: 0 (sin factores CKM) · 1 (exceso/disfunción adiposa) · 2 (factores de
 * riesgo metabólicos o ERC de riesgo moderado/alto) · 3 (ECV subclínica o
 * equivalentes de riesgo: ERC de muy alto riesgo, riesgo PREVENT a 10 años ≥ 20 %)
 * · 4a / 4b (ECV clínica, sin / con falla renal).
 *
 * Con datos incompletos no se "adivina": el resultado es el estadío más alto que
 * los datos disponibles demuestran (`completo=false` → "al menos Estadío X") y la
 * lista de lo que falta para descartar un estadío mayor.
 */
import { UMBRALES_CKM as U } from '../config/ckm.js';

export type EstadioCkm = '0' | '1' | '2' | '3' | '4a' | '4b';
export type RiesgoKdigo = 'bajo' | 'moderado' | 'alto' | 'muy-alto';

/** ECV clínica documentada (problemas activos). */
export type EcvClinica = 'coronaria' | 'insuficiencia-cardiaca' | 'acv' | 'arterial-periferica' | 'fibrilacion-auricular';

export interface EntradaCkm {
  sexo?: 'female' | 'male';
  /** kg/m². */
  imc?: number;
  /** Circunferencia de cintura, cm. */
  cintura?: number;
  /** Glucemia en ayunas, mg/dL. */
  glucemiaAyunas?: number;
  /** HbA1c, %. */
  hba1c?: number;
  /** Presión arterial sistólica / diastólica, mmHg. */
  pas?: number;
  pad?: number;
  /** En tratamiento antihipertensivo. */
  tratamientoHta?: boolean;
  /** Hipertensión diagnosticada (problema activo). */
  hipertension?: boolean;
  /** Diabetes diagnosticada (problema activo). */
  diabetes?: boolean;
  /** mg/dL. */
  trigliceridos?: number;
  hdl?: number;
  /** mL/min/1,73 m². */
  egfr?: number;
  /** Albúmina/creatinina en orina, mg/g. */
  uacr?: number;
  /** Categoría G de ERC diagnosticada (si no hay eGFR). */
  ercDiagnosticada?: 'G3' | 'G4' | 'G5';
  /** Diálisis crónica. */
  dialisis?: boolean;
  /** Calcio coronario (Agatston). */
  cac?: number;
  /** pg/mL. */
  ntProBnp?: number;
  /** Troponina T / I de alta sensibilidad, ng/L. */
  hsTnT?: number;
  hsTnI?: number;
  /** Riesgo PREVENT a 10 años (probabilidades 0–1). */
  riesgo10a?: { ascvd?: number; ic?: number; ecvTotal?: number };
  /** ECV clínica documentada. */
  ecvClinica?: EcvClinica[];
}

export interface ResultadoCkm {
  estadio: EstadioCkm;
  /** false si faltan datos que podrían subir el estadío ("al menos Estadío X"). */
  completo: boolean;
  /** Criterios cumplidos (texto clínico, en español). */
  criterios: string[];
  /** Datos básicos que faltan para descartar un estadío mayor (hacen `completo=false`). */
  faltantes: string[];
  /**
   * Estudios que no están y son los que definen ECV subclínica (Estadío 3). No se
   * piden a todos: se informan para que el médico decida; no afectan `completo`.
   */
  subclinicaSinEvaluar: string[];
  /** Advertencias de interpretación. */
  observaciones: string[];
  /** true mientras los umbrales no tengan la firma del equipo médico. */
  pendienteValidacion: boolean;
}

const ETIQUETA_ECV: Record<EcvClinica, string> = {
  coronaria: 'enfermedad coronaria',
  'insuficiencia-cardiaca': 'insuficiencia cardíaca',
  acv: 'ACV',
  'arterial-periferica': 'enfermedad arterial periférica',
  'fibrilacion-auricular': 'fibrilación auricular',
};

const def = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Categoría KDIGO de filtrado (G1–G5). */
export function categoriaG(egfr: number): 'G1' | 'G2' | 'G3a' | 'G3b' | 'G4' | 'G5' {
  const k = U.kdigo;
  if (egfr >= k.g2) return 'G1';
  if (egfr >= k.g3a) return 'G2';
  if (egfr >= k.g3b) return 'G3a';
  if (egfr >= k.g4) return 'G3b';
  if (egfr >= k.g5) return 'G4';
  return 'G5';
}

/** Categoría KDIGO de albuminuria (A1–A3). */
export function categoriaA(uacr: number): 'A1' | 'A2' | 'A3' {
  if (uacr > U.kdigo.a3) return 'A3';
  if (uacr >= U.kdigo.a2) return 'A2';
  return 'A1';
}

const ORDEN_RIESGO: RiesgoKdigo[] = ['bajo', 'moderado', 'alto', 'muy-alto'];

/** Mapa de calor KDIGO (G × A). G1–G2 con A1 no es ERC ("bajo"). */
const MAPA_KDIGO: Record<string, RiesgoKdigo[]> = {
  //          A1          A2          A3
  G1: ['bajo', 'moderado', 'alto'],
  G2: ['bajo', 'moderado', 'alto'],
  G3a: ['moderado', 'alto', 'muy-alto'],
  G3b: ['alto', 'muy-alto', 'muy-alto'],
  G4: ['muy-alto', 'muy-alto', 'muy-alto'],
  G5: ['muy-alto', 'muy-alto', 'muy-alto'],
};

/**
 * Riesgo KDIGO con lo que haya: con eGFR y UACR es exacto; con uno solo es el
 * mínimo que ese dato garantiza (`completo=false`).
 */
export function riesgoKdigo(
  egfr: number | undefined,
  uacr: number | undefined,
): { riesgo?: RiesgoKdigo; completo: boolean } {
  const indiceA = { A1: 0, A2: 1, A3: 2 } as const;
  if (def(egfr) && def(uacr)) {
    return { riesgo: MAPA_KDIGO[categoriaG(egfr)]![indiceA[categoriaA(uacr)]], completo: true };
  }
  if (def(egfr)) {
    // Sin albuminuria: el mínimo es la columna A1 de su fila.
    return { riesgo: MAPA_KDIGO[categoriaG(egfr)]![0], completo: false };
  }
  if (def(uacr)) {
    // Sin filtrado: el mínimo es la fila G1 de su columna.
    return { riesgo: MAPA_KDIGO.G1![indiceA[categoriaA(uacr)]], completo: false };
  }
  return { completo: false };
}

const mayorOIgual = (a: RiesgoKdigo | undefined, b: RiesgoKdigo): boolean =>
  a !== undefined && ORDEN_RIESGO.indexOf(a) >= ORDEN_RIESGO.indexOf(b);

/** Estadificación CKM (AHA 2023) con los datos disponibles. */
export function estadificarCkm(e: EntradaCkm): ResultadoCkm {
  const criterios: string[] = [];
  const faltantes: string[] = [];
  const subclinicaSinEvaluar: string[] = [];
  const observaciones: string[] = [];

  // ───────── Estadío 1: exceso / disfunción adiposa ─────────
  const e1: string[] = [];
  if (def(e.imc) && e.imc >= U.imc) e1.push(`IMC ${e.imc} kg/m² (≥ ${U.imc})`);
  if (def(e.cintura) && e.sexo && e.cintura >= U.cintura[e.sexo]) {
    e1.push(`cintura ${e.cintura} cm (≥ ${U.cintura[e.sexo]})`);
  }
  const prediabetesGlu = def(e.glucemiaAyunas) && e.glucemiaAyunas >= U.prediabetes.glucemia && e.glucemiaAyunas < U.diabetes.glucemia;
  const prediabetesA1c = def(e.hba1c) && e.hba1c >= U.prediabetes.hba1c && e.hba1c < U.diabetes.hba1c;
  if (prediabetesGlu || prediabetesA1c) e1.push('prediabetes (glucemia 100–125 mg/dL o HbA1c 5,7–6,4 %)');

  // ───────── Estadío 2: factores metabólicos o ERC ─────────
  const e2: string[] = [];
  if (def(e.trigliceridos) && e.trigliceridos >= U.trigliceridos) {
    e2.push(`hipertrigliceridemia (${e.trigliceridos} mg/dL, ≥ ${U.trigliceridos})`);
  }
  const htaPorValor =
    (def(e.pas) && e.pas >= U.hipertension.pas) || (def(e.pad) && e.pad >= U.hipertension.pad);
  if (e.hipertension || e.tratamientoHta || htaPorValor) {
    e2.push(
      e.hipertension || e.tratamientoHta
        ? 'hipertensión (diagnóstico o tratamiento)'
        : `presión arterial ${e.pas ?? '—'}/${e.pad ?? '—'} mmHg (≥ 130/80)`,
    );
  }
  const diabetesPorValor =
    (def(e.glucemiaAyunas) && e.glucemiaAyunas >= U.diabetes.glucemia) || (def(e.hba1c) && e.hba1c >= U.diabetes.hba1c);
  if (e.diabetes || diabetesPorValor) e2.push('diabetes');
  const sm = sindromeMetabolico(e);
  if (sm.cumple) e2.push(`síndrome metabólico (${sm.componentes} de 5 componentes)`);

  const kdigo = riesgoKdigo(e.egfr, e.uacr);
  let riesgoRenal = kdigo.riesgo;
  if (!def(e.egfr) && e.ercDiagnosticada) {
    const porDiagnostico: RiesgoKdigo = e.ercDiagnosticada === 'G3' ? 'moderado' : 'muy-alto';
    if (!mayorOIgual(riesgoRenal, porDiagnostico)) riesgoRenal = porDiagnostico;
  }
  if (mayorOIgual(riesgoRenal, 'moderado') && !mayorOIgual(riesgoRenal, 'muy-alto')) {
    e2.push(`ERC de riesgo ${riesgoRenal} (KDIGO)`);
  }

  // ───────── Estadío 3: ECV subclínica o equivalentes de riesgo ─────────
  const sustrato = e1.length > 0 || e2.length > 0 || mayorOIgual(riesgoRenal, 'moderado');
  const subclinica: string[] = [];
  if (def(e.cac) && e.cac > U.cacMayorA) subclinica.push(`aterosclerosis subclínica (calcio coronario ${e.cac})`);
  if (def(e.ntProBnp) && e.ntProBnp >= U.ntProBnp) subclinica.push(`IC subclínica (NT-proBNP ${e.ntProBnp} pg/mL, ≥ ${U.ntProBnp})`);
  if (def(e.hsTnT) && e.sexo && e.hsTnT >= U.hsTnT[e.sexo]) {
    subclinica.push(`IC subclínica (troponina T us ${e.hsTnT} ng/L, ≥ ${U.hsTnT[e.sexo]})`);
  }
  if (def(e.hsTnI) && e.sexo && e.hsTnI >= U.hsTnI[e.sexo]) {
    subclinica.push(`IC subclínica (troponina I us ${e.hsTnI} ng/L, ≥ ${U.hsTnI[e.sexo]})`);
  }
  const e3: string[] = [];
  if (subclinica.length > 0) {
    if (sustrato) {
      e3.push(...subclinica);
    } else {
      observaciones.push(
        `${subclinica.join('; ')}: sin factores CKM documentados no corresponde Estadío 3 CKM; verificar datos.`,
      );
    }
  }
  if (mayorOIgual(riesgoRenal, 'muy-alto')) e3.push('ERC de muy alto riesgo (KDIGO)');
  const r10 = e.riesgo10a ?? {};
  const riesgoAlto = [r10.ecvTotal, r10.ascvd, r10.ic].some((p) => def(p) && p >= U.riesgoEcv10a);
  if (riesgoAlto) e3.push('riesgo PREVENT a 10 años ≥ 20 %');

  // ───────── Estadío 4: ECV clínica ─────────
  const ecv = [...new Set(e.ecvClinica ?? [])];
  const fallaRenal = e.dialisis === true || (def(e.egfr) && e.egfr < U.egfrFallaRenal) || e.ercDiagnosticada === 'G5';
  let estadio: EstadioCkm;
  if (ecv.length > 0 && (sustrato || e3.length > 0)) {
    estadio = fallaRenal ? '4b' : '4a';
    criterios.push(`ECV clínica: ${ecv.map((x) => ETIQUETA_ECV[x]).join(', ')}`);
    if (fallaRenal) criterios.push('falla renal (eGFR < 15 o diálisis)');
  } else if (ecv.length > 0) {
    // ECV clínica sin sustrato CKM documentado: no se afirma Estadío 4 CKM.
    estadio = e3.length > 0 ? '3' : e2.length > 0 ? '2' : e1.length > 0 ? '1' : '0';
    observaciones.push(
      `ECV clínica (${ecv.map((x) => ETIQUETA_ECV[x]).join(', ')}) sin factores CKM documentados: ` +
        'Estadío 4 CKM requiere además adiposidad, factores metabólicos o ERC. Completar los datos.',
    );
  } else if (e3.length > 0) {
    estadio = '3';
  } else if (e2.length > 0) {
    estadio = '2';
  } else if (e1.length > 0) {
    estadio = '1';
  } else {
    estadio = '0';
  }
  criterios.push(...e3, ...e2, ...e1);

  // ───────── Qué falta para descartar un estadío mayor ─────────
  const nivel = { '0': 0, '1': 1, '2': 2, '3': 3, '4a': 4, '4b': 4 }[estadio];
  if (nivel < 1) {
    if (!def(e.imc)) faltantes.push('IMC');
    if (!def(e.cintura)) faltantes.push('circunferencia de cintura');
    else if (!e.sexo) faltantes.push('sexo del paciente');
  }
  if (nivel < 2) {
    if (!def(e.glucemiaAyunas) && !def(e.hba1c) && !e.diabetes) faltantes.push('glucemia en ayunas o HbA1c');
    if (!def(e.trigliceridos)) faltantes.push('triglicéridos');
    if (!def(e.pas) && !e.hipertension && !e.tratamientoHta) faltantes.push('presión arterial');
  }
  if (nivel < 3) {
    if (!def(e.egfr) && !e.ercDiagnosticada) faltantes.push('eGFR');
    if (!def(e.uacr) && !mayorOIgual(riesgoRenal, 'muy-alto')) faltantes.push('albuminuria (UACR)');
    if (!def(r10.ecvTotal) && !riesgoAlto) faltantes.push('riesgo PREVENT de ECV total a 10 años');
    if (sustrato && !def(e.ntProBnp) && !def(e.hsTnT) && !def(e.hsTnI)) subclinicaSinEvaluar.push('NT-proBNP o troponina us');
    if (sustrato && !def(e.cac)) subclinicaSinEvaluar.push('calcio coronario');
  }
  if (!e.sexo && (def(e.cintura) || def(e.hsTnT) || def(e.hsTnI) || def(e.hdl))) {
    observaciones.push('Sin sexo registrado no se aplican los umbrales por sexo (cintura, HDL, troponinas).');
  }

  return {
    estadio,
    completo: faltantes.length === 0,
    criterios,
    faltantes,
    subclinicaSinEvaluar,
    observaciones,
    pendienteValidacion: true,
  };
}

/** Síndrome metabólico (≥ 3 de 5), con los componentes que se conocen. */
function sindromeMetabolico(e: EntradaCkm): { cumple: boolean; componentes: number } {
  const s = U.sindromeMetabolico;
  let n = 0;
  if (def(e.cintura) && e.sexo && e.cintura >= s.cintura[e.sexo]) n++;
  if (def(e.trigliceridos) && e.trigliceridos >= s.trigliceridos) n++;
  if (def(e.hdl) && e.sexo && e.hdl < s.hdl[e.sexo]) n++;
  if ((def(e.pas) && e.pas >= s.pas) || (def(e.pad) && e.pad >= s.pad) || e.tratamientoHta) n++;
  if ((def(e.glucemiaAyunas) && e.glucemiaAyunas >= s.glucemia) || e.diabetes) n++;
  return { cumple: n >= 3, componentes: n };
}

/** Texto del estadío ("Estadío 2", "al menos Estadío 1"). */
export function etiquetaEstadio(r: ResultadoCkm): string {
  return `${r.completo ? '' : 'al menos '}Estadío ${r.estadio}`;
}

/** Resumen legible (para el prompt, el PDF y la nota del RiskAssessment). */
export function resumenCkm(r: ResultadoCkm): string {
  const lineas = [`Estadificación CKM (AHA 2023): ${etiquetaEstadio(r)}.`];
  lineas.push(r.criterios.length ? `Criterios: ${r.criterios.join('; ')}.` : 'Sin criterios CKM con los datos disponibles.');
  if (r.faltantes.length) lineas.push(`Faltan para descartar un estadío mayor: ${r.faltantes.join(', ')}.`);
  if (r.subclinicaSinEvaluar.length) {
    lineas.push(`ECV subclínica no evaluada (sin ${r.subclinicaSinEvaluar.join(' ni ')}).`);
  }
  lineas.push(...r.observaciones);
  if (r.pendienteValidacion) lineas.push('Umbrales pendientes de validación por el equipo médico.');
  return lineas.join('\n');
}
