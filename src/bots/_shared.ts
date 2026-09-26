/**
 * Helpers compartidos por los bots de agenda (acceden a FHIR; no son "lib pura").
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, Communication, Extension, Flag, Identifier, Invoice, Slot } from '@medplum/fhirtypes';
import { CONFIG_TC_ID, EXT, LOINC_CONSENTIMIENTO, SYSTEM } from '../fhir/identifiers.js';
import { SERVICIOS_POR_CODIGO } from '../config/catalogo.js';
import { SLOT_GRANULARIDAD_MIN } from '../config/horario.js';
import { isoArgentina } from '../lib/slots.js';
import { NOMBRE_PLAN_BIENESTAR } from '../config/plan-bienestar.js';
import { resolverTC } from '../config/tipo-cambio.js';
import { avisoConfirmacion } from '../lib/avisos.js';
import { calcularSenaARS, type ItemCobro } from '../lib/pricing.js';
import type { ReservaRecurso } from '../lib/reglas-turno.js';
import { esConsentimientoTeleconsulta, modalidadDe, teleconsultaUrlDe } from '../lib/teleconsulta.js';
import {
  aE164AR,
  CATEGORIA_WHATSAPP,
  ETIQUETA_RESERVADO,
  estadoEntregaDeTwilio,
  explicarErrorTwilio,
  partirTexto,
  type EstadoEntrega,
} from '../lib/whatsapp.js';

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

/**
 * ¿El paciente firmó el consentimiento informado? Un `DocumentReference` suyo,
 * `status=current`, tipo LOINC 59284-0 (lo escribe el portal). Es precondición de
 * todo procesamiento clínico SOM: sin él no se crea la solicitud ni se envía nada
 * al LLM (contrato con el portal, `bot-som-interface.md`). El portal lo exige del
 * lado cliente, pero la verificación que vale es la del servidor.
 */
export async function tieneConsentimiento(medplum: MedplumClient, pacienteRef: string): Promise<boolean> {
  const doc = await medplum.searchOne(
    'DocumentReference',
    `subject=${pacienteRef}&type=http://loinc.org|${LOINC_CONSENTIMIENTO}&status=current`,
  );
  return Boolean(doc);
}

/**
 * ¿El paciente firmó el consentimiento de teleconsulta? (R-21). Un `Consent` suyo,
 * activo, con `policyRule` `CodeSystem/consentimiento|teleconsulta` (lo registra el
 * portal; es genérico: uno por paciente). La verificación que vale es la del servidor.
 */
export async function tieneConsentimientoTeleconsulta(medplum: MedplumClient, pacienteRef: string): Promise<boolean> {
  const consentimientos = await medplum.searchResources('Consent', `patient=${pacienteRef}&status=active&_count=50`);
  return consentimientos.some((c) => esConsentimientoTeleconsulta(c));
}

/** ¿El turno es de un servicio incluido en el plan (sin seña)? */
export function esIncluidoEnPlan(itemCodigo: string | undefined): boolean {
  return Boolean(itemCodigo && SERVICIOS_POR_CODIGO.get(itemCodigo)?.incluidaEnPlan);
}

/** Mensaje cuando se intenta cobrar la seña de una consulta incluida en el plan. */
export const MENSAJE_SIN_SENA = `La consulta está incluida en el ${NOMBRE_PLAN_BIENESTAR}: no lleva seña.`;

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

/** Resultado de mandar un WhatsApp por Twilio (sin registrar nada en Medplum). */
export interface EnvioWhatsApp {
  /** `completed` salió · `preparation` no se intentó (faltan secrets o el número) · `entered-in-error` Twilio lo rechazó. */
  status: 'completed' | 'preparation' | 'entered-in-error';
  /** Número al que se mandó (E.164). */
  destino?: string;
  /** Un MessageSid por mensaje de Twilio (uno por adjunto: WhatsApp manda un archivo por mensaje). */
  messageSids: string[];
  entrega?: EstadoEntrega;
  /** Por qué no salió, en palabras de Recepción. */
  motivo?: string;
}

