/**
 * Estadificación del síndrome Cardiovascular-Renal-Metabólico (CKM) — lógica pura,
 * sin FHIR ni red. Criterios de la Guía CKM 2026 de la AHA/ACC/ADA/ASN (Tabla 4 y,
 * para pre-IC, Tabla 16); umbrales y fuente en `src/config/ckm.ts`.
 *
 * Estadíos (adultos):
 *  0  Sin factores de riesgo CKM.
 *  1  Exceso o disfunción del tejido adiposo: IMC ≥ 25, cintura ≥ 88/102 cm o
 *     prediabetes (glucemia 100–125 mg/dL o HbA1c 5,7–6,4 %).
 *  2  Factores de riesgo metabólicos, ERC o ambos: HTA (≥ 130/80 o tratamiento),
 *     triglicéridos ≥ 150, síndrome metabólico, DM2 (glucemia ≥ 126 o HbA1c ≥ 6,5 %)
 *     o ERC de riesgo moderado-alto (KDIGO).
 *  3  ECV subclínica con factores CKM (calcio coronario ≥ 100, aterosclerosis coronaria
 *     subclínica, índice tobillo-brazo bajo sin claudicación, o pre-IC) o sus
 *     equivalentes de riesgo: ERC de muy alto riesgo (KDIGO) o PREVENT-CVD a 10 años
 *     ≥ 20 %.
 *  4  ECV clínica (coronaria, IC, ACV, arterial periférica, FA) con factores CKM:
 *     4a sin falla renal · 4b con falla renal (eGFR < 15 o diálisis crónica).
 *
 * Con datos incompletos no se "adivina": el resultado es el estadío más alto que los
 * datos demuestran (`completo=false` → "al menos Estadío X") y la lista de lo que
 * falta para descartar un estadío mayor.
 */
import { UMBRALES_CKM as U } from '../config/ckm.js';

export type EstadioCkm = '0' | '1' | '2' | '3' | '4a' | '4b';
export type RiesgoKdigo = 'bajo' | 'moderado' | 'alto' | 'muy-alto';

/** ECV clínica documentada (problemas activos). */
export type EcvClinica = 'coronaria' | 'insuficiencia-cardiaca' | 'acv' | 'arterial-periferica' | 'fibrilacion-auricular';

/** Parámetros ecocardiográficos de pre-IC (Tabla 16). */
export interface Ecocardiograma {
  /** Volumen auricular izquierdo indexado, mL/m². */
  lavi?: number;
  /** Masa del VI indexada, g/m². */
  lvmi?: number;
  /** Espesor parietal relativo. */
  rwt?: number;
  /** Espesor de pared del VI, mm. */
  espesorPared?: number;
  /** Fracción de eyección del VI, %. */
  fevi?: number;
  /** Strain longitudinal global, % (se usa el valor absoluto). */
  gls?: number;
  /** e′ septal, cm/s. */
  eSeptal?: number;
  /** Velocidad de insuficiencia tricuspídea, m/s. */
  velocidadIt?: number;
  /** Presión sistólica pulmonar estimada, mmHg. */
  psap?: number;
  /** E/e′ promedio. */
  eSobreEPrima?: number;
}

export interface EntradaCkm {
  sexo?: 'female' | 'male';
  /** Años. */
  edad?: number;
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
  /** Cantidad de lecturas de presión arterial registradas. */
  lecturasPa?: number;
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
  /** ERC confirmada: eGFR < 60 o UACR ≥ 30 en ≥ 2 mediciones separadas ≥ 3 meses. */
  ercPersistente?: boolean;
  /** Categoría G de ERC diagnosticada (si no hay eGFR). */
  ercDiagnosticada?: 'G3' | 'G4' | 'G5';
  /** Diálisis crónica (reemplazo renal). */
  dialisis?: boolean;
  /** Calcio coronario (Agatston). */
  cac?: number;
  /** Aterosclerosis coronaria subclínica documentada (angio-TC, cateterismo, calcificación incidental moderada-severa). */
  aterosclerosisSubclinica?: boolean;
  /** Índice tobillo-brazo. */
  itb?: number;
  /** Claudicación intermitente (el ITB bajo con claudicación es EAP clínica). */
  claudicacion?: boolean;
  /** pg/mL. */
  ntProBnp?: number;
  bnp?: number;
  /** Troponina T / I de alta sensibilidad, ng/L. */
  hsTnT?: number;
  hsTnI?: number;
  ecocardiograma?: Ecocardiograma;
  /** Riesgo PREVENT a 10 años (probabilidades 0–1). `ecvTotal` = PREVENT-CVD. */
  riesgo10a?: { ascvd?: number; ic?: number; ecvTotal?: number };
  /** ECV clínica documentada. */
  ecvClinica?: EcvClinica[];
}

