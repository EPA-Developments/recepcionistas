/**
 * Tipo de cambio ARS/USD (R-17).
 * Los precios de lista están en USD y se cobran en pesos al TC vigente al cobro.
 * El TC es configurable por el administrador y se persiste como recurso FHIR
 * (Basic, ver seed). Este valor es el default de referencia del brief.
 */
export const TC_DEFAULT = 1450;

/**
 * Resuelve el TC a aplicar. Precedencia: valor explícito > env > default.
 * En runtime (bots) el valor vigente se lee del recurso de configuración FHIR.
 */
export function resolverTC(explicito?: number): number {
  if (typeof explicito === 'number' && explicito > 0) {
    return explicito;
  }
  const env = process.env.SOM_TC_DEFAULT;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return TC_DEFAULT;
}
