/**
 * Horario de atención del centro (genera las franjas reservables de cada sala).
 *
 * ⚠️ PROVISIONAL (heredado, sin confirmar para SOM): Lunes a Viernes 08:00–22:00,
 * Sábados 08:00–20:00, Domingo cerrado. Franja de 30 minutos. Se reemplaza con el
 * horario real de Segunda Opinión Médica (CABA) al armar el catálogo nuevo.
 *
 * `dia`: 0=domingo ... 6=sábado (Date.getDay()).
 */
export interface FranjaHoraria {
  /** Hora de apertura "HH:mm" (24h, hora de Argentina). */
  desde: string;
  /** Hora de cierre "HH:mm". */
  hasta: string;
}

export interface HorarioDia {
  dia: number;
  abierto: boolean;
  franjas: FranjaHoraria[];
}

/** Granularidad de los slots, en minutos (sesión mínima = 30 min). */
export const SLOT_GRANULARIDAD_MIN = 30;

/** Zona horaria del centro. */
export const TZ = 'America/Argentina/Buenos_Aires';

/** Horario provisional (ver arriba). */
export const HORARIO_SEMANAL: HorarioDia[] = [
  { dia: 0, abierto: false, franjas: [] }, // Domingo: cerrado
  { dia: 1, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] }, // Lunes
  { dia: 2, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] }, // Martes
  { dia: 3, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] }, // Miércoles
  { dia: 4, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] }, // Jueves
  { dia: 5, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] }, // Viernes
  { dia: 6, abierto: true, franjas: [{ desde: '08:00', hasta: '20:00' }] }, // Sábado
];

/** Marca para que el seed advierta si el horario sigue siendo el placeholder. */
export const HORARIO_ES_PLACEHOLDER = true;
