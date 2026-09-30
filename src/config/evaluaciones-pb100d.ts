/**
 * Catálogo PB100D · evaluaciones (qué se mide y cuándo) por estadío CKM 0 a 4, con quién
 * carga cada dato y cómo se detecta en la historia.
 *
 * GENERADO desde `@epa/careplan-menopausia` (`scripts/exportar-evaluaciones-recepcion.ts`)
 * a partir del catálogo firmado el 2026-09-27. No editar a mano.
 *
 * Una evaluación aplica al perfil como los ítems (`ckm-catalogo.ts`): estadío en
 * `estadios`, todas las `condiciones`, alguna de `algunaDe`, ninguna de `excluye`.
 * Recepción la usa para "Día 0: qué falta" sin ver valores (`dia0-pb100d.ts`).
 */

export type QuienCargaEvaluacion = 'persona' | 'consultorio' | 'laboratorio' | 'equipo' | 'sistema';

export type DetectorEvaluacion = 'loinc' | 'cuestionario' | 'fib4' | 'prevent' | 'le8' | 'validacion' | 'manual';

export const ETIQUETA_QUIEN_CARGA: Record<QuienCargaEvaluacion, string> = {
  "persona": "La persona, desde el portal",
  "consultorio": "En el consultorio",
  "laboratorio": "Laboratorio",
  "equipo": "El equipo",
  "sistema": "Lo calcula el sistema"
};

/** Vigencia de un dato para el día 0, en días (provisorio). */
export const VIGENCIA_DIA_0_DIAS = 90;

export interface EvaluacionCatalogoPb100d {
  codigo: string;
  label: string;
  estadios: readonly string[];
  condiciones?: readonly string[];
  algunaDe?: readonly string[];
  excluye?: readonly string[];
  momentos: readonly string[];
  unit?: string;
  quien: QuienCargaEvaluacion;
  detector: DetectorEvaluacion;
  /** LOINC del dato principal y sus alternativas, en orden de preferencia. */
  codigosLoinc?: readonly string[];
  /** Sufijo del Questionnaire (bajo cualquier base) cuya última respuesta satisface la evaluación. */
  cuestionario?: string;
  nombre?: string;
  fuente: string;
}

