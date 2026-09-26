/**
 * Bot · Reservar desde el portal (la paciente elige el horario) — R-23.
 *
 * "Especialidad → Profesional → Horario → seña": la paciente elige una franja libre de la
 * agenda de un profesional (`Slot`) y este bot la reserva con las mismas reglas que usa
 * Recepción (`som-reservar-turno`: R-07, R-20, R-21, R-22). El turno queda:
 *  - **confirmado** si es una consulta del Plan Bienestar 100 Días® (incluida, sin seña;
 *    exige su `tareaId`, que tiene que ser de la propia paciente y estar en ventana, R-20);
 *  - **tentativo** si tiene cargo: la franja queda retenida `RETENCION_RESERVA_PORTAL_MIN`
 *    y se devuelve el link de MercadoPago de la seña (50 %), que también queda en el turno
 *    (`link-pago-sena`) y sale por WhatsApp. Al acreditarse, el webhook lo confirma solo;
 *    si vence sin seña, `som-vencer-reservas` lo cancela y libera la franja. Si no se pudo
 *    generar el link (MercadoPago no respondió), la reserva no vence y Recepción cobra.
 *
 * Seguridad: solo puede reservar para sí misma (`requester`, si Medplum lo informa); el
 * servicio tiene que ser reservable desde el portal (consultas por especialidad, o la del
 * plan con su tarea; el control GLP-1 lo agenda Recepción); no devuelve el link de la
 * videollamada antes de la seña. La paciente solo puede ejecutar este bot,
 * `som-solicitar-turno` y `som-solicitar` (policy del portal).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, Reference } from '@medplum/fhirtypes';
import type { Modalidad } from '../domain/types.js';
import { RETENCION_RESERVA_PORTAL_MIN } from '../config/reglas.js';
import { EXT } from '../fhir/identifiers.js';
import { alertaRecepcionSinLink, avisoReserva, avisoReservaPortal } from '../lib/avisos.js';
import { validarAnticipacionPortal, validarPedidoPortal } from '../lib/reserva-portal.js';
import { enviarWhatsApp } from './_shared.js';
import { handler as linkMercadoPago } from './link-mercadopago.js';
import { handler as reservarTurno } from './reservar-turno.js';

export interface EntradaReservaPortal {
  /** "Patient/{id}": la propia paciente (se verifica contra quien ejecuta). */
  pacienteRef: string;
  /** Código de la consulta del catálogo (p. ej. `CARDIOLOGIA`, `CONSULTA_PB100D`). */
  servicioCodigo: string;
  /** Franja libre elegida (Slot de la agenda de un profesional). */
  slotId: string;
  modalidad: Modalidad;
  /** Consulta del Plan Bienestar: su tarea (`agendar-consulta-pb100d`). */
  tareaId?: string;
}

export interface ResultadoReservaPortal {
  ok: boolean;
  /** Si no se pudo reservar: por qué, en palabras para la paciente. */
  mensaje?: string;
  appointmentId?: string;
  /** `confirmado` (incluida en el plan) o `tentativo` (a la espera de la seña). */
  estado?: 'confirmado' | 'tentativo';
  descripcion?: string;
  inicio?: string;
  fin?: string;
  modalidad?: Modalidad;
  medicoCodigo?: string;
  incluida?: boolean;
  senaARS?: number;
  /** Link de MercadoPago para pagar la seña (tentativo). */
  linkPago?: string;
  /** Hasta cuándo queda retenida la franja (ISO), si es tentativo con link. */
  expira?: string;
  /** No se pudo generar el link: Recepción contacta a la paciente y la reserva no vence. */
  sinLink?: boolean;
  advertencias?: string[];
}

