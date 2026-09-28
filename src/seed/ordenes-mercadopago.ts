/**
 * Pagos de MercadoPago de SOM: lo que registró MercadoPago, cruzado con Medplum.
 *
 *   npm run mercadopago:ordenes                       → los últimos pagos (30 días)
 *   npm run mercadopago:ordenes -- --dias 7 --limite 50
 *   npm run mercadopago:ordenes -- --turno <id>       → los pagos de un turno (external_reference)
 *   npm run mercadopago:ordenes -- --pago <id>        → el detalle de un pago + "Calidad de integración"
 *
 * Por cada pago: estado en palabras, monto, turno y si el webhook lo aplicó en Medplum
 * (Invoice `mp-<id>` y turno confirmado). Con `--pago`, además, lo que mira "Calidad de
 * integración" de MercadoPago (descripción, código y categoría del ítem, webhook…) y si llegó
 * en ese pago. Solo lee: no cobra, no devuelve ni cambia nada.
 *
 * El Access Token sale del Project Secret MERCADOPAGO_ACCESS_TOKEN (lectura de admin), se
 * usa en memoria y nunca se imprime; el email del comprador se muestra enmascarado.
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import { SYSTEM } from '../fhir/identifiers.js';
import {
  camposCalidadPago,
  diagnosticarCuentaMP,
  enmascararEmail,
  estadoPagoEnPalabras,
  limpiarTokenMP,
  problemaCredencialMP,
  resumenErrorMP,
  tipoCredencialMP,
  bloqueaCredencialMP,
  type CuentaMP,
  type PagoMPDetalle,
} from '../lib/mercadopago.js';
import { fechaHoraAR } from '../lib/whatsapp.js';
import { conectarMedplum } from './conexion.js';
import { leerSecretos, valorSecreto } from './secretos.js';

const API_MP = 'https://api.mercadopago.com';

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function mp<T>(token: string, ruta: string): Promise<T> {
  const resp = await fetch(`${API_MP}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await resp.text();
  if (!resp.ok) {
    throw new Error(`MercadoPago respondió ${resumenErrorMP(resp.status, texto)}`);
  }
  return JSON.parse(texto) as T;
}

function pesos(n: number | undefined, moneda?: string): string {
  return n === undefined ? '¿monto?' : `$${n.toLocaleString('es-AR')}${moneda && moneda !== 'ARS' ? ` ${moneda}` : ''}`;
}

function fecha(iso: string | undefined): string {
  return fechaHoraAR(iso) || '¿fecha?';
}

/** ¿El webhook aplicó el pago en Medplum? (Invoice `mp-<id>` y estado del turno.) */
async function enMedplum(medplum: MedplumClient, p: PagoMPDetalle): Promise<string> {
  const invoice = await medplum.searchOne('Invoice', `identifier=${SYSTEM.invoice}|mp-${p.id}`);
  let turno = '';
  if (p.external_reference) {
    const appt = await medplum.readResource('Appointment', p.external_reference).catch(() => undefined);
    turno = appt ? ` · turno ${appt.status}` : ' · la referencia no es un turno de SOM';
  }
  if (invoice?.id) {
    return `✓ aplicado (Invoice/${invoice.id})${turno}`;
  }
  if (p.status === 'approved') {
    return `✗ aprobado pero SIN Invoice: el webhook no lo aplicó${turno}`;
  }
  return `— sin aplicar (no está aprobado)${turno}`;
}

async function listar(medplum: MedplumClient, token: string): Promise<void> {
  const dias = Number(arg('dias') ?? 30) || 30;
  const limite = Math.min(Number(arg('limite') ?? 20) || 20, 100);
  const turno = arg('turno');
  const params = new URLSearchParams({
    sort: 'date_created',
    criteria: 'desc',
    limit: String(limite),
    range: 'date_created',
    begin_date: `NOW-${dias}DAYS`,
    end_date: 'NOW',
    ...(turno ? { external_reference: turno } : {}),
  });
  const r = await mp<{ results?: PagoMPDetalle[]; paging?: { total?: number } }>(token, `/v1/payments/search?${params}`);
  const pagos = r.results ?? [];
  console.log(
    `\nPagos ${turno ? `del turno ${turno}` : `de los últimos ${dias} días`}: ${pagos.length}` +
      `${r.paging?.total && r.paging.total > pagos.length ? ` (de ${r.paging.total}; --limite para ver más)` : ''}`,
  );
  for (const p of pagos) {
    console.log(
      `\n  ${p.id} · ${fecha(p.date_created)} · ${estadoPagoEnPalabras(p.status, p.status_detail)}` +
        `${p.live_mode === false ? ' · PRUEBA' : ''}\n` +
        `    ${pesos(p.transaction_amount, p.currency_id)} · ${p.payment_method_id ?? '¿medio?'}` +
        `${enmascararEmail(p.payer?.email) ? ` · ${enmascararEmail(p.payer?.email)}` : ''}` +
        ` · turno ${p.external_reference ?? '(sin referencia)'}` +
        `${p.order?.id ? ` · Order ID ${p.order.id}` : ''}\n` +
        `    Medplum: ${await enMedplum(medplum, p)}`,
    );
  }
  if (pagos.length > 0) {
    console.log('\nDetalle y "Calidad de integración" de un pago: npm run mercadopago:ordenes -- --pago <id>');
  }
}

