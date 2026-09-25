/**
 * Umbrales de la estadificación del síndrome Cardiovascular-Renal-Metabólico (CKM)
 * de la American Heart Association.
 *
 * Fuente: Ndumele CE, Rangaswami J, Chow SL, et al. "Cardiovascular-Kidney-Metabolic
 * Health: A Presidential Advisory From the American Heart Association."
 * Circulation. 2023;148:1606–1635. doi:10.1161/CIR.0000000000001184
 * (con la presión arterial según ACC/AHA 2017 y el riesgo renal según KDIGO).
 *
 * Salud CONVENCIONAL: son los criterios de la guía, sin parámetros de medicina
 * funcional. Igual que PREVENT, quedan marcados PENDIENTE_VALIDACION hasta la firma
 * del equipo médico (Gobernanza): el resultado viaja como estimación del sistema,
 * no como diagnóstico.
 *
 * Diferencias con otras fuentes a confirmar con el equipo médico:
 *  - Triglicéridos del Estadío 2: Ndumele 2023 usa ≥ 135 mg/dL (la guía CKM 2026 de
 *    la plataforma CKM usa ≥ 150).
 *  - Calcio coronario (Estadío 3): Ndumele 2023 no fija un puntaje; se toma CAC > 0
 *    (calcificación presente). La plataforma CKM usa ≥ 100.
 *  - Ascendencia asiática (IMC ≥ 23, cintura ≥ 80/90 cm): no se aplica porque la
 *    ficha no registra ascendencia.
 */
export const PENDIENTE_VALIDACION_CKM = true;

export const FUENTE_CKM =
  'AHA — Ndumele CE, et al. Cardiovascular-Kidney-Metabolic Health: A Presidential Advisory. Circulation. 2023;148:1606–1635.';

export const UMBRALES_CKM = {
  // Estadío 1 — exceso o disfunción del tejido adiposo
  imc: 25, // kg/m²
  cintura: { female: 88, male: 102 }, // cm
  prediabetes: { glucemia: 100, hba1c: 5.7 }, // mg/dL, % (hasta los umbrales de diabetes)
  // Estadío 2 — factores de riesgo metabólicos o ERC de riesgo moderado/alto
  diabetes: { glucemia: 126, hba1c: 6.5 },
  trigliceridos: 135, // mg/dL
  hipertension: { pas: 130, pad: 80 }, // mmHg (ACC/AHA 2017), o tratamiento
  sindromeMetabolico: {
    // ≥ 3 de 5 componentes
    cintura: { female: 88, male: 102 },
    trigliceridos: 150,
    hdl: { female: 50, male: 40 }, // por debajo
    pas: 130,
    pad: 85,
    glucemia: 100,
  },
  // KDIGO: categorías de filtrado (eGFR, mL/min/1,73 m²) y albuminuria (UACR, mg/g)
  kdigo: { g2: 90, g3a: 60, g3b: 45, g4: 30, g5: 15, a2: 30, a3: 300 },
  // Estadío 3 — ECV subclínica o equivalentes de riesgo
  cacMayorA: 0, // Agatston
  ntProBnp: 125, // pg/mL
  hsTnT: { female: 14, male: 22 }, // ng/L
  hsTnI: { female: 10, male: 12 }, // ng/L
  riesgoEcv10a: 0.2, // PREVENT, ECV total a 10 años (probabilidad 0–1)
  // Estadío 4b — falla renal
  egfrFallaRenal: 15,
} as const;
