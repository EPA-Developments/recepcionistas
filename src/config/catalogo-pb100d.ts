/**
 * Catálogo PB100D · alertas al médico y derivaciones por estadío CKM 0 a 4.
 *
 * GENERADO desde `@epa/careplan-menopausia` (`scripts/exportar-catalogo-recepcion.ts`)
 * a partir del catálogo firmado el 2026-09-27 por los Dres. Barbagelata y D'Alessandro.
 * No editar a mano: cualquier cambio se hace en el monorepo y se vuelve a exportar.
 *
 * Cada ítem aplica a un paciente cuando su estadío validado está en `estadios`, todas
 * sus `condiciones` están presentes, alguna de `algunaDe` (si las hay) está presente y
 * ninguna de `excluye` lo está (`src/lib/ckm-catalogo.ts`). Es soporte a la decisión
 * del médico con umbral y COR/LOE: el sistema no prescribe.
 */

export const FIRMA_CATALOGO_PB100D = '2026-09-27';

export type EstadioCatalogo = '0' | '1' | '2' | '3' | '4';

export type MomentoCatalogo = 'dia-0' | 'dia-30' | 'dia-60' | 'dia-100' | 'continuo' | 'evento' | 'semanal' | 'mensual';

export type TipoAlertaCatalogo = 'alerta' | 'derivacion';

export type ResponsableCatalogo = 'persona' | 'cardiologia' | 'nutricion' | 'kinesiologia' | 'endocrinologia' | 'nefrologia' | 'neurologia' | 'neumonologia' | 'hepatologia' | 'psicologia' | 'trabajo-social' | 'enfermeria' | 'educador' | 'coordinacion' | 'obstetricia' | 'electrofisiologia' | 'farmacia' | 'cirugia-vascular' | 'rehabilitacion' | 'imagen' | 'oftalmologia' | 'equipo' | 'firmantes';

/** Condiciones que activan ítems: las registra el equipo o se derivan de la estadificación. */
export const CONDICIONES_CATALOGO = [
  "exceso-adiposidad",
  "imc-23-25",
  "imc-27",
  "imc-30",
  "prediabetes",
  "dm2",
  "hba1c-10",
  "riesgo-hipoglucemia",
  "automonitoreo-glucemia",
  "dos-o-mas-factores",
  "pa-elevada",
  "hta",
  "hta-resistente",
  "pa-180-110",
  "toma-antihipertensivo",
  "tg-altos",
  "tg-500",
  "sindrome-metabolico",
  "ldl-fuera-de-meta",
  "dislipidemia-aislada",
  "erc",
  "erc-muy-alto-riesgo",
  "falla-renal",
  "uacr-30",
  "uacr-100",
  "uacr-200",
  "egfr-30",
  "egfr-45",
  "hiperpotasemia",
  "dialisis",
  "prevent-ascvd-3-5",
  "prevent-ascvd-5",
  "prevent-ascvd-3-10",
  "prevent-ascvd-30-10",
  "prevent-cvd-7-5",
  "prevent-hf-5",
  "prevent-alto",
  "aterosclerosis-subclinica",
  "cac-100",
  "cac-1000",
  "cac-percentil-75",
  "cac-0",
  "itb-bajo",
  "pre-ic",
  "sin-ecocardiograma",
  "biomarcadores-en-ascenso",
  "hipertension-pulmonar",
  "ecv",
  "coronaria",
  "acv",
  "eap",
  "ic",
  "hfref",
  "hfmref",
  "hfpef",
  "fa",
  "evento-reciente",
  "sintomas-nuevos",
  "congestion",
  "sangrado-mayor",
  "candidato-trasplante",
  "medicacion",
  "toma-glp1",
  "toma-sglt2i",
  "toma-rasi-mra",
  "toma-estatina",
  "toma-antitrombotico",
  "inicia-rasi-mra",
  "inicia-sglt2i",
  "inicia-hipolipemiante",
  "farmaco-obesidad",
  "polifarmacia",
  "deficit-hierro",
  "sin-respuesta",
  "procedimiento",
  "fib4-alto",
  "menopausia",
  "planifica-embarazo",
  "embarazo",
  "dmg-previa",
  "apo-reciente",
  "fuma",
  "phq-gad-positivo",
  "ahc-necesidades",
  "potenciadores",
  "ancestria-asiatica",
  "apnea-sospecha",
  "edad-30-59",
  "edad-40-79",
  "edad-50-79",
  "edad-65-79",
  "fragilidad",
  "alcohol"
] as const;

export type CondicionCatalogo = (typeof CONDICIONES_CATALOGO)[number];

export interface AlertaCatalogo {
  /** Código firmado (`E2-HTA-MED-01`). */
  codigo: string;
  tipo: TipoAlertaCatalogo;
  dominio: string;
  /** Estadíos en que está activa. */
  estadios: readonly EstadioCatalogo[];
  /** Todas deben cumplirse. */
  condiciones?: readonly CondicionCatalogo[];
  /** Al menos una debe cumplirse (además de `condiciones`). */
  algunaDe?: readonly CondicionCatalogo[];
  /** Ninguna debe cumplirse. */
  excluye?: readonly CondicionCatalogo[];
  momentos: readonly MomentoCatalogo[];
  responsable: ResponsableCatalogo;
  /** Alerta: cuándo se dispara. Derivación: especialidad. */
  titulo: string;
  /** Alerta: qué dice. Derivación: cuándo. */
  texto: string;
  fuente: string;
  cor?: string;
  loe?: string;
}

export const ETIQUETA_ESTADIO_CATALOGO: Record<EstadioCatalogo, string> = {
  "0": "Salud cardiometabólica preservada",
  "1": "Exceso de adiposidad o prediabetes",
  "2": "Factores de riesgo metabólicos o renales",
  "3": "Señales tempranas en corazón o riñón",
  "4": "Enfermedad cardiovascular establecida"
};

export const ETIQUETA_MOMENTO_CATALOGO: Record<MomentoCatalogo, string> = {
  "dia-0": "Día 0",
  "dia-30": "Día 30",
  "dia-60": "Día 60",
  "dia-100": "Día 100",
  "continuo": "Continuo",
  "evento": "Evento",
  "semanal": "Semanal",
  "mensual": "Mensual"
};

export const ETIQUETA_RESPONSABLE_CATALOGO: Record<ResponsableCatalogo, string> = {
  "persona": "La persona",
  "cardiologia": "Cardiología",
  "nutricion": "Nutrición",
  "kinesiologia": "Kinesiología",
  "endocrinologia": "Endocrinología",
  "nefrologia": "Nefrología",
  "neurologia": "Neurología",
  "neumonologia": "Neumonología",
  "hepatologia": "Hepatología",
  "psicologia": "Psicología",
  "trabajo-social": "Trabajo social",
  "enfermeria": "Enfermería",
  "educador": "Educador en diabetes",
  "coordinacion": "Coordinación CKM",
  "obstetricia": "Obstetricia",
  "electrofisiologia": "Electrofisiología",
  "farmacia": "Farmacia clínica",
  "cirugia-vascular": "Cirugía vascular",
  "rehabilitacion": "Rehabilitación cardiovascular",
  "imagen": "Cardiología de imagen",
  "oftalmologia": "Oftalmología y podología",
  "equipo": "Equipo",
  "firmantes": "Firmantes"
};

