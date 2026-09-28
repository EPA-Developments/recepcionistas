/**
 * Bot · Cancelar la teleconsulta (portal de la paciente) — R-14, R-20, R-22.
 *
 * Dos pasos, para que la paciente sepa qué pasa antes de cancelar:
 *  - sin `confirmar`: no cambia nada; devuelve qué pasaría (R-14: con menos de 24 h la
 *    sesión se consume y la seña no vuelve; con 24 h o más, la seña no se pierde);
 *  - con `confirmar: true`: cancela el turno (motivo `pat`) con `som-estado-turno`, que
 *    libera las franjas (R-22), cierra el Encounter y, si es una consulta del Plan Bienestar
 *    100 Días®, la deja otra vez por agendar (R-20).
 *
 * Si tenía la seña pagada, avisa a Recepción por WhatsApp (`RECEPCION_WHATSAPP_TO`) con lo
 * que dice R-14: reintegrar / dejar a favor, o sesión consumida (la fuerza mayor médica la
 * autoriza un médico desde Recepción, no la paciente).
 *
 * Reemplaza, con el modelo de SOM, al bot de cancelación del módulo de teleconsulta de
 * otro proyecto: el portal de SOM solo ejecuta bots `som-*` de este proyecto.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment } from '@medplum/fhirtypes';
import { alertaRecepcionCancelacionPortal } from '../lib/avisos.js';
import { evaluarCancelacionPortal, itemDelTurno, verificarTurnoDelPaciente } from '../lib/teleconsulta-portal.js';
import { enviarWhatsApp, esIncluidoEnPlan } from './_shared.js';
import { handler as estadoTurno } from './estado-turno.js';

export interface EntradaCancelarTeleconsulta {
  appointmentId: string;
  /** false/ausente: solo informa qué pasaría. true: cancela. */
  confirmar?: boolean;
}

export interface ResultadoCancelarTeleconsulta {
  ok: boolean;
  /** Se canceló de verdad (solo con `confirmar`). */
  cancelado?: boolean;
  conSena?: boolean;
  incluida?: boolean;
  /** R-14: con menos de 24 h la sesión se consume. */
  consumeSesion?: boolean;
  devuelveSaldo?: boolean;
  mensaje?: string;
}

/** Motivo de cancelación estándar de HL7: la canceló la paciente. */
const MOTIVO_PACIENTE = {
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/appointment-cancellation-reason', code: 'pat', display: 'Patient' }],
};

async function nombreDe(medplum: MedplumClient, pacienteRef: string): Promise<string | undefined> {
  const id = pacienteRef.split('/')[1];
  const p = id ? await medplum.readResource('Patient', id).catch(() => undefined) : undefined;
  const nombre = p?.name?.[0]?.text ?? [p?.name?.[0]?.given?.join(' '), p?.name?.[0]?.family].filter(Boolean).join(' ');
  return nombre || undefined;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaCancelarTeleconsulta>,
): Promise<ResultadoCancelarTeleconsulta> {
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

  const ahora = new Date();
  const r = evaluarCancelacionPortal(appt, ahora, esIncluidoEnPlan(itemDelTurno(appt)));
  if (!r.ok) {
    return { ok: false, mensaje: r.mensaje };
  }
  const { ok: _ok, ...evaluacion } = r;
  if (!event.input.confirmar) {
    return { ok: true, cancelado: false, ...evaluacion };
  }

  await estadoTurno(medplum, { ...event, input: { appointmentId, estado: 'cancelled' } });
  const cancelado = await medplum.readResource('Appointment', appointmentId);
  await medplum.updateResource<Appointment>({
    ...cancelado,
    cancelationReason: { ...MOTIVO_PACIENTE, text: 'Cancelada por la paciente desde el portal.' },
  });

  const to = event.secrets['RECEPCION_WHATSAPP_TO']?.valueString;
  if (r.conSena && to) {
    await enviarWhatsApp(medplum, event.secrets, {
      template: 'teleconsulta-cancelada-portal',
      to,
      about: `Appointment/${appointmentId}`,
      body: alertaRecepcionCancelacionPortal({
        paciente: await nombreDe(medplum, v.pacienteRef),
        descripcion: appt.description ?? 'Teleconsulta',
        inicio: new Date(appt.start as string),
        consumeSesion: r.consumeSesion,
      }),
    });
  }

  return { ok: true, cancelado: true, ...evaluacion, mensaje: `Cancelamos tu teleconsulta. ${r.mensaje}` };
}
