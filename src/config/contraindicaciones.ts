/**
 * Tabla de contraindicaciones — Segunda Opinión Médica.
 *
 * ⚠️ PENDIENTE de validación clínica. Las consultas de segunda opinión no tienen
 * las contraindicaciones de aparatología (HBOT/IHHT) del modelo anterior. Si el
 * equipo médico define contraindicaciones para las subespecialidades cardiológicas,
 * se cargan acá. Hoy queda vacía: no se inventan contraindicaciones clínicas.
 *
 * Uso (R-02): una contraindicación `absoluta` activa bloquea la confirmación del
 * turno sin autorización médica; una `relativa` genera advertencia. La recepción
 * solo ve la señal binaria del banner (verde/rojo), nunca el detalle clínico.
 */
import type { Contraindicacion } from '../domain/types.js';

export const CONTRAINDICACIONES: Contraindicacion[] = [];

export const CONTRAINDICACIONES_POR_CODIGO: ReadonlyMap<string, Contraindicacion> = new Map(
  CONTRAINDICACIONES.map((c) => [c.codigo, c]),
);
