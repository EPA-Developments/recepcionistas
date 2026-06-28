/**
 * PREVENT (AHA 2023) — estimación de riesgo cardiovascular. Lógica pura, testeable.
 *
 * Implementa la maquinaria de las ecuaciones PREVENT (Predicting Risk of
 * cardiovascular disease EVENTs) de la American Heart Association para el modelo
 * BASE (sin HbA1c / UACR / SDI), sexo-específico, para los tres desenlaces que
 * pide el contrato SOM:
 *   - ASCVD a 10 años,
 *   - Insuficiencia cardíaca (IC) a 10 años,
 *   - ECV total a 30 años.
 *
 * Fuente: Khan SS, et al. "Development and Validation of the American Heart
 * Association's PREVENT Equations." Circulation. 2024;149:430–449
 * (doi:10.1161/CIRCULATIONAHA.123.067626), Tablas suplementarias del modelo base.
 *
 * ⚠️  VALIDACIÓN CLÍNICA PENDIENTE. Igual que el CodeSystem de contraindicaciones,
 * los COEFICIENTES de abajo son un BORRADOR transcripto de la publicación y DEBEN
 * validarse contra las tablas oficiales (y contra una calculadora de referencia,
 * p.ej. la del ACC) antes de usarse en producción. El flag `PENDIENTE_VALIDACION`
 * viaja en el resultado para que el bot lo estampe en el RiskAssessment y nadie
 * tome los números como definitivos sin la firma del equipo médico (Gobernanza).
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
  /** Filtrado glomerular estimado (eGFR) en mL/min/1.73m². */
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

export interface ResultadoPrevent {
  predicciones: PrediccionPrevent[];
  /** true mientras los coeficientes no estén validados clínicamente. */
  pendienteValidacion: boolean;
  /** Combinaciones que no se pudieron calcular (faltó coeficiente o dato). */
  faltantes: string[];
}

const MG_DL_POR_MMOL = 38.67; // colesterol mg/dL → mmol/L

/** Un término del predictor lineal: nombre legible + coeficiente. */
type Coeficientes = Record<string, number>;

interface ModeloPrevent {
  intercepto: number;
  coef: Coeficientes;
  /** Familia de predictores: 'chol' (ASCVD/CVD) usa colesterol; 'bmi' (IC) usa IMC. */
  familia: 'chol' | 'bmi';
  etiqueta: string;
}

/**
 * Construye los términos (centrados/transformados como en PREVENT) del predictor
 * lineal. `age` se centra en 55 y se divide por 10; el colesterol va en mmol/L.
 */
function terminos(e: EntradaPrevent, familia: 'chol' | 'bmi'): Coeficientes {
  const age = (e.edad - 55) / 10;
  const sbpMin = (Math.min(e.sbp, 110) - 110) / 20;
  const sbpMax = (Math.max(e.sbp, 110) - 130) / 20;
  const egfrMin = (Math.min(e.egfr, 60) - 60) / -15;
  const egfrMax = (Math.max(e.egfr, 60) - 90) / -15;
  const dm = e.diabetes ? 1 : 0;
  const smk = e.fumador ? 1 : 0;
  const htn = e.tratamientoHta ? 1 : 0;
  const statin = e.estatina ? 1 : 0;

  const t: Coeficientes = {
    age,
    sbpMin,
    sbpMax,
    dm,
    smk,
    egfrMin,
    egfrMax,
    htn,
    statin,
    'htn:sbpMax': htn * sbpMax,
    'age:sbpMax': age * sbpMax,
    'age:dm': age * dm,
    'age:smk': age * smk,
    'age:egfrMin': age * egfrMin,
  };

  if (familia === 'chol') {
    const nonHdl = (e.colesterolTotalMgDl - e.hdlMgDl) / MG_DL_POR_MMOL - 3.5;
    const hdl = (e.hdlMgDl / MG_DL_POR_MMOL - 1.3) / 0.3;
    t.nonHdl = nonHdl;
    t.hdl = hdl;
    t['statin:nonHdl'] = statin * nonHdl;
    t['age:nonHdl'] = age * nonHdl;
    t['age:hdl'] = age * hdl;
  } else {
    const bmi = ((e.imc ?? 0) - 30) / 5;
    t.bmi = bmi;
    t['age:bmi'] = age * bmi;
  }
  return t;
}

