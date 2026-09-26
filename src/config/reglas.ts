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

/**
 * Reserva desde el portal de la paciente (R-23): el turno con cargo queda tentativo y
 * la franja retenida estos minutos hasta que se pague la seña; vencido el plazo, el cron
 * lo cancela y libera la franja. Decidido el 26/09/2026.
 */
export const RETENCION_RESERVA_PORTAL_MIN = 30;

/**
 * Anticipación mínima para reservar desde el portal (R-23): un horario que empieza antes
 * de que venza la retención no se puede pagar a tiempo. PROVISIONAL: igual a la
 * retención; ver docs/decisiones-pendientes.md.
 */
export const ANTICIPACION_MINIMA_PORTAL_MIN = RETENCION_RESERVA_PORTAL_MIN;

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

/**
 * Consultas programadas del Plan Bienestar 100 Días® (R-20): la del día 50 y la final
 * se agendan dentro de ± estos días de su fecha (definido por el Dr. D'Alessandro y el
 * Dr. Barbagelata). Antes de la ventana: bloqueo; después: advertencia (como R-19).
 */
export const TOLERANCIA_CONSULTA_PB100D_DIAS = 7;

/**
 * Horario en que salen los avisos de los programas (se abrió la ventana de una
 * consulta, sigue sin agendar a mitad de ventana). El cron corre todo el día; estos
 * avisos no salen de noche. Hora de Argentina, [desde, hasta). PROVISIONAL.
 */
export const HORARIO_AVISOS_PROGRAMA = { desde: 9, hasta: 20 } as const;
