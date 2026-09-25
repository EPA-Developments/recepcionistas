/**
 * PREVENT (AHA) — riesgo cardiovascular a 10 y 30 años. Lógica pura, testeable.
 *
 * Ecuaciones del modelo BASE (sin UACR / HbA1c / SDI), sexo-específicas, para los
 * tres desenlaces de la AHA: ECV total (PREVENT-CVD: ASCVD + IC), ASCVD e
 * insuficiencia cardíaca (IC), a 10 y 30 años.
 *
 * Fuente: Khan SS, et al. "Development and Validation of the American Heart
 * Association's PREVENT Equations." Circulation. 2024;149:430–449
 * (doi:10.1161/CIRCULATIONAHA.123.067626), tablas suplementarias del modelo base.
 * Los coeficientes NO están transcriptos a mano: se generaron desde la tabla de la
 * implementación de referencia `preventr` (CRAN, M. G. Mayer; `R/sysdata.rda`,
 * `base_10yr` / `base_30yr`), con sus mismas transformaciones de variables, y el
 * resultado coincide con el ejemplo publicado del paquete (ver tests/prevent.test.ts).
 *
 * Uso según la Guía CKM 2026 (AHA/ACC/ADA/ASN, Tabla 8): PREVENT-CVD a 10 años es la
 * ecuación principal (≥ 20 % = equivalente de riesgo del Estadío 3; ≥ 7,5 % prioriza
 * tratamientos); no se aplica con ECV clínica (Estadío 4): eso lo decide el llamador.
 *
 * Rangos válidos (como la calculadora de la AHA y `preventr`): edad 30–79 años;
 * colesterol total 130–320 y HDL 20–100 mg/dL; PAS 90–180 mmHg; eGFR 15–140;
 * IMC 18,5–39,9 kg/m² (solo IC). El riesgo a 30 años se estima para 30–59 años.
 * Fuera de rango no se estima (queda en `noEstimadas` con el motivo).
 *
 * `PENDIENTE_VALIDACION`: los números viajan como estimación preliminar hasta la
 * firma del equipo médico (Gobernanza).
 */

export const PENDIENTE_VALIDACION = true;

export type Sexo = 'female' | 'male';
export type Desenlace = 'ascvd' | 'heart-failure' | 'total-cvd';
export type Horizonte = 10 | 30;

export interface EntradaPrevent {
  sexo: Sexo;
  /** Edad en años (modelo válido 30–79). */
  edad: number;
  /** Colesterol total en mg/dL. */
  colesterolTotalMgDl: number;
  /** HDL en mg/dL. */
  hdlMgDl: number;
  /** Presión arterial sistólica en mmHg. */
  sbp: number;
  /** En tratamiento antihipertensivo. */
  tratamientoHta: boolean;
  /** Diabetes. */
  diabetes: boolean;
  /** Fumador actual. */
  fumador: boolean;
  /** Filtrado glomerular estimado (eGFR) en mL/min/1,73 m². */
  egfr: number;
  /** En tratamiento con estatina. */
  estatina: boolean;
  /** Índice de masa corporal (kg/m²). Requerido para IC. */
  imc?: number;
}

export interface PrediccionPrevent {
  desenlace: Desenlace;
  horizonte: Horizonte;
  /** Probabilidad 0–1. */
  probabilidad: number;
  /** Etiqueta humana del desenlace (para RiskAssessment.prediction.outcome.text). */
  etiqueta: string;
}

/** Un desenlace que no se pudo estimar, con el motivo. */
export interface NoEstimada {
  desenlace: Desenlace;
  horizonte: Horizonte;
  etiqueta: string;
  motivo: string;
}

export interface ResultadoPrevent {
  predicciones: PrediccionPrevent[];
  noEstimadas: NoEstimada[];
  /** true mientras los números no tengan la firma del equipo médico. */
  pendienteValidacion: boolean;
  /** Motivos de lo que no se pudo estimar (texto). */
  faltantes: string[];
}

type Clave = `${Desenlace}|${Horizonte}`;

