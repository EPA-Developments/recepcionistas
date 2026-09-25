/**
 * Umbrales del síndrome Cardiovascular-Renal-Metabólico (CKM) según la guía vigente:
 *
 *   "2026 AHA/ACC/ADA/ASN Guideline for the Prevention, Detection, Evaluation, and
 *   Management of Cardiovascular-Kidney-Metabolic Syndrome" — Ndumele CE,
 *   Rodriguez F, et al. Circulation. 2026. doi:10.1161/CIR.0000000000001453
 *
 * Reemplaza a la Presidential Advisory de la AHA de 2023. De la guía se toman:
 *  - Tabla 4: estadificación en adultos (Estadíos 0–4a/4b) y KDIGO.
 *  - Tabla 8: usos de las ecuaciones PREVENT por umbral de riesgo.
 *  - Tabla 16: definición de pre-insuficiencia cardíaca (ecocardiograma y biomarcadores).
 *  - Figura 3: frecuencia de las evaluaciones según el estadío.
 *
 * Salud CONVENCIONAL, sin parámetros de medicina funcional. Quedan marcados
 * PENDIENTE_VALIDACION hasta la firma del equipo médico (Gobernanza): el resultado
 * viaja como estimación del sistema, no como diagnóstico.
 *
 * Supuestos a confirmar con el equipo médico:
 *  - Índice tobillo-brazo "bajo" (Estadío 3): la guía no fija el valor; se usa
 *    ≤ 0,90, el umbral diagnóstico habitual de enfermedad arterial periférica.
 *  - Ascendencia asiática (IMC ≥ 23, cintura ≥ 80/90 cm): no se aplica porque la
 *    ficha no registra ascendencia.
 */
export const PENDIENTE_VALIDACION_CKM = true;

export const FUENTE_CKM =
  '2026 AHA/ACC/ADA/ASN Guideline for the Prevention, Detection, Evaluation, and Management of ' +
  'Cardiovascular-Kidney-Metabolic Syndrome (Ndumele CE, Rodriguez F, et al. Circulation. 2026; ' +
  'doi:10.1161/CIR.0000000000001453).';

/** Tabla 4 (y Tabla 16 para pre-IC): criterios de estadificación en adultos. */
export const UMBRALES_CKM = {
  // Estadío 1 — exceso o disfunción del tejido adiposo
  imc: 25, // kg/m²
  cintura: { female: 88, male: 102 }, // cm
  prediabetes: { glucemia: 100, hba1c: 5.7 }, // mg/dL, % (hasta los umbrales de diabetes)
  // Estadío 2 — factores de riesgo metabólicos, ERC o ambos
  diabetes: { glucemia: 126, hba1c: 6.5 },
  trigliceridos: 150, // mg/dL
  hipertension: { pas: 130, pad: 80 }, // mmHg, o tratamiento antihipertensivo
  sindromeMetabolico: {
    // AHA/NHLBI: ≥ 3 de 5 componentes
    cintura: { female: 88, male: 102 },
    trigliceridos: 150,
    hdl: { female: 50, male: 40 }, // por debajo
    pas: 130,
    pad: 80,
    glucemia: 100,
  },
  // KDIGO: filtrado (eGFR, mL/min/1,73 m²) y albuminuria (UACR, mg/g: A2 30 a < 300, A3 ≥ 300)
  kdigo: { g2: 90, g3a: 60, g3b: 45, g4: 30, g5: 15, a2: 30, a3: 300 },
  // Estadío 3 — ECV subclínica
  cac: 100, // Agatston ≥ 100
  itbBajo: 0.9, // ≤ 0,90 sin claudicación (ver supuestos)
  ntProBnp: 125, // pg/mL
  bnp: 35, // pg/mL (Tabla 16)
  hsTnT: { female: 14, male: 22 }, // ng/L
  hsTnI: { female: 10, male: 12 }, // ng/L
  /** Tabla 16 — pre-IC por ecocardiograma. */
  ecocardiograma: {
    lavi: 29, // volumen auricular izquierdo indexado ≥ 29 mL/m²
    lvmi: { male: 116, female: 95 }, // masa del VI indexada > g/m²
    rwt: 0.42, // espesor parietal relativo > 0,42
    espesorPared: 12, // espesor de pared del VI ≥ 12 mm
    fevi: 50, // fracción de eyección del VI < 50 %
    gls: 16, // strain longitudinal global < 16 % (valor absoluto)
    eSeptal: 7, // e′ septal < 7 cm/s
    velocidadIt: 2.8, // velocidad de insuficiencia tricuspídea > 2,8 m/s
    psap: 35, // presión sistólica pulmonar estimada > 35 mmHg
    eSobreEPrima: 15, // E/e′ promedio ≥ 15
  },
  // Estadío 3 — equivalente de riesgo
  riesgoEcv10a: 0.2, // PREVENT-CVD a 10 años ≥ 20 %
  // Estadío 4b — falla renal
  egfrFallaRenal: 15,
} as const;

/** Tabla 8 — umbrales de PREVENT en prevención primaria (probabilidades 0–1). */
export const UMBRALES_PREVENT_GUIA = {
  /** PREVENT-CVD 10a ≥ 20 %: equivalente de riesgo del Estadío 3. */
  ecv10aEstadio3: 0.2,
  /** PREVENT-CVD 10a ≥ 7,5 %: priorizar SGLT2i / terapia GLP-1 (DM2) y tratar HTA estadío 1. */
  ecv10aPriorizar: 0.075,
  /** PREVENT-ASCVD 10a 3 % a < 10 %: evaluar aterosclerosis subclínica (CAC) si hay incertidumbre. */
  ascvd10aEvaluarSubclinica: { desde: 0.03, hasta: 0.1 },
  /** PREVENT-ASCVD 10a ≥ 5 %: iniciar hipolipemiantes (guía de dislipidemia 2026). */
  ascvd10aIniciarHipolipemiante: 0.05,
  /** PREVENT-ASCVD 10a 3 % a < 5 %: considerar hipolipemiantes (potenciadores, riesgo a 30 años o CAC). */
  ascvd10aConsiderarHipolipemiante: 0.03,
  /** PREVENT-ASCVD 30a ≥ 10 %: considerar hipolipemiantes. */
  ascvd30aConsiderarHipolipemiante: 0.1,
  /** PREVENT-HF 10a ≥ 5 %: evaluar pre-IC (biomarcadores) y coordinar cuidados. */
  ic10aEvaluarPreIc: 0.05,
  /** Proteína C reactiva us ≥ 2,0 mg/L: potenciador de riesgo CKM (Tabla 9). */
  pcrUs: 2,
} as const;