/** Nombre visible de la paciente (best-effort, para la alerta a Recepción). */
async function nombreDe(medplum: MedplumClient, pacienteRef: string): Promise<string | undefined> {
  const id = pacienteRef.split('/')[1];
  const p = id ? await medplum.readResource('Patient', id).catch(() => undefined) : undefined;
  const nombre = p?.name?.[0]?.text ?? [p?.name?.[0]?.given?.join(' '), p?.name?.[0]?.family].filter(Boolean).join(' ');
  return nombre || undefined;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaReservaPortal>): Promise<ResultadoReservaPortal> {
  const e = event.input ?? ({} as EntradaReservaPortal);
  // Quién ejecuta: Medplum lo informa en `requester` (no está en el tipo de BotEvent).
  const requester = (event as BotEvent<EntradaReservaPortal> & { requester?: Reference }).requester?.reference;
  const v = validarPedidoPortal(e, requester);
  if (!v.ok) {
    return { ok: false, mensaje: v.error };
  }

  const ahora = new Date();
  const franja = await medplum.readResource('Slot', e.slotId).catch(() => undefined);
  if (!franja?.start) {
    return { ok: false, mensaje: 'Ese horario ya no existe. Elegí otro.' };
  }
  const anticipacion = validarAnticipacionPortal(ahora, new Date(franja.start));
  if (!anticipacion.ok) {
    return { ok: false, mensaje: anticipacion.error };
  }

  // La reserva propiamente dicha, con todas las reglas de Recepción. El WhatsApp lo manda
  // este bot (con el link de la seña).
  const expira = new Date(ahora.getTime() + RETENCION_RESERVA_PORTAL_MIN * 60_000);
  const r = await reservarTurno(medplum, {
    ...event,
    input: {
      pacienteRef: e.pacienteRef,
      servicioCodigo: e.servicioCodigo,
      slotId: e.slotId,
      modalidad: e.modalidad,
      ...(e.tareaId ? { tareaId: e.tareaId } : {}),
      origen: 'portal',
      expiraEn: expira.toISOString(),
      avisar: false,
    },
  });
  const advertencias = r.advertencias.map((a) => a.mensaje);
  if (!r.ok || !r.creado || !r.appointmentId || !r.inicio || !r.modalidad) {
    return { ok: false, mensaje: r.bloqueos[0]?.mensaje ?? 'No se pudo reservar el turno. Probá con otro horario.', advertencias };
  }

  const inicio = new Date(r.inicio);
  const descripcion = r.descripcion ?? '';
  const base = {
    appointmentId: r.appointmentId,
    descripcion,
    inicio: r.inicio,
    fin: r.fin,
    modalidad: r.modalidad,
    ...(r.medicoCodigo ? { medicoCodigo: r.medicoCodigo } : {}),
    advertencias,
  };
  const about = `Appointment/${r.appointmentId}`;

  // Incluida en el plan: confirmada, sin seña (el link de la videollamada va en el aviso).
  if (r.incluida) {
    await enviarWhatsApp(medplum, event.secrets, {
      template: 'consulta-plan-confirmada',
      pacienteRef: e.pacienteRef,
      about,
      body: avisoReserva({ nombre: descripcion, inicio, modalidad: r.modalidad, incluida: true, teleconsultaUrl: r.teleconsultaUrl }),
    });
    return { ok: true, ...base, estado: 'confirmado', incluida: true };
  }

  // Con cargo: link de MercadoPago de la seña. Queda en el turno para que el portal lo relea.
  const link = await linkMercadoPago(medplum, { ...event, input: { appointmentId: r.appointmentId } }).catch((err: unknown) => ({
    ok: false as const,
    mensaje: err instanceof Error ? err.message : 'MercadoPago no respondió.',
    url: undefined,
    senaARS: undefined,
  }));
  const appt = await medplum.readResource('Appointment', r.appointmentId);
  if (link.ok && link.url) {
    await medplum.updateResource<Appointment>({
      ...appt,
      extension: [...(appt.extension ?? []).filter((x) => x.url !== EXT.linkPagoSena), { url: EXT.linkPagoSena, valueUrl: link.url }],
    });
    await enviarWhatsApp(medplum, event.secrets, {
      template: 'reserva-portal-sena',
      pacienteRef: e.pacienteRef,
      about,
      body: avisoReservaPortal({ nombre: descripcion, inicio, modalidad: r.modalidad, senaARS: link.senaARS ?? 0, linkPago: link.url, expira }),
    });
    return {
      ok: true,
      ...base,
      estado: 'tentativo',
      incluida: false,
      ...(link.senaARS !== undefined ? { senaARS: link.senaARS } : {}),
      linkPago: link.url,
      expira: expira.toISOString(),
    };
  }

  // Sin link (MercadoPago no configurado o caído): no es culpa de la paciente, así que la
  // reserva no vence; Recepción la contacta para cobrar la seña.
  console.error(`som-reservar-portal: sin link de pago para ${about}: ${link.mensaje ?? 'sin detalle'}`);
  await medplum.updateResource<Appointment>({ ...appt, extension: (appt.extension ?? []).filter((x) => x.url !== EXT.reservaExpira) });
  await enviarWhatsApp(medplum, event.secrets, {
    template: 'reserva-tentativa',
    pacienteRef: e.pacienteRef,
    about,
    body: avisoReserva({ nombre: descripcion, inicio, modalidad: r.modalidad }),
  });
  const to = event.secrets['RECEPCION_WHATSAPP_TO']?.valueString;
  if (to) {
    await enviarWhatsApp(medplum, event.secrets, {
      template: 'reserva-portal-sin-link',
      to,
      about,
      body: alertaRecepcionSinLink({ paciente: await nombreDe(medplum, e.pacienteRef), nombre: descripcion, inicio, motivo: link.mensaje?.slice(0, 160) }),
    });
  }
  return {
    ok: true,
    ...base,
    estado: 'tentativo',
    incluida: false,
    ...(link.senaARS !== undefined ? { senaARS: link.senaARS } : {}),
    sinLink: true,
  };
}
