/**
 * Plantillas de WhatsApp (Meta) de Segunda Opinión Médica.
 *
 * WhatsApp solo deja que el negocio escriba primero —o pasadas 24 h del último mensaje del
 * paciente— con una **plantilla aprobada por Meta**; con texto libre, Twilio lo rechaza
 * (error 63016). Cada plantilla se crea en la cuenta de Twilio de SOM (Content API) y se
 * manda a aprobación con `npm run whatsapp:plantillas -- --aplicar`; aprobada, su
 * `ContentSid` (HX…) queda en el Project Secret indicado y los bots la usan solos. Sin ese
 * secret, los avisos salen como texto libre (llegan solo dentro de la ventana de 24 h).
 *
 * `aviso` es la **genérica**: el texto fijo envuelve el aviso que ya arma `lib/avisos.ts`
 * (confirmación, recordatorios, reservas, avisos a Recepción…), así que no hay copy nuevo
 * más que el cierre. Meta no admite que el cuerpo empiece ni termine con una variable.
 * Plantillas específicas por aviso (con sus variables) se suman acá cuando se aprueben los
 * textos.
 */
export interface PlantillaWhatsApp {
  /** Clave interna. */
  clave: string;
  /** Nombre en Twilio y Meta: minúsculas, números y guiones bajos. */
  nombre: string;
  categoria: 'UTILITY';
  /** Código de idioma de Meta. */
  idioma: string;
  /** Texto con variables {{1}}, {{2}}…; no puede empezar ni terminar con una. */
  cuerpo: string;
  /** Un ejemplo por variable: Meta lo pide para aprobarla. */
  ejemplo: Record<string, string>;
  /** Project Secret con el ContentSid (HX…) una vez aprobada. */
  secret: string;
}

export const PLANTILLA_AVISO: PlantillaWhatsApp = {
  clave: 'aviso',
  nombre: 'som_aviso',
  categoria: 'UTILITY',
  idioma: 'es_AR',
  cuerpo: 'Segunda Opinión Médica: {{1}} Si tenés dudas, respondé este mensaje. 💙',
  ejemplo: {
    '1': '¡tu turno quedó confirmado! Consulta de Cardiología el lunes 28/09 a las 10:00. Recibimos la seña de $75.000. ¡Te esperamos!',
  },
  secret: 'TWILIO_CONTENT_SID_AVISO',
};

export const PLANTILLAS_WHATSAPP: readonly PlantillaWhatsApp[] = [PLANTILLA_AVISO];
