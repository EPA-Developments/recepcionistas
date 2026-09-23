// Datos clínicos que `monitoring.ts` usa para sumar controles — contrato INTERINO.
//
// El `eligibility.ts` original (criterios de elegibilidad) todavía no está en este
// repo; acá solo van los campos que el calendario necesita. Al integrar el
// original, reemplazar este archivo.

export interface GLP1Inputs {
  /** Retinopatía diabética: suma control oftalmológico en la semana 12. */
  hasRetinopathy?: boolean;
  /** Relación albúmina/creatinina en orina (mg/g). */
  uacrMgG?: number;
  /** Filtrado glomerular estimado (mL/min/1,73 m²). */
  egfr?: number;
}