/** Las 239 alertas y derivaciones firmadas. */
export const ALERTAS_CATALOGO: readonly AlertaCatalogo[] = [
  {
    "codigo": "E0-MED-01",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "30 a 79 años",
    "texto": "Calcular PREVENT a 10 años (COR 1) y, de 30 a 59, a 30 años (COR 2a); comunicar el riesgo a largo plazo.",
    "fuente": "Guía CKM 2026, Tabla 26",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E0-MED-02",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "prevent-ascvd-30-10",
      "prevent-ascvd-3-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-ASCVD a 30 años ≥ 10 %, o a 10 años 3 a 4,9 %",
    "texto": "Considerar tratamiento hipolipemiante en una conversación de riesgo con potenciadores; en estadío 0 suele responder a LDL alto aislado.",
    "fuente": "Guía CKM 2026, Tabla 8 (guía de dislipidemia 2026)"
  },
  {
    "codigo": "E0-MED-03",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "dislipidemia-aislada"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "No-HDL ≥ 130 o LDL ≥ 160 con el resto normal",
    "texto": "Dislipidemia aislada: descartar causas secundarias e hipercolesterolemia familiar (LDL ≥ 190); estilo de vida y decisión según PREVENT. No saca del estadío 0.",
    "fuente": "Guía CKM 2026, Sección 7.1 (guía de dislipidemia 2026)"
  },
  {
    "codigo": "E0-MED-04",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "pa-elevada"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PA 120 a 129 / < 80",
    "texto": "Presión elevada: estilo de vida (sodio, peso, actividad, alcohol) y control cada 3 a 6 meses; no requiere fármacos.",
    "fuente": "Guía HTA 2025"
  },
  {
    "codigo": "E0-MED-05",
    "tipo": "alerta",
    "dominio": "potenciadores",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "potenciadores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Uno o más potenciadores de la Tabla 9",
    "texto": "Cadencia de laboratorio cada 2 a 3 años en vez de 5; educación específica; con apnea sospechada, estudio del sueño.",
    "fuente": "Guía CKM 2026, Tabla 27 y Figura 3",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E0-MED-06",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "dmg-previa"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "endocrinologia",
    "titulo": "Diabetes gestacional previa",
    "texto": "Si no tuvo TTOG posparto, glucemia y HbA1c ahora; seguimiento con la cadencia del estadío 1 (glucemia, lípidos y riñón cada 2 a 3 años).",
    "fuente": "Guía CKM 2026, Tabla 33 y Sección 5.4.5",
    "cor": "1",
    "loe": "B-R"
  },
  {
    "codigo": "E0-MED-07",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "apo-reciente"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Resultado obstétrico adverso en el último año",
    "texto": "Cribado de factores CKM (PA, lípidos, glucemia, riñón, IMC y cintura) dentro del año y consejería; transición a atención primaria longitudinal.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E0-MED-08",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "obstetricia",
    "titulo": "Planifica embarazo",
    "texto": "Consejo preconcepcional: sostener peso, presión y glucemia; ácido fólico según obstetricia.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E0-MED-09",
    "tipo": "alerta",
    "dominio": "estres",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "psicologia",
    "titulo": "PHQ-2 ≥ 3 o GAD-2 ≥ 3",
    "texto": "PHQ-9 o GAD-7 y psicología; la salud psicológica pobre es potenciador.",
    "fuente": "Guía CKM 2026, Sección 5.1 y Tabla 9"
  },
  {
    "codigo": "E0-MED-10",
    "tipo": "alerta",
    "dominio": "social",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "AHC-HRSN con necesidades",
    "texto": "Trabajo social o navegación; adaptar acciones.",
    "fuente": "Guía CKM 2026, Tabla 25",
    "cor": "1"
  },
  {
    "codigo": "E0-MED-11",
    "tipo": "alerta",
    "dominio": "nicotina",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "fuma"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Fuma o vapea",
    "texto": "Consejería y tratamiento de cesación; es el dominio de mayor impacto cuando el resto está normal.",
    "fuente": "Guía CKM 2026, Sección 5.1 (guía de prevención primaria)"
  },
  {
    "codigo": "E0-MED-12",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "0"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Al día 100 o en un control aparece un criterio de estadío 1 o 2",
    "texto": "Cambio de estadío validado por el médico; se activa el catálogo correspondiente y su laboratorio.",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E0-MED-13",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "ancestria-asiatica"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Ancestría asiática declarada",
    "texto": "Aplicar IMC ≥ 23 y cintura ≥ 80/90 como umbrales de estadío 1.",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E0-DER-01",
    "tipo": "derivacion",
    "dominio": "dieta",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "imc-23-25",
      "dislipidemia-aislada"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "nutricion",
    "titulo": "Nutrición",
    "texto": "IMC 23 a 24,9, cintura en ascenso, MEDAS-14 < 9 o dislipidemia aislada; opcional para el resto.",
    "fuente": "Guía CKM 2026, Sección 5.4"
  },
  {
    "codigo": "E0-DER-02",
    "tipo": "derivacion",
    "dominio": "actividad-fisica",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "edad-65-79"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "kinesiologia",
    "titulo": "Kinesiología o educación física",
    "texto": "Actividad < 150 min/semana; 65 a 79 años para fuerza y equilibrio; niveles 3 y 4 de la escalera.",
    "fuente": "LE8 (AHA 2022)"
  },
  {
    "codigo": "E0-DER-03",
    "tipo": "derivacion",
    "dominio": "estres",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "psicologia",
    "titulo": "Psicología",
    "texto": "PHQ-2 o GAD-2 positivos; estrés elevado.",
    "fuente": "Guía CKM 2026, Tabla 9"
  },
  {
    "codigo": "E0-DER-04",
    "tipo": "derivacion",
    "dominio": "social",
    "estadios": [
      "0"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "Trabajo social",
    "texto": "AHC-HRSN con necesidades.",
    "fuente": "Guía CKM 2026, Sección 3.2"
  },
  {
    "codigo": "E0-DER-05",
    "tipo": "derivacion",
    "dominio": "apnea",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "apnea-sospecha",
      "fuma"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "neumonologia",
    "titulo": "Neumonología",
    "texto": "STOP-BANG positivo con síntomas; tabaquismo con fracasos previos.",
    "fuente": "Guía CKM 2026, Sección 7.3"
  },
  {
    "codigo": "E0-DER-06",
    "tipo": "derivacion",
    "dominio": "embarazo",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "planifica-embarazo",
      "apo-reciente"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "obstetricia",
    "titulo": "Obstetricia",
    "texto": "Planificación de embarazo; posparto tras resultado adverso.",
    "fuente": "Guía CKM 2026, Tabla 46"
  },
  {
    "codigo": "E0-DER-07",
    "tipo": "derivacion",
    "dominio": "glucemia",
    "estadios": [
      "0"
    ],
    "algunaDe": [
      "dmg-previa",
      "dislipidemia-aislada"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "endocrinologia",
    "titulo": "Endocrinología",
    "texto": "DMG previa con glucemia alterada; sospecha de hipercolesterolemia familiar.",
    "fuente": "Guía CKM 2026, Secciones 5.4.5 y 7.1"
  },
  {
    "codigo": "E1-MED-01",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "imc-27"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "IMC ≥ 27 sin otros factores CKM",
    "texto": "Sumar a la intervención de estilo de vida estructurada una terapia basada en GLP-1 con beneficio probado puede ser beneficioso para bajar de peso y mejorar glucemia y perfil CKM (2a, A). Los fármacos no basados en GLP-1 pueden ser razonables (2b, A). Nunca lo ve la persona.",
    "fuente": "Guía CKM 2026, Tabla 31",
    "cor": "2a",
    "loe": "A"
  },
  {
    "codigo": "E1-MED-02",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "toma-glp1"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Toma GLP-1 y al día 100 el peso bajó menos de 5 %",
    "texto": "Reevaluar hiporrespuesta: escalar dosis, cambiar a otro agente con beneficio CKM o derivar a un especialista en obesidad.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E1-MED-03",
    "tipo": "alerta",
    "dominio": "medicacion",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "toma-glp1"
    ],
    "momentos": [
      "dia-30"
    ],
    "responsable": "cardiologia",
    "titulo": "Toma GLP-1",
    "texto": "Revisar efectos gastrointestinales, pérdida de masa magra, litiasis biliar y, con descenso rápido de HbA1c, retinopatía; ajustar la velocidad de titulación.",
    "fuente": "Guía CKM 2026, Tablas 15 y 19"
  },
  {
    "codigo": "E1-MED-05",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "prediabetes"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Prediabetes",
    "texto": "Programa intensivo de estilo de vida con meta de peso; repetir glucemia o HbA1c al año. Con DMG previa y prediabetes: estilo de vida o metformina para reducir el riesgo de diabetes (1, B-R).",
    "fuente": "Guía CKM 2026, Sección 5.4.5 y Tabla 33"
  },
  {
    "codigo": "E1-MED-06",
    "tipo": "alerta",
    "dominio": "hepatico",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "prediabetes"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Prediabetes con FIB-4 calculado",
    "texto": "Menor de 65 años: FIB-4 < 1,3 rutina; 1,3 a 2,67 elastografía o ELF; > 2,67 hepatología. 65 años o más: < 2,0 rutina; 2,0 a 2,67 elastografía o ELF; > 2,67 hepatología. Repetir cada 2 a 3 años. No usar FIB-4 en enfermedad aguda.",
    "fuente": "Guía CKM 2026, Tabla 44 y Tablas 17 y 18",
    "cor": "2a",
    "loe": "C-LD"
  },
  {
    "codigo": "E1-MED-07",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "1"
    ],
    "algunaDe": [
      "imc-30",
      "apnea-sospecha"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "IMC ≥ 30 y STOP-BANG ≥ 3, o síntomas de apnea con cualquier puntaje",
    "texto": "Pedir polisomnografía o estudio domiciliario del sueño. STOP-BANG subestima en mujeres y en ECV. Si se confirma apnea, el tratamiento incluye pérdida de peso además de CPAP (1, B-R).",
    "fuente": "Guía CKM 2026, Tabla 45 y Sección 7.3",
    "cor": "2a",
    "loe": "C-LD"
  },
  {
    "codigo": "E1-MED-08",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "1"
    ],
    "algunaDe": [
      "prevent-ascvd-3-5",
      "prevent-ascvd-30-10",
      "prevent-ascvd-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-ASCVD a 10 años 3 a 4,9 %, o a 30 años ≥ 10 %",
    "texto": "Considerar tratamiento hipolipemiante como parte de una conversación de riesgo que incorpore potenciadores, riesgo a 30 años o calcio coronario. Con ≥ 5 % a 10 años, iniciar.",
    "fuente": "Guía CKM 2026, Tabla 8 y Sección 7.1 (guía de dislipidemia 2026)"
  },
  {
    "codigo": "E1-MED-09",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "prevent-hf-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-HF a 10 años ≥ 5 %",
    "texto": "Evaluar pre-IC con NT-proBNP o BNP (troponina us si obesidad) y coordinar cuidados; ecocardiograma para refinar. Un resultado positivo cambia el estadío a 3.",
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 16"
  },
  {
    "codigo": "E1-MED-10",
    "tipo": "alerta",
    "dominio": "potenciadores",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "potenciadores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Uno o más potenciadores de la Tabla 9",
    "texto": "Es razonable usar los potenciadores para intensificar la prevención; seguimiento quincenal los primeros 60 días.",
    "fuente": "Guía CKM 2026, Tabla 27 y Tabla 9",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E1-MED-11",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "dmg-previa"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "endocrinologia",
    "titulo": "DMG previa sin TTOG posparto registrada",
    "texto": "Corresponde prueba de tolerancia oral a la glucosa a las 4 a 12 semanas posparto; si ya pasó ese plazo, glucemia y HbA1c ahora y seguimiento con la cadencia del estadío 1.",
    "fuente": "Guía CKM 2026, Tabla 33 y Sección 5.4.5",
    "cor": "1",
    "loe": "B-R"
  },
  {
    "codigo": "E1-MED-12",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "endocrinologia",
    "titulo": "Planifica embarazo",
    "texto": "Optimizar peso, función renal, glucemia y presión antes del embarazo con estilo de vida y medicación apropiada; con diabetes, HbA1c < 6,5 %.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E1-MED-13",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Al día 100 aparece un criterio de estadío 2 (PA ≥ 130/80 en AMPA, TG ≥ 150, HbA1c ≥ 6,5 %, eGFR < 60 o UACR ≥ 30)",
    "texto": "La persona cambia de estadío: se cierra el módulo 1 y se activa el módulo 2 con sus submódulos. Confirmar HTA y ERC con segunda medición.",
    "fuente": "Guía CKM 2026, Tabla 4 y Figura 3"
  },
  {
    "codigo": "E1-MED-14",
    "tipo": "alerta",
    "dominio": "estres",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "psicologia",
    "titulo": "PHQ-2 ≥ 3 o GAD-2 ≥ 3",
    "texto": "Completar PHQ-9 o GAD-7 y derivar a psicología; con ideación suicida en el PHQ-9, contacto el mismo día.",
    "fuente": "Guía CKM 2026, Sección 5.1 y Tabla 9"
  },
  {
    "codigo": "E1-MED-15",
    "tipo": "alerta",
    "dominio": "social",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "AHC-HRSN con una o más necesidades",
    "texto": "Derivar a trabajo social o navegación; registrar la barrera en el plan para adaptar las acciones.",
    "fuente": "Guía CKM 2026, Tabla 25 y Sección 3.2",
    "cor": "1"
  },
  {
    "codigo": "E1-DER-01",
    "tipo": "derivacion",
    "dominio": "dieta",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nutricion",
    "titulo": "Nutrición",
    "texto": "Todas las personas en estadío 1, al alta.",
    "fuente": "Guía CKM 2026, Sección 5.4.2",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E1-DER-02",
    "tipo": "derivacion",
    "dominio": "actividad-fisica",
    "estadios": [
      "1"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "kinesiologia",
    "titulo": "Kinesiología o educación física",
    "texto": "Todas; obligatoria con flag de caídas, densitometría alterada o incontinencia frecuente.",
    "fuente": "Guía CKM 2026, Sección 5.4.2"
  },
  {
    "codigo": "E1-DER-03",
    "tipo": "derivacion",
    "dominio": "glucemia",
    "estadios": [
      "1"
    ],
    "algunaDe": [
      "imc-27",
      "prediabetes",
      "dmg-previa",
      "planifica-embarazo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "endocrinologia",
    "titulo": "Endocrinología",
    "texto": "Decisión farmacológica para obesidad; prediabetes con potenciadores; DMG previa; planificación de embarazo.",
    "fuente": "Guía CKM 2026, Secciones 5.4.3 y 5.4.5"
  },
  {
    "codigo": "E1-DER-04",
    "tipo": "derivacion",
    "dominio": "hepatico",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "prediabetes"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "hepatologia",
    "titulo": "Hepatología",
    "texto": "FIB-4 > 2,67, o intermedio con elastografía o ELF de riesgo.",
    "fuente": "Guía CKM 2026, Tablas 17 y 18"
  },
  {
    "codigo": "E1-DER-05",
    "tipo": "derivacion",
    "dominio": "apnea",
    "estadios": [
      "1"
    ],
    "algunaDe": [
      "imc-30",
      "apnea-sospecha",
      "fuma"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "neumonologia",
    "titulo": "Neumonología",
    "texto": "STOP-BANG ≥ 3 o síntomas de apnea; tabaquismo con fracasos previos o EPOC.",
    "fuente": "Guía CKM 2026, Sección 7.3"
  },
  {
    "codigo": "E1-DER-07",
    "tipo": "derivacion",
    "dominio": "estres",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "psicologia",
    "titulo": "Psicología",
    "texto": "PHQ-2 o GAD-2 positivos; ingesta emocional o estrés elevado en el cuestionario inicial.",
    "fuente": "Guía CKM 2026, Tabla 9"
  },
  {
    "codigo": "E1-DER-08",
    "tipo": "derivacion",
    "dominio": "social",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "Trabajo social",
    "texto": "AHC-HRSN con necesidades no cubiertas.",
    "fuente": "Guía CKM 2026, Sección 3.2"
  },
  {
    "codigo": "E1-DER-09",
    "tipo": "derivacion",
    "dominio": "embarazo",
    "estadios": [
      "1"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "obstetricia",
    "titulo": "Obstetricia",
    "texto": "Planifica embarazo con potenciadores o antecedente obstétrico adverso.",
    "fuente": "Guía CKM 2026, Tabla 46"
  },
  {
    "codigo": "E2-HTA-MED-01",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PA promedio ≥ 140/90; o ≥ 130/80 con DM2, ERC, ACV previo, ECV o PREVENT-CVD a 10 años ≥ 7,5 %",
    "texto": "Indicado tratamiento farmacológico además del estilo de vida. Primera línea: RASi, tiazida o calcioantagonista dihidropiridínico de acción prolongada; preferir combinación de dos en un comprimido. Meta < 130/80.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E2-HTA-MED-02",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "hta",
      "toma-antihipertensivo"
    ],
    "momentos": [
      "dia-30",
      "dia-60",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "AMPA ≥ 130/80 al día 30, 60 o 100 con tratamiento",
    "texto": "Intensificar: subir dosis o sumar un fármaco de primera línea; revisar adherencia, sal, alcohol y AINE antes de escalar.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E2-HTA-MED-03",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "hta",
      "inicia-rasi-mra"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Se inicia o se sube un RASi o un MRA",
    "texto": "Recalcular eGFR y medir potasio a las 2 a 4 semanas; una caída de eGFR ≤ 30 % es aceptable.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E2-HTA-MED-04",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "hta"
    ],
    "algunaDe": [
      "erc",
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC con UACR ≥ 30 o DM2",
    "texto": "El RASi es el antihipertensivo de elección por su efecto renoprotector (ver E2-ERC-MED-01).",
    "fuente": "Guía CKM 2026, Tabla 35",
    "cor": "1",
    "loe": "B-R"
  },
  {
    "codigo": "E2-HTA-MED-05",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "hta-resistente"
    ],
    "momentos": [
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "PA ≥ 130/80 con tres fármacos a dosis óptima, uno de ellos diurético",
    "texto": "HTA resistente: descartar apnea del sueño (STOP-BANG, estudio del sueño), hiperaldosteronismo primario, AINE y adherencia. Derivar a neumonología si corresponde.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Secciones 5.5.3 y 7.3"
  },
  {
    "codigo": "E2-HTA-MED-06",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "pa-180-110"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "PA ≥ 180/110 con síntomas, o sin síntomas y sostenida",
    "texto": "Urgencia o emergencia hipertensiva según la guía HTA 2025; contacto el mismo día.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E2-HTA-MED-07",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "hta"
    ],
    "algunaDe": [
      "planifica-embarazo",
      "embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Planifica embarazo o embarazo en curso con HTA",
    "texto": "Cambiar a fármacos con perfil seguro en embarazo; suspender RASi, ARA II y MRA; equipo con obstetricia.",
    "fuente": "Guía CKM 2026, Tabla 46 y Sección 7.5",
    "cor": "1",
    "loe": "C-LD"
  },
  {
    "codigo": "E2-DM2-MED-01",
    "tipo": "alerta",
    "dominio": "glucemia",
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
    "responsable": "cardiologia",
    "titulo": "DM2",
    "texto": "Estilo de vida con conducta, dieta y actividad, más farmacoterapia como adyuvante según necesidad, para peso saludable y control glucémico; intervención multifactorial intensificada (glucemia, presión, lípidos, albuminuria).",
    "fuente": "Guía CKM 2026, Tabla 34",
    "cor": "1",
    "loe": "A; B-R"
  },
  {
    "codigo": "E2-DM2-MED-02",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "prevent-cvd-7-5",
      "edad-50-79"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "DM2 con PREVENT-CVD a 10 años ≥ 7,5 %, o ≥ 50 años con otro factor CKM",
    "texto": "El plan debe incluir SGLT2i o terapia basada en GLP-1 con beneficio demostrado, para reducir eventos y mortalidad cardiovascular. Con obesidad clase II o mayor, priorizar GLP-1 (Tabla 10); con ERC o pre-IC, priorizar SGLT2i.",
    "fuente": "Guía CKM 2026, Tabla 34, Figura 8 y Tabla 10",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E2-DM2-MED-03",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "toma-sglt2i",
      "toma-glp1"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "HbA1c 0,5 a 1 punto por encima de la meta con cardioprotector",
    "texto": "Metformina puede ser efectiva sumada al cardioprotector para alcanzar la meta. Con HbA1c 7 a 8,5 %: agregar metformina; > 8,5 %: agregar semaglutida o tirzepatida si ya toma SGLT2i.",
    "fuente": "Guía CKM 2026, Tabla 34 y Tabla 20",
    "cor": "2a",
    "loe": "A"
  },
  {
    "codigo": "E2-DM2-MED-04",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "toma-sglt2i",
      "toma-glp1"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "DM2 con riesgo aumentado o varios factores CKM, ya con un cardioprotector",
    "texto": "La combinación de GLP-1 con beneficio probado y SGLT2i puede considerarse para reducir eventos más allá de un solo agente.",
    "fuente": "Guía CKM 2026, Tabla 34",
    "cor": "2b",
    "loe": "B-NR"
  },
  {
    "codigo": "E2-DM2-MED-05",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2",
      "hba1c-10"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "endocrinologia",
    "titulo": "HbA1c > 10 %, glucemia ≥ 300 mg/dL o síntomas de hiperglucemia",
    "texto": "Derivación a endocrinología para manejo según ADA; considerar insulina.",
    "fuente": "Guía CKM 2026, Tabla 20"
  },
  {
    "codigo": "E2-DM2-MED-06",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "toma-sglt2i",
      "toma-glp1"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Inició SGLT2i o GLP-1",
    "texto": "Evaluar el estado glucémico con HbA1c, automonitoreo o sensor cada 3 a 6 meses, y más seguido si no está en meta.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E2-DM2-MED-07",
    "tipo": "alerta",
    "dominio": "hepatico",
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
    "responsable": "cardiologia",
    "titulo": "DM2 o ≥ 2 factores cardiometabólicos",
    "texto": "Calcular FIB-4 cada 1 a 2 años; con DM2, GLP-1 con beneficio probado si hay MASLD con fibrosis significativa. Cortes por edad en la Tabla 17; hepatología si > 2,67.",
    "fuente": "Guía CKM 2026, Tabla 44 y Tablas 17 y 18",
    "cor": "1",
    "loe": "B-NR; B-R"
  },
  {
    "codigo": "E2-DM2-MED-08",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2",
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "DM2 y PA ≥ 130/80",
    "texto": "Tratamiento antihipertensivo indicado (umbral bajo por DM2); meta < 130/80.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E2-DM2-MED-09",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "edad-40-79",
      "prevent-ascvd-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "DM2 en ≥ 40 años, o PREVENT-ASCVD 5 a 9,9 %",
    "texto": "Estatina y otras terapias de descenso de LDL para reducir eventos ASCVD.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E2-DM2-MED-10",
    "tipo": "alerta",
    "dominio": "medicacion",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "toma-sglt2i",
      "toma-glp1"
    ],
    "momentos": [
      "dia-30"
    ],
    "responsable": "cardiologia",
    "titulo": "Toma SGLT2i o GLP-1",
    "texto": "Revisar efectos adversos: SGLT2i (infecciones genitales, depleción de volumen, cetoacidosis; pausar en días de enfermedad), GLP-1 (gastrointestinales, litiasis, pancreatitis, retinopatía con descenso rápido de HbA1c).",
    "fuente": "Guía CKM 2026, Tablas 14, 15 y 19"
  },
  {
    "codigo": "E2-DM2-MED-11",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dm2",
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "endocrinologia",
    "titulo": "DM2 y planifica embarazo",
    "texto": "Meta HbA1c < 6,5 % antes de concebir con estilo de vida y medicación; pasar a insulina si toma no insulínicos; equipo con obstetricia.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "B-R; C-LD"
  },
  {
    "codigo": "E2-TG-MED-01",
    "tipo": "alerta",
    "dominio": "lipidos",
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
    "responsable": "cardiologia",
    "titulo": "TG ≥ 150",
    "texto": "Buscar y corregir causas secundarias reversibles: estilo de vida, hipotiroidismo (TSH), hiperglucemia no controlada, albuminuria severa, alcohol, fármacos (estrógenos, corticoides, betabloqueantes, tiazidas, retinoides, antipsicóticos).",
    "fuente": "Guía CKM 2026, Sección 5.5.2"
  },
  {
    "codigo": "E2-TG-MED-02",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "tg-altos"
    ],
    "algunaDe": [
      "prevent-ascvd-3-5",
      "prevent-ascvd-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "TG ≥ 150 con PREVENT-ASCVD limítrofe o mayor",
    "texto": "Estatina como terapia inicial junto con estilo de vida; los TG persistentemente elevados son potenciador de riesgo ASCVD.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Secciones 5.5.2 y 7.1"
  },
  {
    "codigo": "E2-TG-MED-03",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "tg-altos",
      "toma-estatina"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "TG persisten ≥ 150 con estatina a dosis máxima tolerada, o factores adicionales",
    "texto": "Puede considerarse icosapent ethyl para reducir el riesgo ASCVD.",
    "fuente": "Guía CKM 2026, Sección 5.5.2"
  },
  {
    "codigo": "E2-TG-MED-04",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "tg-500"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "TG ≥ 500",
    "texto": "Hipertrigliceridemia severa: riesgo de pancreatitis; tratamiento farmacológico para bajar TG y control en días. Endocrinología si corresponde.",
    "fuente": "Guía CKM 2026, Sección 5.5.2"
  },
  {
    "codigo": "E2-TG-MED-05",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "sindrome-metabolico"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Síndrome metabólico",
    "texto": "Tratar como obesidad de prioridad alta: intervención multicomponente, meta de cintura y, con IMC ≥ 27, la alerta de GLP-1 del estadío 1 (E1-MED-01). Nutrición.",
    "fuente": "Guía CKM 2026, Sección 5.4.1 y Tabla 31",
    "cor": "1; 2a",
    "loe": "A"
  },
  {
    "codigo": "E2-TG-MED-06",
    "tipo": "alerta",
    "dominio": "hepatico",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "dos-o-mas-factores"
    ],
    "algunaDe": [
      "tg-altos",
      "sindrome-metabolico"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "≥ 2 factores cardiometabólicos",
    "texto": "FIB-4 cada 1 a 2 años; hepatología si > 2,67.",
    "fuente": "Guía CKM 2026, Tabla 44",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E2-ERC-MED-01",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc"
    ],
    "algunaDe": [
      "dm2",
      "uacr-30"
    ],
    "excluye": [
      "egfr-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC con DM2, o sin DM2 con UACR ≥ 30, y eGFR ≥ 30",
    "texto": "RASi (IECA o ARA II) a la dosis máxima tolerada para reducir la pérdida de función renal y el riesgo cardiovascular. Nunca dos RASi juntos. Nefrología según KDIGO.",
    "fuente": "Guía CKM 2026, Tabla 35",
    "cor": "1",
    "loe": "B-R"
  },
  {
    "codigo": "E2-ERC-MED-02",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc"
    ],
    "algunaDe": [
      "dm2",
      "uacr-200"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC con DM2, o sin DM2 con UACR ≥ 200, y eGFR ≥ 20",
    "texto": "SGLT2i para reducir la pérdida de función renal, la hospitalización por IC y la mortalidad cardiovascular.",
    "fuente": "Guía CKM 2026, Tabla 35",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E2-ERC-MED-03",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "uacr-30"
    ],
    "excluye": [
      "dm2",
      "uacr-200"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC sin DM2 con UACR 30 a 199",
    "texto": "SGLT2i puede considerarse con los mismos fines.",
    "fuente": "Guía CKM 2026, Tabla 35 y Figura 10",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E2-ERC-MED-04",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "dm2",
      "uacr-30",
      "toma-rasi-mra",
      "toma-sglt2i"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "nefrologia",
    "titulo": "ERC con DM2 y UACR ≥ 30 pese a RASi y SGLT2i tolerados, eGFR ≥ 25",
    "texto": "Agregar un antagonista no esteroideo del receptor mineralocorticoide (finerenona) con beneficio renal y cardiovascular probado. Controlar potasio.",
    "fuente": "Guía CKM 2026, Tabla 35",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E2-ERC-MED-05",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "dm2",
      "uacr-100",
      "toma-rasi-mra",
      "toma-sglt2i"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "nefrologia",
    "titulo": "ERC con DM2 y UACR ≥ 100 pese a RASi y SGLT2i tolerados",
    "texto": "Agregar terapia basada en GLP-1 con beneficio renal y cardiovascular probado (semaglutida es la que lo demostró en FLOW). Con obesidad o MASLD, elegirla antes que finerenona; ambas si el riesgo lo justifica. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 35 y Figura 9",
    "cor": "1",
    "loe": "B-R"
  },
  {
    "codigo": "E2-ERC-MED-06",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "inicia-rasi-mra"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Se inicia o se sube RASi o MRA",
    "texto": "eGFR y potasio a las 2 a 4 semanas; una caída de eGFR ≤ 30 % es aceptable; potasio > 5,5 mmol/L requiere ajuste.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E2-ERC-MED-07",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "uacr-30"
    ],
    "algunaDe": [
      "toma-rasi-mra",
      "toma-sglt2i"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Se inició renoprotección con UACR ≥ 30",
    "texto": "Remedir la UACR a los 3 a 6 meses para riesgo residual e indicación de terapias adicionales.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E2-ERC-MED-08",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC con HTA",
    "texto": "Meta < 130/80; el RASi es el antihipertensivo de elección.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E2-ERC-MED-09",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "edad-40-79"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC en ≥ 40 años",
    "texto": "Estatina para reducir eventos ASCVD; la atorvastatina podría reducir la progresión de la ERC.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Secciones 7.1 y 5.5.4"
  },
  {
    "codigo": "E2-ERC-MED-10",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc"
    ],
    "algunaDe": [
      "egfr-30",
      "erc-muy-alto-riesgo",
      "hiperpotasemia"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "eGFR < 30, UACR ≥ 300, caída de eGFR > 5 mL/min por año, hiperpotasemia recurrente, hematuria o causa no clara",
    "texto": "Derivación a nefrología. Con eGFR < 30 o UACR ≥ 300 la persona pasa a ERC de muy alto riesgo y a estadío 3.",
    "fuente": "KDIGO; Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E2-ERC-MED-11",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "2",
      "3",
      "4"
    ],
    "condiciones": [
      "erc",
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "ERC y planifica embarazo",
    "texto": "Equipo interdisciplinario con nefrología y obstetricia; suspender RASi, ARA II, MRA y SGLT2i antes de concebir; optimizar PA con fármacos seguros.",
    "fuente": "Guía CKM 2026, Tabla 46 y Sección 7.5",
    "cor": "1",
    "loe": "C-LD"
  },
  {
    "codigo": "E2-MED-01",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "prevent-ascvd-5",
      "dm2",
      "erc"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-ASCVD a 10 años ≥ 5 %; o DM2 o ERC en ≥ 40 años",
    "texto": "Iniciar estatina y otras terapias de descenso de LDL.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Tabla 8 y Sección 7.1"
  },
  {
    "codigo": "E2-MED-02",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "prevent-ascvd-3-5",
      "prevent-ascvd-30-10"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-ASCVD a 10 años 3 a 4,9 %, o a 30 años ≥ 10 %",
    "texto": "Considerar hipolipemiante en una conversación de riesgo con potenciadores, riesgo a 30 años o calcio coronario.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Tabla 8"
  },
  {
    "codigo": "E2-MED-03",
    "tipo": "alerta",
    "dominio": "aterosclerosis",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "prevent-ascvd-3-10"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-ASCVD a 10 años 3 a < 10 % con incertidumbre sobre tratar",
    "texto": "Calcio coronario para reclasificar; ≥ 100 o moderado a severo pasa a estadío 3 y habilita intensificar.",
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 36",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E2-MED-04",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "prevent-hf-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-HF a 10 años ≥ 5 %",
    "texto": "NT-proBNP o BNP (troponina us si obesidad) y coordinar cuidados; ecocardiograma para refinar. Pre-IC confirmada pasa a estadío 3.",
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 16"
  },
  {
    "codigo": "E2-MED-05",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "prevent-alto"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-CVD a 10 años ≥ 20 %",
    "texto": "Equivalente de riesgo del estadío 3: cambiar de estadío y aplicar su catálogo.",
    "fuente": "Guía CKM 2026, Tabla 4 y Tabla 8"
  },
  {
    "codigo": "E2-MED-06",
    "tipo": "alerta",
    "dominio": "potenciadores",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "potenciadores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Uno o más potenciadores de la Tabla 9",
    "texto": "Intensificar la prevención y bajar el umbral de las alertas farmacológicas; seguimiento quincenal 60 días.",
    "fuente": "Guía CKM 2026, Tabla 27",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E2-MED-07",
    "tipo": "alerta",
    "dominio": "coordinacion",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "dm2",
      "erc"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "coordinacion",
    "titulo": "DM2 más ERC (dos o más de DM2, ERC, ECV)",
    "texto": "Equipo interdisciplinario coordinado con persona de coordinación CKM; manejo integral de medicación.",
    "fuente": "Guía CKM 2026, Tabla 28 y Tablas 11 y 12",
    "cor": "1"
  },
  {
    "codigo": "E2-MED-08",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "imc-27"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "IMC ≥ 27 con cualquier factor del estadío 2",
    "texto": "Estilo de vida primero (5 a 10 %); GLP-1 con beneficio probado como adyuvante; con DM2 y riesgo aumentado, ver E2-DM2-MED-02. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tablas 29, 30 y 31",
    "cor": "1; 2a",
    "loe": "A"
  },
  {
    "codigo": "E2-MED-09",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "toma-glp1",
      "sin-respuesta"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Toma GLP-1 por obesidad y peso < 5 % al día 100",
    "texto": "Reevaluar hiporrespuesta: escalar, cambiar o derivar a obesidad.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E2-MED-10",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "imc-30",
      "hta-resistente",
      "apnea-sospecha"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "IMC ≥ 30, HTA resistente o DM2 con síntomas de apnea, o STOP-BANG ≥ 3",
    "texto": "Estudio del sueño; con apnea confirmada, pérdida de peso además de CPAP. Neumonología.",
    "fuente": "Guía CKM 2026, Tabla 45",
    "cor": "2a; 1",
    "loe": "C-LD; B-R"
  },
  {
    "codigo": "E2-MED-11",
    "tipo": "alerta",
    "dominio": "hepatico",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "dm2",
      "dos-o-mas-factores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FIB-4 calculado (DM2 o ≥ 2 factores)",
    "texto": "Menor de 65: < 1,3 rutina; 1,3 a 2,67 elastografía o ELF; > 2,67 hepatología. 65 o más: < 2,0 rutina; 2,0 a 2,67 elastografía o ELF; > 2,67 hepatología.",
    "fuente": "Guía CKM 2026, Tabla 44 y Tablas 17 y 18",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E2-MED-12",
    "tipo": "alerta",
    "dominio": "estres",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PHQ-2 ≥ 3 o GAD-2 ≥ 3",
    "texto": "PHQ-9 o GAD-7 y derivación a psicología; ideación suicida, contacto el mismo día.",
    "fuente": "Guía CKM 2026, Tabla 9 y Sección 5.1"
  },
  {
    "codigo": "E2-MED-13",
    "tipo": "alerta",
    "dominio": "social",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "coordinacion",
    "titulo": "AHC-HRSN con necesidades",
    "texto": "Trabajo social o navegación; registrar la barrera para adaptar acciones y facilitar acceso a los fármacos (programas de asistencia).",
    "fuente": "Guía CKM 2026, Tabla 25 y Tabla 12",
    "cor": "1"
  },
  {
    "codigo": "E2-MED-14",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "2"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Al día 100 aparece un criterio de estadío 3, o desaparecen todos los del 2",
    "texto": "Re-estadificar: subir a 3 (CAC, pre-IC, ERC de muy alto riesgo, PREVENT ≥ 20 %) o, si PA, TG, glucemia y riñón volvieron a rango sin fármacos, evaluar regresión a estadío 1. Con fármacos activos la persona sigue en estadío 2.",
    "fuente": "Guía CKM 2026, Tabla 4 y Figura 3"
  },
  {
    "codigo": "E2-MED-15",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Planifica embarazo con estadío 2",
    "texto": "Equipo interdisciplinario con obstetricia; optimizar peso, riñón, glucemia y presión antes; revisar fármacos contraindicados.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "C-LD; B-NR"
  },
  {
    "codigo": "E2-DER-01",
    "tipo": "derivacion",
    "dominio": "dieta",
    "estadios": [
      "2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nutricion",
    "titulo": "Nutrición",
    "texto": "Todas las personas en estadío 2, al alta; con ERC, dieta renal.",
    "fuente": "Guía CKM 2026, Sección 5.4.2; KDIGO"
  },
  {
    "codigo": "E2-DER-02",
    "tipo": "derivacion",
    "dominio": "actividad-fisica",
    "estadios": [
      "2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "kinesiologia",
    "titulo": "Kinesiología o educación física",
    "texto": "Todas; obligatoria con flags de caídas, densitometría o incontinencia.",
    "fuente": "Guía CKM 2026, Sección 5.4.2"
  },
  {
    "codigo": "E2-DER-03",
    "tipo": "derivacion",
    "dominio": "glucemia",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "hba1c-10",
      "dm2",
      "imc-27",
      "tg-500"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "evento"
    ],
    "responsable": "endocrinologia",
    "titulo": "Endocrinología",
    "texto": "HbA1c > 10 % o insulinización; elección de cardioprotector o GLP-1 por obesidad; TG ≥ 500; planificación de embarazo con DM2.",
    "fuente": "Guía CKM 2026, Tabla 20 y Sección 5.4.3"
  },
  {
    "codigo": "E2-DER-04",
    "tipo": "derivacion",
    "dominio": "renal",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "egfr-30",
      "erc-muy-alto-riesgo",
      "hiperpotasemia",
      "uacr-100"
    ],
    "momentos": [
      "evento",
      "dia-100"
    ],
    "responsable": "nefrologia",
    "titulo": "Nefrología",
    "texto": "eGFR < 30, UACR ≥ 300, caída > 5 mL/min por año, hiperpotasemia recurrente, causa no clara; nsMRA o GLP-1 por albuminuria residual.",
    "fuente": "KDIGO; Guía CKM 2026, Tabla 35"
  },
  {
    "codigo": "E2-DER-05",
    "tipo": "derivacion",
    "dominio": "hepatico",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "fib4-alto"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "hepatologia",
    "titulo": "Hepatología",
    "texto": "FIB-4 > 2,67, o intermedio con elastografía o ELF de riesgo.",
    "fuente": "Guía CKM 2026, Tablas 17 y 18"
  },
  {
    "codigo": "E2-DER-06",
    "tipo": "derivacion",
    "dominio": "apnea",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "imc-30",
      "apnea-sospecha",
      "hta-resistente",
      "fuma"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60"
    ],
    "responsable": "neumonologia",
    "titulo": "Neumonología",
    "texto": "STOP-BANG ≥ 3 o síntomas de apnea; HTA resistente; tabaquismo con fracasos o EPOC.",
    "fuente": "Guía CKM 2026, Sección 7.3"
  },
  {
    "codigo": "E2-DER-07",
    "tipo": "derivacion",
    "dominio": "cardiaco",
    "estadios": [
      "2"
    ],
    "algunaDe": [
      "prevent-ascvd-3-10",
      "prevent-hf-5"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "imagen",
    "titulo": "Cardiología de imagen",
    "texto": "Calcio coronario o ecocardiograma según PREVENT y biomarcadores.",
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 16"
  },
  {
    "codigo": "E2-DER-08",
    "tipo": "derivacion",
    "dominio": "estres",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "psicologia",
    "titulo": "Psicología",
    "texto": "PHQ-2 o GAD-2 positivos; ingesta emocional; estrés elevado.",
    "fuente": "Guía CKM 2026, Tabla 9"
  },
  {
    "codigo": "E2-DER-09",
    "tipo": "derivacion",
    "dominio": "social",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "Trabajo social",
    "texto": "AHC-HRSN con necesidades no cubiertas; barreras de acceso a fármacos.",
    "fuente": "Guía CKM 2026, Sección 3.2 y Tabla 12"
  },
  {
    "codigo": "E2-DER-10",
    "tipo": "derivacion",
    "dominio": "embarazo",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "obstetricia",
    "titulo": "Obstetricia",
    "texto": "Planifica embarazo con estadío 2.",
    "fuente": "Guía CKM 2026, Tabla 46"
  },
  {
    "codigo": "E2-DER-11",
    "tipo": "derivacion",
    "dominio": "prevencion",
    "estadios": [
      "2"
    ],
    "condiciones": [
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "oftalmologia",
    "titulo": "Oftalmología y podología",
    "texto": "DM2: fondo de ojo y pies anuales.",
    "fuente": "ADA"
  },
  {
    "codigo": "E3-ATERO-MED-01",
    "tipo": "alerta",
    "dominio": "aterosclerosis",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "cac-100"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Calcio coronario > 100 o moderado a severo",
    "texto": "Iniciar o intensificar las terapias preventivas indicadas para CKM: estatina, GLP-1 si obesidad, descenso agresivo de la PA, icosapent ethyl si TG altos; el mismo principio aplica a SGLT2i, RASi y nsMRA cuando están indicados.",
    "fuente": "Guía CKM 2026, Tabla 36 y Sección 5.6.1",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E3-ATERO-MED-02",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "cac-100"
    ],
    "excluye": [
      "cac-1000"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "Calcio coronario 100 a 999",
    "texto": "Estatina de alta intensidad; meta LDL < 70; sumar ezetimibe si no se alcanza a las 4 a 12 semanas.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E3-ATERO-MED-03",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "cac-1000"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "Calcio coronario ≥ 1000",
    "texto": "Meta LDL < 55; estatina de alta intensidad más ezetimibe y, si hace falta, PCSK9, inclisirán o bempedoico.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E3-ATERO-MED-04",
    "tipo": "alerta",
    "dominio": "aterosclerosis",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "cac-percentil-75"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Calcio coronario ≥ percentil 75 con puntaje < 100 en mujer o menor de 50 años",
    "texto": "Riesgo aumentado pese al valor absoluto bajo: tratar como estadío 3.",
    "fuente": "Guía CKM 2026, Sección 5.6.1"
  },
  {
    "codigo": "E3-ATERO-MED-05",
    "tipo": "alerta",
    "dominio": "aterosclerosis",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "cac-0"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Calcio coronario 0 en persona con CKM",
    "texto": "No garantiza bajo riesgo en CKM, sobre todo en jóvenes con varios factores; mantener el manejo del estadío 2 y no diferir estatina sólo por el cero.",
    "fuente": "Guía CKM 2026, Sección 5.6.1"
  },
  {
    "codigo": "E3-ATERO-MED-06",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "aterosclerosis-subclinica",
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Aterosclerosis subclínica con PA ≥ 130/80",
    "texto": "Tratamiento antihipertensivo con meta < 130/80 (PREVENT ≥ 7,5 % o riesgo equivalente).",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E3-ATERO-MED-07",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "aterosclerosis-subclinica",
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Aterosclerosis subclínica con DM2",
    "texto": "SGLT2i o GLP-1 con beneficio probado (riesgo aumentado por definición); combinación con umbral más bajo que en estadío 2. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 34 y Sección 5.6",
    "cor": "1; 2b",
    "loe": "A; B-NR"
  },
  {
    "codigo": "E3-ATERO-MED-08",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "aterosclerosis-subclinica",
      "imc-27"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Aterosclerosis subclínica con obesidad (IMC ≥ 27)",
    "texto": "GLP-1 con beneficio probado como adyuvante del estilo de vida; mayor reducción absoluta de riesgo (Tabla 10).",
    "fuente": "Guía CKM 2026, Tabla 31 y Tabla 10",
    "cor": "2a",
    "loe": "A"
  },
  {
    "codigo": "E3-ATERO-MED-09",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "aterosclerosis-subclinica",
      "tg-altos",
      "toma-estatina"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "TG ≥ 150 persistentes con estatina máxima tolerada",
    "texto": "Icosapent ethyl para reducir eventos.",
    "fuente": "Guía CKM 2026, Secciones 5.5.2 y 5.6.1"
  },
  {
    "codigo": "E3-ATERO-MED-10",
    "tipo": "alerta",
    "dominio": "medicacion",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "aterosclerosis-subclinica"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Antiagregación en prevención primaria",
    "texto": "La guía CKM no la recomienda por defecto; decisión individual de cardiología según la guía de prevención primaria 2019 y el riesgo de sangrado.",
    "fuente": "Guía de prevención primaria 2019 (fuera de la guía CKM); firma del estadío 3"
  },
  {
    "codigo": "E3-ATERO-MED-11",
    "tipo": "alerta",
    "dominio": "aterosclerosis",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "itb-bajo",
      "sintomas-nuevos"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Índice tobillo-brazo ≤ 0,90 con claudicación, o síntomas nuevos",
    "texto": "Arteriopatía periférica clínica: cambio a estadío 4.",
    "fuente": "Guía CKM 2026, Tabla 4; firma del estadío 3 (ITB ≤ 0,90)"
  },
  {
    "codigo": "E3-PREIC-MED-01",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Pre-IC confirmada",
    "texto": "Intervenciones intensivas de estilo de vida y control intensivo de factores de riesgo para mejorar la salud CKM y prevenir la progresión a IC clínica.",
    "fuente": "Guía CKM 2026, Tabla 37",
    "cor": "1",
    "loe": "B-R"
  },
  {
    "codigo": "E3-PREIC-MED-02",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic"
    ],
    "algunaDe": [
      "dm2",
      "erc"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Pre-IC con DM2 o ERC",
    "texto": "SGLT2i como primera línea para prevenir IC.",
    "fuente": "Guía CKM 2026, Tabla 37",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E3-PREIC-MED-03",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic",
      "dm2",
      "erc",
      "uacr-100"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Pre-IC con DM2, ERC y UACR ≥ 100",
    "texto": "Agregar GLP-1 con beneficio probado al SGLT2i. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 37",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E3-PREIC-MED-04",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic",
      "dm2",
      "erc",
      "uacr-30"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Pre-IC con DM2, ERC y UACR ≥ 30",
    "texto": "Agregar nsMRA al SGLT2i; controlar potasio a las 2 a 4 semanas. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 37",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E3-PREIC-MED-05",
    "tipo": "alerta",
    "dominio": "cardiaco",
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
    "responsable": "cardiologia",
    "titulo": "Pre-IC por biomarcadores sin eco, o biomarcadores en ascenso al día 100",
    "texto": "Ecocardiograma para definir estructura y función y refinar el riesgo; con FEVI < 50 %, evaluar tratamiento según la guía de IC.",
    "fuente": "Guía CKM 2026, Tabla 8, Tabla 16 y Figura 12"
  },
  {
    "codigo": "E3-PREIC-MED-06",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic",
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Pre-IC con PA ≥ 130/80",
    "texto": "Tratamiento antihipertensivo con meta < 130/80; RASi de elección si hay albuminuria o DM2.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E3-PREIC-MED-07",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic",
      "imc-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Pre-IC con obesidad",
    "texto": "Pérdida marcada de peso; GLP-1 con beneficio probado como adyuvante (en HFpEF establecida es COR 1 A, aquí se anticipa). Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 10 y Tabla 31",
    "cor": "2a",
    "loe": "A"
  },
  {
    "codigo": "E3-PREIC-MED-08",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic",
      "hipertension-pulmonar"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Velocidad tricuspídea > 2,8 m/s o PSAP > 35 mmHg",
    "texto": "Evaluar hipertensión pulmonar y apnea del sueño; STOP-BANG y estudio del sueño; neumonología si hay hipoxemia.",
    "fuente": "Guía CKM 2026, Tabla 16 y Sección 7.3"
  },
  {
    "codigo": "E3-PREIC-MED-09",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic",
      "sintomas-nuevos"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Síntomas o signos de IC (disnea, ortopnea, edema, congestión)",
    "texto": "IC clínica: cambio a estadío 4 y manejo según guía de IC (cuádruple terapia en HFrEF; SGLT2i y diuréticos en HFpEF).",
    "fuente": "Guía CKM 2026, Tabla 4 y Sección 6.3"
  },
  {
    "codigo": "E3-PREIC-MED-10",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "pre-ic"
    ],
    "algunaDe": [
      "toma-sglt2i",
      "toma-rasi-mra",
      "inicia-rasi-mra",
      "inicia-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Toma SGLT2i, nsMRA o RASi",
    "texto": "Potasio y creatinina a las 2 a 4 semanas; efectos adversos del SGLT2i; evitar dos RASi.",
    "fuente": "Guía CKM 2026, Tabla 47 y Tabla 14",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E3-ERC-MED-01",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nefrologia",
    "titulo": "ERC de muy alto riesgo",
    "texto": "Derivación a nefrología al día 0; plan conjunto con cardiología.",
    "fuente": "KDIGO; Guía CKM 2026, Tabla 11"
  },
  {
    "codigo": "E3-ERC-MED-02",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nefrologia",
    "titulo": "eGFR ≥ 30 (RASi) o ≥ 20 (SGLT2i)",
    "texto": "Aplicar E2-ERC-MED-01 a 03: RASi a dosis máxima tolerada y SGLT2i; con DM2 y albuminuria residual, nsMRA (eGFR ≥ 25) y GLP-1 (UACR ≥ 100). En estadío 3 la combinación se considera con umbral más bajo.",
    "fuente": "Guía CKM 2026, Tabla 35 y Sección 5.6",
    "cor": "1",
    "loe": "B-R; A"
  },
  {
    "codigo": "E3-ERC-MED-03",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo",
      "egfr-30"
    ],
    "algunaDe": [
      "toma-rasi-mra",
      "toma-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "eGFR cae por debajo del umbral de inicio del fármaco (RASi < 30, SGLT2i < 20, nsMRA < 25)",
    "texto": "Es razonable continuar la renoprotección mientras se tolere; no suspender por el umbral de inicio.",
    "fuente": "Guía CKM 2026, Tabla 43",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E3-ERC-MED-04",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo",
      "hiperpotasemia"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "Potasio > 5,5 mmol/L",
    "texto": "Ajustar: dieta, diurético, dosis de RASi o MRA; quelantes de potasio pueden ser razonables para sostener el RASi (evidencia en IC con ERC).",
    "fuente": "Guía CKM 2026, Tabla 42; KDIGO",
    "cor": "2b",
    "loe": "B-R"
  },
  {
    "codigo": "E3-ERC-MED-05",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ERC de muy alto riesgo",
    "texto": "Estatina para reducir eventos ASCVD; la atorvastatina podría reducir la progresión; LDL de alto riesgo según dislipidemia 2026.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Secciones 7.1 y 5.5.4"
  },
  {
    "codigo": "E3-ERC-MED-06",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo",
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nefrologia",
    "titulo": "PA ≥ 130/80",
    "texto": "Meta < 130/80 con RASi de base; evitar dos RASi.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E3-ERC-MED-07",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo",
      "dm2",
      "egfr-45"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "endocrinologia",
    "titulo": "DM2 con eGFR < 45",
    "texto": "Ajustar metformina (1000 a 1500 mg/día con eGFR 45 a 59; suspender < 30); HbA1c menos estricta si hay riesgo de hipoglucemia. Nefrología.",
    "fuente": "Guía CKM 2026, Sección 6.3.2; ADA"
  },
  {
    "codigo": "E3-ERC-MED-08",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo"
    ],
    "algunaDe": [
      "pre-ic",
      "biomarcadores-en-ascenso"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "NT-proBNP ≥ 125 o troponina elevada en ERC",
    "texto": "Interpretar con cautela (se elevan por la ERC); ecocardiograma para definir pre-IC.",
    "fuente": "Guía CKM 2026, Tabla 16"
  },
  {
    "codigo": "E3-ERC-MED-09",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo",
      "egfr-30"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "eGFR < 20 a 30 con caída sostenida",
    "texto": "Educación y preparación para reemplazo renal; acceso vascular; vacunas. eGFR < 15 o diálisis cambia a 4b.",
    "fuente": "KDIGO; Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E3-ERC-MED-10",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "erc-muy-alto-riesgo",
      "procedimiento"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "Procedimiento con contraste o cirugía",
    "texto": "Protección renal, suspensión temporal de metformina y SGLT2i, hidratación; coordinación con el servicio que lo indica.",
    "fuente": "KDIGO"
  },
  {
    "codigo": "E3-RIESGO-MED-01",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "prevent-alto"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-CVD ≥ 20 % sin sustrato",
    "texto": "Manejar como estadío 3: intensificar estilo de vida y fármacos de cada factor con umbral bajo para combinar.",
    "fuente": "Guía CKM 2026, Sección 5.6 y Tabla 4"
  },
  {
    "codigo": "E3-RIESGO-MED-02",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "prevent-alto"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo",
      "cac-0"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-CVD ≥ 20 % sin calcio coronario ni biomarcadores",
    "texto": "Solicitar calcio coronario y NT-proBNP o BNP (troponina us si obesidad) para asignar sustrato y meta de LDL; ecocardiograma si biomarcadores positivos.",
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 16"
  },
  {
    "codigo": "E3-RIESGO-MED-03",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "prevent-alto",
      "prevent-ascvd-5"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PREVENT-ASCVD ≥ 5 % (siempre con CVD ≥ 20 %)",
    "texto": "Estatina indicada; meta de alto riesgo según dislipidemia 2026 hasta conocer el calcio coronario.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Tabla 8 y Sección 7.1"
  },
  {
    "codigo": "E3-RIESGO-MED-04",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "prevent-alto",
      "hta"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PA ≥ 130/80",
    "texto": "Tratamiento farmacológico indicado (PREVENT ≥ 7,5 %); meta < 130/80.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E3-RIESGO-MED-05",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "prevent-alto",
      "dm2"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "DM2",
    "texto": "SGLT2i o GLP-1 con beneficio probado (riesgo aumentado por definición); combinación con umbral bajo. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 34 y Sección 5.6",
    "cor": "1; 2b",
    "loe": "A; B-NR"
  },
  {
    "codigo": "E3-RIESGO-MED-06",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "prevent-alto"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Al día 100 PREVENT-CVD < 20 % y sin sustrato hallado",
    "texto": "Volver a estadío 2 con sus submódulos; mantener las metas alcanzadas. Si se halló sustrato, sigue en 3 con el submódulo correspondiente.",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E3-MED-01",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 3 confirmado",
    "texto": "Intensificar estilo de vida y farmacoterapia: los principios del estadío 2 se mantienen con mayor reducción absoluta esperada; combinaciones (SGLT2i más GLP-1, RASi más SGLT2i más nsMRA) se consideran con umbral más bajo.",
    "fuente": "Guía CKM 2026, Sección 5.6"
  },
  {
    "codigo": "E3-MED-02",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "ldl-fuera-de-meta"
    ],
    "momentos": [
      "dia-60",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "LDL fuera de meta al día 60 o 100",
    "texto": "Sumar ezetimibe; si persiste, PCSK9, inclisirán o ácido bempedoico. Con intolerancia a estatina, no abandonar: cambiar de estatina o dosis alterna antes de escalar.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E3-MED-03",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "imc-27"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 3 con obesidad (IMC ≥ 27)",
    "texto": "GLP-1 con beneficio probado como adyuvante; potencial de mayor reducción absoluta de riesgo (Tabla 10). Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 31 y Tabla 10",
    "cor": "2a",
    "loe": "A"
  },
  {
    "codigo": "E3-MED-04",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 3 con DM2",
    "texto": "SGLT2i o GLP-1 con beneficio probado; combinación (2b) con umbral bajo; metformina como agregado para la meta glucémica. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 34",
    "cor": "1; 2b; 2a",
    "loe": "A; B-NR; A"
  },
  {
    "codigo": "E3-MED-05",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 3 con PA ≥ 130/80",
    "texto": "Tratamiento farmacológico, meta < 130/80; combinación en un comprimido.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E3-MED-06",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "erc",
      "erc-muy-alto-riesgo"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 3 con ERC (cualquier categoría)",
    "texto": "RASi y SGLT2i; con DM2 y albuminuria residual, nsMRA o GLP-1; en pre-IC, SGLT2i primero. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tablas 35 y 37",
    "cor": "1",
    "loe": "A; B-R; B-NR"
  },
  {
    "codigo": "E3-MED-07",
    "tipo": "alerta",
    "dominio": "potenciadores",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "potenciadores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Uno o más potenciadores",
    "texto": "Contacto semanal 4 semanas; umbral más bajo aún para combinar terapias.",
    "fuente": "Guía CKM 2026, Tabla 27; firma del estadío 3",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E3-MED-08",
    "tipo": "alerta",
    "dominio": "hepatico",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "dm2",
      "dos-o-mas-factores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 3 con DM2 o ≥ 2 factores",
    "texto": "FIB-4 cada 1 a 2 años; cortes por edad; hepatología si > 2,67.",
    "fuente": "Guía CKM 2026, Tabla 44",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E3-MED-09",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "imc-30",
      "hta-resistente",
      "hipertension-pulmonar",
      "apnea-sospecha"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "Obesidad, HTA resistente, pre-IC con PSAP alta, o síntomas de apnea",
    "texto": "Estudio del sueño; con apnea, pérdida de peso más CPAP. Neumonología.",
    "fuente": "Guía CKM 2026, Tabla 45",
    "cor": "2a; 1",
    "loe": "C-LD; B-R"
  },
  {
    "codigo": "E3-MED-10",
    "tipo": "alerta",
    "dominio": "estres",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "cardiologia",
    "titulo": "PHQ-2 ≥ 3 o GAD-2 ≥ 3",
    "texto": "PHQ-9 o GAD-7 y psicología; en estadío 3 el diagnóstico de riesgo alto es en sí un estresor.",
    "fuente": "Guía CKM 2026, Tabla 9 y Sección 5.1"
  },
  {
    "codigo": "E3-MED-11",
    "tipo": "alerta",
    "dominio": "social",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "coordinacion",
    "titulo": "AHC-HRSN con necesidades, o costo de los fármacos como barrera",
    "texto": "Trabajo social; programas de asistencia para acceso a fármacos (Tabla 12).",
    "fuente": "Guía CKM 2026, Tabla 25 y Tabla 12",
    "cor": "1"
  },
  {
    "codigo": "E3-MED-12",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "sintomas-nuevos",
      "ecv",
      "falla-renal"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Evento clínico (síndrome coronario, IC sintomática, ACV o AIT, claudicación, FA)",
    "texto": "Cambio a estadío 4 y su catálogo; prevención secundaria. eGFR < 15 o diálisis: 4b.",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E3-MED-13",
    "tipo": "alerta",
    "dominio": "riesgo",
    "estadios": [
      "3"
    ],
    "excluye": [
      "aterosclerosis-subclinica",
      "pre-ic",
      "erc-muy-alto-riesgo",
      "prevent-alto"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Al día 100, sin sustrato hallado y PREVENT < 20 %",
    "texto": "Regreso a estadío 2 (E3-RIESGO-MED-06). Con sustrato documentado, la persona sigue en 3 aunque mejoren los factores.",
    "fuente": "Guía CKM 2026, Tabla 4"
  },
  {
    "codigo": "E3-MED-14",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Planifica embarazo con estadío 3",
    "texto": "Equipo interdisciplinario con obstetricia; suspender estatina, RASi, ARA II, MRA y SGLT2i antes de concebir; optimizar PA y glucemia con fármacos seguros.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "C-LD"
  },
  {
    "codigo": "E3-MED-15",
    "tipo": "alerta",
    "dominio": "medicacion",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "edad-65-79",
      "polifarmacia"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Persona de 65 a 79 años con polifarmacia",
    "texto": "Revisión de medicación y desprescripción compartida de lo no indicado; metas de HbA1c y PA individualizadas por fragilidad.",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E3-DER-01",
    "tipo": "derivacion",
    "dominio": "dieta",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nutricion",
    "titulo": "Nutrición",
    "texto": "Todas; dieta renal con ERC; sodio y líquidos en pre-IC.",
    "fuente": "Guía CKM 2026, Sección 5.4.2; KDIGO"
  },
  {
    "codigo": "E3-DER-02",
    "tipo": "derivacion",
    "dominio": "actividad-fisica",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "kinesiologia",
    "titulo": "Kinesiología",
    "texto": "Todas, con supervisión inicial obligatoria en pre-IC y ERC avanzada.",
    "fuente": "Guía CKM 2026, Sección 5.6.2"
  },
  {
    "codigo": "E3-DER-03",
    "tipo": "derivacion",
    "dominio": "renal",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "erc-muy-alto-riesgo",
      "hiperpotasemia",
      "uacr-100"
    ],
    "momentos": [
      "dia-0",
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "Nefrología",
    "texto": "ERC de muy alto riesgo desde el día 0; albuminuria residual con RASi y SGLT2i; potasio > 5,5.",
    "fuente": "KDIGO; Guía CKM 2026, Tabla 35"
  },
  {
    "codigo": "E3-DER-04",
    "tipo": "derivacion",
    "dominio": "glucemia",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "hba1c-10",
      "dm2",
      "imc-27",
      "planifica-embarazo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "endocrinologia",
    "titulo": "Endocrinología",
    "texto": "DM2 con HbA1c > 10 %; elección y combinación de cardioprotectores; GLP-1 por obesidad; embarazo.",
    "fuente": "Guía CKM 2026, Tabla 20 y Sección 5.4.3"
  },
  {
    "codigo": "E3-DER-05",
    "tipo": "derivacion",
    "dominio": "cardiaco",
    "estadios": [
      "3"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "imagen",
    "titulo": "Cardiología de imagen",
    "texto": "Calcio coronario, angio-TC o ecocardiograma para asignar o seguir el sustrato.",
    "fuente": "Guía CKM 2026, Tabla 8 y Tabla 16"
  },
  {
    "codigo": "E3-DER-06",
    "tipo": "derivacion",
    "dominio": "hepatico",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "fib4-alto"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "hepatologia",
    "titulo": "Hepatología",
    "texto": "FIB-4 > 2,67 o intermedio con elastografía o ELF de riesgo.",
    "fuente": "Guía CKM 2026, Tablas 17 y 18"
  },
  {
    "codigo": "E3-DER-07",
    "tipo": "derivacion",
    "dominio": "apnea",
    "estadios": [
      "3"
    ],
    "algunaDe": [
      "apnea-sospecha",
      "imc-30",
      "hipertension-pulmonar",
      "hta-resistente"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60"
    ],
    "responsable": "neumonologia",
    "titulo": "Neumonología",
    "texto": "Apnea sospechada o confirmada; hipertensión pulmonar en pre-IC; EPOC.",
    "fuente": "Guía CKM 2026, Sección 7.3 y Tabla 16"
  },
  {
    "codigo": "E3-DER-08",
    "tipo": "derivacion",
    "dominio": "estres",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "psicologia",
    "titulo": "Psicología",
    "texto": "PHQ-2 o GAD-2 positivos; ansiedad por el diagnóstico.",
    "fuente": "Guía CKM 2026, Tabla 9"
  },
  {
    "codigo": "E3-DER-09",
    "tipo": "derivacion",
    "dominio": "social",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "Trabajo social",
    "texto": "Necesidades sociales o barreras de acceso a fármacos.",
    "fuente": "Guía CKM 2026, Sección 3.2 y Tabla 12"
  },
  {
    "codigo": "E3-DER-10",
    "tipo": "derivacion",
    "dominio": "embarazo",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "obstetricia",
    "titulo": "Obstetricia",
    "texto": "Planificación de embarazo con estadío 3.",
    "fuente": "Guía CKM 2026, Tabla 46"
  },
  {
    "codigo": "E3-DER-11",
    "tipo": "derivacion",
    "dominio": "aterosclerosis",
    "estadios": [
      "3"
    ],
    "condiciones": [
      "itb-bajo",
      "sintomas-nuevos"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cirugia-vascular",
    "titulo": "Cirugía vascular",
    "texto": "Índice tobillo-brazo bajo con síntomas nuevos o lesiones tróficas (ya es estadío 4).",
    "fuente": "Guía CKM 2026, Sección 5.6.1"
  },
  {
    "codigo": "E4-ASCVD-MED-01",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD con DM2",
    "texto": "Plan de estilo de vida adaptado (dieta cardiosaludable y actividad) para glucemia, peso y factores. SGLT2i o GLP-1 con beneficio CV probado para reducir eventos y muerte CV. La combinación puede ser beneficiosa. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 39",
    "cor": "1; 1; 2a",
    "loe": "A; A; C-LD"
  },
  {
    "codigo": "E4-ASCVD-MED-02",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "imc-27"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD con IMC ≥ 27",
    "texto": "Intervención conductual intensiva multicomponente (COR 1 A). GLP-1 con beneficio CV probado más consejería de dieta y actividad para reducir eventos (COR 1 B-R). Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 38",
    "cor": "1",
    "loe": "A; B-R"
  },
  {
    "codigo": "E4-ASCVD-MED-03",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "imc-27",
      "farmaco-obesidad"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD con IMC ≥ 27 y fármaco para obesidad en curso o propuesto",
    "texto": "Daño potencial: naltrexona/bupropión y agentes con fentermina suben PA y frecuencia; no usar.",
    "fuente": "Guía CKM 2026, Tabla 38",
    "cor": "3",
    "loe": "B-R"
  },
  {
    "codigo": "E4-ASCVD-MED-05",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "erc"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD con ERC",
    "texto": "RASi y SGLT2i de primera línea; GLP-1 o finerenona con DM2 y albuminuria residual; estatina; cautela con contraste y sangrado en procedimientos coronarios. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Sección 6.2.3 y Tabla 35",
    "cor": "1",
    "loe": "A; B-R"
  },
  {
    "codigo": "E4-ASCVD-MED-06",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0",
      "dia-60"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD (todos)",
    "texto": "Estatina de alta intensidad con meta LDL < 55; ezetimibe si no alcanza a las 4 a 12 semanas; luego PCSK9, inclisirán o bempedoico.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E4-ASCVD-MED-07",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hta"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD con PA ≥ 130/80",
    "texto": "Tratamiento con meta < 130/80; betabloqueante y RASi según la enfermedad de base.",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E4-ASCVD-MED-08",
    "tipo": "alerta",
    "dominio": "medicacion",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD (todos)",
    "texto": "Antiagregación o anticoagulación según guía de la enfermedad (coronaria 2023, ACV 2021, EAP 2024); duración de la doble antiagregación según riesgo de sangrado. Neurología en ACV.",
    "fuente": "Guías de enfermedad; Guía CKM 2026, Sección 6.2"
  },
  {
    "codigo": "E4-ASCVD-MED-09",
    "tipo": "alerta",
    "dominio": "actividad-fisica",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "coronaria",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Coronaria, revascularización o arteriopatía periférica",
    "texto": "Rehabilitación cardiovascular supervisada; ejercicio de marcha supervisado en EAP.",
    "fuente": "Guías coronaria 2023 y EAP 2024; Guía CKM 2026, Sección 6.2"
  },
  {
    "codigo": "E4-ASCVD-MED-10",
    "tipo": "alerta",
    "dominio": "aterosclerosis",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "acv"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "neurologia",
    "titulo": "ACV o AIT",
    "texto": "Derivación a neurología; búsqueda de FA (monitoreo prolongado); antitrombótico y metas según guía 2021; apnea del sueño.",
    "fuente": "Guía ACV 2021; Guía CKM 2026, Sección 6.2"
  },
  {
    "codigo": "E4-ASCVD-MED-11",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "tg-altos",
      "toma-estatina"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "TG ≥ 150 con estatina máxima",
    "texto": "Icosapent ethyl para reducir eventos.",
    "fuente": "Guía CKM 2026, Sección 5.5.2"
  },
  {
    "codigo": "E4-ASCVD-MED-12",
    "tipo": "alerta",
    "dominio": "nicotina",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fuma"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Fuma o vapea",
    "texto": "Farmacoterapia de cesación más consejería desde el día 0.",
    "fuente": "Guía coronaria 2023; Guía CKM 2026, Sección 5.1"
  },
  {
    "codigo": "E4-ASCVD-MED-13",
    "tipo": "alerta",
    "dominio": "estres",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "cardiologia",
    "titulo": "PHQ-2 ≥ 3 tras evento",
    "texto": "PHQ-9, psicología y tratamiento de la depresión post-evento.",
    "fuente": "Guía coronaria 2023; Guía CKM 2026, Tabla 9"
  },
  {
    "codigo": "E4-ASCVD-MED-14",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "sintomas-nuevos"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Síntomas nuevos o recurrentes (angina, déficit, claudicación en reposo)",
    "texto": "Evaluación urgente según la enfermedad; contacto el mismo día. Neurología en ACV.",
    "fuente": "Guías de enfermedad; Guía CKM 2026, Sección 6.2"
  },
  {
    "codigo": "E4-IC-MED-01",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hfref"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "HFrEF (FEVI ≤ 40 %)",
    "texto": "Cuádruple terapia: ARNI (o IECA/ARA II), betabloqueante, MRA y SGLT2i; titular; hidralazina/nitrato en pacientes negros; diurético si congestión; dispositivos según indicación.",
    "fuente": "Guía IC 2022; Guía CKM 2026, Sección 6.3"
  },
  {
    "codigo": "E4-IC-MED-02",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "hfmref",
      "hfpef"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "HFmrEF o HFpEF",
    "texto": "SGLT2i de primera línea; diuréticos si congestión; ARNI, ARA II o MRA con evidencia limitada.",
    "fuente": "Guía IC 2022; Guía CKM 2026, Sección 6.3"
  },
  {
    "codigo": "E4-IC-MED-03",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic",
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "IC con DM2",
    "texto": "SGLT2i priorizado como hipoglucemiante cardioprotector para reducir muerte CV y hospitalización.",
    "fuente": "Guía CKM 2026, Tabla 41",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E4-IC-MED-04",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hfpef",
      "dm2"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "HFpEF con DM2 y otros factores CKM",
    "texto": "Sumar GLP-1 con beneficio CV al SGLT2i para síntomas y eventos CKM. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 41",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E4-IC-MED-05",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic",
      "dm2"
    ],
    "excluye": [
      "egfr-30"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "IC estable con DM2, eGFR ≥ 30 y HbA1c sobre la meta",
    "texto": "Sumar metformina al SGLT2i (contraindicada en descompensación; dosis por eGFR: 45 a 59, 1000 a 1500 mg/día; < 30, suspender). Meta HbA1c 7 a 8 %. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 41 y Sección 6.3.2",
    "cor": "2a",
    "loe": "B-NR"
  },
  {
    "codigo": "E4-IC-MED-06",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hfpef",
      "imc-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "HFpEF sintomática con obesidad",
    "texto": "GLP-1 con beneficio CV probado para perfil CKM, capacidad funcional, síntomas y eventos de IC (COR 1 A). Ejercicio más dieta con déficit calórico para capacidad funcional (2a B-R).",
    "fuente": "Guía CKM 2026, Tabla 40",
    "cor": "1; 2a",
    "loe": "A; B-R"
  },
  {
    "codigo": "E4-IC-MED-07",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hfref",
      "imc-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "HFrEF sintomática con obesidad",
    "texto": "Tratamiento de la obesidad puede considerarse en seleccionados para capacidad funcional o elegibilidad a trasplante; GLP-1 con cautela por señales de riesgo en ensayos chicos, sobre todo sin ASCVD.",
    "fuente": "Guía CKM 2026, Tabla 40 y Sección 6.3.1",
    "cor": "2b",
    "loe": "B-NR"
  },
  {
    "codigo": "E4-IC-MED-08",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic",
      "erc"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "IC con ERC y eGFR ≥ 20",
    "texto": "SGLT2i en cualquier FE para reducir mortalidad CV, hospitalización y pérdida de función renal (COR 1 A). HFrEF con eGFR ≥ 30: ARNI, o RASi si no se puede (COR 1 A). Nunca dos RASi. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 42",
    "cor": "1",
    "loe": "A"
  },
  {
    "codigo": "E4-IC-MED-09",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "dm2",
      "erc",
      "uacr-30"
    ],
    "algunaDe": [
      "hfmref",
      "hfpef"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "HFmrEF o HFpEF con DM2, ERC, UACR ≥ 30 y eGFR ≥ 25",
    "texto": "nsMRA (finerenona) para reducir hospitalización por IC y pérdida de función renal; potasio a las 2 a 4 semanas. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 42",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E4-IC-MED-10",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hfref",
      "erc",
      "hiperpotasemia"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "HFrEF con ERC, eGFR > 30 e hiperpotasemia que limita el RASi",
    "texto": "Quelantes de potasio orales nuevos pueden ser razonables para sostener la inhibición del RAAS. Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 42",
    "cor": "2b",
    "loe": "B-R"
  },
  {
    "codigo": "E4-IC-MED-11",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic"
    ],
    "algunaDe": [
      "inicia-rasi-mra",
      "inicia-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Inicio o ajuste de RASi, ARNI, MRA o SGLT2i",
    "texto": "Potasio y creatinina a las 2 a 4 semanas; caída de eGFR ≤ 30 % aceptable; hipotensión sintomática.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E4-IC-MED-12",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic",
      "deficit-hierro"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Déficit de hierro (ferritina < 100, o 100 a 299 con saturación < 20 %)",
    "texto": "Hierro intravenoso para síntomas y capacidad funcional.",
    "fuente": "Guía IC 2022; Guía CKM 2026, Sección 6.3; firma del estadío 4"
  },
  {
    "codigo": "E4-IC-MED-13",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic",
      "congestion"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Congestión clínica, 2 kg en 3 días o NYHA que empeora",
    "texto": "Ajuste de diurético; evaluar internación; revisar adherencia y sodio.",
    "fuente": "Guía IC 2022; Guía CKM 2026, Sección 6.3"
  },
  {
    "codigo": "E4-IC-MED-14",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ic"
    ],
    "algunaDe": [
      "fa",
      "apnea-sospecha",
      "hta-resistente"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "IC con FA, apnea o HTA resistente",
    "texto": "Estudio del sueño; con apnea, pérdida de peso y CPAP. Neumonología.",
    "fuente": "Guía CKM 2026, Tabla 45",
    "cor": "2a; 1",
    "loe": "C-LD; B-R"
  },
  {
    "codigo": "E4-FA-MED-01",
    "tipo": "alerta",
    "dominio": "arritmia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FA",
    "texto": "Anticoagulación según CHA2DS2-VASc y riesgo de sangrado; anticoagulante directo preferido salvo válvula mecánica o estenosis mitral; dosis ajustada por eGFR; en 4b, decisión con nefrología.",
    "fuente": "Guía FA 2023; Guía CKM 2026, Sección 6"
  },
  {
    "codigo": "E4-FA-MED-02",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa",
      "imc-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FA con obesidad (IMC ≥ 30)",
    "texto": "Pérdida de peso ≥ 10 % como parte del control del ritmo; GLP-1 como adyuvante según el resto del perfil CKM.",
    "fuente": "Guía FA 2023; Guía CKM 2026, Tabla 31",
    "cor": "2a",
    "loe": "A"
  },
  {
    "codigo": "E4-FA-MED-03",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FA",
    "texto": "Cribado de apnea del sueño; con apnea, CPAP y pérdida de peso. Neumonología.",
    "fuente": "Guía CKM 2026, Tabla 45 y Sección 7.3",
    "cor": "2a; 1",
    "loe": "C-LD; B-R"
  },
  {
    "codigo": "E4-FA-MED-04",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa",
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FA con PA ≥ 130/80",
    "texto": "Control estricto de la PA reduce recurrencia y sangrado; meta < 130/80.",
    "fuente": "Guía HTA 2025; guía FA 2023; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E4-FA-MED-05",
    "tipo": "alerta",
    "dominio": "coordinacion",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa"
    ],
    "algunaDe": [
      "ic",
      "dm2",
      "erc"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FA con IC o DM2 o ERC",
    "texto": "Aplicar los submódulos correspondientes (E4-IC, E2-DM2, E2-ERC); SGLT2i según indicación de base.",
    "fuente": "Guía CKM 2026, Tablas 41 y 42 y Sección 6.3"
  },
  {
    "codigo": "E4-FA-MED-06",
    "tipo": "alerta",
    "dominio": "arritmia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa",
      "alcohol"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Alcohol > 1 medida/día",
    "texto": "Reducción o abstinencia como parte del control del ritmo.",
    "fuente": "Guía FA 2023; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E4-FA-MED-07",
    "tipo": "alerta",
    "dominio": "arritmia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa"
    ],
    "algunaDe": [
      "sintomas-nuevos",
      "evento-reciente",
      "ic"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "cardiologia",
    "titulo": "Síntomas persistentes, FA de reciente diagnóstico o IC",
    "texto": "Estrategia de control del ritmo (ablación o fármacos) según guía; derivación a electrofisiología.",
    "fuente": "Guía FA 2023; Guía CKM 2026, Sección 6"
  },
  {
    "codigo": "E4-FA-MED-08",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fa",
      "sangrado-mayor"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Sangrado mayor o caída del hematocrito",
    "texto": "Evaluación urgente; ajuste o suspensión temporal coordinada; nunca por la persona.",
    "fuente": "Guía FA 2023; Guía CKM 2026, Sección 6"
  },
  {
    "codigo": "E4-RENAL-MED-01",
    "tipo": "alerta",
    "dominio": "coordinacion",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nefrologia",
    "titulo": "4b",
    "texto": "Nefrología conduce; plan conjunto con cardiología; persona de coordinación asignada.",
    "fuente": "Guía CKM 2026, Tabla 11",
    "cor": "1"
  },
  {
    "codigo": "E4-RENAL-MED-02",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal"
    ],
    "algunaDe": [
      "toma-rasi-mra",
      "toma-sglt2i"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "Toma RASi, SGLT2i o nsMRA y el eGFR cayó bajo el umbral de inicio",
    "texto": "Es razonable continuar mientras se tolere; en diálisis, evaluar suspensión del SGLT2i y del nsMRA por falta de evidencia.",
    "fuente": "Guía CKM 2026, Tabla 43",
    "cor": "2a",
    "loe": "B-R"
  },
  {
    "codigo": "E4-RENAL-MED-03",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal",
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "endocrinologia",
    "titulo": "DM2 con eGFR < 30",
    "texto": "Suspender metformina; ajustar GLP-1 y otros hipoglucemiantes por eGFR; HbA1c menos estricta y con cautela por interferencia de la anemia. Nefrología.",
    "fuente": "Guía CKM 2026, Sección 6.3.2; ADA"
  },
  {
    "codigo": "E4-RENAL-MED-04",
    "tipo": "alerta",
    "dominio": "arritmia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal",
      "fa"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "FA en 4b",
    "texto": "Anticoagulación con decisión individual (evidencia limitada en diálisis); dosis ajustada. Con nefrología.",
    "fuente": "Guía FA 2023; Guía CKM 2026, Sección 6"
  },
  {
    "codigo": "E4-RENAL-MED-05",
    "tipo": "alerta",
    "dominio": "cardiaco",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal",
      "ic"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "IC en 4b",
    "texto": "GDMT ajustada; control de volumen con diálisis; ARNI y MRA según potasio; SGLT2i sin evidencia en diálisis. Con nefrología.",
    "fuente": "Guía IC 2022; Guía CKM 2026, Tabla 21 y Sección 6.3.3"
  },
  {
    "codigo": "E4-RENAL-MED-06",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal"
    ],
    "algunaDe": [
      "coronaria",
      "acv",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "ASCVD en 4b",
    "texto": "Estatina según guía de dislipidemia (no iniciar de novo en diálisis; continuar si ya la tomaba); antiagregación con evaluación de sangrado. Con nefrología.",
    "fuente": "Guía de dislipidemia 2026; KDIGO; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E4-RENAL-MED-07",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "Potasio > 5,5, fósforo alto, anemia, acidosis",
    "texto": "Manejo de complicaciones según KDIGO: quelantes, hierro y eritropoyetina, bicarbonato.",
    "fuente": "KDIGO"
  },
  {
    "codigo": "E4-RENAL-MED-08",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal",
      "candidato-trasplante",
      "imc-30"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nefrologia",
    "titulo": "Candidato a trasplante con obesidad",
    "texto": "Programa de pérdida de peso; GLP-1 como adyuvante según perfil; la cirugía metabólica no se incorpora (firma). Endocrinología.",
    "fuente": "Guía CKM 2026, Tabla 40 y Sección 6.3.1",
    "cor": "2b"
  },
  {
    "codigo": "E4-RENAL-MED-09",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "falla-renal",
      "procedimiento"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "Procedimiento con contraste o cirugía",
    "texto": "Protección del acceso vascular y de la función residual; coordinación con el servicio que lo indica.",
    "fuente": "KDIGO"
  },
  {
    "codigo": "E4-MED-01",
    "tipo": "alerta",
    "dominio": "prevencion",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 4 confirmado",
    "texto": "Prevención secundaria completa según la guía de la enfermedad, más los ítems CKM por factor (obesidad, DM2, ERC); coordinación CKM asignada.",
    "fuente": "Guía CKM 2026, Tabla 28 y Sección 6",
    "cor": "1"
  },
  {
    "codigo": "E4-MED-02",
    "tipo": "alerta",
    "dominio": "lipidos",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ldl-fuera-de-meta"
    ],
    "momentos": [
      "dia-60",
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "LDL ≥ 55 al día 60 o 100",
    "texto": "Escalar: ezetimibe, luego PCSK9, inclisirán o ácido bempedoico; con intolerancia a estatina, cambiar o dosis alterna antes de abandonar.",
    "fuente": "Guía de dislipidemia 2026; Guía CKM 2026, Sección 7.1"
  },
  {
    "codigo": "E4-MED-03",
    "tipo": "alerta",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "dm2"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 4 con DM2",
    "texto": "SGLT2i o GLP-1 con beneficio CV probado (COR 1 A); con IC, SGLT2i primero; con ASCVD y obesidad, GLP-1; combinación (2a). Metformina para la meta glucémica según eGFR. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tablas 39 y 41",
    "cor": "1; 2a",
    "loe": "A"
  },
  {
    "codigo": "E4-MED-04",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "imc-27"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 4 con IMC ≥ 27",
    "texto": "Intervención conductual intensiva (COR 1 A); GLP-1 con beneficio CV (COR 1 B-R en ASCVD; COR 1 A en HFpEF); naltrexona/bupropión y fentermina contraindicados (COR 3). Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tablas 38 y 40",
    "cor": "1; 1; 3",
    "loe": "A; B-R"
  },
  {
    "codigo": "E4-MED-05",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "erc",
      "erc-muy-alto-riesgo",
      "falla-renal"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Estadío 4 con ERC",
    "texto": "RASi y SGLT2i; GLP-1 o finerenona con DM2 y albuminuria residual; en IC con ERC, ARNI o SGLT2i según Tabla 42; continuar bajo el umbral de inicio si se tolera (Tabla 43). Nefrología según el caso.",
    "fuente": "Guía CKM 2026, Tablas 35, 42 y 43",
    "cor": "1; 1; 2a",
    "loe": "A; B-R; B-R"
  },
  {
    "codigo": "E4-MED-06",
    "tipo": "alerta",
    "dominio": "presion-arterial",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "hta"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "PA ≥ 130/80",
    "texto": "Tratamiento con meta < 130/80; fármacos según enfermedad de base (betabloqueante y RASi en coronaria e IC).",
    "fuente": "Guía HTA 2025; Guía CKM 2026, Sección 5.5.3"
  },
  {
    "codigo": "E4-MED-07",
    "tipo": "alerta",
    "dominio": "imc",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "toma-glp1",
      "sin-respuesta"
    ],
    "momentos": [
      "dia-100"
    ],
    "responsable": "cardiologia",
    "titulo": "Toma GLP-1 por obesidad y peso < 5 % al día 100",
    "texto": "Reevaluar hiporrespuesta: escalar, cambiar o derivar a obesidad. Endocrinología según el caso.",
    "fuente": "Guía CKM 2026, Tabla 47",
    "cor": "1",
    "loe": "B-NR"
  },
  {
    "codigo": "E4-MED-08",
    "tipo": "alerta",
    "dominio": "hepatico",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "dm2",
      "dos-o-mas-factores"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "DM2 o ≥ 2 factores",
    "texto": "FIB-4 cada 1 a 2 años; hepatología si > 2,67; GLP-1 si MASLD con fibrosis y DM2.",
    "fuente": "Guía CKM 2026, Tabla 44",
    "cor": "1",
    "loe": "B-NR; B-R"
  },
  {
    "codigo": "E4-MED-09",
    "tipo": "alerta",
    "dominio": "apnea",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "imc-30",
      "fa",
      "ic",
      "acv",
      "hta-resistente"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "cardiologia",
    "titulo": "Obesidad, FA, IC, ACV o HTA resistente",
    "texto": "Cribado y estudio del sueño; con apnea, CPAP y pérdida de peso. Neumonología.",
    "fuente": "Guía CKM 2026, Tabla 45 y Sección 7.3",
    "cor": "2a; 1",
    "loe": "C-LD; B-R"
  },
  {
    "codigo": "E4-MED-10",
    "tipo": "alerta",
    "dominio": "estres",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "cardiologia",
    "titulo": "PHQ-2 ≥ 3 o GAD-2 ≥ 3",
    "texto": "PHQ-9 o GAD-7, psicología y tratamiento; la depresión post-evento empeora el pronóstico.",
    "fuente": "Guía CKM 2026, Tabla 9 y Sección 5.1; guía coronaria 2023"
  },
  {
    "codigo": "E4-MED-11",
    "tipo": "alerta",
    "dominio": "social",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "coordinacion",
    "titulo": "AHC-HRSN con necesidades o barreras de acceso a fármacos",
    "texto": "Trabajo social; programas de asistencia; simplificar esquema.",
    "fuente": "Guía CKM 2026, Tabla 25 y Tabla 12",
    "cor": "1"
  },
  {
    "codigo": "E4-MED-12",
    "tipo": "alerta",
    "dominio": "medicacion",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "polifarmacia",
      "fragilidad"
    ],
    "momentos": [
      "dia-0",
      "dia-100"
    ],
    "responsable": "farmacia",
    "titulo": "Polifarmacia (≥ 5 fármacos) o 65 a 79 años con fragilidad",
    "texto": "Manejo integral de la medicación: reconciliación, interacciones, desprescripción compartida de lo no indicado, metas individualizadas. Con coordinación.",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E4-MED-13",
    "tipo": "alerta",
    "dominio": "seguridad",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "procedimiento"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Procedimiento, cirugía o estudio con contraste programado",
    "texto": "Coordinar suspensión y reinicio de antitrombóticos, SGLT2i, metformina y RASi; protección renal. Con nefrología.",
    "fuente": "Guías de enfermedad; KDIGO; Guía CKM 2026, Sección 6.2.3"
  },
  {
    "codigo": "E4-MED-14",
    "tipo": "alerta",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "falla-renal",
      "dialisis"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "nefrologia",
    "titulo": "eGFR < 15 o inicio de diálisis",
    "texto": "Cambio a 4b; nefrología conduce; revisión de todos los fármacos por eGFR.",
    "fuente": "Guía CKM 2026, Tabla 4 y Tabla 43"
  },
  {
    "codigo": "E4-MED-15",
    "tipo": "alerta",
    "dominio": "embarazo",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cardiologia",
    "titulo": "Planifica embarazo con ECV establecida",
    "texto": "Consejo preconcepcional con cardiología y obstetricia; suspender estatina, RASi, ARA II, ARNI, MRA y SGLT2i; anticoagulación segura si FA.",
    "fuente": "Guía CKM 2026, Tabla 46",
    "cor": "1",
    "loe": "C-LD"
  },
  {
    "codigo": "E4-DER-01",
    "tipo": "derivacion",
    "dominio": "actividad-fisica",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "coronaria",
      "ic",
      "eap"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "rehabilitacion",
    "titulo": "Rehabilitación cardiovascular",
    "texto": "Coronaria, revascularización, IC, arteriopatía; dentro de los 100 días.",
    "fuente": "Guías coronaria 2023, IC 2022 y EAP 2024"
  },
  {
    "codigo": "E4-DER-02",
    "tipo": "derivacion",
    "dominio": "dieta",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nutricion",
    "titulo": "Nutrición",
    "texto": "Todas; dieta renal en ERC y 4b; sodio y líquidos en IC.",
    "fuente": "Guía CKM 2026, Tabla 39; KDIGO"
  },
  {
    "codigo": "E4-DER-03",
    "tipo": "derivacion",
    "dominio": "actividad-fisica",
    "estadios": [
      "4"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "kinesiologia",
    "titulo": "Kinesiología",
    "texto": "Todas, dentro de rehabilitación o supervisión inicial.",
    "fuente": "Guía CKM 2026, Sección 6"
  },
  {
    "codigo": "E4-DER-04",
    "tipo": "derivacion",
    "dominio": "aterosclerosis",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "acv"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "neurologia",
    "titulo": "Neurología",
    "texto": "ACV o AIT; deterioro cognitivo.",
    "fuente": "Guía ACV 2021"
  },
  {
    "codigo": "E4-DER-05",
    "tipo": "derivacion",
    "dominio": "renal",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "erc",
      "erc-muy-alto-riesgo",
      "falla-renal",
      "hiperpotasemia"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "nefrologia",
    "titulo": "Nefrología",
    "texto": "ERC de alto o muy alto riesgo; 4b; hiperpotasemia; ajustes por eGFR.",
    "fuente": "KDIGO; Guía CKM 2026, Tabla 43"
  },
  {
    "codigo": "E4-DER-06",
    "tipo": "derivacion",
    "dominio": "glucemia",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "dm2",
      "imc-27",
      "hba1c-10"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "endocrinologia",
    "titulo": "Endocrinología",
    "texto": "DM2 compleja o insulinizada; GLP-1 por obesidad; HbA1c > 10 %.",
    "fuente": "Guía CKM 2026, Tabla 20 y Tabla 38"
  },
  {
    "codigo": "E4-DER-07",
    "tipo": "derivacion",
    "dominio": "arritmia",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "fa",
      "hfref"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "electrofisiologia",
    "titulo": "Electrofisiología",
    "texto": "FA con estrategia de control del ritmo; dispositivos en HFrEF.",
    "fuente": "Guía FA 2023; guía IC 2022"
  },
  {
    "codigo": "E4-DER-08",
    "tipo": "derivacion",
    "dominio": "hepatico",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "fib4-alto"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "hepatologia",
    "titulo": "Hepatología",
    "texto": "FIB-4 > 2,67 o intermedio de riesgo.",
    "fuente": "Guía CKM 2026, Tablas 17 y 18"
  },
  {
    "codigo": "E4-DER-09",
    "tipo": "derivacion",
    "dominio": "apnea",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "apnea-sospecha",
      "imc-30",
      "fuma"
    ],
    "momentos": [
      "dia-0",
      "dia-30",
      "dia-60"
    ],
    "responsable": "neumonologia",
    "titulo": "Neumonología",
    "texto": "Apnea sospechada o confirmada; EPOC; cesación compleja.",
    "fuente": "Guía CKM 2026, Sección 7.3"
  },
  {
    "codigo": "E4-DER-10",
    "tipo": "derivacion",
    "dominio": "estres",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "phq-gad-positivo"
    ],
    "momentos": [
      "dia-0",
      "dia-30"
    ],
    "responsable": "psicologia",
    "titulo": "Psicología",
    "texto": "PHQ-2 o GAD-2 positivos; depresión post-evento.",
    "fuente": "Guía CKM 2026, Tabla 9"
  },
  {
    "codigo": "E4-DER-11",
    "tipo": "derivacion",
    "dominio": "social",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "ahc-necesidades"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "trabajo-social",
    "titulo": "Trabajo social",
    "texto": "Necesidades sociales; acceso a fármacos.",
    "fuente": "Guía CKM 2026, Sección 3.2 y Tabla 12"
  },
  {
    "codigo": "E4-DER-12",
    "tipo": "derivacion",
    "dominio": "medicacion",
    "estadios": [
      "4"
    ],
    "algunaDe": [
      "polifarmacia",
      "toma-antitrombotico"
    ],
    "momentos": [
      "dia-0"
    ],
    "responsable": "farmacia",
    "titulo": "Farmacia clínica",
    "texto": "Polifarmacia; reconciliación; interacciones con anticoagulantes.",
    "fuente": "Guía CKM 2026, Tabla 12"
  },
  {
    "codigo": "E4-DER-13",
    "tipo": "derivacion",
    "dominio": "embarazo",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "planifica-embarazo"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "obstetricia",
    "titulo": "Obstetricia",
    "texto": "Planificación de embarazo con ECV establecida.",
    "fuente": "Guía CKM 2026, Tabla 46"
  },
  {
    "codigo": "E4-DER-14",
    "tipo": "derivacion",
    "dominio": "aterosclerosis",
    "estadios": [
      "4"
    ],
    "condiciones": [
      "eap",
      "sintomas-nuevos"
    ],
    "momentos": [
      "evento"
    ],
    "responsable": "cirugia-vascular",
    "titulo": "Cirugía vascular",
    "texto": "Arteriopatía periférica con isquemia crítica o lesiones tróficas.",
    "fuente": "Guía EAP 2024"
  }
];
