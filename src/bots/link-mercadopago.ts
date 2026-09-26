/**
 * Bot · Link de pago MercadoPago (seña).
 *
 * Crea una preferencia de Checkout Pro por el monto de la seña (50%) y devuelve el
 * link para que el paciente pague. Requiere el Project Secret MERCADOPAGO_ACCESS_TOKEN:
 * el **Access Token** de producción de la cuenta de SOM (no la Public Key).
 *
 * Antes de llamar a MercadoPago valida la credencial (su formato) y el monto: no hay
 * link por $0 (con los precios PENDIENTES la seña es 0). Si MercadoPago rechaza la
 * credencial (401, o 403 "PolicyAgent" / PA_UNAUTHORIZED_RESULT_FROM_POLICIES), lee
 * la cuenta (`GET /users/me`) y devuelve qué corregir. Nunca devuelve el token.
 *
 * Con `{ diagnosticar: true }` no crea nada: revisa la credencial y la cuenta
 * (`npm run mercadopago:test`). El flujo manual de seña sigue funcionando siempre.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { APP_BASE_URL_DEFAULT, urlBase } from '../config/urls.js';
import { calcularSenaARS, type ItemCobro } from '../lib/pricing.js';
import {
  armarPreferenciaSena,
  bloqueaCredencialMP,
  diagnosticarCuentaMP,
  explicarErrorMP,
  limpiarTokenMP,
  mensajeConCuenta,
  problemaCredencialMP,
  problemaMontoSena,
  resumenCredencial,
  resumenErrorMP,
  tipoCredencialMP,
  type CuentaMP,
  type DiagnosticoCuentaMP,
  type TipoCredencialMP,
} from '../lib/mercadopago.js';
import { EXT } from '../fhir/identifiers.js';
import { esIncluidoEnPlan, leerTcVigente, MENSAJE_SIN_SENA } from './_shared.js';

const API_MP = 'https://api.mercadopago.com';

export interface EntradaLinkMP {
  appointmentId?: string;
  tc?: number;
  /** Solo revisar la credencial y la cuenta de MercadoPago (no crea nada). */
  diagnosticar?: boolean;
}

export interface ResultadoLinkMP {
  ok: boolean;
  mensaje?: string;
  senaARS?: number;
  url?: string;
  /** Qué credencial hay cargada (nunca el token). */
  credencial?: TipoCredencialMP;
  /** Lo que se vio en la cuenta de MercadoPago (diagnóstico). */
  cuenta?: DiagnosticoCuentaMP;
}

/** Lee la cuenta de la credencial (`GET /users/me`): de quién es y si puede cobrar. */
async function leerCuenta(token: string): Promise<DiagnosticoCuentaMP | { error: string }> {
  try {
    const resp = await fetch(`${API_MP}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      return { error: resumenErrorMP(resp.status, await resp.text().catch(() => '')) };
    }
    return diagnosticarCuentaMP((await resp.json()) as CuentaMP);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'sin respuesta' };
  }
}

/** Aviso previo si la credencial no tiene el formato de un Access Token (se prueba igual). */
function avisoFormato(credencial: TipoCredencialMP): string {
  return credencial === 'desconocida' ? `${problemaCredencialMP(credencial)} ` : '';
}

async function diagnosticar(token: string, credencial: TipoCredencialMP): Promise<ResultadoLinkMP> {
  if (bloqueaCredencialMP(credencial)) {
    return { ok: false, credencial, mensaje: problemaCredencialMP(credencial) };
  }
  const cuenta = await leerCuenta(token);
  const ok = !('error' in cuenta) && cuenta.problemas.length === 0;
  return {
    ok,
    credencial,
    ...('error' in cuenta ? {} : { cuenta }),
    mensaje: `${avisoFormato(credencial)}${resumenCredencial(cuenta, credencial)}`,
  };
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaLinkMP>): Promise<ResultadoLinkMP> {
  const token = limpiarTokenMP(event.secrets['MERCADOPAGO_ACCESS_TOKEN']?.valueString);
  const credencial = tipoCredencialMP(token);
  if (event.input?.diagnosticar) {
    return diagnosticar(token, credencial);
  }

  const appointmentId = event.input?.appointmentId;
  if (!appointmentId) {
    return { ok: false, mensaje: 'Falta el turno (appointmentId).' };
  }
  const appt = await medplum.readResource('Appointment', appointmentId);
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

  // Sin credencial usable o con seña $0 no se llama a MercadoPago para crear el link.
  const problemaCredencial = bloqueaCredencialMP(credencial) ? problemaCredencialMP(credencial) : undefined;
  const problemaMonto = problemaMontoSena(senaARS);
  if (problemaCredencial || problemaMonto) {
    const partes = [problemaCredencial, problemaMonto].filter((p): p is string => Boolean(p));
    // Seña $0 con una credencial de formato válido: igual se verifica la cuenta, así se
    // ve si la credencial ya funciona aunque falten los precios.
    if (!problemaCredencial) {
      partes.push(`${avisoFormato(credencial)}${resumenCredencial(await leerCuenta(token), credencial)}`);
    }
    return { ok: false, senaARS, credencial, mensaje: partes.join(' ') };
  }

  const appUrl = urlBase(event.secrets['APP_BASE_URL']?.valueString, APP_BASE_URL_DEFAULT);
  const resp = await fetch(`${API_MP}/checkout/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `sena-${appointmentId}`,
    },
    body: JSON.stringify(
      armarPreferenciaSena({
        appointmentId,
        descripcion: appt.description ?? itemCodigo,
        senaARS,
        appUrl,
        notificationUrl: event.secrets['MP_WEBHOOK_URL']?.valueString,
      }),
    ),
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    const explicacion = explicarErrorMP(resp.status, texto, credencial);
    // Credencial rechazada: la cuenta dice qué falta.
    const mensaje =
      resp.status === 401 || resp.status === 403
        ? `${avisoFormato(credencial)}${mensajeConCuenta(explicacion, await leerCuenta(token))}`
        : explicacion;
    console.error(`som-link-mercadopago: MercadoPago respondió ${resp.status}: ${texto.slice(0, 300)}`);
    return { ok: false, senaARS, credencial, mensaje };
  }
  const pref = (await resp.json()) as { init_point?: string; sandbox_init_point?: string };
  const url = pref.init_point ?? pref.sandbox_init_point;
  if (!url) {
    return { ok: false, senaARS, credencial, mensaje: 'MercadoPago no devolvió un link de pago (init_point).' };
  }
  return { ok: true, senaARS, credencial, url };
}
