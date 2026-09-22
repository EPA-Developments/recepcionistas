/**
 * Helpers compartidos por los bots de agenda (acceden a FHIR; no son "lib pura").
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, Communication, Flag, Invoice } from '@medplum/fhirtypes';
import { CONFIG_TC_ID, EXT, SYSTEM } from '../fhir/identifiers.js';
import { resolverTC } from '../config/tipo-cambio.js';
import { calcularSenaARS, type ItemCobro } from '../lib/pricing.js';
import type { ReservaRecurso } from '../lib/reglas-turno.js';

type Secrets = BotEvent['secrets'];

/** Meta de datos de demostración (tag `demo`); se autodestruyen a las 48 h. */
export const META_DEMO = { tag: [{ system: SYSTEM.demo, code: 'demo' }] };

/** Tipos demo, en orden de borrado: hijos antes que padres (evita refs colgadas). */
const TIPOS_DEMO = ['Communication', 'Invoice', 'Coverage', 'Flag', 'Appointment', 'Slot', 'Patient'] as const;

export interface ResultadoBorradoDemo {
  borrados: number;
  porTipo: Record<string, number>;
}

/**
 * Borra recursos etiquetados `demo`. Si se pasa `antesDe` (ISO), borra solo los
 * más viejos que esa fecha (`_lastUpdated < antesDe`) — así el cron elimina los
 * que ya cumplieron 48 h. Sin `antesDe`, borra TODOS los demo. Nunca toca datos
 * sin el tag demo.
 */
export async function borrarRecursosDemo(
  medplum: MedplumClient,
  opts: { antesDe?: string } = {},
): Promise<ResultadoBorradoDemo> {
  const porTipo: Record<string, number> = {};
  let borrados = 0;
  for (const tipo of TIPOS_DEMO) {
    let query = `_tag=${SYSTEM.demo}|demo&_count=1000`;
    if (opts.antesDe) {
      query += `&_lastUpdated=lt${opts.antesDe}`;
    }
    const recursos = await medplum.searchResources(tipo, query);
    for (const r of recursos) {
      if (!r.id) {
        continue;
      }
      try {
        await medplum.deleteResource(tipo, r.id);
        porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;
        borrados++;
      } catch {
        // referenciado o ya borrado: seguir
      }
    }
  }
  return { borrados, porTipo };
}

/** Project id del proyecto Medplum (vía el recurso Basic de configuración). */
export async function resolverProjectId(medplum: MedplumClient): Promise<string> {
  const fromProfile = medplum.getProfile()?.meta?.project;
  if (fromProfile) {
    return fromProfile;
  }
  const basic = await medplum.searchOne('Basic', `identifier=${CONFIG_TC_ID}`);
  if (basic?.meta?.project) {
    return basic.meta.project;
  }
  throw new Error('No pude determinar el projectId del proyecto Medplum.');
}

/** TC vigente: del recurso Basic de configuración; si no hay, el default. */
export async function leerTcVigente(medplum: MedplumClient): Promise<number> {
  try {
    const basic = await medplum.searchOne('Basic', `identifier=${CONFIG_TC_ID}`);
    const ext = basic?.extension?.find((e) => e.url === EXT.tcAplicado);
    if (ext?.valueDecimal && ext.valueDecimal > 0) {
      return ext.valueDecimal;
    }
  } catch {
    // sin servidor / sin recurso
  }
  return resolverTC();
}

/**
 * Envía un WhatsApp por Twilio y registra la Communication. Resuelve el teléfono
 * desde el paciente si no se pasa `to`. Si faltan credenciales o teléfono, NO
 * envía pero igual deja la Communication (estado 'preparation'). Los secretos de
 * Twilio se leen de event.secrets (Project Secrets de Medplum).
 */