/**
 * Manda un WhatsApp por Twilio: el texto y, si hay, los archivos (`mediaUrls`, links
 * públicos o firmados: Twilio los baja al enviar). WhatsApp acepta un archivo por
 * mensaje: el texto va con el primero y cada archivo más sale en otro mensaje; un texto
 * de más de 1600 caracteres (el tope de Twilio) sale en varias partes. El
 * teléfono se normaliza a E.164 (`+549…`). Pide los estados de entrega (✓✓) al webhook
 * si está el secret `TWILIO_WEBHOOK_URL`.
 */
export async function mandarWhatsApp(
  secrets: Secrets,
  p: { to?: string; body: string; mediaUrls?: string[] },
): Promise<EnvioWhatsApp> {
  const destino = aE164AR(p.to);
  if (!destino) {
    return {
      status: 'preparation',
      messageSids: [],
      ...(p.to ? { motivo: `El teléfono "${p.to}" no es un celular válido para WhatsApp.` } : {}),
    };
  }
  const sid = secrets['TWILIO_ACCOUNT_SID']?.valueString;
  const token = secrets['TWILIO_AUTH_TOKEN']?.valueString;
  const from = secrets['TWILIO_WHATSAPP_FROM']?.valueString;
  const statusCallback = secrets['TWILIO_WEBHOOK_URL']?.valueString;
  if (!sid || !token || !from) {
    return { status: 'preparation', destino, messageSids: [] };
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const medios = p.mediaUrls ?? [];
  // Un texto de más de 1600 caracteres sale en varios mensajes; si entra en uno, va como
  // epígrafe del primer archivo.
  const textos = partirTexto(p.body);
  const partes: Array<{ Body?: string; MediaUrl?: string }> =
    medios.length && textos.length <= 1
      ? medios.map((MediaUrl, i) => ({ ...(i === 0 && textos[0] ? { Body: textos[0] } : {}), MediaUrl }))
      : [...textos.map((Body) => ({ Body })), ...medios.map((MediaUrl) => ({ MediaUrl }))];
  if (partes.length === 0) {
    return { status: 'preparation', destino, messageSids: [], motivo: 'El mensaje está vacío.' };
  }
  const messageSids: string[] = [];
  let entrega: EstadoEntrega | undefined;
  for (const parte of partes) {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        To: `whatsapp:${destino}`,
        ...parte,
        ...(statusCallback ? { StatusCallback: statusCallback } : {}),
      }),
    });
    const respuesta = await leerJson(resp);
    if (!resp.ok) {
      const codigo = typeof respuesta?.code === 'number' || typeof respuesta?.code === 'string' ? respuesta.code : undefined;
      console.error(`mandarWhatsApp: Twilio ${resp.status}${codigo ? ` (${codigo})` : ''}`);
      return {
        status: 'entered-in-error',
        destino,
        messageSids,
        entrega: 'fallido',
        motivo:
          explicarErrorTwilio(codigo) ??
          `Twilio respondió ${resp.status}${respuesta?.message ? `: ${String(respuesta.message)}` : ''}`,
      };
    }
    if (typeof respuesta?.sid === 'string') {
      messageSids.push(respuesta.sid);
    }
    entrega ??= estadoEntregaDeTwilio(String(respuesta?.status ?? '')) ?? 'en-cola';
  }
  return { status: 'completed', destino, messageSids, entrega };
}

