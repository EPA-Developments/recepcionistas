/**
 * Biomarcadores que publica el servidor como `ObservationDefinition` (rangos de
 * referencia convencional / funcional, por sexo). El portal del paciente
 * (`EPA-Developments/app`, `src/fhir/biomarkers.ts`) arma sus paneles con estas
 * definiciones: la lista del servidor REEMPLAZA a su catálogo local.
 *
 * Fuente de verdad: este archivo (lo carga `npm run seed`). Primera tanda: los 7
 * lípidos del panel Cardiometabólico (`metabolico`) que faltaban en el servidor,
 * tomados de `app/docs/medplum/observation-definitions/cardiometabolico-lipidos.json`
 * (tabla institucional). Códigos LOINC salvo LDL-P, que no tiene LOINC en el
 * catálogo y usa el CodeSystem `biomarker` de SOM.
 *
 * No se inventan rangos: un rango marcado `pendienteRevisionMedica` NO se publica
 * hasta que el equipo médico lo confirme (Gobernanza).
 */
export type TipoRango = 'convencional' | 'funcional';

export interface RangoBiomarcador {
  tipo: TipoRango;
  bajo?: number;
  alto?: number;
  /** Rango específico de un sexo (FHIR `qualifiedInterval.gender`). */
  sexo?: 'male' | 'female';
  /** Si está, el rango NO se publica: motivo de la revisión médica pendiente. */
  pendienteRevisionMedica?: string;
}

export interface Biomarcador {
  /** `http://loinc.org` o el CodeSystem `biomarker` de SOM. */
  sistema: 'loinc' | 'som';
  codigo: string;
  nombre: string;
  /** Unidad UCUM. */
  unidad: string;
  /** Panel del portal (CodeSystem `panel-biomarcador`). */
  panel: 'metabolico';
  rangos: RangoBiomarcador[];
}

export const PANEL_DISPLAY: Record<Biomarcador['panel'], string> = {
  metabolico: 'Cardiometabólico',
};

export const BIOMARCADORES: Biomarcador[] = [
  {
    sistema: 'loinc',
    codigo: '2093-3',
    nombre: 'Colesterol total',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', alto: 200 },
      {
        tipo: 'funcional',
        alto: 100,
        pendienteRevisionMedica:
          'Colesterol total funcional < 100 mg/dL es fisiológicamente improbable (¿errata por el objetivo de LDL?). Confirmar con el Dr. Barbagelata.',
      },
    ],
  },
  {
    sistema: 'loinc',
    codigo: '2085-9',
    nombre: 'Colesterol HDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', bajo: 40 },
      { tipo: 'funcional', bajo: 60 },
      { tipo: 'convencional', bajo: 40, sexo: 'male' },
      { tipo: 'convencional', bajo: 50, sexo: 'female' },
    ],
  },
  {
    sistema: 'loinc',
    codigo: '13457-7',
    nombre: 'Colesterol LDL',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', alto: 100 },
      { tipo: 'funcional', alto: 70 },
    ],
  },
  {
    sistema: 'loinc',
    codigo: '1884-6',
    nombre: 'ApoB (Apolipoproteína B)',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', bajo: 66, alto: 144 },
      { tipo: 'funcional', alto: 90 },
    ],
  },
  {
    sistema: 'loinc',
    codigo: '10835-7',
    nombre: 'Lipoproteína(a) — Lp(a)',
    unidad: 'nmol/L',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', alto: 75 },
      { tipo: 'funcional', alto: 50 },
    ],
  },
  {
    sistema: 'som',
    codigo: 'ldl-p',
    nombre: 'LDL Partículas (LDL-P)',
    unidad: 'nmol/L',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', alto: 1300 },
      { tipo: 'funcional', alto: 1000 },
    ],
  },
  {
    sistema: 'loinc',
    codigo: '2571-8',
    nombre: 'Triglicéridos',
    unidad: 'mg/dL',
    panel: 'metabolico',
    rangos: [
      { tipo: 'convencional', alto: 150 },
      { tipo: 'funcional', alto: 80 },
    ],
  },
];

/** Rangos retenidos por revisión médica pendiente (para avisarlo en el seed). */
export function rangosPendientes(): Array<{ nombre: string; motivo: string }> {
  return BIOMARCADORES.flatMap((b) =>
    b.rangos
      .filter((r) => r.pendienteRevisionMedica)
      .map((r) => ({ nombre: `${b.nombre} (${r.tipo})`, motivo: r.pendienteRevisionMedica! })),
  );
}
