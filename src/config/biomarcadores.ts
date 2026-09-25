/**
 * Biomarcadores que publica el servidor como `ObservationDefinition` (rango de
 * referencia por sexo). El portal del paciente (`EPA-Developments/app`,
 * `src/fhir/biomarkers.ts`) arma sus paneles con estas definiciones: la lista del
 * servidor REEMPLAZA a su catálogo local.
 *
 * Fuente de verdad: este archivo (lo carga `npm run seed`).
 *
 * Salud CONVENCIONAL: solo rangos de las guías habituales (AHA/ACC, NCEP ATP III,
 * ADA). En este repositorio NO se usan parámetros de medicina funcional: no hay
 * rangos `funcional` ni biomarcadores que no estén en esas guías (p. ej. LDL-P). Cada
 * biomarcador cita su fuente. Umbral `alto` = valor de corte de la guía (lo normal
 * está por debajo); `bajo` = valor de corte inferior (lo normal está por encima).
 *
 * No se inventan rangos: cambiar un valor es una decisión del equipo médico
 * (Gobernanza). Los umbrales de la estadificación CKM viven aparte (`ckm.ts`).
 */
export type TipoRango = 'convencional';

export interface RangoBiomarcador {
  tipo: TipoRango;
  bajo?: number;
  alto?: number;
  /** Rango específico de un sexo (FHIR `qualifiedInterval.gender`). */
  sexo?: 'male' | 'female';
}

export interface Biomarcador {
  /** Código LOINC. */
  codigo: string;
  nombre: string;
  /** Unidad UCUM. */
  unidad: string;
  /** Panel del portal (CodeSystem `panel-biomarcador`). */
  panel: 'metabolico';
  rangos: RangoBiomarcador[];
  /** Guía de la que sale el rango (trazabilidad). */
  fuente: string;
}

export const PANEL_DISPLAY: Record<Biomarcador['panel'], string> = {
  metabolico: 'Cardiometabólico',
};

const NCEP = 'NCEP ATP III (NHLBI) — clasificación del perfil lipídico';
const AHA_ACC_2018 = 'AHA/ACC 2018 Guideline on the Management of Blood Cholesterol — factores que aumentan el riesgo';
const AHA_SM = 'AHA/NHLBI — criterios de síndrome metabólico';
const ADA = 'ADA Standards of Care — diagnóstico de prediabetes y diabetes';

export const BIOMARCADORES: Biomarcador[] = [
  // Perfil lipídico
  {
    codigo: '2093-3',
    nombre: 'Colesterol total',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', alto: 200 }],
    fuente: `${NCEP}: deseable < 200 mg/dL.`,
  },
  {
    codigo: '2085-9',
    nombre: 'Colesterol HDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', bajo: 40 },
      { tipo: 'convencional', bajo: 40, sexo: 'male' },
      { tipo: 'convencional', bajo: 50, sexo: 'female' },
    ],
    fuente: `${AHA_SM}: bajo si < 40 mg/dL (varones) o < 50 mg/dL (mujeres).`,
  },
  {
    codigo: '13457-7',
    nombre: 'Colesterol LDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', alto: 100 }],
    fuente: `${NCEP}: óptimo < 100 mg/dL (la meta individual depende del riesgo: PREVENT / estadío CKM).`,
  },
  {
    codigo: '2571-8',
    nombre: 'Triglicéridos',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', alto: 150 }],
    fuente: `${NCEP}: normal < 150 mg/dL.`,
  },
  {
    codigo: '1884-6',
    nombre: 'ApoB (Apolipoproteína B)',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', alto: 130 }],
    fuente: `${AHA_ACC_2018}: ApoB ≥ 130 mg/dL.`,
  },
  {
    codigo: '10835-7',
    nombre: 'Lipoproteína(a) — Lp(a)',
    unidad: 'nmol/L',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', alto: 125 }],
    fuente: `${AHA_ACC_2018}: Lp(a) ≥ 125 nmol/L (≥ 50 mg/dL).`,
  },
  // Glucemia (sustrato metabólico de la estadificación CKM)
  {
    codigo: '1558-6',
    nombre: 'Glucemia en ayunas',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', bajo: 70, alto: 100 }],
    fuente: `${ADA}: normal < 100 mg/dL; prediabetes 100–125; diabetes ≥ 126.`,
  },
  {
    codigo: '4548-4',
    nombre: 'Hemoglobina glicosilada (HbA1c)',
    unidad: '%',
    panel: 'metabolico',
    rangos: [{ tipo: 'convencional', alto: 5.7 }],
    fuente: `${ADA}: normal < 5,7 %; prediabetes 5,7–6,4 %; diabetes ≥ 6,5 %.`,
  },
];
