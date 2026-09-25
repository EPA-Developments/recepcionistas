/**
 * Bot · Link de pago MercadoPago (seña).
 *
 * Crea una preferencia de checkout de MercadoPago por el monto de la seña (50%)
 * y devuelve el link para que el paciente pague. Requiere el secret
 * MERCADOPAGO_ACCESS_TOKEN en los Project Secrets; si no está, devuelve un aviso
 * claro (el flujo manual de seña sigue funcionando).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { APP_BASE_URL_DEFAULT, urlBase } from '../config/urls.js';
import { calcularSenaARS, type ItemCobro } from '../lib/pricing.js';
import { EXT } from '../fhir/identifiers.js';
import { esIncluidoEnPlan, leerTcVigente, MENSAJE_SIN_SENA } from './_shared.js';

export interface EntradaLinkMP {
  appointmentId: string;
  tc?: number;
}

export interface ResultadoLinkMP {
  ok: boolean;
  mensaje?: string;
  senaARS?: number;
  url?: string;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaLinkMP>): Promise<ResultadoLinkMP> {
  const appt = await medplum.readResource('Appointment', event.input.appointmentId);
  const itemTipo = appt.extension?.find((e) => e.url === EXT.itemTipo)?.valueCode;
  const itemCodigo = appt.extension?.find((e) => e.url === EXT.itemCodigo)?.valueString;
  if (!itemTipo || !itemCodigo) {
    return { ok: false, mensaje: 'El turno no tiene ítem asociado para calcular la seña.' };
  }
  if (esIncluidoEnPlan(itemCodigo)) {
    return { ok: false, mensaje: MENSAJE_SIN_SENA };
  }

  const tc = event.input.tc ?? (await leerTcVigente(medplum));
  const { senaARS } = calcularSenaARS([{ tipo: itemTipo as ItemCobro['tipo'], codigo: itemCodigo }], { tc });

  const token = event.secrets['MERCADOPAGO_ACCESS_TOKEN']?.valueString;
  if (!token) {
    return {
      ok: false,
      senaARS,
      mensaje: 'MercadoPago no está configurado (falta MERCADOPAGO_ACCESS_TOKEN en Project Secrets).',
    };
  }

  const appUrl = urlBase(event.secrets['APP_BASE_URL']?.valueString, APP_BASE_URL_DEFAULT);
  const notifUrl = event.secrets['MP_WEBHOOK_URL']?.valueString;

  const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `sena-${event.input.appointmentId}`,
    },
    body: JSON.stringify({
      items: [
        {
          title: `Seña 50% · ${appt.description ?? itemCodigo}`,
          quantity: 1,
          unit_price: senaARS,
          currency_id: 'ARS',
        },
      ],
      external_reference: event.input.appointmentId,
      metadata: { appointmentId: event.input.appointmentId },
      back_urls: { success: appUrl, pending: appUrl, failure: appUrl },
      auto_return: 'approved',
      ...(notifUrl ? { notification_url: notifUrl } : {}),
    }),
  });

  if (!resp.ok) {
    const detalle = await resp.text().catch(() => '');
    return { ok: false, senaARS, mensaje: `MercadoPago respondió ${resp.status}: ${detalle.slice(0, 400)}` };
  }
  const pref = (await resp.json()) as { init_point?: string; sandbox_init_point?: string };
  const url = pref.init_point ?? pref.sandbox_init_point;
  if (!url) {
    return { ok: false, senaARS, mensaje: 'MercadoPago no devolvió un link de pago (init_point).' };
  }
  return { ok: true, senaARS, url };
}
