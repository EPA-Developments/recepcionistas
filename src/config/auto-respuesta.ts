/**
 * Respuestas automáticas de Mensajes por WhatsApp (se ven «🤖 Automática» en la bandeja).
 *
 * Textos aprobados por el Dr. D'Alessandro (26/09/2026). Cuándo sale cada una lo
 * decide `src/lib/auto-respuesta.ts`:
 *  - **Acuse:** cuando un WhatsApp abre una conversación nueva.
 *  - **Fuera de horario:** cuando llega un WhatsApp con el centro cerrado, una vez por
 *    cada período cerrado. El horario es el de la agenda (`config/horario.ts`, hoy
 *    provisorio): al cargar el real, el texto y el momento se ajustan solos.
 */

/** Acuse cuando un WhatsApp abre una conversación nueva. */
export const TEXTO_ACUSE =
  '¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. En breve te responde alguien de Recepción.';

/** Fuera del horario de atención; `horario` = "lunes a viernes de 8 a 22 y sábados de 8 a 20". */
export function textoFueraDeHorario(horario: string): string {
  return `¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. Ahora estamos fuera del horario de atención (${horario}). Te respondemos apenas abramos.`;
}

/** Quién firma las respuestas automáticas en la conversación (`Communication.sender.display`). */
export const REMITENTE_AUTOMATICO = 'Segunda Opinión Médica · respuesta automática';

/** Minutos antes del cierre de la ventana de 24 h de WhatsApp en que el aviso se pone naranja. */
export const VENTANA_AVISO_MINUTOS = 120;