/**
 * Envía un aviso por WhatsApp (confirmación, recordatorio, invitación, …) y lo registra
 * como `Communication` suelta (no es una conversación de Mensajes). Resuelve el teléfono
 * desde el paciente si no se pasa `to`. Si faltan credenciales o teléfono, NO envía pero
 * igual deja la Communication (estado 'preparation'). Los secretos de Twilio se leen de
 * event.secrets (Project Secrets de Medplum).
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
    /** El mensaje lleva información clínica: queda con la etiqueta de confidencialidad "R". */
    reservado?: boolean;
  },
): Promise<Communication> {
  let to = params.to;
  if (!to && params.pacienteRef) {
    const id = params.pacienteRef.split('/')[1];
    if (id) {
      const p = await medplum.readResource('Patient', id).catch(() => undefined);
      const telefonos = p?.telecom?.filter((t) => t.system === 'phone' || t.system === 'sms') ?? [];
      to = (telefonos.find((t) => t.use === 'mobile') ?? telefonos[0])?.value;
    }
  }
  const envio = await mandarWhatsApp(secrets, { to, body: params.body });

  const identificadores = [
    ...(params.identifier ? [params.identifier] : []),
    ...envio.messageSids.map((value) => ({ system: SYSTEM.twilioMessageSid, value })),
  ];
  return medplum.createResource<Communication>({
    resourceType: 'Communication',
    ...(params.reservado ? { meta: { security: [ETIQUETA_RESERVADO] } } : {}),
    status: envio.status,
    category: [CATEGORIA_WHATSAPP],
    sent: new Date().toISOString(),
    ...(identificadores.length ? { identifier: identificadores } : {}),
    ...(params.about ? { about: [{ reference: params.about }] } : {}),
    ...(params.pacienteRef
      ? { subject: { reference: params.pacienteRef }, recipient: [{ reference: params.pacienteRef }] }
      : {}),
    ...(envio.motivo ? { statusReason: { text: envio.motivo } } : {}),
    // payload solo si hay cuerpo: un payload sin content[x] es FHIR inválido.
    ...(params.body ? { payload: [{ contentString: params.body }] } : {}),
    extension: [
      { url: EXT.canal, valueCode: 'whatsapp' },
      // templateUsado solo si hay template: una extensión sin valor viola ext-1.
      ...(params.template ? [{ url: EXT.templateUsado, valueString: params.template }] : []),
      ...(envio.destino ? [{ url: EXT.telefonoWhatsapp, valueString: envio.destino }] : []),
      ...(envio.entrega ? [{ url: EXT.estadoEntrega, valueCode: envio.entrega }] : []),
    ],
  });
}

/** JSON de una respuesta, o undefined (Twilio puede no devolver cuerpo). */
async function leerJson(resp: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const cuerpo = (await resp.json()) as unknown;
    return cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
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
  if (esIncluidoEnPlan(itemCodigo)) {
    throw new Error(MENSAJE_SIN_SENA);
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
    body: avisoConfirmacion({
      descripcion: appt.description ?? '',
      senaARS,
      modalidad: modalidadDe(appt),
      teleconsultaUrl: teleconsultaUrlDe(appt),
    }),
  });

  return { totalARS, senaARS, invoiceId: invoice.id, confirmados, yaConfirmado: false };
}

// --------------------------------------------------------------------------
// Agenda: ocupar y liberar franjas (Slot) de una agenda (recurso o profesional)
// --------------------------------------------------------------------------

/** Id del Schedule (agenda propia) de un profesional (identifier SCH_<codigo>). */
export async function scheduleIdDeProfesional(medplum: MedplumClient, medicoCodigo: string): Promise<string | undefined> {
  const sch = await medplum.searchOne('Schedule', `identifier=${SYSTEM.medico}|SCH_${medicoCodigo}`);
  return sch?.id;
}

export interface OcuparFranjas {
  scheduleId: string;
  inicio: Date;
  fin: Date;
  /** Identifier determinista de la franja que empieza en `inicioISO` (para no duplicar con el seed/cron). */
  identificador: (inicioISO: string) => Identifier;
  /** Extensión de pertenencia de la franja (recurso físico o profesional). */
  extension: Extension;
  /** Tamaño de la grilla en minutos (default `SLOT_GRANULARIDAD_MIN`). */
  granularidadMin?: number;
}

export type ResultadoOcupar = { ok: true; slots: Slot[] } | { ok: false; motivo: 'ocupado' };