/**
 * La aplicación de MercadoPago que creó el pago: el `client_id` de su preferencia (o el
 * `application_id` de su orden). "Calidad de integración" solo mide pagos de SU aplicación.
 */
async function aplicacionDelPago(token: string, p: PagoMPDetalle): Promise<string | undefined> {
  if (!p.order?.id) {
    return undefined;
  }
  const orden = await mp<{ application_id?: string | number; preference_id?: string }>(token, `/merchant_orders/${p.order.id}`).catch(
    () => undefined,
  );
  const pref = orden?.preference_id
    ? await mp<{ client_id?: string | number }>(token, `/checkout/preferences/${encodeURIComponent(orden.preference_id)}`).catch(
        () => undefined,
      )
    : undefined;
  const app = pref?.client_id ?? orden?.application_id;
  return app === undefined || app === null ? undefined : String(app);
}

async function detalle(medplum: MedplumClient, token: string, id: string): Promise<void> {
  const p = await mp<PagoMPDetalle>(token, `/v1/payments/${encodeURIComponent(id)}`);
  const item = p.additional_info?.items?.[0];
  const app = await aplicacionDelPago(token, p);
  console.log(
    `\nPago ${p.id}${p.live_mode === false ? ' (PRUEBA)' : ''}\n` +
      `  Estado:   ${estadoPagoEnPalabras(p.status, p.status_detail)}\n` +
      `  Monto:    ${pesos(p.transaction_amount, p.currency_id)} · ${p.payment_type_id ?? '?'} / ${p.payment_method_id ?? '?'}\n` +
      `  Creado:   ${fecha(p.date_created)}${p.date_approved ? ` · aprobado ${fecha(p.date_approved)}` : ''}\n` +
      `  Turno:    ${p.external_reference ?? '(sin external_reference)'}\n` +
      `  Order ID: ${p.order?.id ?? '(sin orden)'}${p.order?.id ? `  ← el que pide "Calidad de integración" (${p.order.type ?? 'orden'})` : ''}\n` +
      `  Vendedor: cuenta ${p.collector_id ?? '?'}\n` +
      `  Aplicación: ${app ?? '(no se pudo leer)'}  ← "Calidad de integración" solo acepta pagos de la aplicación\n` +
      '              del panel donde medís (el número en la URL: /developers/panel/app/<número>)\n' +
      `  Ítem:     ${item?.title ?? '(sin ítem)'}\n` +
      `  Comprador: ${enmascararEmail(p.payer?.email) ?? '(sin email)'}\n` +
      `  Medplum:  ${await enMedplum(medplum, p)}`,
  );
  console.log('\nLo que mira "Calidad de integración" (y si llegó en este pago):');
  for (const c of camposCalidadPago(p)) {
    console.log(`  ${c.presente ? '✓' : '✗'} ${c.campo}${c.nota ? `  — ${c.nota}` : ''}`);
  }
  console.log(
    '\n  Los campos del ítem salen de la preferencia: un pago hecho antes de agregarlos no los tiene.\n' +
      '  MercadoPago recalcula la calidad con el último pago (Tus integraciones → Calidad de integración).',
  );
}

async function main(): Promise<void> {
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl} (project ${projectId}).`);

  const token = limpiarTokenMP(valorSecreto(await leerSecretos(medplum, projectId), 'MERCADOPAGO_ACCESS_TOKEN'));
  const credencial = tipoCredencialMP(token);
  if (bloqueaCredencialMP(credencial)) {
    console.error(`\n✗ ${problemaCredencialMP(credencial) ?? 'Falta MERCADOPAGO_ACCESS_TOKEN.'}`);
    process.exitCode = 1;
    return;
  }
  const cuenta = diagnosticarCuentaMP(await mp<CuentaMP>(token, '/users/me'));
  console.log(`Cuenta de MercadoPago: ${cuenta.resumen}${cuenta.esPrueba ? ' · USUARIO DE PRUEBA (sin plata real)' : ''}`);

  const pago = arg('pago');
  await (pago ? detalle(medplum, token, pago) : listar(medplum, token));
}

main().catch((err) => {
  console.error('Pagos de MercadoPago: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