export const ETIQUETAS_PREVENT: Record<Clave, string> = {
  'ascvd|10': 'ASCVD a 10 años',
  'heart-failure|10': 'Insuficiencia cardíaca a 10 años',
  'total-cvd|10': 'ECV total a 10 años',
  'ascvd|30': 'ASCVD a 30 años',
  'heart-failure|30': 'Insuficiencia cardíaca a 30 años',
  'total-cvd|30': 'ECV total a 30 años',
};

/**
 * Orden de salida. Los 3 primeros son el contrato con el portal (ASCVD 10a, IC 10a,
 * ECV total 30a), que los lee por texto y, si no, por posición.
 */
export const ORDEN_PREVENT: ReadonlyArray<{ desenlace: Desenlace; horizonte: Horizonte }> = [
  { desenlace: 'ascvd', horizonte: 10 },
  { desenlace: 'heart-failure', horizonte: 10 },
  { desenlace: 'total-cvd', horizonte: 30 },
  { desenlace: 'total-cvd', horizonte: 10 },
  { desenlace: 'ascvd', horizonte: 30 },
  { desenlace: 'heart-failure', horizonte: 30 },
];

/** Rangos válidos de las variables (calculadora de la AHA / `preventr`). */
export const RANGOS_PREVENT = {
  edad: [30, 79],
  edad30Anios: [30, 59],
  colesterolTotalMgDl: [130, 320],
  hdlMgDl: [20, 100],
  sbp: [90, 180],
  egfr: [15, 140],
  imc: [18.5, 39.9],
} as const;

const MMOL_POR_MG_DL = 0.02586; // colesterol mg/dL → mmol/L (como `preventr`)

type Terminos = Record<string, number>;

/**
 * Variables transformadas como en PREVENT: edad centrada en 55 (por 10 años),
 * colesterol en mmol/L, splines lineales por tramos para PAS (110), IMC (30) y
 * eGFR (60), e interacciones con la edad y con el tratamiento.
 */
function terminos(e: EntradaPrevent): Terminos {
  const edad = (e.edad - 55) / 10;
  const noHdl = (e.colesterolTotalMgDl - e.hdlMgDl) * MMOL_POR_MG_DL - 3.5;
  const hdl = (e.hdlMgDl * MMOL_POR_MG_DL - 1.3) / 0.3;
  const pasMayor110 = (Math.max(e.sbp, 110) - 130) / 20;
  const imc = e.imc ?? 25;
  const imcMayor30 = (Math.max(imc, 30) - 30) / 5;
  const egfrMenor60 = (Math.min(e.egfr, 60) - 60) / -15;
  const diabetes = e.diabetes ? 1 : 0;
  const fumador = e.fumador ? 1 : 0;
  const tratamientoHta = e.tratamientoHta ? 1 : 0;
  const estatina = e.estatina ? 1 : 0;
  return {
    edad,
    edad2: edad * edad,
    noHdl,
    hdl,
    pasMenor110: (Math.min(e.sbp, 110) - 110) / 20,
    pasMayor110,
    diabetes,
    fumador,
    imcMenor30: (Math.min(imc, 30) - 25) / 5,
    imcMayor30,
    egfrMenor60,
    egfrMayor60: (Math.max(e.egfr, 60) - 90) / -15,
    tratamientoHta,
    estatina,
    tratamientoHtaPas: tratamientoHta * pasMayor110,
    estatinaNoHdl: estatina * noHdl,
    edadNoHdl: edad * noHdl,
    edadHdl: edad * hdl,
    edadPas: edad * pasMayor110,
    edadDiabetes: edad * diabetes,
    edadFumador: edad * fumador,
    edadImc: edad * imcMayor30,
    edadEgfr: edad * egfrMenor60,
    constante: 1,
  };
}

/**
 * Coeficientes del modelo base (log-odds; solo los distintos de cero). Generados
 * desde `preventr` (`base_10yr` / `base_30yr`); no editar a mano.
 */
