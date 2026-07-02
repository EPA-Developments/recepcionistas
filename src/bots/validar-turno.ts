/**
 * Bot · Validar turno.
 *
 * Corre el motor de reglas de agenda sobre un turno propuesto y devuelve el
 * resultado (bloqueos + advertencias). La recepción no decide: el sistema
 * valida capacidad de recursos y ventana de reserva (R-07, R-13).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { PerfilReserva } from '../config/reglas.js';
import {
  combinar,
  validarRecursos,
  validarVentanaReserva,
  type ResultadoValidacion,
  type ReservaRecurso,
} from '../lib/reglas-turno.js';

export interface EntradaValidacion {
  /** Reservas de recursos para validar capacidad — R-07. */
  reservas?: Array<{ recursoCodigo: string; inicio: string; fin: string }>;
  /** Ventana de reserva — R-13. */
  perfil?: PerfilReserva;
  ahora?: string;
  inicioTurno?: string;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function handler(
  _medplum: MedplumClient,
  event: BotEvent<EntradaValidacion>,
): Promise<ResultadoValidacion> {
  return validarEntrada(event.input);
}

/** Lógica pura del bot (separada para testear sin MedplumClient). */
export function validarEntrada(e: EntradaValidacion): ResultadoValidacion {
  const partes: ResultadoValidacion[] = [];

  if (e.reservas?.length) {
    const reservas: ReservaRecurso[] = e.reservas.map((r) => ({
      recursoCodigo: r.recursoCodigo,
      inicio: new Date(r.inicio),
      fin: new Date(r.fin),
    }));
    partes.push(validarRecursos(reservas));
  }

  if (e.perfil && e.ahora && e.inicioTurno) {
    partes.push(validarVentanaReserva(e.perfil, new Date(e.ahora), new Date(e.inicioTurno)));
  }

  return combinar(...partes);
}