export interface ResultadoCkm {
  estadio: EstadioCkm;
  /** false si faltan datos que podrían subir el estadío ("al menos Estadío X"). */
  completo: boolean;
  /** Criterios cumplidos (texto clínico, en español), del estadío más alto al más bajo. */
  criterios: string[];
  /** Datos básicos que faltan para descartar un estadío mayor (hacen `completo=false`). */
  faltantes: string[];
  /**
   * ECV subclínica sin evaluar (pre-IC, aterosclerosis). No se pide a todos: cuándo
   * evaluarla lo sugiere el plan de la guía (`ckm-guia.ts`); no afecta `completo`.
   */
  subclinicaSinEvaluar: string[];
  /** Advertencias de interpretación. */
  observaciones: string[];
  /** Riesgo renal KDIGO usado, si se pudo determinar. */
  riesgoKdigo?: RiesgoKdigo;
  /** true mientras los umbrales no tengan la firma del equipo médico. */
  pendienteValidacion: boolean;
}

/** Nombre de cada estadío (Tabla 4). */
export const NOMBRE_ESTADIO: Record<EstadioCkm, string> = {
  '0': 'sin factores de riesgo CKM',
  '1': 'exceso o disfunción del tejido adiposo',
  '2': 'factores de riesgo metabólicos, ERC o ambos',
  '3': 'ECV subclínica en CKM',
  '4a': 'ECV clínica en CKM, sin falla renal',
  '4b': 'ECV clínica en CKM, con falla renal',
};