const COEFICIENTES: Record<`${Sexo}|${Clave}`, Terminos> = {
  'female|total-cvd|10': { edad: 0.7939329, noHdl: 0.0305239, hdl: -0.1606857, pasMenor110: -0.2394003, pasMayor110: 0.3600781, diabetes: 0.8667604, fumador: 0.5360739, egfrMenor60: 0.6045917, egfrMayor60: 0.0433769, tratamientoHta: 0.3151672, estatina: -0.1477655, tratamientoHtaPas: -0.0663612, estatinaNoHdl: 0.1197879, edadNoHdl: -0.0819715, edadHdl: 0.0306769, edadPas: -0.0946348, edadDiabetes: -0.27057, edadFumador: -0.078715, edadEgfr: -0.1637806, constante: -3.307728 },
  'female|ascvd|10': { edad: 0.719883, noHdl: 0.1176967, hdl: -0.151185, pasMenor110: -0.0835358, pasMayor110: 0.3592852, diabetes: 0.8348585, fumador: 0.4831078, egfrMenor60: 0.4864619, egfrMayor60: 0.0397779, tratamientoHta: 0.2265309, estatina: -0.0592374, tratamientoHtaPas: -0.0395762, estatinaNoHdl: 0.0844423, edadNoHdl: -0.0567839, edadHdl: 0.0325692, edadPas: -0.1035985, edadDiabetes: -0.2417542, edadFumador: -0.0791142, edadEgfr: -0.1671492, constante: -3.819975 },
  'female|heart-failure|10': { edad: 0.8998235, pasMenor110: -0.4559771, pasMayor110: 0.3576505, diabetes: 1.038346, fumador: 0.583916, imcMenor30: -0.0072294, imcMayor30: 0.2997706, egfrMenor60: 0.7451638, egfrMayor60: 0.0557087, tratamientoHta: 0.3534442, tratamientoHtaPas: -0.0981511, edadPas: -0.0946663, edadDiabetes: -0.3581041, edadFumador: -0.1159453, edadImc: -0.003878, edadEgfr: -0.1884289, constante: -4.310409 },
  'male|total-cvd|10': { edad: 0.7688528, noHdl: 0.0736174, hdl: -0.0954431, pasMenor110: -0.4347345, pasMayor110: 0.3362658, diabetes: 0.7692857, fumador: 0.4386871, egfrMenor60: 0.5378979, egfrMayor60: 0.0164827, tratamientoHta: 0.288879, estatina: -0.1337349, tratamientoHtaPas: -0.0475924, estatinaNoHdl: 0.150273, edadNoHdl: -0.0517874, edadHdl: 0.0191169, edadPas: -0.1049477, edadDiabetes: -0.2251948, edadFumador: -0.0895067, edadEgfr: -0.1543702, constante: -3.031168 },
  'male|ascvd|10': { edad: 0.7099847, noHdl: 0.1658663, hdl: -0.1144285, pasMenor110: -0.2837212, pasMayor110: 0.3239977, diabetes: 0.7189597, fumador: 0.3956973, egfrMenor60: 0.3690075, egfrMayor60: 0.0203619, tratamientoHta: 0.2036522, estatina: -0.0865581, tratamientoHtaPas: -0.0322916, estatinaNoHdl: 0.114563, edadNoHdl: -0.0300005, edadHdl: 0.0232747, edadPas: -0.0927024, edadDiabetes: -0.2018525, edadFumador: -0.0970527, edadEgfr: -0.1217081, constante: -3.500655 },
  'male|heart-failure|10': { edad: 0.8972642, pasMenor110: -0.6811466, pasMayor110: 0.3634461, diabetes: 0.923776, fumador: 0.5023736, imcMenor30: -0.0485841, imcMayor30: 0.3726929, egfrMenor60: 0.6926917, egfrMayor60: 0.0251827, tratamientoHta: 0.2980922, tratamientoHtaPas: -0.0497731, edadPas: -0.1289201, edadDiabetes: -0.3040924, edadFumador: -0.1401688, edadImc: 0.0068126, edadEgfr: -0.1797778, constante: -3.946391 },
  'female|total-cvd|30': { edad: 0.5503079, edad2: -0.0928369, noHdl: 0.0409794, hdl: -0.1663306, pasMenor110: -0.1628654, pasMayor110: 0.3299505, diabetes: 0.6793894, fumador: 0.3196112, egfrMenor60: 0.1857101, egfrMayor60: 0.0553528, tratamientoHta: 0.2894, estatina: -0.075688, tratamientoHtaPas: -0.056367, estatinaNoHdl: 0.1071019, edadNoHdl: -0.0751438, edadHdl: 0.0301786, edadPas: -0.0998776, edadDiabetes: -0.3206166, edadFumador: -0.1607862, edadEgfr: -0.1450788, constante: -1.318827 },
  'female|ascvd|30': { edad: 0.4669202, edad2: -0.0893118, noHdl: 0.1256901, hdl: -0.1542255, pasMenor110: -0.0018093, pasMayor110: 0.322949, diabetes: 0.6296707, fumador: 0.268292, egfrMenor60: 0.100106, egfrMayor60: 0.0499663, tratamientoHta: 0.1875292, estatina: 0.0152476, tratamientoHtaPas: -0.0276123, estatinaNoHdl: 0.0736147, edadNoHdl: -0.0521962, edadHdl: 0.0316918, edadPas: -0.1046101, edadDiabetes: -0.2727793, edadFumador: -0.1530907, edadEgfr: -0.1299149, constante: -1.974074 },
  'female|heart-failure|30': { edad: 0.6254374, edad2: -0.0983038, pasMenor110: -0.3919241, pasMayor110: 0.3142295, diabetes: 0.8330787, fumador: 0.3438651, imcMenor30: 0.0594874, imcMayor30: 0.2525536, egfrMenor60: 0.2981642, egfrMayor60: 0.0667159, tratamientoHta: 0.333921, tratamientoHtaPas: -0.0893177, edadPas: -0.0974299, edadDiabetes: -0.404855, edadFumador: -0.1982991, edadImc: -0.0035619, edadEgfr: -0.1564215, constante: -2.205379 },
  'male|total-cvd|30': { edad: 0.4627309, edad2: -0.0984281, noHdl: 0.0836088, hdl: -0.1029824, pasMenor110: -0.2140352, pasMayor110: 0.2904325, diabetes: 0.5331276, fumador: 0.2141914, egfrMenor60: 0.1155556, egfrMayor60: 0.0603775, tratamientoHta: 0.232714, estatina: -0.0272112, tratamientoHtaPas: -0.0384488, estatinaNoHdl: 0.134192, edadNoHdl: -0.0511759, edadHdl: 0.0165865, edadPas: -0.1101437, edadDiabetes: -0.2585943, edadFumador: -0.1566406, edadEgfr: -0.1166776, constante: -1.148204 },
  'male|ascvd|30': { edad: 0.3994099, edad2: -0.0937484, noHdl: 0.1744643, hdl: -0.120203, pasMenor110: -0.0665117, pasMayor110: 0.2753037, diabetes: 0.4790257, fumador: 0.1782635, egfrMenor60: -0.0218789, egfrMayor60: 0.0602553, tratamientoHta: 0.1421182, estatina: 0.0135996, tratamientoHtaPas: -0.0218265, estatinaNoHdl: 0.1013148, edadNoHdl: -0.0312619, edadHdl: 0.020673, edadPas: -0.0920935, edadDiabetes: -0.2159947, edadFumador: -0.1548811, edadEgfr: -0.0712547, constante: -1.736444 },
  'male|heart-failure|30': { edad: 0.5681541, edad2: -0.1048388, pasMenor110: -0.4761564, pasMayor110: 0.30324, diabetes: 0.6840338, fumador: 0.2656273, imcMenor30: 0.0833107, imcMayor30: 0.26999, egfrMenor60: 0.2541805, egfrMayor60: 0.0638923, tratamientoHta: 0.2583631, tratamientoHtaPas: -0.0391938, edadPas: -0.1269124, edadDiabetes: -0.3273572, edadFumador: -0.2043019, edadImc: -0.0182831, edadEgfr: -0.1342618, constante: -1.95751 },
};