export async function enviarWhatsApp(
  medplum: MedplumClient,
  secrets: Secrets,
  params: {
    template: string;
    body: string;
    pacienteRef?: string;
    to?: string;
    identifier?: { system: string; value: string };
    about?: string;
  },
): Promise<Communication> {
  let to = params.to;
  if (!to && params.pacienteRef) {
    const id = params.pacienteRef.split('/')[1];
    if (id) {
      const p = await medplum.readResource('Patient', id).catch(() => undefined);
      to = p?.telecom?.find((t) => t.system === 'phone' || t.system === 'sms')?.value;
    }
  }

  const sid = secrets['TWILIO_ACCOUNT_SID']?.valueString;
  const token = secrets['TWILIO_AUTH_TOKEN']?.valueString;
  const from = secrets['TWILIO_WHATSAPP_FROM']?.valueString;

  let status: Communication['status'] = 'preparation';
  if (to && sid && token && from) {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        To: `whatsapp:${to}`,
        Body: params.body,
      }),
    });
    status = resp.ok ? 'completed' : 'entered-in-error';
  }

  return medplum.createResource<Communication>({
    resourceType: 'Communication',
    status,
    sent: new Date().toISOString(),
    ...(params.identifier ? { identifier: [params.identifier] } : {}),
    ...(params.about ? { about: [{ reference: params.about }] } : {}),
    ...(params.pacienteRef
      ? { subject: { reference: params.pacienteRef }, recipient: [{ reference: params.pacienteRef }] }
      : {}),
    // payload solo si hay cuerpo: un payload sin content[x] es FHIR inválido.
    ...(params.body ? { payload: [{ contentString: params.body }] } : {}),
    extension: [
      { url: EXT.canal, valueCode: 'whatsapp' },
      // templateUsado solo si hay template: una extensión sin valor viola ext-1.
      ...(params.template ? [{ url: EXT.templateUsado, valueString: params.template }] : []),
    ],
  });
}

/**
 * Envía un email con `medplum.sendEmail()` (proveedor SES configurado en el
 * servidor) y registra la Communication (canal 'email'). Resuelve el email del
 * paciente si no se pasa `to`. Si no hay destinatario o SES falla, NO interrumpe:
 * igual deja la Communication ('preparation' / 'entered-in-error').
 */
export async function enviarEmail(
  medplum: MedplumClient,
  params: {
    asunto: string;
    cuerpo: string;
    template: string;
    pacienteRef?: string;
    to?: string;
    about?: string;
    /** Remitente con nombre visible (debe ser una identidad SES verificada). */
    from?: string;
  },
): Promise<Communication> {
  let to = params.to;
  if (!to && params.pacienteRef) {
    const id = params.pacienteRef.split('/')[1];
    if (id) {
      const p = await medplum.readResource('Patient', id).catch(() => undefined);
      to = p?.telecom?.find((t) => t.system === 'email')?.value;
    }
  }

  let status: Communication['status'] = 'preparation';
  if (to) {
    try {
      await medplum.sendEmail({
        to,
        subject: params.asunto,
        text: params.cuerpo,
        ...(params.from ? { from: params.from } : {}),
      });
      status = 'completed';
    } catch (err) {
      // Visible en CloudWatch (Lambda) para diagnosticar SES sin adivinar.
      console.error('enviarEmail: SES/medplum.sendEmail falló:', err instanceof Error ? err.message : err);
      status = 'entered-in-error';
    }
  } else {
    console.warn('enviarEmail: sin destinatario (el paciente no tiene email).');
  }

  return medplum.createResource<Communication>({
    resourceType: 'Communication',
    status,
    sent: new Date().toISOString(),
    ...(params.about ? { about: [{ reference: params.about }] } : {}),
    ...(params.pacienteRef
      ? { subject: { reference: params.pacienteRef }, recipient: [{ reference: params.pacienteRef }] }
      : {}),
    // payload solo si hay cuerpo: un payload sin content[x] es FHIR inválido.
    ...(params.cuerpo ? { payload: [{ contentString: params.cuerpo }] } : {}),
    extension: [
      { url: EXT.canal, valueCode: 'email' },
      // templateUsado solo si hay template: una extensión sin valor viola ext-1.
      ...(params.template ? [{ url: EXT.templateUsado, valueString: params.template }] : []),
    ],
  });
}

/** Códigos de contraindicación activos de un Flag. */
export function extraerCodigos(flag: Flag): string[] {
  return (flag.code?.coding ?? []).map((c) => c.code).filter((c): c is string => Boolean(c));
}

/** Id del Schedule de un recurso físico (por identifier SCH_<codigo>). */
export async function scheduleIdDeRecurso(medplum: MedplumClient, recursoCodigo: string): Promise<string | undefined> {
  const sch = await medplum.searchOne('Schedule', `identifier=${SYSTEM.recursoCodigo}|SCH_${recursoCodigo}`);
  return sch?.id;
}

