/**
 * Lógica pura de `npm run claude:probar`: qué quiere decir cada error de la API de Claude
 * y si el tiempo de una lectura entra en el límite del bot.
 */
import type { AnalitoExtraido } from './laboratorio.js';

/** El límite de ejecución del bot de laboratorio (`Bot.timeout`, ver deploy:bots). */
export const LIMITE_BOT_SEGUNDOS = 300;

/** Qué hacer ante un error de la API, por su estado HTTP (undefined = no hubo respuesta). */
export function explicarErrorClaude(status: number | undefined, mensaje: string): string {
  if (status === undefined) {
    return /timed? ?out/i.test(mensaje)
      ? `No respondió a tiempo (${mensaje}).`
      : `No hay conexión con api.anthropic.com (${mensaje}): red, proxy o firewall.`;
  }
  switch (status) {
    case 401:
      return 'La clave es inválida o fue revocada: generá una nueva en platform.claude.com y actualizá el secret ANTHROPIC_API_KEY en Medplum.';
    case 403:
      return `La clave no tiene permiso para esto (workspace o restricciones de la organización): ${mensaje}`;
    case 404:
      return `El modelo no está disponible para esta cuenta: ${mensaje}`;
    case 429:
      return `Límite de uso o de velocidad de la cuenta: esperá un momento o revisá los límites en platform.claude.com (${mensaje}).`;
    case 400:
      return `Pedido rechazado: ${mensaje} (si habla de saldo o créditos, es la facturación de la cuenta).`;
    default:
      return status >= 500
        ? `Anthropic con problemas o sobrecargado (HTTP ${status}): mirá status.anthropic.com y reintentá.`
        : `HTTP ${status}: ${mensaje}`;
  }
}

/** ¿Una lectura de `segundos` entra en el límite del bot? */
export function veredictoTiempo(segundos: number, limite = LIMITE_BOT_SEGUNDOS): { ok: boolean; texto: string } {
  if (segundos >= limite) {
    return { ok: false, texto: `tardó ${Math.round(segundos)} s: el bot (límite ${limite} s) se cortaría.` };
  }
  return {
    ok: true,
    texto:
      segundos < limite / 2
        ? `tardó ${Math.round(segundos)} s: entra con margen en los ${limite} s del bot.`
        : `tardó ${Math.round(segundos)} s: entra en los ${limite} s del bot, pero justo.`,
  };
}

/** "Colesterol LDL: 131 mg/dL" (+ aviso si no se mapeó a un código del catálogo). */
export function lineaAnalito(a: AnalitoExtraido): string {
  const valor = a.valor ?? a.valorTexto ?? '—';
  return `${a.nombre}: ${valor}${a.unidad ? ` ${a.unidad}` : ''}${a.codigo ? '' : ' (sin código del catálogo)'}`;
}