function probabilidad(coef: Terminos, t: Terminos): number {
  let lp = 0;
  for (const [k, beta] of Object.entries(coef)) {
    lp += beta * (t[k] ?? 0);
  }
  return Math.exp(lp) / (1 + Math.exp(lp));
}

const fuera = (v: number | undefined, [min, max]: readonly [number, number]): boolean =>
  typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max;

/** Motivo por el que un desenlace no se puede estimar con esta entrada (o undefined). */
function motivoNoEstimable(e: EntradaPrevent, desenlace: Desenlace, horizonte: Horizonte): string | undefined {
  const r = RANGOS_PREVENT;
  if (fuera(e.edad, r.edad)) return 'edad fuera de 30–79 años';
  if (horizonte === 30 && fuera(e.edad, r.edad30Anios)) return 'el riesgo a 30 años se estima para 30–59 años';
  if (fuera(e.sbp, r.sbp)) return 'presión sistólica fuera de 90–180 mmHg';
  if (fuera(e.egfr, r.egfr)) return 'eGFR fuera de 15–140';
  if (desenlace === 'heart-failure') {
    if (e.imc === undefined) return 'falta IMC';
    if (fuera(e.imc, r.imc)) return 'IMC fuera de 18,5–39,9';
  } else {
    if (fuera(e.colesterolTotalMgDl, r.colesterolTotalMgDl)) return 'colesterol total fuera de 130–320 mg/dL';
    if (fuera(e.hdlMgDl, r.hdlMgDl)) return 'HDL fuera de 20–100 mg/dL';
  }
  return undefined;
}