/** Turnos ocupados del día (todos los recursos), para validar capacidad/desfasaje. */
export async function cargarReservasDelDia(medplum: MedplumClient, dia: Date): Promise<ReservaRecurso[]> {
  const inicioDia = new Date(dia);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(dia);
  finDia.setHours(23, 59, 59, 999);

  const ocupados = await medplum.searchResources('Slot', {
    status: 'busy',
    start: `ge${inicioDia.toISOString()}`,
    _count: 500,
  });

  const reservas: ReservaRecurso[] = [];
  for (const s of ocupados) {
    const codigo = s.extension?.find((x) => x.url === EXT.recursoFisico)?.valueString;
    if (!codigo || !s.start || !s.end || s.start > finDia.toISOString()) {
      continue;
    }
    reservas.push({ recursoCodigo: codigo, inicio: new Date(s.start), fin: new Date(s.end) });
  }
  return reservas;
}

export interface ResultadoConfirmacion {
  totalARS: number;
  senaARS: number;
  invoiceId?: string;
  confirmados: number;
  yaConfirmado: boolean;
}

/**
 * Confirma una reserva al cobrarse la seña (50%): emite el Invoice de la seña,
 * pasa el turno a 'booked' y dispara el WhatsApp de confirmación. Idempotente:
 * si ya existe el Invoice de esa seña (misma clave), no duplica ni reenvía.
 * La usan el cobro manual y el webhook de MP.
 */
export async function confirmarReserva(
  medplum: MedplumClient,
  secrets: Secrets,
  opts: { appointmentId: string; medioPago?: string; tc?: number; mpPaymentId?: string },
): Promise<ResultadoConfirmacion> {
  const appt = await medplum.readResource('Appointment', opts.appointmentId);
  const itemTipo = appt.extension?.find((e) => e.url === EXT.itemTipo)?.valueCode;
  const itemCodigo = appt.extension?.find((e) => e.url === EXT.itemCodigo)?.valueString;
  if (!itemTipo || !itemCodigo) {
    throw new Error('El turno no tiene ítem asociado para calcular la seña.');
  }

  const tc = opts.tc ?? (await leerTcVigente(medplum));
  const { totalARS, senaARS } = calcularSenaARS([{ tipo: itemTipo as ItemCobro['tipo'], codigo: itemCodigo }], { tc });

  // Idempotencia: una sola seña por clave (pago MP o turno).
  const invoiceKey = opts.mpPaymentId ? `mp-${opts.mpPaymentId}` : `sena-${opts.appointmentId}`;
  const existente = await medplum.searchOne('Invoice', `identifier=${SYSTEM.invoice}|${invoiceKey}`);
  if (existente) {
    return { totalARS, senaARS, invoiceId: existente.id, confirmados: 0, yaConfirmado: true };
  }

  let confirmados = 0;
  if (appt.status === 'pending' || appt.status === 'proposed') {
    await medplum.updateResource({ ...appt, status: 'booked' });
    confirmados++;
  }

  const pacienteRef = appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
  const invoice = await medplum.createResource<Invoice>({
    resourceType: 'Invoice',
    status: 'balanced',
    date: new Date().toISOString(),
    identifier: [{ system: SYSTEM.invoice, value: invoiceKey }],
    ...(pacienteRef ? { subject: { reference: pacienteRef } } : {}),
    lineItem: [
      {
        chargeItemCodeableConcept: { text: `Seña 50% · ${appt.description ?? itemCodigo}` },
        priceComponent: [{ type: 'base', amount: { value: senaARS, currency: 'ARS' } }],
      },
    ],
    totalGross: { value: senaARS, currency: 'ARS' },
    extension: [
      { url: EXT.esSena, valueBoolean: true },
      { url: EXT.tcAplicado, valueDecimal: tc },
      ...(opts.medioPago ? [{ url: EXT.medioPago, valueCode: opts.medioPago }] : []),
    ],
  });

  await enviarWhatsApp(medplum, secrets, {
    template: 'turno-confirmado',
    pacienteRef,
    body: `Segunda Opinión Médica: ¡tu turno quedó confirmado! ${appt.description ?? ''}. Recibimos la seña de $${senaARS.toLocaleString('es-AR')}. ¡Te esperamos! 💙`,
  });

  return { totalARS, senaARS, invoiceId: invoice.id, confirmados, yaConfirmado: false };
}
