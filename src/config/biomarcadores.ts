/**
 * Biomarcadores que publica el servidor como `ObservationDefinition` (rango de
 * referencia por sexo). El portal del paciente (`EPA-Developments/app`,
 * `src/fhir/biomarkers.ts`) arma sus paneles con estas definiciones: la lista del
 * servidor REEMPLAZA a su catálogo local. El bot de laboratorio en PDF usa este mismo
 * catálogo para codificar cada valor (LOINC + UCUM): lo que no está acá queda solo
 * como texto.
 *
 * Fuente de verdad: este archivo (lo carga `npm run seed`).
 *
 * LABORATORIO DE RUTINA de la salud cardiovascular de la mujer en la menopausia: 7
 * grupos (esenciales y extensivos) más "Menopausia". Cada analito tiene su clave
 * (`slug`), LOINC, unidad UCUM, nivel y sinónimos para leer los informes.
 *
 * Salud CONVENCIONAL: solo rangos de las guías habituales (AHA/ACC, NCEP ATP III,
 * ADA) y de la guía CKM 2026 (Ndumele et al.; umbrales en `ckm.ts`). En este
 * repositorio NO se usan parámetros de medicina funcional. Umbral `alto` = valor de
 * corte de la guía (lo normal está por debajo); `bajo` = valor de corte inferior.
 * Un analito sin rango de guía no lleva rango: se usa el del laboratorio de cada
 * informe (`Observation.referenceRange`).
 *
 * No se inventan rangos: cambiar un valor es una decisión del equipo médico
 * (Gobernanza). Los códigos LOINC son los del estándar; donde el portal ya usaba
 * uno, se reutiliza. Validarlos contra el laboratorio es una tarea pendiente.
 */
import { FUENTE_CKM, UMBRALES_CKM } from './ckm.js';

export type TipoRango = 'convencional';

export interface RangoBiomarcador {
  tipo: TipoRango;
  bajo?: number;
  alto?: number;
  /** Rango específico de un sexo (FHIR `qualifiedInterval.gender`). */
  sexo?: 'male' | 'female';
}

/** Panel del portal (CodeSystem `panel-biomarcador`): los 7 grupos del laboratorio de rutina + Menopausia. */
export type PanelBiomarcador =
  | 'metabolico'
  | 'renal'
  | 'electrolitos'
  | 'cardiaco'
  | 'inflamatorios'
  | 'hematologia'
  | 'endocrinologia'
  | 'menopausia';

/** Esencial: el laboratorio de rutina de base. Extensivo: según la clínica y el estadío. */
export type NivelLaboratorio = 'esencial' | 'extensivo';

export interface Biomarcador {
  /** Clave estable del analito (snake_case), la misma en el código, el pedido y el portal. */
  slug: string;
  /** Código LOINC (o local de SOM si no hay LOINC estándar, ver `sistema`). */
  codigo: string;
  /**
   * Otros códigos LOINC del MISMO valor que el bot escribe junto al principal, para que
   * lo encuentren los lectores que buscan solo uno (p. ej. eGFR: hGraph lee 62238-1; el
   * módulo CKM del portal y el catálogo del Plan Bienestar, 33914-3).
   */
  codigosEquivalentes?: string[];
  /** `som` = código local de SOM (`CodeSystem/biomarker`) para analitos sin LOINC (HOMA-IR). */
  sistema?: 'loinc' | 'som';
  nombre: string;
  /** Unidad UCUM. */
  unidad: string;
  /** Unidad como la lee la paciente, si la UCUM es poco legible (mEq/L, mUI/L, …). */
  unidadTexto?: string;
  panel: PanelBiomarcador;
  nivel: NivelLaboratorio;
  /** Otros nombres con los que aparece en los informes (ayudan al bot a reconocerlo). */
  sinonimos?: string[];
  /** Para "te faltan estudios esenciales": este analito cubre a otro (p. ej. BUN cubre urea). */
  cuentaComo?: string;
  rangos: RangoBiomarcador[];
  /** Guía de la que sale el rango, o "rango del laboratorio" (trazabilidad). */
  fuente: string;
}

export const PANEL_DISPLAY: Record<PanelBiomarcador, string> = {
  metabolico: 'Perfil básico y riesgo cardiovascular',
  renal: 'Función renal y síndrome cardiorrenal',
  electrolitos: 'Electrolitos y conducción eléctrica',
  cardiaco: 'Biomarcadores cardíacos',
  inflamatorios: 'Inflamación y riesgo residual',
  hematologia: 'Hematología, coagulación y trombosis',
  endocrinologia: 'Eje endocrino y metabólico secundario',
  menopausia: 'Menopausia',
};