/**
 * Riesgo PREVENT (modelo base): ECV total, ASCVD e IC a 10 y 30 años, en el orden de
 * `ORDEN_PREVENT`. Lo que no se puede estimar va a `noEstimadas` con su motivo.
 * Nunca lanza por datos faltantes o fuera de rango.
 */
export function calcularPrevent(e: EntradaPrevent): ResultadoPrevent {
  const t = terminos(e);
  const predicciones: PrediccionPrevent[] = [];
  const noEstimadas: NoEstimada[] = [];
  for (const { desenlace, horizonte } of ORDEN_PREVENT) {
    const etiqueta = ETIQUETAS_PREVENT[`${desenlace}|${horizonte}`];
    const motivo = motivoNoEstimable(e, desenlace, horizonte);
    if (motivo) {
      noEstimadas.push({ desenlace, horizonte, etiqueta, motivo });
      continue;
    }
    const coef = COEFICIENTES[`${e.sexo}|${desenlace}|${horizonte}`];
    predicciones.push({ desenlace, horizonte, etiqueta, probabilidad: probabilidad(coef, t) });
  }
  return {
    predicciones,
    noEstimadas,
    pendienteValidacion: PENDIENTE_VALIDACION,
    faltantes: noEstimadas.map((n) => `${n.etiqueta}: ${n.motivo}`),
  };
}

/** Probabilidad (0–1) de un desenlace, si se estimó. */
export function riesgoPrevent(r: ResultadoPrevent, desenlace: Desenlace, horizonte: Horizonte): number | undefined {
  return r.predicciones.find((p) => p.desenlace === desenlace && p.horizonte === horizonte)?.probabilidad;
}

/** Resultado sin estimación (p. ej. ECV clínica o datos faltantes), con el mismo motivo para todo. */
export function sinPrevent(motivo: string): ResultadoPrevent {
  const noEstimadas = ORDEN_PREVENT.map(({ desenlace, horizonte }) => ({
    desenlace,
    horizonte,
    etiqueta: ETIQUETAS_PREVENT[`${desenlace}|${horizonte}`],
    motivo,
  }));
  return {
    predicciones: [],
    noEstimadas,
    pendienteValidacion: PENDIENTE_VALIDACION,
    faltantes: noEstimadas.map((n) => `${n.etiqueta}: ${n.motivo}`),
  };
}
