/**
 * Respuestas automáticas de Mensajes por WhatsApp (se ven «🤖 Automática» en la bandeja).
 *
 * Cuándo sale cada una lo decide `src/lib/auto-respuesta.ts`:
 *  - **Bienvenida:** el primer WhatsApp de un **número nuevo** (alguien que no estaba en
 *    SOM). Saluda y le pide nombre y apellido, e-mail y DNI (opcional) para darlo de alta
 *    como usuario registrado. Con el centro cerrado, sale con el horario al final (y vale
 *    como aviso de fuera de horario). Texto aprobado por el Dr. D'Alessandro el 03/10/2026.
 *  - **Acuse:** cuando un paciente que ya está en SOM abre una conversación nueva por
 *    WhatsApp.
 *  - **Fuera de horario:** cuando llega un WhatsApp con el centro cerrado, una vez por
 *    cada período cerrado. El horario es el de la agenda (`config/horario.ts`, hoy
 *    provisorio): al cargar el real, el texto y el momento se ajustan solos.
 * El acuse y el aviso de fuera de horario los aprobó el Dr. D'Alessandro el 26/09/2026.
 *
 * Cada texto es también el cuerpo de su plantilla de Meta (`config/plantillas-whatsapp.ts`):
 * una plantilla de Twilio no se edita, así que cambiar un texto pide una plantilla nueva.
 */

/** El saludo y el pedido de datos de la bienvenida (sin el cierre, que depende del horario). */
const BIENVENIDA =
  '¡Hola! 👋 Gracias por comunicarte con Segunda Opinión Médica.\n\n' +
  'Para darte de alta como usuario registrado y acompañarte mejor, ¿nos compartís estos datos?\n' +
  '• Nombre y apellido\n' +
  '• E-mail\n' +
  '• DNI (opcional)\n\n' +
  'Tus datos se tratan con total confidencialidad.';

/** Bienvenida al primer WhatsApp de un número nuevo, en horario de atención. */
export const TEXTO_BIENVENIDA = `${BIENVENIDA} En breve te responde alguien de nuestro equipo de Recepción. 💙`;

/** La bienvenida con el centro cerrado; `horario` = "lunes a viernes de 8 a 22 y sábados de 8 a 20". */
export function textoBienvenidaFueraDeHorario(horario: string): string {
  return `${BIENVENIDA} Ahora estamos fuera del horario de atención (${horario}): te respondemos apenas abramos. 💙`;
}

/** Acuse cuando un paciente que ya está en SOM abre una conversación nueva por WhatsApp. */
export const TEXTO_ACUSE =
  '¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. En breve te responde alguien de Recepción.';

/** Fuera del horario de atención; `horario` = "lunes a viernes de 8 a 22 y sábados de 8 a 20". */
export function textoFueraDeHorario(horario: string): string {
  return `¡Hola! Recibimos tu mensaje en Segunda Opinión Médica. Ahora estamos fuera del horario de atención (${horario}). Te respondemos apenas abramos.`;
}

/**
 * Aviso al paciente cuando Recepción responde con la ventana de 24 h de WhatsApp cerrada:
 * sale con su plantilla aprobada por Meta (`config/plantillas-whatsapp.ts`); la respuesta
 * en sí se reenvía por WhatsApp cuando el paciente contesta (mientras, la ve en el portal).
 */
export const TEXTO_MENSAJE_NUEVO =
  'Segunda Opinión Médica: Recepción te respondió en Mensajes. Podés leerlo en el portal o respondé este mensaje y te lo reenviamos por acá. 💙';

/** Quién firma las respuestas automáticas en la conversación (`Communication.sender.display`). */
export const REMITENTE_AUTOMATICO = 'Segunda Opinión Médica · respuesta automática';

/** Minutos antes del cierre de la ventana de 24 h de WhatsApp en que el aviso se pone naranja. */
export const VENTANA_AVISO_MINUTOS = 120;