/** Descripción de cada panel para la paciente. */
export const PANEL_DESCRIPCION: Record<PanelBiomarcador, string> = {
  metabolico: 'Lípidos y glucosa: la base del riesgo cardiovascular y de la estadificación cardio-reno-metabólica.',
  renal: 'Creatinina, filtrado glomerular y albuminuria: cómo está el riñón dentro del síndrome cardio-reno-metabólico.',
  electrolitos: 'Potasio, sodio, magnesio, calcio y cloro: claves con diuréticos, IECA/ARA-II y en las arritmias.',
  cardiaco: 'Troponinas de alta sensibilidad y péptidos natriuréticos: daño del músculo cardíaco e insuficiencia cardíaca.',
  inflamatorios: 'Inflamación, lipoproteína(a) y apolipoproteínas: el riesgo que queda más allá del colesterol LDL.',
  hematologia: 'Anemia, hierro, plaquetas y coagulación.',
  endocrinologia: 'Tiroides, cortisol, vitamina D e hígado (hígado graso metabólico).',
  menopausia: 'Las hormonas de la transición menopáusica y la resistencia a la insulina, que cambian el riesgo cardiovascular de la mujer.',
};

export const NIVEL_DISPLAY: Record<NivelLaboratorio, string> = {
  esencial: 'Esencial',
  extensivo: 'Extensivo',
};

const NCEP = 'NCEP ATP III (NHLBI) — clasificación del perfil lipídico';
const AHA_ACC_2018 = 'AHA/ACC 2018 Guideline on the Management of Blood Cholesterol — factores que aumentan el riesgo';
const AHA_SM = 'AHA/NHLBI — criterios de síndrome metabólico';
const ADA = 'ADA Standards of Care — diagnóstico de prediabetes y diabetes';
const CKM = `Guía CKM 2026 (${FUENTE_CKM})`;
const DEL_LABORATORIO = 'Sin rango de guía: se usa el rango del laboratorio de cada informe.';
const K = UMBRALES_CKM;

