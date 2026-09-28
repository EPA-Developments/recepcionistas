/**
 * Bot · Pagar la seña de la teleconsulta (portal de la paciente) — R-23.
 *
 * La paciente reservó una teleconsulta con cargo desde el portal (tentativa, con la franja
 * retenida) y quiere volver a abrir el pago (p. ej. cerró MercadoPago). Si el turno es suyo
 * y la reserva no venció, devuelve el link de la seña guardado en el turno
 * (`link-pago-sena`); si no hay, lo genera con `som-link-mercadopago` y lo guarda. El pago
 * lo confirma, como siempre, el webhook de MercadoPago (`som-webhook-mercadopago`).
 *
 * Reemplaza, con el modelo de SOM, al bot de pago del módulo de teleconsulta de otro
 * proyecto: el portal de SOM solo ejecuta bots `som-*` de este proyecto.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment } from '@medplum/fhirtypes';
import { EXT } from '../fhir/identifiers.js';
import { evaluarPago, itemDelTurno, verificarTurnoDelPaciente } from '../lib/teleconsulta-portal.js';
import { esIncluidoEnPlan } from './_shared.js';
import { handler as linkMercadoPago } from './link-mercadopago.js';

export interface EntradaPagoTeleconsulta {
  appointmentId: string;
}

export interface ResultadoPagoTeleconsulta {
  ok: boolean;
  /** Link de MercadoPago (Checkout Pro) de la seña. */
  url?: string;
  senaARS?: number;
  /** Hasta cuándo se retiene el horario (ISO), si la reserva vence. */
  expira?: string;
  mensaje?: string;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaPagoTeleconsulta>): Promise<ResultadoPagoTeleconsulta> {
  const appointmentId = event.input?.appointmentId;
  if (!appointmentId) {
    return { ok: false, mensaje: 'Falta el turno.' };
  }
  const appt = await medplum.readResource('Appointment', appointmentId).catch(() => undefined);
  if (!appt) {
    return { ok: false, mensaje: 'No encontramos ese turno.' };
  }
  const v = verificarTurnoDelPaciente(appt, event.requester?.reference);
  if (!v.ok) {
    return { ok: false, mensaje: v.error };
  }

  const r = evaluarPago(appt, new Date(), esIncluidoEnPlan(itemDelTurno(appt)));
  if (!r.ok) {
    return { ok: false, mensaje: r.mensaje };
  }
  const expira = r.expira ? { expira: r.expira } : {};
  if (r.url) {
    return { ok: true, url: r.url, ...expira };
  }

  // Sin link guardado (MercadoPago no respondió al reservar): se intenta de nuevo.
  const link = await linkMercadoPago(medplum, { ...event, input: { appointmentId } }).catch(() => undefined);
  if (!link?.ok || !link.url) {
    console.error(`som-teleconsulta-pago: sin link para Appointment/${appointmentId}: ${link?.mensaje ?? 'sin respuesta'}`);
    return { ok: false, mensaje: 'No pudimos abrir el pago. Recepción te contacta para cobrar la seña.' };
  }
  await medplum.updateResource<Appointment>({
    ...appt,
    extension: [...(appt.extension ?? []).filter((x) => x.url !== EXT.linkPagoSena), { url: EXT.linkPagoSena, valueUrl: link.url }],
  });
  return { ok: true, url: link.url, ...(link.senaARS !== undefined ? { senaARS: link.senaARS } : {}), ...expira };
}