/** Las 103 evaluaciones firmadas. */
export const EVALUACIONES_CATALOGO: readonly EvaluacionCatalogoPb100d[] = [
  {
    "codigo": "E0-EVAL-01",
    "label": "Peso, talla, IMC",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "kg/m2",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "39156-5",
      "29463-7"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E0-EVAL-02",
    "label": "Cintura con protocolo",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "cm",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8280-0"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E0-EVAL-03",
    "label": "Presión arterial: dos lecturas en consultorio; una medición mensual en casa",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "mmHg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8480-6",
      "8462-4"
    ],
    "fuente": "Guía CKM 2026, Figura 3; guía HTA 2025"
  },
  {
    "codigo": "E0-EVAL-04",
    "label": "Perfil lipídico completo (día 100 sólo si cambió peso, cintura o presión)",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0"
    ],
    "unit": "mg/dL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "43396-1",
      "2093-3",
      "13457-7",
      "2571-8"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E0-EVAL-05",
    "label": "Glucemia en ayunas y HbA1c (día 100 sólo si cambió algo)",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0"
    ],
    "unit": "%",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "4548-4",
      "1558-6"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E0-EVAL-06",
    "label": "Creatinina, eGFR y UACR (día 100 sólo si cambió algo)",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0"
    ],
    "unit": "mg/g",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "9318-7"
    ],
    "fuente": "Guía CKM 2026, Figura 3; firma del estadío 1"
  },
  {
    "codigo": "E0-EVAL-07",
    "label": "PREVENT a 10 y 30 años",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "prevent",
    "fuente": "Guía CKM 2026, Tabla 26"
  },
  {
    "codigo": "E0-EVAL-08",
    "label": "Potenciadores de la Tabla 9",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-potenciadores-v1",
    "nombre": "registro de potenciadores",
    "fuente": "Guía CKM 2026, Tabla 27"
  },
  {
    "codigo": "E0-EVAL-09",
    "label": "Estadificación validada por el médico",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "validacion",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E0-EVAL-10",
    "label": "Cuestionario inicial: etapa de cambio, autoeficacia, barreras",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-baseline",
    "nombre": "cuestionario inicial del portal",
    "fuente": "Biblioteca nivel 1"
  },
  {
    "codigo": "E0-EVAL-11",
    "label": "Dieta: MEDAS-14",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/le8-diet-mepa-v1",
    "nombre": "MEDAS-14 del portal",
    "fuente": "LE8"
  },
  {
    "codigo": "E0-EVAL-12",
    "label": "Actividad: minutos semanales (preguntas LE8) e IPAQ-SF",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "loinc",
    "codigosLoinc": [
      "55423-8"
    ],
    "cuestionario": "Questionnaire/le8-activity-evs-v1",
    "fuente": "LE8"
  },
  {
    "codigo": "E0-EVAL-13",
    "label": "Nicotina: estado, tiempo desde el abandono, exposición pasiva, vapeo",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "loinc",
    "codigosLoinc": [
      "72166-2"
    ],
    "cuestionario": "Questionnaire/le8-tobacco-v1",
    "fuente": "LE8"
  },
  {
    "codigo": "E0-EVAL-14",
    "label": "Sueño: horas promedio",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "h",
    "quien": "persona",
    "detector": "loinc",
    "codigosLoinc": [
      "93832-4"
    ],
    "cuestionario": "Questionnaire/le8-sleep-psqi-v1",
    "fuente": "LE8"
  },
  {
    "codigo": "E0-EVAL-15",
    "label": "PHQ-2, GAD-2, PSS-4",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-phq2-gad2-pss4-v1",
    "nombre": "PHQ-2, GAD-2 y PSS-4",
    "fuente": "Guía CKM 2026, Sección 5.1 y Tabla 9"
  },
  {
    "codigo": "E0-EVAL-16",
    "label": "AHC-HRSN",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-ahc-hrsn-v1",
    "nombre": "AHC-HRSN",
    "fuente": "Guía CKM 2026, Sección 3.2"
  },
  {
    "codigo": "E0-EVAL-17",
    "label": "Puntaje LE8 por dominio y total",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "le8",
    "fuente": "LE8"
  },
  {
    "codigo": "E0-EVAL-18",
    "label": "Respuesta LE8 (categoría) y verificación de permanencia en estadío 0",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Firma del estadío 0"
  },
  {
    "codigo": "E0-EVAL-19",
    "label": "STOP-BANG",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "apnea-sospecha",
      "potenciadores"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-stop-bang-v1",
    "nombre": "STOP-BANG",
    "fuente": "Guía CKM 2026, Tabla 9 y Sección 7.3"
  },
  {
    "codigo": "E0-EVAL-20",
    "label": "Glucemia o HbA1c y presión",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "dmg-previa",
      "apo-reciente"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Sección 5.4.5 y Tabla 46"
  },
  {
    "codigo": "E1-EVAL-01",
    "label": "Peso, talla, IMC",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "kg/m2",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "39156-5",
      "29463-7"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E1-EVAL-02",
    "label": "Cintura con protocolo",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "cm",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8280-0"
    ],
    "fuente": "Guía CKM 2026, Figura 3 y Sección 5.4"
  },
  {
    "codigo": "E1-EVAL-03",
    "label": "Presión arterial en consultorio, dos lecturas",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mmHg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8480-6",
      "8462-4"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E1-EVAL-04",
    "label": "AMPA, 7 días antes del hito",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "mmHg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8480-6",
      "8462-4"
    ],
    "fuente": "Guía HTA 2025"
  },
  {
    "codigo": "E1-EVAL-05",
    "label": "Perfil lipídico: total, HDL, LDL, no-HDL, triglicéridos",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mg/dL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "43396-1",
      "2093-3",
      "13457-7",
      "2571-8"
    ],
    "fuente": "Guía CKM 2026, Figura 3; LE8"
  },
  {
    "codigo": "E1-EVAL-06",
    "label": "Glucemia en ayunas y HbA1c",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "%",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "4548-4",
      "1558-6"
    ],
    "fuente": "Guía CKM 2026, Figura 3 y Sección 3.1.1"
  },
  {
    "codigo": "E1-EVAL-07",
    "label": "Creatinina y eGFR",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mL/min/1.73m2",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "33914-3",
      "2160-0"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E1-EVAL-08",
    "label": "UACR (todas las personas)",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mg/g",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "9318-7"
    ],
    "fuente": "Firma del estadío 1"
  },
  {
    "codigo": "E1-EVAL-09",
    "label": "FIB-4 (edad, AST, ALT, plaquetas)",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "prediabetes"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "laboratorio",
    "detector": "fib4",
    "nombre": "AST, ALT y plaquetas",
    "fuente": "Guía CKM 2026, Sección 7.2 (COR 2a, LOE C-LD) y Tabla 17"
  },
  {
    "codigo": "E1-EVAL-10",
    "label": "STOP-BANG",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "imc-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-stop-bang-v1",
    "nombre": "STOP-BANG",
    "fuente": "Guía CKM 2026, Sección 7.3 (COR 2a, LOE C-LD)"
  },
  {
    "codigo": "E1-EVAL-11",
    "label": "PREVENT a 10 años (30 a 79) y a 30 años (30 a 59)",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "prevent",
    "fuente": "Guía CKM 2026, Tabla 26 y Tabla 8"
  },
  {
    "codigo": "E1-EVAL-12",
    "label": "Potenciadores de riesgo (Tabla 9)",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-potenciadores-v1",
    "nombre": "registro de potenciadores",
    "fuente": "Guía CKM 2026, Tabla 27"
  },
  {
    "codigo": "E1-EVAL-13",
    "label": "Estadificación CKM validada por el médico",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "validacion",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E1-EVAL-14",
    "label": "Cuestionario inicial: etapa de cambio, autoeficacia, barreras",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-baseline",
    "nombre": "cuestionario inicial del portal",
    "fuente": "Biblioteca nivel 1"
  },
  {
    "codigo": "E1-EVAL-15",
    "label": "Dieta: MEDAS-14",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/le8-diet-mepa-v1",
    "nombre": "MEDAS-14 del portal",
    "fuente": "LE8"
  },
  {
    "codigo": "E1-EVAL-16",
    "label": "Actividad: minutos semanales (preguntas LE8) e IPAQ-SF",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "loinc",
    "codigosLoinc": [
      "55423-8"
    ],
    "cuestionario": "Questionnaire/le8-activity-evs-v1",
    "fuente": "LE8"
  },
  {
    "codigo": "E1-EVAL-17",
    "label": "Nicotina: estado, tiempo desde el abandono, exposición pasiva, vapeo",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "loinc",
    "codigosLoinc": [
      "72166-2"
    ],
    "cuestionario": "Questionnaire/le8-tobacco-v1",
    "fuente": "LE8"
  },
  {
    "codigo": "E1-EVAL-18",
    "label": "Sueño: horas promedio",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "h",
    "quien": "persona",
    "detector": "loinc",
    "codigosLoinc": [
      "93832-4"
    ],
    "cuestionario": "Questionnaire/le8-sleep-psqi-v1",
    "fuente": "LE8"
  },
  {
    "codigo": "E1-EVAL-19",
    "label": "Estrés y salud psicológica: PHQ-2, GAD-2, PSS-4",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-phq2-gad2-pss4-v1",
    "nombre": "PHQ-2, GAD-2 y PSS-4",
    "fuente": "Guía CKM 2026, Sección 5.1 y Tabla 9"
  },
  {
    "codigo": "E1-EVAL-20",
    "label": "Determinantes sociales: AHC-HRSN",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-ahc-hrsn-v1",
    "nombre": "AHC-HRSN",
    "fuente": "Guía CKM 2026, Sección 3.2 (COR 1)"
  },
  {
    "codigo": "E1-EVAL-21",
    "label": "Puntaje LE8 por dominio y total",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "le8",
    "fuente": "LE8"
  },
  {
    "codigo": "E1-EVAL-22",
    "label": "Respuesta de peso y cintura, % del basal",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Firma del estadío 1; Guía CKM 2026, Tabla 47"
  },
  {
    "codigo": "E1-EVAL-23",
    "label": "Tolerancia y efectos del GLP-1 (náuseas, vómitos, dolor abdominal, fuerza)",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "toma-glp1"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tablas 15 y 19"
  },
  {
    "codigo": "E1-EVAL-24",
    "label": "Reconciliación de medicación y suplementos",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-reconciliacion-medicacion-v1",
    "nombre": "reconciliación de medicación",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E2-EVAL-01",
    "label": "Peso, talla, IMC, cintura con protocolo",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "kg/m2",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "39156-5",
      "29463-7"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E2-EVAL-02",
    "label": "Presión en consultorio, dos lecturas",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mmHg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8480-6",
      "8462-4"
    ],
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E2-EVAL-03",
    "label": "AMPA, 7 días antes del hito; semanal entre hitos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100",
      "semanal"
    ],
    "unit": "mmHg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "8480-6",
      "8462-4"
    ],
    "fuente": "Guía HTA 2025"
  },
  {
    "codigo": "E2-EVAL-04",
    "label": "Perfil lipídico completo (al día 60 si inició hipolipemiante)",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mg/dL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "43396-1",
      "2093-3",
      "13457-7",
      "2571-8"
    ],
    "fuente": "Guía CKM 2026, Figura 3; dislipidemia 2026"
  },
  {
    "codigo": "E2-EVAL-05",
    "label": "Glucemia en ayunas y HbA1c",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "%",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "4548-4",
      "1558-6"
    ],
    "fuente": "Guía CKM 2026, Figura 3 y Tabla 47"
  },
  {
    "codigo": "E2-EVAL-06",
    "label": "Creatinina, eGFR y UACR",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mg/g",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "9318-7"
    ],
    "fuente": "Guía CKM 2026, Figura 3; KDIGO"
  },
  {
    "codigo": "E2-EVAL-07",
    "label": "Potasio y creatinina a las 2 a 4 semanas",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "algunaDe": [
      "inicia-rasi-mra",
      "inicia-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "unit": "mmol/L",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "2823-3"
    ],
    "fuente": "Guía CKM 2026, Tabla 47 (COR 2a)"
  },
  {
    "codigo": "E2-EVAL-08",
    "label": "TSH",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "tg-altos"
    ],
    "momentos": [
      "dia-0"
    ],
    "unit": "mIU/L",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "3016-3"
    ],
    "fuente": "Guía CKM 2026, Sección 5.5.2"
  },
  {
    "codigo": "E2-EVAL-09",
    "label": "AST, ALT, plaquetas y FIB-4",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "algunaDe": [
      "dm2",
      "dos-o-mas-factores"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "laboratorio",
    "detector": "fib4",
    "nombre": "AST, ALT y plaquetas",
    "fuente": "Guía CKM 2026, Tabla 44 (COR 1)"
  },
  {
    "codigo": "E2-EVAL-10",
    "label": "STOP-BANG",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "algunaDe": [
      "imc-30",
      "hta-resistente",
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-stop-bang-v1",
    "nombre": "STOP-BANG",
    "fuente": "Guía CKM 2026, Tabla 45 (COR 2a)"
  },
  {
    "codigo": "E2-EVAL-11",
    "label": "NT-proBNP o BNP (troponina us con obesidad)",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "prevent-hf-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "unit": "pg/mL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "33762-6"
    ],
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 16"
  },
  {
    "codigo": "E2-EVAL-12",
    "label": "Calcio coronario",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "prevent-ascvd-3-10"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tabla 8"
  },
  {
    "codigo": "E2-EVAL-13",
    "label": "PREVENT a 10 y 30 años",
    "estadios": [
      "2",
      "3"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "prevent",
    "fuente": "Guía CKM 2026, Tabla 26"
  },
  {
    "codigo": "E2-EVAL-14",
    "label": "Potenciadores de la Tabla 9",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-potenciadores-v1",
    "nombre": "registro de potenciadores",
    "fuente": "Guía CKM 2026, Tabla 27"
  },
  {
    "codigo": "E2-EVAL-15",
    "label": "Estadificación CKM y categoría KDIGO validadas por el médico",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "validacion",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E2-EVAL-16",
    "label": "Glucemias capilares o sensor",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2",
      "automonitoreo-glucemia"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "mg/dL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "1558-6"
    ],
    "fuente": "Guía CKM 2026, Tabla 47"
  },
  {
    "codigo": "E2-EVAL-17",
    "label": "Cuestionario inicial y cuestionarios LE8 (MEDAS-14, actividad, nicotina, sueño)",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "persona",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/le8-diet-mepa-v1",
    "nombre": "MEDAS-14 del portal",
    "fuente": "LE8"
  },
  {
    "codigo": "E2-EVAL-18",
    "label": "PHQ-2, GAD-2, PSS-4",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-phq2-gad2-pss4-v1",
    "nombre": "PHQ-2, GAD-2 y PSS-4",
    "fuente": "Guía CKM 2026, Sección 5.1"
  },
  {
    "codigo": "E2-EVAL-19",
    "label": "AHC-HRSN",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-ahc-hrsn-v1",
    "nombre": "AHC-HRSN",
    "fuente": "Guía CKM 2026, Sección 3.2"
  },
  {
    "codigo": "E2-EVAL-20",
    "label": "Puntaje LE8 por dominio y total",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "le8",
    "fuente": "LE8"
  },
  {
    "codigo": "E2-EVAL-21",
    "label": "Respuesta de peso y cintura, % del basal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Firma del estadío 1"
  },
  {
    "codigo": "E2-EVAL-22",
    "label": "Adherencia: dosis olvidadas por semana",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "medicacion"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E2-EVAL-23",
    "label": "Efectos adversos de SGLT2i, GLP-1, RASi, MRA",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "algunaDe": [
      "toma-sglt2i",
      "toma-glp1",
      "toma-rasi-mra"
    ],
    "momentos": [
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tablas 14, 15 y 47"
  },
  {
    "codigo": "E2-EVAL-24",
    "label": "Reconciliación de medicación y suplementos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-reconciliacion-medicacion-v1",
    "nombre": "reconciliación de medicación",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E2-EVAL-25",
    "label": "Fondo de ojo, pies y orina",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "ADA"
  },
  {
    "codigo": "E3-EVAL-01",
    "label": "Todo el bloque de evaluación del estadío 2 (E2-EVAL-01 a 25), heredado",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0",
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E3-EVAL-02",
    "label": "LDL y perfil completo (día 60 = 4 a 12 semanas del inicio o ajuste)",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0",
      "dia-60",
      "dia-100"
    ],
    "unit": "mg/dL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "13457-7"
    ],
    "fuente": "Guía de dislipidemia 2026"
  },
  {
    "codigo": "E3-EVAL-03",
    "label": "Documento del sustrato (calcio coronario, angio-TC, ITB, eco, biomarcadores)",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tabla 4 y Sección 5.6.1; firma del estadío 3"
  },
  {
    "codigo": "E3-EVAL-04",
    "label": "NT-proBNP o BNP",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "pre-ic",
      "erc-muy-alto-riesgo",
      "prevent-alto"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "pg/mL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "33762-6"
    ],
    "fuente": "Guía CKM 2026, Tabla 16"
  },
  {
    "codigo": "E3-EVAL-05",
    "label": "Ecocardiograma",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic"
    ],
    "algunaDe": [
      "sin-ecocardiograma",
      "biomarcadores-en-ascenso"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Figura 12; firma del estadío 3"
  },
  {
    "codigo": "E3-EVAL-06",
    "label": "Peso diario y síntomas de congestión en la app",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "kg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "29463-7"
    ],
    "fuente": "Guía IC 2022"
  },
  {
    "codigo": "E3-EVAL-07",
    "label": "eGFR y UACR",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "mL/min/1.73m2",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "33914-3",
      "2160-0"
    ],
    "fuente": "Guía CKM 2026, Sección 3.1.1; KDIGO"
  },
  {
    "codigo": "E3-EVAL-08",
    "label": "Hemograma, calcio, fósforo, PTH, bicarbonato",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "KDIGO"
  },
  {
    "codigo": "E3-EVAL-09",
    "label": "Potasio y creatinina a las 2 a 4 semanas",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "inicia-rasi-mra",
      "inicia-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "unit": "mmol/L",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "2823-3"
    ],
    "fuente": "Guía CKM 2026, Tabla 47 (COR 2a)"
  },
  {
    "codigo": "E3-EVAL-10",
    "label": "Índice tobillo-brazo y síntomas de claudicación",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "itb-bajo"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Sección 5.6.1"
  },
  {
    "codigo": "E3-EVAL-11",
    "label": "Síntomas de angina, disnea, síncope, déficit neurológico",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0",
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Sección 5.6"
  },
  {
    "codigo": "E3-EVAL-12",
    "label": "Contacto de coordinación quincenal los primeros 60 días",
    "estadios": [
      "3"
    ],
    "momentos": [
      "continuo"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E3-EVAL-13",
    "label": "Adherencia a estatina, RASi, SGLT2i y antihipertensivos: dosis olvidadas por semana",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "medicacion"
    ],
    "momentos": [
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E3-EVAL-14",
    "label": "Síntomas musculares con estatina",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "toma-estatina"
    ],
    "momentos": [
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía de dislipidemia 2026"
  },
  {
    "codigo": "E3-EVAL-15",
    "label": "PREVENT recalculado",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "prevent",
    "fuente": "Guía CKM 2026, Tabla 26"
  },
  {
    "codigo": "E3-EVAL-16",
    "label": "Estadificación validada y sustrato asignado",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "validacion",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E4-EVAL-01",
    "label": "Todo el bloque de evaluación del estadío 2 sin PREVENT, heredado",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0",
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "sistema",
    "detector": "prevent",
    "fuente": "Guía CKM 2026, Figura 3"
  },
  {
    "codigo": "E4-EVAL-02",
    "label": "LDL y perfil completo (día 60 = 4 a 12 semanas del inicio o ajuste)",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-60",
      "dia-100"
    ],
    "unit": "mg/dL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "13457-7"
    ],
    "fuente": "Guía de dislipidemia 2026"
  },
  {
    "codigo": "E4-EVAL-03",
    "label": "ECG",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guías de enfermedad"
  },
  {
    "codigo": "E4-EVAL-04",
    "label": "Ecocardiograma con FEVI",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "sin-ecocardiograma"
    ],
    "algunaDe": [
      "ic",
      "coronaria",
      "fa"
    ],
    "momentos": [
      "dia-0"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía IC 2022"
  },
  {
    "codigo": "E4-EVAL-05",
    "label": "NT-proBNP o BNP",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "unit": "pg/mL",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "33762-6"
    ],
    "fuente": "Guía IC 2022"
  },
  {
    "codigo": "E4-EVAL-06",
    "label": "Clase NYHA y marcha de 6 minutos",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "ic",
      "eap"
    ],
    "momentos": [
      "dia-0",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía IC 2022; Guía CKM 2026, Tabla 40"
  },
  {
    "codigo": "E4-EVAL-07",
    "label": "Peso diario y síntomas de congestión",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "unit": "kg",
    "quien": "consultorio",
    "detector": "loinc",
    "codigosLoinc": [
      "29463-7"
    ],
    "fuente": "Guía IC 2022"
  },
  {
    "codigo": "E4-EVAL-08",
    "label": "Hemograma, ferritina, saturación de transferrina",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía IC 2022"
  },
  {
    "codigo": "E4-EVAL-09",
    "label": "Potasio y creatinina a las 2 a 4 semanas",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "inicia-rasi-mra",
      "inicia-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "unit": "mmol/L",
    "quien": "laboratorio",
    "detector": "loinc",
    "codigosLoinc": [
      "2823-3"
    ],
    "fuente": "Guía CKM 2026, Tabla 47 (COR 2a)"
  },
  {
    "codigo": "E4-EVAL-10",
    "label": "Sangrado, hematocrito y función renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "toma-antitrombotico"
    ],
    "momentos": [
      "dia-0",
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guías FA 2023 y coronaria 2023"
  },
  {
    "codigo": "E4-EVAL-11",
    "label": "Síntomas: angina, disnea, palpitaciones, claudicación, déficit neurológico",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0",
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Sección 6"
  },
  {
    "codigo": "E4-EVAL-12",
    "label": "Asistencia a rehabilitación cardiovascular",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "coronaria",
      "ic",
      "eap"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guías de enfermedad"
  },
  {
    "codigo": "E4-EVAL-13",
    "label": "Adherencia a antitrombóticos, estatina y GDMT: dosis olvidadas por semana",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "medicacion"
    ],
    "momentos": [
      "evento",
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E4-EVAL-14",
    "label": "PHQ-2 y GAD-2 (depresión post-evento)",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "cuestionario",
    "cuestionario": "Questionnaire/pb100d-phq2-gad2-pss4-v1",
    "nombre": "PHQ-2, GAD-2 y PSS-4",
    "fuente": "Guía CKM 2026, Tabla 9; guía coronaria 2023"
  },
  {
    "codigo": "E4-EVAL-15",
    "label": "Sodio, calcio, fósforo, PTH, bicarbonato, hemograma",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "falla-renal",
      "egfr-30"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "KDIGO"
  },
  {
    "codigo": "E4-EVAL-16",
    "label": "Registro de palpitaciones y trazados de dispositivo",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía FA 2023"
  },
  {
    "codigo": "E4-EVAL-17",
    "label": "Estadificación validada (4a o 4b) y submódulos activos",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "validacion",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E4-EVAL-18",
    "label": "Hospitalizaciones y eventos en los 100 días",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "quien": "equipo",
    "detector": "manual",
    "fuente": "Guía CKM 2026, Sección 6"
  }
];