/** Predictor lineal · link logístico → probabilidad 0–1. */
function probabilidad(modelo: ModeloPrevent, e: EntradaPrevent): number {
  const t = terminos(e, modelo.familia);
  let lp = modelo.intercepto;
  for (const [k, beta] of Object.entries(modelo.coef)) {
    lp += beta * (t[k] ?? 0);
  }
  const p = Math.exp(lp) / (1 + Math.exp(lp));
  return Math.min(Math.max(p, 0), 1);
}

/**
 * ⚠️ BORRADOR — coeficientes PREVENT (modelo base) pendientes de validación.
 * Transcriptos de Khan 2024 (Circulation). Estructura lista; los valores deben
 * confirmarse contra las tablas oficiales antes de producción.
 */
const MODELOS: Partial<Record<`${Sexo}|${Desenlace}|${Horizonte}`, ModeloPrevent>> = {
  'female|ascvd|10': {
    familia: 'chol',
    etiqueta: 'ASCVD a 10 años',
    intercepto: -3.819975,
    coef: {
      age: 0.719883,
      nonHdl: 0.1176967,
      hdl: -0.151185,
      sbpMin: -0.0835358,
      sbpMax: 0.3592852,
      dm: 0.8348585,
      smk: 0.4831078,
      egfrMin: 0.4864619,
      egfrMax: 0.0397779,
      htn: 0.2265309,
      statin: -0.0592374,
      'htn:sbpMax': -0.0395762,
      'statin:nonHdl': 0.0844423,
      'age:nonHdl': -0.0567839,
      'age:hdl': 0.0325692,
      'age:sbpMax': -0.1035985,
      'age:dm': -0.2417542,
      'age:smk': -0.0791142,
      'age:egfrMin': -0.1671492,
    },
  },
  'male|ascvd|10': {
    familia: 'chol',
    etiqueta: 'ASCVD a 10 años',
    intercepto: -3.500655,
    coef: {
      age: 0.7099847,
      nonHdl: 0.1658663,
      hdl: -0.1144285,
      sbpMin: -0.2837212,
      sbpMax: 0.3239977,
      dm: 0.7189597,
      smk: 0.3956973,
      egfrMin: 0.3690075,
      egfrMax: 0.0203619,
      htn: 0.2036522,
      statin: -0.0865581,
      'htn:sbpMax': -0.0322916,
      'statin:nonHdl': 0.114563,
      'age:nonHdl': -0.0300005,
      'age:hdl': 0.0232747,
      'age:sbpMax': -0.0927024,
      'age:dm': -0.2018525,
      'age:smk': -0.0970527,
      'age:egfrMin': -0.1217081,
    },
  },
  'female|heart-failure|10': {
    familia: 'bmi',
    etiqueta: 'Insuficiencia cardíaca a 10 años',
    intercepto: -4.310409,
    coef: {
      age: 0.8998235,
      sbpMin: -0.4559771,
      sbpMax: 0.3576505,
      dm: 1.038346,
      smk: 0.583916,
      bmi: 0.0974654,
      egfrMin: 0.6840338,
      egfrMax: 0.0972642,
      htn: 0.0942288,
      'htn:sbpMax': -0.0387234,
      'age:sbpMax': -0.0772852,
      'age:dm': -0.2722725,
      'age:smk': -0.0307079,
      'age:bmi': -0.0339355,
      'age:egfrMin': -0.2360132,
    },
  },
  'male|heart-failure|10': {
    familia: 'bmi',
    etiqueta: 'Insuficiencia cardíaca a 10 años',
    intercepto: -3.946391,
    coef: {
      age: 0.8972642,
      sbpMin: -0.6811466,
      sbpMax: 0.3634461,
      dm: 0.923776,
      smk: 0.5023736,
      bmi: 0.1198368,
      egfrMin: 0.6926917,
      egfrMax: 0.0251693,
      htn: 0.2980922,
      'htn:sbpMax': -0.0497731,
      'age:sbpMax': -0.0656117,
      'age:dm': -0.2304788,
      'age:smk': -0.0989714,
      'age:bmi': -0.0228118,
      'age:egfrMin': -0.1739182,
    },
  },
  'female|total-cvd|30': {
    familia: 'chol',
    etiqueta: 'ECV total a 30 años',
    intercepto: -1.748653,
    coef: {
      age: 0.4501231,
      nonHdl: 0.0836098,
      hdl: -0.0998895,
      sbpMin: -0.226716,
      sbpMax: 0.3030191,
      dm: 0.5980227,
      smk: 0.2898624,
      egfrMin: 0.3038706,
      egfrMax: 0.0496981,
      htn: 0.1729568,
      statin: -0.0512154,
      'htn:sbpMax': -0.0322337,
      'statin:nonHdl': 0.0691325,
      'age:nonHdl': -0.0367598,
      'age:hdl': 0.0220624,
      'age:sbpMax': -0.0673539,
      'age:dm': -0.1497659,
      'age:smk': -0.0506663,
      'age:egfrMin': -0.1140375,
    },
  },
  'male|total-cvd|30': {
    familia: 'chol',
    etiqueta: 'ECV total a 30 años',
    intercepto: -1.495112,
    coef: {
      age: 0.4359619,
      nonHdl: 0.1115945,
      hdl: -0.0790669,
      sbpMin: -0.3683381,
      sbpMax: 0.2615636,
      dm: 0.5050208,
      smk: 0.2255663,
      egfrMin: 0.2331565,
      egfrMax: 0.0314929,
      htn: 0.1481031,
      statin: -0.0697325,
      'htn:sbpMax': -0.025014,
      'statin:nonHdl': 0.0890106,
      'age:nonHdl': -0.0202249,
      'age:hdl': 0.0153184,
      'age:sbpMax': -0.0593798,
      'age:dm': -0.1271401,
      'age:smk': -0.0581037,
      'age:egfrMin': -0.0938007,
    },
  },
};

