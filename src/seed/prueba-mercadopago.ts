/**
 * Prueba de punta a punta de MercadoPago con un turno real y un pago real.
 *
 *   npm run mercadopago:e2e                          → arma el turno de prueba, da el link y espera el pago
 *   npm run mercadopago:e2e -- --telefono +549…      → ídem, y el paciente de prueba recibe el WhatsApp
 *   npm run mercadopago:e2e -- --paciente Patient/…  → con un paciente que ya existe
 *   npm run mercadopago:e2e -- --modalidad teleconsulta → teleconsulta (el paciente tiene que
 *                                                    haber firmado su consentimiento, R-21)
 *   npm run mercadopago:e2e -- --turno <id>          → sigue esperando / verifica un turno ya armado
 *   npm run mercadopago:e2e -- --limpiar --turno <id> → cancela el turno de prueba (libera la franja)
 *   (--espera <min>: cuánto espera el pago; 15 por defecto)
 *
 * El circuito es el mismo que usa Recepción: `som-reservar-turno` (turno tentativo, la
 * primera franja libre de un profesional desde mañana; presencial por defecto, que no depende
 * del consentimiento de teleconsulta, o `--modalidad teleconsulta`) → `som-link-mercadopago`
 * (link de la seña) → **pagás** → MercadoPago avisa a la URL pública del webhook →
 * `som-webhook-mercadopago` verifica el pago y confirma el turno. El script espera a que el
 * turno pase a confirmado y verifica el Invoice (lo pagado, el id del pago) y el WhatsApp.
 *
 * Con la credencial de la cuenta real de SOM el pago es REAL (la seña de la consulta):
 * después, devolverlo desde el panel de MercadoPago (Actividad → el pago → Devolver). Con
 * la de un **usuario de prueba** de MercadoPago la prueba corre en **modo prueba**: el
 * circuito es el mismo, sin plata real, pagando con un comprador de prueba y una tarjeta
 * de prueba. En los dos casos, al final cancelar el turno con `--limpiar`. El script nunca
 * devuelve plata ni cobra nada por su cuenta.
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import type { Appointment, Communication, Invoice, Patient, Slot } from '@medplum/fhirtypes';
import type { Modalidad } from '../domain/types.js';
import { getServicio, ofreceModalidad, SERVICIOS_POR_CODIGO } from '../config/catalogo.js';
import { MEDICOS, type Medico } from '../config/medicos.js';
import { RUTA_WEBHOOK_MERCADOPAGO } from '../config/urls.js';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import { permiteModalidad } from '../lib/agenda-profesional.js';
import { problemasUrlPublica } from '../lib/webhooks.js';
import { aE164AR, estadoEntregaDe } from '../lib/whatsapp.js';
import type { ResultadoLinkMP } from '../bots/link-mercadopago.js';
import type { ResultadoReserva } from '../bots/reservar-turno.js';
import { conectarMedplum } from './conexion.js';
import { leerSecretos, valorSecreto } from './secretos.js';

const ID_PACIENTE_PRUEBA = { system: SYSTEM.demo, value: 'prueba-mercadopago' };
const META_DEMO = { tag: [{ system: SYSTEM.demo, code: 'demo' }] };

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function botId(medplum: MedplumClient, nombre: string): Promise<string> {
  const bot = await medplum.searchOne('Bot', `name:exact=${nombre}`);
  if (!bot?.id) {
    throw new Error(`No encontré el bot "${nombre}": npm run deploy:bots`);
  }
  return bot.id;
}

/** El paciente de la prueba: el indicado, o uno de prueba (tag demo: se borra solo a las 48 h). */
async function pacienteDePrueba(medplum: MedplumClient): Promise<string> {
  const indicado = arg('paciente');
  if (indicado) {
    const id = indicado.replace(/^Patient\//, '');
    await medplum.readResource('Patient', id);
    return `Patient/${id}`;
  }
  const telefono = arg('telefono') ? aE164AR(arg('telefono')) : undefined;
  if (arg('telefono') && !telefono) {
    throw new Error(`"${arg('telefono')}" no es un celular válido (usá +549…).`);
  }
  const telecom = telefono ? [{ system: 'phone' as const, use: 'mobile' as const, value: telefono }] : undefined;
  const existente = await medplum.searchOne('Patient', `identifier=${ID_PACIENTE_PRUEBA.system}|${ID_PACIENTE_PRUEBA.value}`);
  if (existente?.id) {
    if (telecom && existente.telecom?.[0]?.value !== telefono) {
      await medplum.updateResource<Patient>({ ...existente, telecom });
    }
    return `Patient/${existente.id}`;
  }
  const creado = await medplum.createResource<Patient>({
    resourceType: 'Patient',
    meta: META_DEMO,
    identifier: [ID_PACIENTE_PRUEBA],
    name: [{ given: ['Prueba'], family: 'MercadoPago', text: 'Prueba MercadoPago' }],
    ...(telecom ? { telecom } : {}),
  });
  return `Patient/${creado.id}`;
}

/**
 * Modalidad del turno de prueba. Presencial por defecto: el pago de la seña es el mismo y
 * no depende del consentimiento de teleconsulta (R-21), que el paciente firma en el portal.
 */
function modalidadPrueba(): Modalidad {
  const m = arg('modalidad') ?? 'presencial';
  if (m !== 'presencial' && m !== 'teleconsulta') {
    throw new Error(`--modalidad tiene que ser presencial o teleconsulta (no "${m}").`);
  }
  return m;
}

/** Una consulta con seña que el profesional atiende en esa modalidad. */
function consultaConSena(m: Medico, modalidad: Modalidad): string | undefined {
  if (modalidad === 'presencial' && !m.consultorioCodigo) {
    return undefined; // sin consultorio propio, lo presencial lo elige Recepción (R-22)
  }
  return m.servicios.find((c) => {
    const s = SERVICIOS_POR_CODIGO.get(c);
    return s && !s.incluidaEnPlan && ofreceModalidad(s, modalidad);
  });
}

interface Candidata {
  slot: Slot;
  medico: Medico;
  servicioCodigo: string;
}

/** Franjas libres de esa modalidad desde mañana, de los profesionales que la atienden (las primeras de cada uno). */
async function franjasLibres(medplum: MedplumClient, modalidad: Modalidad): Promise<Candidata[]> {
  const desde = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const candidatas: Candidata[] = [];
  for (const medico of MEDICOS) {
    const servicioCodigo = consultaConSena(medico, modalidad);
    if (!servicioCodigo || medico.disponibilidad.length === 0) {
      continue;
    }
    const schedule = await medplum.searchOne('Schedule', `identifier=${SYSTEM.medico}|SCH_${medico.codigo}`);
    if (!schedule?.id) {
      continue;
    }
    const slots = await medplum.searchResources(
      'Slot',
      `schedule=Schedule/${schedule.id}&status=free&start=ge${desde}&_sort=start&_count=100`,
    );
    for (const slot of slots.filter((s) => permiteModalidad(s, modalidad)).slice(0, 5)) {
      candidatas.push({ slot, medico, servicioCodigo });
    }
  }
  return candidatas.sort((x, y) => (x.slot.start ?? '').localeCompare(y.slot.start ?? ''));
}

/** Arma el turno tentativo: prueba franjas hasta que una se pueda reservar. Devuelve el id del turno. */
async function armar(medplum: MedplumClient): Promise<string | undefined> {
  const pacienteRef = await pacienteDePrueba(medplum);
  const modalidad = modalidadPrueba();
  console.log(`Paciente de la prueba: ${pacienteRef} · modalidad ${modalidad}`);

  const candidatas = await franjasLibres(medplum, modalidad);
  if (candidatas.length === 0) {
    console.error(`\n✗ No hay franjas libres (${modalidad}) desde mañana. Generá la agenda (bot som-generar-agenda) y volvé a correr.`);
    process.exitCode = 1;
    return undefined;
  }
  const reservar = await botId(medplum, 'som-reservar-turno');
  let ultimo = '';
  for (const { slot, medico, servicioCodigo } of candidatas) {
    const r = (await medplum.executeBot(reservar, {
      pacienteRef,
      servicioCodigo,
      slotId: slot.id,
      modalidad,
      origen: 'recepcion',
    })) as ResultadoReserva;
    if (r.creado && r.appointmentId) {
      console.log(`Franja: ${medico.nombre} · ${getServicio(servicioCodigo).nombre} · ${slot.start}`);
      console.log(`✓ Turno tentativo: Appointment/${r.appointmentId} (${r.descripcion ?? ''})`);
      return r.appointmentId;
    }
    ultimo = r.bloqueos?.map((b) => `${b.regla}: ${b.mensaje}`).join(' · ') || 'sin detalle';
    console.log(`  · ${medico.nombre} ${slot.start}: no se pudo (${ultimo}); pruebo otra franja.`);
    if (r.bloqueos?.some((b) => b.regla === 'R-21')) {
      break; // el consentimiento falta para cualquier franja de teleconsulta
    }
  }
  console.error(`\n✗ No se pudo reservar: ${ultimo}`);
  if (modalidad === 'teleconsulta') {
    console.error('  Sin el consentimiento de teleconsulta del paciente, probá presencial (sin --modalidad).');
  }
  process.exitCode = 1;
  return undefined;
}

/** El link de la seña del turno (idempotente: MercadoPago devuelve la misma preferencia). */
async function link(medplum: MedplumClient, appointmentId: string): Promise<ResultadoLinkMP> {
  return (await medplum.executeBot(await botId(medplum, 'som-link-mercadopago'), { appointmentId })) as ResultadoLinkMP;
}

/** Espera a que el webhook confirme el turno. */
async function esperarConfirmacion(medplum: MedplumClient, appointmentId: string, minutos: number): Promise<Appointment | undefined> {
  const hasta = Date.now() + minutos * 60_000;
  let aviso = 0;
  while (Date.now() < hasta) {
    const appt = await medplum.readResource('Appointment', appointmentId, { cache: 'no-cache' } as never);
    if (appt.status !== 'pending' && appt.status !== 'proposed') {
      return appt;
    }
    if (Date.now() - aviso > 60_000) {
      const faltan = Math.ceil((hasta - Date.now()) / 60_000);
      console.log(`  … esperando el pago (turno ${appt.status}; ${faltan} min más)`);
      aviso = Date.now();
    }
    await dormir(10_000);
  }
  return undefined;
}

async function verificar(medplum: MedplumClient, appt: Appointment): Promise<void> {
  // El Invoice y el WhatsApp se crean al confirmar el turno (su última modificación).
  const desde = new Date(Date.parse(appt.meta?.lastUpdated ?? new Date().toISOString()) - 10 * 60_000).toISOString();
  const pacienteRef = appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
  console.log(`\n✓ Turno ${appt.status === 'booked' ? 'CONFIRMADO' : appt.status} (Appointment/${appt.id}).`);
  if (!pacienteRef) {
    return;
  }
  const invoices = await medplum.searchResources('Invoice', `subject=${pacienteRef}&_lastUpdated=ge${desde}&_count=20`);
  const mp = invoices.filter((i: Invoice) => i.identifier?.some((x) => x.system === SYSTEM.invoice && x.value?.startsWith('mp-')));
  if (mp.length === 0) {
    console.error('  ✗ No encontré el Invoice del pago de MercadoPago.');
    process.exitCode = 1;
  }
  for (const i of mp) {
    const pago = i.identifier?.find((x) => x.value?.startsWith('mp-'))?.value?.slice(3);
    console.log(`  ✓ Invoice/${i.id}: $${i.totalGross?.value?.toLocaleString('es-AR')} ${i.totalGross?.currency ?? ''} · pago MercadoPago ${pago} · ${i.status}`);
  }
  const avisos = await medplum.searchResources('Communication', `subject=${pacienteRef}&_lastUpdated=ge${desde}&_count=20`);
  const confirmacion = avisos.find((c: Communication) =>
    c.extension?.some((x) => x.url === EXT.templateUsado && x.valueString === 'turno-confirmado'),
  );
  if (!confirmacion) {
    console.log('  · No encontré el WhatsApp de confirmación.');
  } else {
    const motivo = confirmacion.statusReason?.text;
    const explicacion =
      confirmacion.status === 'preparation' ? ' (no se mandó: el paciente no tiene celular o faltan secrets de Twilio)' : '';
    console.log(
      `  ✓ WhatsApp de confirmación: ${confirmacion.status}${explicacion}` +
        `${estadoEntregaDe(confirmacion) ? ` · entrega ${estadoEntregaDe(confirmacion)}` : ''}${motivo ? ` · ${motivo}` : ''}`,
    );
  }
}

async function limpiar(medplum: MedplumClient, appointmentId: string): Promise<void> {
  const appt = await medplum.readResource('Appointment', appointmentId);
  if (appt.status === 'cancelled') {
    console.log(`= El turno ${appointmentId} ya estaba cancelado.`);
    return;
  }
  await medplum.executeBot(await botId(medplum, 'som-estado-turno'), { appointmentId, estado: 'cancelled' });
  console.log(`✓ Turno ${appointmentId} cancelado (la franja quedó libre).`);
  console.log('  Si pagaste, devolvé el pago desde el panel de MercadoPago (Actividad → el pago → Devolver).');
}

async function main(): Promise<void> {
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl} (project ${projectId}).`);

  const turno = arg('turno');
  if (process.argv.includes('--limpiar')) {
    if (!turno) {
      throw new Error('Con --limpiar, indicá el turno: --turno <id>');
    }
    await limpiar(medplum, turno);
    return;
  }

  // Antes de reservar nada: credencial de MercadoPago y URL del webhook. Un usuario de
  // prueba (y nada más) no cobra de verdad, pero sirve para probar sin plata real.
  const diag = (await medplum.executeBot(await botId(medplum, 'som-link-mercadopago'), { diagnosticar: true })) as ResultadoLinkMP;
  // Modo prueba: una credencial de prueba (TEST-) de la aplicación, o la de un usuario de
  // prueba cuyo único "problema" es serlo. En los dos casos no se mueve plata real.
  const credencialDePrueba = diag.credencial === 'access-token-prueba';
  const modoPrueba = credencialDePrueba || (!diag.ok && diag.cuenta?.esPrueba === true && diag.cuenta.problemas.length === 1);
  if (!diag.ok && !modoPrueba) {
    console.error(`\n✗ MercadoPago no está listo: ${diag.mensaje ?? 'sin detalle'} (npm run mercadopago:test)`);
    process.exitCode = 1;
    return;
  }
  if (modoPrueba) {
    console.log(
      credencialDePrueba
        ? '✓ MercadoPago en MODO PRUEBA: credencial de prueba (TEST-) de la aplicación; el link es el del sandbox.\n' +
            '  El circuito es el mismo, pero no se mueve plata real.'
        : `✓ MercadoPago en MODO PRUEBA: la credencial es de un usuario de prueba (${diag.cuenta?.resumen}).\n` +
            '  El circuito es el mismo, pero no se mueve plata real.',
    );
  } else {
    console.log(`✓ MercadoPago: ${diag.mensaje ?? 'credencial OK'}`);
  }
  const webhook = valorSecreto(await leerSecretos(medplum, projectId), 'MP_WEBHOOK_URL');
  const problemas = problemasUrlPublica(webhook, { baseUrl, ruta: RUTA_WEBHOOK_MERCADOPAGO });
  if (problemas.length > 0) {
    console.error(`\n✗ MP_WEBHOOK_URL: ${problemas.join('; ')}. Sin el webhook, el pago no confirma el turno: npm run webhooks`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ Webhook: ${webhook}`);

  const appointmentId = turno ?? (await armar(medplum));
  if (!appointmentId) {
    return;
  }
  const actual = await medplum.readResource('Appointment', appointmentId);
  if (actual.status === 'pending' || actual.status === 'proposed') {
    const l = await link(medplum, appointmentId);
    if (!l.ok || !l.url) {
      console.error(`\n✗ Sin link de pago: ${l.mensaje ?? 'sin detalle'}`);
      console.error(`  Cancelá el turno de prueba: npm run mercadopago:e2e -- --limpiar --turno ${appointmentId}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      modoPrueba
        ? `\n→ Pagá la seña de $${l.senaARS?.toLocaleString('es-AR')} (MODO PRUEBA, sin plata real) en:\n\n    ${l.url}\n\n` +
            '  Abrilo en una ventana de incógnito y entrá con un COMPRADOR de prueba (otro usuario de prueba,\n' +
            '  no el vendedor: MercadoPago → Tus integraciones → Cuentas de prueba). Pagá con una tarjeta de\n' +
            '  prueba (Tus integraciones → Tarjetas de prueba) con titular APRO (= aprobado) y DNI 12345678.\n'
        : `\n→ Pagá la seña de $${l.senaARS?.toLocaleString('es-AR')} (pago REAL) en:\n\n    ${l.url}\n`,
    );
    const minutos = Number(arg('espera') ?? 15) || 15;
    const confirmado = await esperarConfirmacion(medplum, appointmentId, minutos);
    if (!confirmado) {
      console.error(
        `\n✗ En ${minutos} min el turno no se confirmó. Si ya pagaste: revisá en MercadoPago que el pago esté ` +
          'aprobado y que el webhook (Tus integraciones → Webhooks) tenga notificaciones entregadas; ' +
          `volvé a esperar con: npm run mercadopago:e2e -- --turno ${appointmentId}`,
      );
      process.exitCode = 1;
      return;
    }
    await verificar(medplum, confirmado);
  } else {
    await verificar(medplum, actual);
  }
  console.log(
    '\nPara terminar la prueba:\n' +
      (modoPrueba ? '' : '  · Devolvé el pago desde el panel de MercadoPago (Actividad → el pago → Devolver).\n') +
      `  · npm run mercadopago:e2e -- --limpiar --turno ${appointmentId}`,
  );
}

main().catch((err) => {
  console.error('Prueba de MercadoPago falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