const ETIQUETA_ECV: Record<EcvClinica, string> = {
  coronaria: 'enfermedad coronaria',
  'insuficiencia-cardiaca': 'insuficiencia cardíaca',
  acv: 'ACV o AIT',
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

/** Categoría KDIGO de albuminuria: A1 < 30 · A2 30 a < 300 · A3 ≥ 300 mg/g. */
export function categoriaA(uacr: number): 'A1' | 'A2' | 'A3' {
  if (uacr >= U.kdigo.a3) return 'A3';
  if (uacr >= U.kdigo.a2) return 'A2';
  return 'A1';
}

const ORDEN_RIESGO: RiesgoKdigo[] = ['bajo', 'moderado', 'alto', 'muy-alto'];

/**
 * Mapa de calor KDIGO (G × A). La guía agrupa "moderado-alto" (Estadío 2: G1–G2 con
 * A2–A3, G3a con A1–A2, G3b con A1) y "muy alto" (Estadío 3: G3a con A3, G3b con
 * A2–A3, G4–G5). G1–G2 con A1 no es ERC ("bajo").
 */
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

const pct = (p: number): string => `${(p * 100).toFixed(1).replace('.', ',')} %`;

/** Criterios de pre-IC por ecocardiograma (Tabla 16) que se cumplen. */
export function preIcPorEcocardiograma(eco: Ecocardiograma | undefined, sexo?: 'female' | 'male'): string[] {
  if (!eco) return [];
  const u = U.ecocardiograma;
  const out: string[] = [];
  if (def(eco.lavi) && eco.lavi >= u.lavi) out.push(`volumen auricular izquierdo indexado ${eco.lavi} mL/m² (≥ ${u.lavi})`);
  if (def(eco.lvmi) && sexo && eco.lvmi > u.lvmi[sexo]) out.push(`masa del VI indexada ${eco.lvmi} g/m² (> ${u.lvmi[sexo]})`);
  if (def(eco.rwt) && eco.rwt > u.rwt) out.push(`espesor parietal relativo ${eco.rwt} (> ${u.rwt})`);
  if (def(eco.espesorPared) && eco.espesorPared >= u.espesorPared) out.push(`espesor de pared del VI ${eco.espesorPared} mm (≥ ${u.espesorPared})`);
  if (def(eco.fevi) && eco.fevi < u.fevi) out.push(`FEVI ${eco.fevi} % (< ${u.fevi})`);
  if (def(eco.gls) && Math.abs(eco.gls) < u.gls) out.push(`strain longitudinal global ${Math.abs(eco.gls)} % (< ${u.gls})`);
  if (def(eco.eSeptal) && eco.eSeptal < u.eSeptal) out.push(`e′ septal ${eco.eSeptal} cm/s (< ${u.eSeptal})`);
  if (def(eco.velocidadIt) && eco.velocidadIt > u.velocidadIt) out.push(`velocidad de IT ${eco.velocidadIt} m/s (> ${u.velocidadIt})`);
  if (def(eco.psap) && eco.psap > u.psap) out.push(`PSAP estimada ${eco.psap} mmHg (> ${u.psap})`);
  if (def(eco.eSobreEPrima) && eco.eSobreEPrima >= u.eSobreEPrima) out.push(`E/e′ ${eco.eSobreEPrima} (≥ ${u.eSobreEPrima})`);
  return out;
}

const hayEcocardiograma = (eco: Ecocardiograma | undefined): boolean =>
  Boolean(eco && Object.values(eco).some((v) => def(v as number | undefined)));

/** Estadificación CKM (Guía 2026, Tabla 4) con los datos disponibles. */
export function estadificarCkm(e: EntradaCkm): ResultadoCkm {
  const criterios: string[] = [];
  const faltantes: string[] = [];
  const subclinicaSinEvaluar: string[] = [];
  const observaciones: string[] = [];

  // ───────── Estadío 1: exceso / disfunción adiposa ─────────
  const e1: string[] = [];
  if (def(e.imc) && e.imc >= U.imc) e1.push(`IMC ${e.imc} kg/m² (≥ ${U.imc})`);
  const cinturaAlta = def(e.cintura) && e.sexo !== undefined && e.cintura >= U.cintura[e.sexo];
  if (cinturaAlta) e1.push(`cintura ${e.cintura} cm (≥ ${U.cintura[e.sexo!]})`);
  const prediabetesGlu =
    def(e.glucemiaAyunas) && e.glucemiaAyunas >= U.prediabetes.glucemia && e.glucemiaAyunas < U.diabetes.glucemia;
  const prediabetesA1c = def(e.hba1c) && e.hba1c >= U.prediabetes.hba1c && e.hba1c < U.diabetes.hba1c;
  if (prediabetesGlu || prediabetesA1c) e1.push('prediabetes (glucemia 100–125 mg/dL o HbA1c 5,7–6,4 %)');

  // ───────── Estadío 2: factores metabólicos, ERC o ambos ─────────
  const e2: string[] = [];
  if (def(e.trigliceridos) && e.trigliceridos >= U.trigliceridos) {
    e2.push(`hipertrigliceridemia (${e.trigliceridos} mg/dL, ≥ ${U.trigliceridos})`);
  }
  const htaPorValor = (def(e.pas) && e.pas >= U.hipertension.pas) || (def(e.pad) && e.pad >= U.hipertension.pad);
  if (e.hipertension || e.tratamientoHta) {
    e2.push('hipertensión (diagnóstico o tratamiento antihipertensivo)');
  } else if (htaPorValor) {
    e2.push(`presión arterial ${e.pas ?? '—'}/${e.pad ?? '—'} mmHg (≥ 130/80)`);
    if (e.lecturasPa !== undefined && e.lecturasPa < 2) {
      observaciones.push(
        'Hipertensión por una sola medición: la guía la define con el promedio de ≥ 2 lecturas en ≥ 2 ocasiones; confirmar.',
      );
    }
  }
  const diabetesPorValor =
    (def(e.glucemiaAyunas) && e.glucemiaAyunas >= U.diabetes.glucemia) || (def(e.hba1c) && e.hba1c >= U.diabetes.hba1c);
  if (e.diabetes || diabetesPorValor) e2.push('diabetes tipo 2');
  const sm = sindromeMetabolico(e);
  if (sm.cumple) e2.push(`síndrome metabólico (${sm.componentes} de 5 componentes, AHA/NHLBI)`);

  const kdigo = riesgoKdigo(e.egfr, e.uacr);
  let riesgoRenal = kdigo.riesgo;
  if (!def(e.egfr) && e.ercDiagnosticada) {
    const porDiagnostico: RiesgoKdigo = e.ercDiagnosticada === 'G3' ? 'moderado' : 'muy-alto';
    if (!mayorOIgual(riesgoRenal, porDiagnostico)) riesgoRenal = porDiagnostico;
  }
  if (mayorOIgual(riesgoRenal, 'moderado') && !mayorOIgual(riesgoRenal, 'muy-alto')) {
    e2.push(`ERC de riesgo ${riesgoRenal} (KDIGO)`);
  }
  const ercPorLaboratorio = mayorOIgual(kdigo.riesgo, 'moderado');
  if (ercPorLaboratorio && e.ercPersistente === false && !e.dialisis) {
    observaciones.push(
      'ERC por un único valor de laboratorio: la guía la define con eGFR < 60 o UACR ≥ 30 en ≥ 2 mediciones separadas ≥ 3 meses; confirmar.',
    );
  }

  // ───────── Estadío 3: ECV subclínica o equivalentes de riesgo ─────────
  const sustrato = e1.length > 0 || e2.length > 0 || mayorOIgual(riesgoRenal, 'moderado');
  const aterosclerosis: string[] = [];
  if (def(e.cac) && e.cac >= U.cac) aterosclerosis.push(`calcio coronario ${e.cac} (Agatston ≥ ${U.cac})`);
  if (e.aterosclerosisSubclinica) aterosclerosis.push('aterosclerosis coronaria subclínica documentada');
  if (def(e.itb) && e.itb <= U.itbBajo && !e.claudicacion) {
    aterosclerosis.push(`índice tobillo-brazo ${e.itb} (≤ ${U.itbBajo}) sin claudicación`);
  }
  const preIc: string[] = [];
  const porPeptidos =
    (def(e.ntProBnp) && e.ntProBnp >= U.ntProBnp) || (def(e.bnp) && e.bnp >= U.bnp);
  if (def(e.ntProBnp) && e.ntProBnp >= U.ntProBnp) preIc.push(`NT-proBNP ${e.ntProBnp} pg/mL (≥ ${U.ntProBnp})`);
  if (def(e.bnp) && e.bnp >= U.bnp) preIc.push(`BNP ${e.bnp} pg/mL (≥ ${U.bnp})`);
  if (def(e.hsTnT) && e.sexo && e.hsTnT >= U.hsTnT[e.sexo]) preIc.push(`troponina T us ${e.hsTnT} ng/L (≥ ${U.hsTnT[e.sexo]})`);
  if (def(e.hsTnI) && e.sexo && e.hsTnI >= U.hsTnI[e.sexo]) preIc.push(`troponina I us ${e.hsTnI} ng/L (≥ ${U.hsTnI[e.sexo]})`);
  const ecoPreIc = preIcPorEcocardiograma(e.ecocardiograma, e.sexo);
  preIc.push(...ecoPreIc);

  const subclinica = [
    ...(aterosclerosis.length ? [`aterosclerosis subclínica: ${aterosclerosis.join('; ')}`] : []),
    ...(preIc.length ? [`pre-IC: ${preIc.join('; ')}`] : []),
  ];
  const e3: string[] = [];
  if (subclinica.length > 0) {
    if (sustrato) {
      e3.push(...subclinica);
      if (porPeptidos && ecoPreIc.length > 0) {
        observaciones.push('Pre-IC por biomarcadores y ecocardiograma: la combinación indica el mayor riesgo de IC (Tabla 16).');
      }
      if (porPeptidos && mayorOIgual(riesgoRenal, 'moderado')) {
        observaciones.push('Con ERC los péptidos natriuréticos pierden especificidad (Tabla 16): interpretar con cautela.');
      }
    } else {
      observaciones.push(
        `${subclinica.join('; ')}: sin factores CKM documentados no corresponde Estadío 3 CKM; verificar datos.`,
      );
    }
  }
  if (mayorOIgual(riesgoRenal, 'muy-alto')) e3.push('ERC de muy alto riesgo (KDIGO: G3a-A3, G3b-A2/A3 o G4–G5)');
  const r10 = e.riesgo10a ?? {};
  if (def(r10.ecvTotal) && r10.ecvTotal >= U.riesgoEcv10a) {
    e3.push(`PREVENT-CVD a 10 años ${pct(r10.ecvTotal)} (≥ 20 %)`);
  } else if (!def(r10.ecvTotal) && [r10.ascvd, r10.ic].some((p) => def(p) && p >= U.riesgoEcv10a)) {
    // ASCVD e IC son componentes de la ECV total: si alguno llega a 20 %, la ECV total también.
    e3.push('PREVENT a 10 años ≥ 20 % (ASCVD o IC; la ECV total es mayor)');
  }

  // ───────── Estadío 4: ECV clínica ─────────
  const ecv = [...new Set(e.ecvClinica ?? [])];
  const fallaRenal =
    e.dialisis === true || (def(e.egfr) && e.egfr < U.egfrFallaRenal) || e.ercDiagnosticada === 'G5';
  let estadio: EstadioCkm;
  if (ecv.length > 0 && (sustrato || e3.length > 0)) {
    estadio = fallaRenal ? '4b' : '4a';
    criterios.push(`ECV clínica: ${ecv.map((x) => ETIQUETA_ECV[x]).join(', ')}`);
    if (fallaRenal) criterios.push('falla renal (eGFR < 15 o diálisis crónica)');
  } else if (ecv.length > 0) {
    // ECV clínica sin sustrato CKM documentado: no se afirma Estadío 4 CKM.
    estadio = e3.length > 0 ? '3' : e2.length > 0 ? '2' : e1.length > 0 ? '1' : '0';
    observaciones.push(
      `ECV clínica (${ecv.map((x) => ETIQUETA_ECV[x]).join(', ')}) sin factores CKM documentados: ` +
        'el Estadío 4 CKM requiere además adiposidad, factores metabólicos o ERC. Completar los datos.',
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
  }
  if (nivel < 2) {
    if (!def(e.glucemiaAyunas) && !def(e.hba1c) && !e.diabetes) faltantes.push('glucemia en ayunas o HbA1c');
    if (!def(e.trigliceridos)) faltantes.push('triglicéridos');
    if (!def(e.pas) && !e.hipertension && !e.tratamientoHta) faltantes.push('presión arterial');
    // HDL solo define el síndrome metabólico cuando ya hay cintura alta y glucemia ≥ 100.
    if (sm.componentes === 2 && !def(e.hdl)) faltantes.push('HDL (síndrome metabólico)');
  }
  if (nivel < 3) {
    if (!def(e.egfr) && !e.ercDiagnosticada) faltantes.push('eGFR');
    // UACR: la guía la indica desde el Estadío 2 (y define la ERC de muy alto riesgo).
    if (nivel === 2 && !def(e.uacr) && !mayorOIgual(riesgoRenal, 'muy-alto')) faltantes.push('albuminuria (UACR)');
    const prevAplica = !def(e.edad) || (e.edad >= 30 && e.edad <= 79);
    const riesgoAltoConocido = e3.some((c) => c.startsWith('PREVENT'));
    if (prevAplica && !def(r10.ecvTotal) && !riesgoAltoConocido) faltantes.push('PREVENT-CVD a 10 años');
    if (!prevAplica) {
      observaciones.push('PREVENT se valida para 30–79 años: no se usa el riesgo a 10 años como criterio del Estadío 3.');
    }
    if (sustrato) {
      if (!def(e.ntProBnp) && !def(e.bnp) && !def(e.hsTnT) && !def(e.hsTnI) && !hayEcocardiograma(e.ecocardiograma)) {
        subclinicaSinEvaluar.push('pre-IC (NT-proBNP/BNP, troponina us o ecocardiograma)');
      }
      if (!def(e.cac) && !e.aterosclerosisSubclinica && !def(e.itb)) {
        subclinicaSinEvaluar.push('aterosclerosis subclínica (calcio coronario)');
      }
    }
  }
  if (!e.sexo && (def(e.cintura) || def(e.hsTnT) || def(e.hsTnI) || def(e.hdl) || def(e.ecocardiograma?.lvmi))) {
    observaciones.push('Sin sexo registrado no se aplican los umbrales por sexo (cintura, HDL, troponinas, masa del VI).');
  }

  return {
    estadio,
    completo: faltantes.length === 0,
    criterios,
    faltantes,
    subclinicaSinEvaluar,
    observaciones,
    ...(riesgoRenal ? { riesgoKdigo: riesgoRenal } : {}),
    pendienteValidacion: true,
  };
}

/** Síndrome metabólico AHA/NHLBI (≥ 3 de 5), con los componentes que se conocen. */
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
  const lineas = [`Estadificación CKM (Guía AHA/ACC/ADA/ASN 2026): ${etiquetaEstadio(r)} — ${NOMBRE_ESTADIO[r.estadio]}.`];
  lineas.push(r.criterios.length ? `Criterios: ${r.criterios.join('; ')}.` : 'Sin criterios CKM con los datos disponibles.');
  if (r.faltantes.length) lineas.push(`Faltan para descartar un estadío mayor: ${r.faltantes.join(', ')}.`);
  if (r.subclinicaSinEvaluar.length) lineas.push(`ECV subclínica no evaluada: ${r.subclinicaSinEvaluar.join('; ')}.`);
  lineas.push(...r.observaciones);
  if (r.pendienteValidacion) lineas.push('Umbrales pendientes de validación por el equipo médico.');
  return lineas.join('\n');
}