const OBJETIVO: Array<{ desenlace: Desenlace; horizonte: Horizonte }> = [
  { desenlace: 'ascvd', horizonte: 10 },
  { desenlace: 'heart-failure', horizonte: 10 },
  { desenlace: 'total-cvd', horizonte: 30 },
];

/**
 * Calcula las predicciones PREVENT del contrato SOM (ASCVD 10a, IC 10a, ECV 30a).
 * Omite las combinaciones que no pueda calcular (falta de coeficiente o de IMC
 * para IC) y las reporta en `faltantes`. Nunca lanza por datos faltantes.
 */
export function calcularPrevent(e: EntradaPrevent): ResultadoPrevent {
  const predicciones: PrediccionPrevent[] = [];
  const faltantes: string[] = [];

  for (const { desenlace, horizonte } of OBJETIVO) {
    const modelo = MODELOS[`${e.sexo}|${desenlace}|${horizonte}`];
    if (!modelo) {
      faltantes.push(`${desenlace} ${horizonte}a (sin coeficiente)`);
      continue;
    }
    if (modelo.familia === 'bmi' && (e.imc == null || Number.isNaN(e.imc))) {
      faltantes.push(`${desenlace} ${horizonte}a (falta IMC)`);
      continue;
    }
    predicciones.push({
      desenlace,
      horizonte,
      probabilidad: probabilidad(modelo, e),
      etiqueta: modelo.etiqueta,
    });
  }

  return { predicciones, pendienteValidacion: PENDIENTE_VALIDACION, faltantes };
}