export const BIOMARCADORES: Biomarcador[] = [
  // ───────── 🧬 Perfil básico y riesgo cardiovascular (esenciales) ─────────
  {
    slug: 'colesterol_total',
    codigo: '2093-3',
    nombre: 'Colesterol total',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['Colesterol', 'CT'],
    rangos: [{ tipo: 'convencional', alto: 200 }],
    fuente: `${NCEP}: deseable < 200 mg/dL.`,
  },
  {
    slug: 'colesterol_ldl',
    codigo: '13457-7',
    nombre: 'Colesterol LDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['LDL', 'LDL calculado', 'Colesterol LDL (Friedewald)', 'c-LDL'],
    rangos: [{ tipo: 'convencional', alto: 100 }],
    fuente: `${NCEP}: óptimo < 100 mg/dL (la meta individual depende del riesgo: PREVENT / estadío CKM).`,
  },
  {
    slug: 'colesterol_ldl_directo',
    codigo: '18262-6',
    nombre: 'Colesterol LDL (directo)',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['LDL directo', 'LDL medido'],
    cuentaComo: 'colesterol_ldl',
    rangos: [{ tipo: 'convencional', alto: 100 }],
    fuente: `${NCEP}: óptimo < 100 mg/dL (mismo umbral que el LDL calculado).`,
  },
  {
    slug: 'colesterol_hdl',
    codigo: '2085-9',
    nombre: 'Colesterol HDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['HDL', 'c-HDL'],
    rangos: [
      { tipo: 'convencional', bajo: 40 },
      { tipo: 'convencional', bajo: 40, sexo: 'male' },
      { tipo: 'convencional', bajo: 50, sexo: 'female' },
    ],
    fuente: `${AHA_SM}: bajo si < 40 mg/dL (varones) o < 50 mg/dL (mujeres).`,
  },
  {
    slug: 'colesterol_no_hdl',
    codigo: '43396-1',
    nombre: 'Colesterol no-HDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['No-HDL', 'Colesterol no HDL'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'trigliceridos',
    codigo: '2571-8',
    nombre: 'Triglicéridos',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['TG', 'Trigliceridemia'],
    rangos: [{ tipo: 'convencional', alto: 150 }],
    fuente: `${NCEP}: normal < 150 mg/dL.`,
  },
  {
    slug: 'glucemia_ayunas',
    codigo: '1558-6',
    nombre: 'Glucemia en ayunas',
    unidad: 'mg/dL',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['Glucemia', 'Glucosa', 'Glucosa en ayunas', 'Glucosa basal'],
    rangos: [{ tipo: 'convencional', bajo: 70, alto: 100 }],
    fuente: `${ADA}: normal < 100 mg/dL; prediabetes 100–125; diabetes ≥ 126.`,
  },
  {
    slug: 'hba1c',
    codigo: '4548-4',
    nombre: 'Hemoglobina glicosilada (HbA1c)',
    unidad: '%',
    panel: 'metabolico',
    nivel: 'esencial',
    sinonimos: ['HbA1c', 'Hemoglobina A1c', 'Glicohemoglobina', 'Hemoglobina glicada'],
    rangos: [{ tipo: 'convencional', alto: 5.7 }],
    fuente: `${ADA}: normal < 5,7 %; prediabetes 5,7–6,4 %; diabetes ≥ 6,5 %.`,
  },

  // ───────── 🫘 Función renal y síndrome cardiorrenal (esenciales) ─────────
  {
    slug: 'creatinina_serica',
    codigo: '2160-0',
    nombre: 'Creatinina sérica',
    unidad: 'mg/dL',
    panel: 'renal',
    nivel: 'esencial',
    sinonimos: ['Creatinina', 'Creatininemia', 'Creatinina en sangre'],
    rangos: [],
    fuente: `${DEL_LABORATORIO} Con la creatinina, el bot calcula el filtrado (CKD-EPI 2021) si el informe no lo trae.`,
  },
  {
    slug: 'e_gfr',
    codigo: '62238-1',
    codigosEquivalentes: ['33914-3'],
    nombre: 'Filtrado glomerular estimado (eGFR)',
    unidad: 'mL/min/{1.73_m2}',
    unidadTexto: 'mL/min/1,73 m²',
    panel: 'renal',
    nivel: 'esencial',
    sinonimos: ['Filtrado glomerular estimado', 'FG estimado', 'TFG estimada', 'Tasa de filtrado glomerular', 'eGFR', 'CKD-EPI', 'MDRD'],
    rangos: [{ tipo: 'convencional', bajo: K.kdigo.g3a }],
    fuente: `${CKM}: eGFR < ${K.kdigo.g3a} mL/min/1,73 m² (G3a o peor) es enfermedad renal crónica, criterio de Estadío 2.`,
  },
  {
    slug: 'urea_serica',
    codigo: '3091-6',
    nombre: 'Urea sérica',
    unidad: 'mg/dL',
    panel: 'renal',
    nivel: 'esencial',
    sinonimos: ['Urea', 'Uremia'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'bun',
    codigo: '3094-0',
    nombre: 'Nitrógeno ureico (BUN)',
    unidad: 'mg/dL',
    panel: 'renal',
    nivel: 'esencial',
    sinonimos: ['BUN', 'Nitrógeno ureico'],
    cuentaComo: 'urea_serica',
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'cistatina_c',
    codigo: '33863-2',
    nombre: 'Cistatina C',
    unidad: 'mg/L',
    panel: 'renal',
    nivel: 'esencial',
    sinonimos: ['Cistatina'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'acr_urinaria',
    codigo: '9318-7',
    nombre: 'Cociente albúmina/creatinina en orina (UACR)',
    unidad: 'mg/g',
    panel: 'renal',
    nivel: 'esencial',
    sinonimos: ['UACR', 'RAC', 'Índice albúmina/creatinina', 'Microalbuminuria/creatininuria', 'Albuminuria'],
    rangos: [{ tipo: 'convencional', alto: K.kdigo.a2 }],
    fuente: `${CKM}: UACR ≥ ${K.kdigo.a2} mg/g (A2 o peor) es enfermedad renal crónica, criterio de Estadío 2.`,
  },

  // ───────── ⚡ Electrolitos y conducción eléctrica (esenciales) ─────────
  {
    slug: 'potasio_serico',
    codigo: '2823-3',
    nombre: 'Potasio sérico',
    unidad: 'meq/L',
    unidadTexto: 'mEq/L',
    panel: 'electrolitos',
    nivel: 'esencial',
    sinonimos: ['Potasio', 'Kalemia', 'K'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'sodio_serico',
    codigo: '2951-2',
    nombre: 'Sodio sérico',
    unidad: 'meq/L',
    unidadTexto: 'mEq/L',
    panel: 'electrolitos',
    nivel: 'esencial',
    sinonimos: ['Sodio', 'Natremia', 'Na'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'magnesio_serico',
    codigo: '2601-3',
    nombre: 'Magnesio sérico',
    unidad: 'mg/dL',
    panel: 'electrolitos',
    nivel: 'esencial',
    sinonimos: ['Magnesio', 'Magnesemia', 'Mg'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'calcio_serico',
    codigo: '17861-6',
    nombre: 'Calcio total',
    unidad: 'mg/dL',
    panel: 'electrolitos',
    nivel: 'esencial',
    sinonimos: ['Calcio', 'Calcemia', 'Calcio sérico'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'calcio_ionico',
    codigo: '1994-3',
    nombre: 'Calcio iónico',
    unidad: 'mmol/L',
    panel: 'electrolitos',
    nivel: 'esencial',
    sinonimos: ['Calcio iónico', 'Calcio ionizado', 'Ca++'],
    cuentaComo: 'calcio_serico',
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'cloro_serico',
    codigo: '2075-0',
    nombre: 'Cloro sérico',
    unidad: 'meq/L',
    unidadTexto: 'mEq/L',
    panel: 'electrolitos',
    nivel: 'esencial',
    sinonimos: ['Cloro', 'Cloremia', 'Cloruro', 'Cl'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },

  // ───────── 🚨 Biomarcadores cardíacos de urgencia y pronóstico (extensivos) ─────────
  {
    slug: 'hs_tnt',
    codigo: '67151-1',
    nombre: 'Troponina T de alta sensibilidad',
    unidad: 'ng/L',
    panel: 'cardiaco',
    nivel: 'extensivo',
    sinonimos: ['Troponina T ultrasensible', 'hs-TnT', 'TnT-hs'],
    rangos: [
      { tipo: 'convencional', alto: K.hsTnT.female, sexo: 'female' },
      { tipo: 'convencional', alto: K.hsTnT.male, sexo: 'male' },
    ],
    fuente: `${CKM}: hs-TnT ≥ ${K.hsTnT.female} ng/L (mujeres) o ≥ ${K.hsTnT.male} ng/L (varones) indica pre-IC (Estadío 3).`,
  },
  {
    slug: 'hs_tni',
    codigo: '89579-7',
    nombre: 'Troponina I de alta sensibilidad',
    unidad: 'ng/L',
    panel: 'cardiaco',
    nivel: 'extensivo',
    sinonimos: ['Troponina I ultrasensible', 'hs-TnI', 'TnI-hs'],
    rangos: [
      { tipo: 'convencional', alto: K.hsTnI.female, sexo: 'female' },
      { tipo: 'convencional', alto: K.hsTnI.male, sexo: 'male' },
    ],
    fuente: `${CKM}: hs-TnI ≥ ${K.hsTnI.female} ng/L (mujeres) o ≥ ${K.hsTnI.male} ng/L (varones) indica pre-IC (Estadío 3).`,
  },
  {
    slug: 'bnp',
    codigo: '30934-4',
    nombre: 'Péptido natriurético tipo B (BNP)',
    unidad: 'pg/mL',
    panel: 'cardiaco',
    nivel: 'extensivo',
    sinonimos: ['BNP'],
    rangos: [{ tipo: 'convencional', alto: K.bnp }],
    fuente: `${CKM}: BNP ≥ ${K.bnp} pg/mL indica pre-IC (Estadío 3).`,
  },
  {
    slug: 'nt_probnp',
    codigo: '33762-6',
    nombre: 'NT-proBNP',
    unidad: 'pg/mL',
    panel: 'cardiaco',
    nivel: 'extensivo',
    sinonimos: ['NT-proBNP', 'Pro-BNP N-terminal', 'Fracción N-terminal del pro-BNP'],
    rangos: [{ tipo: 'convencional', alto: K.ntProBnp }],
    fuente: `${CKM}: NT-proBNP ≥ ${K.ntProBnp} pg/mL indica pre-IC (Estadío 3).`,
  },
  {
    slug: 'ck_mb_masa',
    codigo: '13969-1',
    nombre: 'CK-MB (masa)',
    unidad: 'ng/mL',
    panel: 'cardiaco',
    nivel: 'extensivo',
    sinonimos: ['CK-MB', 'CPK-MB', 'CK-MB masa'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'ck_total',
    codigo: '2157-6',
    nombre: 'Creatina quinasa total (CK)',
    unidad: 'U/L',
    panel: 'cardiaco',
    nivel: 'extensivo',
    sinonimos: ['CK', 'CPK', 'Creatina quinasa', 'Creatinfosfoquinasa'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },

  // ───────── 🩹 Inflamación y riesgo residual (extensivos) ─────────
  {
    slug: 'hs_pcr',
    codigo: '30522-7',
    nombre: 'PCR ultrasensible (hs-PCR)',
    unidad: 'mg/L',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['PCR ultrasensible', 'Proteína C reactiva de alta sensibilidad', 'hs-CRP', 'PCR us', 'pcr_ultrasensible'],
    rangos: [{ tipo: 'convencional', alto: 2 }],
    fuente: `${AHA_ACC_2018}: hs-PCR ≥ 2,0 mg/L.`,
  },
  {
    slug: 'homocisteina',
    codigo: '13965-9',
    nombre: 'Homocisteína',
    unidad: 'umol/L',
    unidadTexto: 'µmol/L',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['Homocisteinemia'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'acido_urico',
    codigo: '3084-1',
    nombre: 'Ácido úrico',
    unidad: 'mg/dL',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['Uricemia'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'lp_a',
    codigo: '43583-4',
    nombre: 'Lipoproteína(a) — Lp(a)',
    unidad: 'nmol/L',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['Lp(a)', 'Lipoproteína a'],
    rangos: [{ tipo: 'convencional', alto: 125 }],
    fuente: `${AHA_ACC_2018}: Lp(a) ≥ 125 nmol/L (≥ 50 mg/dL).`,
  },
  {
    slug: 'lp_a_masa',
    codigo: '10835-7',
    nombre: 'Lipoproteína(a) — Lp(a) (en mg/dL)',
    unidad: 'mg/dL',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['Lp(a)', 'Lipoproteína a'],
    cuentaComo: 'lp_a',
    rangos: [{ tipo: 'convencional', alto: 50 }],
    fuente: `${AHA_ACC_2018}: Lp(a) ≥ 50 mg/dL (≥ 125 nmol/L).`,
  },
  {
    slug: 'apo_b',
    codigo: '1884-6',
    nombre: 'ApoB (Apolipoproteína B)',
    unidad: 'mg/dL',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['Apolipoproteína B', 'Apo B'],
    rangos: [{ tipo: 'convencional', alto: 130 }],
    fuente: `${AHA_ACC_2018}: ApoB ≥ 130 mg/dL.`,
  },
  {
    slug: 'apo_a1',
    codigo: '1869-7',
    nombre: 'Apolipoproteína A1',
    unidad: 'mg/dL',
    panel: 'inflamatorios',
    nivel: 'extensivo',
    sinonimos: ['Apo A1', 'Apo A-I'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },

  // ───────── 🩸 Hematología, coagulación y trombosis (extensivos) ─────────
  {
    slug: 'hemoglobina',
    codigo: '718-7',
    nombre: 'Hemoglobina',
    unidad: 'g/dL',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['Hb'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'hematocrito',
    codigo: '4544-3',
    nombre: 'Hematocrito',
    unidad: '%',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['Hto', 'Hct'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'plaquetas',
    codigo: '777-3',
    nombre: 'Recuento de plaquetas',
    unidad: '10*3/uL',
    unidadTexto: '10³/µL',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['Plaquetas', 'Recuento plaquetario'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'inr',
    codigo: '6301-6',
    nombre: 'Tiempo de protrombina (RIN)',
    unidad: '{INR}',
    unidadTexto: 'RIN',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['RIN', 'INR', 'Quick (RIN)'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'ttpa',
    codigo: '3173-2',
    nombre: 'Tiempo de tromboplastina parcial activada (TTPA)',
    unidad: 's',
    unidadTexto: 'segundos',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['KPTT', 'TTPa', 'APTT'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'dimero_d',
    codigo: '48065-7',
    nombre: 'Dímero D',
    unidad: 'ng/mL{FEU}',
    unidadTexto: 'ng/mL FEU',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['D-dímero', 'Dimero D'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'ferritina',
    codigo: '2276-4',
    nombre: 'Ferritina',
    unidad: 'ng/mL',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['Ferritinemia'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'saturacion_transferrina',
    codigo: '2502-3',
    nombre: 'Saturación de transferrina',
    unidad: '%',
    panel: 'hematologia',
    nivel: 'extensivo',
    sinonimos: ['IST', 'Índice de saturación de transferrina', '% de saturación'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },

  // ───────── 🦋 Eje endocrino y metabólico secundario (extensivos) ─────────
  {
    slug: 'tsh',
    codigo: '3016-3',
    nombre: 'TSH (tirotrofina)',
    unidad: 'm[IU]/L',
    unidadTexto: 'mUI/L',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['TSH', 'Tirotrofina', 'Hormona estimulante de la tiroides'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 't4_libre',
    codigo: '3024-7',
    nombre: 'T4 libre',
    unidad: 'ng/dL',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['Tiroxina libre', 'FT4', 'T4L'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'cortisol',
    codigo: '2143-6',
    nombre: 'Cortisol sérico',
    unidad: 'ug/dL',
    unidadTexto: 'µg/dL',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['Cortisol', 'Cortisolemia', 'Cortisol matinal'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'vitamina_d',
    codigo: '1989-3',
    nombre: 'Vitamina D (25-OH)',
    unidad: 'ng/mL',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['25-hidroxivitamina D', '25-OH vitamina D', 'Vitamina D'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'alt',
    codigo: '1742-6',
    nombre: 'ALT (TGP)',
    unidad: 'U/L',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['TGP', 'GPT', 'ALAT', 'Transaminasa glutámico pirúvica'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'ast',
    codigo: '1920-8',
    nombre: 'AST (TGO)',
    unidad: 'U/L',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['TGO', 'GOT', 'ASAT', 'Transaminasa glutámico oxalacética'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'ggt',
    codigo: '2324-2',
    nombre: 'GGT (gamma-glutamil transferasa)',
    unidad: 'U/L',
    panel: 'endocrinologia',
    nivel: 'extensivo',
    sinonimos: ['Gamma GT', 'Gamma glutamil transpeptidasa'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },

  // ───────── 🌸 Menopausia (extensivos, según indicación) ─────────
  {
    slug: 'fsh',
    codigo: '15067-2',
    nombre: 'FSH (hormona folículo estimulante)',
    unidad: 'm[IU]/mL',
    unidadTexto: 'mUI/mL',
    panel: 'menopausia',
    nivel: 'extensivo',
    sinonimos: ['FSH', 'Folitropina', 'Hormona folículo estimulante'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'estradiol',
    codigo: '2243-4',
    nombre: 'Estradiol (E2)',
    unidad: 'pg/mL',
    panel: 'menopausia',
    nivel: 'extensivo',
    sinonimos: ['E2', '17-beta estradiol'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'shbg',
    codigo: '13967-5',
    nombre: 'SHBG (globulina fijadora de hormonas sexuales)',
    unidad: 'nmol/L',
    panel: 'menopausia',
    nivel: 'extensivo',
    sinonimos: ['SHBG', 'Globulina transportadora de hormonas sexuales'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'testosterona_total',
    codigo: '2986-8',
    nombre: 'Testosterona total',
    unidad: 'ng/mL',
    panel: 'menopausia',
    nivel: 'extensivo',
    sinonimos: ['Testosterona'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'insulina_ayunas',
    codigo: '2484-4',
    nombre: 'Insulina en ayunas',
    unidad: 'u[IU]/mL',
    unidadTexto: 'µUI/mL',
    panel: 'menopausia',
    nivel: 'extensivo',
    sinonimos: ['Insulina', 'Insulinemia', 'Insulina basal'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
  {
    slug: 'homa_ir',
    codigo: 'homa-ir',
    sistema: 'som',
    nombre: 'Índice HOMA-IR',
    unidad: '{index}',
    unidadTexto: 'índice',
    panel: 'menopausia',
    nivel: 'extensivo',
    sinonimos: ['HOMA', 'HOMA-IR', 'Índice HOMA'],
    rangos: [],
    fuente: DEL_LABORATORIO,
  },
];

/** El biomarcador del catálogo por slug. */
export function biomarcadorPorSlug(slug: string): Biomarcador | undefined {
  return BIOMARCADORES.find((b) => b.slug === slug);
}
