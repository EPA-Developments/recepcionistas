/**
 * Constantes de reglas de negocio (motor de reglas).
 * Centralizadas para que el pricing engine, la validación de turnos y los tests
 * compartan exactamente los mismos valores. Cada constante referencia su regla R-xx.
 */

/** Ventanas máximas de anticipación para reservar, en horas (R-13). */
export const VENTANA_RESERVA_HORAS = {
  PUBLICO: 48,
} as const;

export type PerfilReserva = keyof typeof VENTANA_RESERVA_HORAS;

/** Cancelación / reagenda (R-14). */
export const CANCELACION = {
  /** Cancelar/reagendar con menos de estas horas => sesión consumida. */
  minHoras: 24,
} as const;

/**
 * Recordatorios automáticos de turnos confirmados (cron + WhatsApp).
 * Se avisa a las 48 h y a las 2 h del turno. El orden importa: de mayor a menor
 * antelación (el motor elige el más urgente que aún no se envió).
 */
export const RECORDATORIO_HORAS = [48, 2] as const;

/**
 * Ventana para agendar cada control del programa GLP-1 (R-19). PROVISIONAL: a
 * validar por el equipo médico. Un control se agenda desde su semana calculada y
 * hasta estos días después (nunca antes: la revisión de respuesta solo es
 * interpretable desde esa semana); el basal, en los días previos al inicio.
 */
export const VENTANA_CONTROL_GLP1_DIAS = 7;