/**
 * Ocupa las franjas de una agenda que cubren [inicio, fin): las que ya existen libres
 * pasan a `busy` con `If-Match` (si otra reserva las tomó en el medio, el servidor
 * rechaza y no se pisa nada); las que no existen se crean ocupadas con su identifier
 * determinista (`If-None-Exist`: dos reservas simultáneas no pueden crear la misma).
 * Si alguna franja ya estaba ocupada, o una escritura condicional falla, libera lo que
 * había tomado y devuelve `ocupado`. Nunca deja una franja libre duplicada sobre una
 * ocupada: los horarios libres siguen siendo la fuente de la disponibilidad.
 */
export async function ocuparFranjas(medplum: MedplumClient, o: OcuparFranjas): Promise<ResultadoOcupar> {
  const gran = (o.granularidadMin ?? SLOT_GRANULARIDAD_MIN) * 60_000;
  const existentes = await medplum.searchResources(
    'Slot',
    `schedule=Schedule/${o.scheduleId}&start=ge${o.inicio.toISOString()}&start=lt${o.fin.toISOString()}&_count=100`,
  );
  const enRango = (s: Slot): boolean =>
    Boolean(s.start) && new Date(s.start!).getTime() >= o.inicio.getTime() && new Date(s.start!).getTime() < o.fin.getTime();
  const dentro = existentes.filter(enRango);
  if (dentro.some((s) => s.status !== 'free')) {
    return { ok: false, motivo: 'ocupado' };
  }

  // Las franjas de la grilla que no existían se materializan LIBRES con su identifier
  // (`If-None-Exist`: si otra reserva o el cron la creó en el medio, vuelve esa).
  const cubiertas = new Set(dentro.map((s) => new Date(s.start!).getTime()));
  for (let t = o.inicio.getTime(); t < o.fin.getTime(); t += gran) {
    if (cubiertas.has(t)) {
      continue;
    }
    const inicioISO = new Date(t).toISOString();
    // El identifier usa el formato de los Slot del seed ("…T10:00:00-03:00"): mismo instante, misma franja.
    const identifier = o.identificador(isoArgentina(new Date(t)));
    const franja = await medplum.createResourceIfNoneExist<Slot>(
      {
        resourceType: 'Slot',
        identifier: [identifier],
        schedule: { reference: `Schedule/${o.scheduleId}` },
        status: 'free',
        start: inicioISO,
        end: new Date(Math.min(t + gran, o.fin.getTime())).toISOString(),
        extension: [o.extension],
      },
      `identifier=${identifier.system}|${identifier.value}`,
    );
    if (franja.status !== 'free') {
      return { ok: false, motivo: 'ocupado' };
    }
    dentro.push(franja);
  }

  // Todas a ocupado, condicionado a la versión leída: si alguien las tomó en el medio,
  // el servidor rechaza (412), liberamos lo tomado y avisamos.
  const tomadas: Slot[] = [];
  for (const s of dentro) {
    try {
      const ocupada = await medplum.updateResource<Slot>(
        { ...s, status: 'busy' },
        s.meta?.versionId ? { headers: { 'If-Match': `W/"${s.meta.versionId}"` } } : undefined,
      );
      tomadas.push(ocupada);
    } catch {
      for (const t of tomadas) {
        await medplum.updateResource<Slot>({ ...t, status: 'free' }).catch(() => undefined);
      }
      return { ok: false, motivo: 'ocupado' };
    }
  }
  return { ok: true, slots: tomadas };
}

/** Libera las franjas de un turno (vuelven a `free`); nunca las borra: son la agenda. */
export async function liberarFranjas(medplum: MedplumClient, slotRefs: Array<{ reference?: string }> | undefined): Promise<void> {
  for (const s of slotRefs ?? []) {
    const id = s.reference?.split('/')[1];
    if (!id) {
      continue;
    }
    const slot = await medplum.readResource('Slot', id).catch(() => undefined);
    if (slot && slot.status !== 'free') {
      await medplum.updateResource<Slot>({ ...slot, status: 'free' });
    }
  }
}
