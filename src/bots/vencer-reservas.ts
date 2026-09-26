/**
 * Bot · Vencer reservas del portal (cron) — R-23.
 *
 * Cancela los turnos tentativos del portal cuya retención venció sin seña y libera sus
 * franjas (vuelven a `free`). Solo toca turnos `pending` con `reserva-expira` vencida:
 * los tentativos de Recepción (sin vencimiento) y los del portal sin link de pago no se
 * tocan. Escritura condicional (`If-Match`): si el webhook de MercadoPago confirmó el turno
 * en el medio, no lo pisa. Avisa a la paciente por WhatsApp que el horario se liberó.
 *
 * Pensado para un `cronTimer` cada pocos minutos (p. ej. cada 5).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment } from '@medplum/fhirtypes';
import { avisoReservaVencida } from '../lib/avisos.js';
import { reservaVencida } from '../lib/reserva-portal.js';
import { enviarWhatsApp, liberarFranjas } from './_shared.js';

export interface EntradaVencerReservas {
  /** Fecha de referencia ISO (default: ahora). Útil para pruebas/reprocesos. */
  ahora?: string;
}

export interface ResultadoVencerReservas {
  /** Turnos tentativos revisados. */
  revisados: number;
  /** Cancelados por vencimiento en esta corrida (franjas liberadas). */
  vencidos: number;
  /** Vencidos que no se pudieron cancelar (alguien los cambió en el medio): se reintentan en la próxima. */
  omitidos: number;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaVencerReservas>): Promise<ResultadoVencerReservas> {
  const ahora = event.input?.ahora ? new Date(event.input.ahora) : new Date();
  const pendientes = await medplum.searchResources('Appointment', 'status=pending&_count=200');
  let vencidos = 0;
  let omitidos = 0;

  for (const appt of pendientes) {
    if (!reservaVencida(appt, ahora)) {
      continue;
    }
    try {
      await medplum.updateResource<Appointment>(
        { ...appt, status: 'cancelled', cancelationReason: { text: 'Venció la retención sin seña (reserva del portal, R-23).' } },
        appt.meta?.versionId ? { headers: { 'If-Match': `W/"${appt.meta.versionId}"` } } : undefined,
      );
    } catch {
      omitidos++;
      continue;
    }
    await liberarFranjas(medplum, appt.slot);
    const pacienteRef = appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
    if (pacienteRef && appt.start) {
      await enviarWhatsApp(medplum, event.secrets, {
        template: 'reserva-vencida',
        pacienteRef,
        about: `Appointment/${appt.id}`,
        body: avisoReservaVencida({ nombre: appt.description ?? 'turno', inicio: new Date(appt.start) }),
      });
    }
    vencidos++;
  }

  return { revisados: pendientes.length, vencidos, omitidos };
}
