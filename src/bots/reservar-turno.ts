/**
 * Bot · Reservar turno.
 *
 * Valida un turno propuesto (R-07 capacidad, R-13 ventana) y, si está OK, crea
 * el Appointment + un Slot ocupado (para que la agenda lo refleje). Toda la
 * decisión vive acá; el front solo manda la propuesta.
 *
 * Con `tareaId` (control del programa GLP-1) valida además la ventana del control
 * (R-19) y, al crear el turno, completa la tarea de Recepción. El control GLP-1
 * sin su tarea se bloquea (R-19).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, AppointmentParticipant, Slot, Task } from '@medplum/fhirtypes';
import type { Servicio } from '../domain/types.js';
import { getServicio } from '../config/catalogo.js';
import type { PerfilReserva } from '../config/reglas.js';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import { cargarReservasDelDia, enviarWhatsApp, scheduleIdDeRecurso } from './_shared.js';
import { validarControlSinTarea, validarTareaAgenda, validarVentanaControl, type Ventana } from '../lib/glp1-plan.js';

const fmtFechaHora = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});
import { combinar, validarRecursos, validarVentanaReserva, type ReservaRecurso, type ResultadoValidacion } from '../lib/reglas-turno.js';

export interface EntradaReserva {
  pacienteRef: string; // "Patient/123"
  servicioCodigo: string;
  recursoCodigo: string;
  /** Inicio del turno en ISO (con offset de Argentina). */
  inicio: string;
  ocupantes?: number;
  /** Perfil para la ventana de reserva (R-13). Si se omite, no se limita. */
  perfil?: PerfilReserva;
  /** Si es false, solo valida (no crea). Default true. */
  confirmar?: boolean;
  /** Tarea de Recepción que este turno resuelve (control del programa GLP-1). */
  tareaId?: string;
}

export interface ResultadoReserva extends ResultadoValidacion {
  creado: boolean;
  appointmentId?: string;
  slotId?: string;
}

export interface ContextoReserva {
  servicio: Servicio;
  inicio: Date;
  fin: Date;
  recursoCodigo: string;
  /** Turnos ya ocupados (de hoy), de todos los recursos, para capacidad. */
  reservasExistentes: ReservaRecurso[];
  perfil?: PerfilReserva;
  ahora: Date;
  /** Ventana del control que se agenda (programa GLP-1, R-19). */
  ventanaControl?: Ventana;
}

/** Validación pura de una reserva (sin FHIR). Reúne las reglas aplicables. */
export function validarReserva(ctx: ContextoReserva): ResultadoValidacion {
  const partes: ResultadoValidacion[] = [];

  // No se puede reservar en el pasado.
  if (ctx.inicio.getTime() <= ctx.ahora.getTime()) {
    partes.push({
      ok: false,
      bloqueos: [{ regla: 'R-13', nivel: 'bloqueo', mensaje: 'El turno está en el pasado.' }],
      advertencias: [],
    });
  }

  const nueva: ReservaRecurso = { recursoCodigo: ctx.recursoCodigo, inicio: ctx.inicio, fin: ctx.fin };
  partes.push(validarRecursos([...ctx.reservasExistentes, nueva]));

  if (ctx.perfil) {
    partes.push(validarVentanaReserva(ctx.perfil, ctx.ahora, ctx.inicio));
  }

  // R-19: el control GLP-1 va atado a su tarea (y a la ventana que calculó el programa).
  partes.push(
    ctx.ventanaControl ? validarVentanaControl(ctx.inicio, ctx.ventanaControl) : validarControlSinTarea(ctx.servicio.codigo),
  );

  return combinar(...partes);
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaReserva>,
): Promise<ResultadoReserva> {
  const e = event.input;
  const servicio = getServicio(e.servicioCodigo);
  const inicio = new Date(e.inicio);
  const fin = new Date(inicio.getTime() + servicio.duracionMin * 60_000);
  const ahora = new Date();

  // Control de un programa: la tarea tiene que ser de este paciente y estar pendiente.
  let tarea: Task | undefined;
  let ventanaControl: Ventana | undefined;
  let traerLaboratorio = false;
  if (e.tareaId) {
    tarea = await medplum.readResource('Task', e.tareaId).catch(() => undefined);
    const check = tarea
      ? validarTareaAgenda(tarea, { pacienteRef: e.pacienteRef, servicioCodigo: e.servicioCodigo })
      : ({ ok: false, error: 'La tarea no existe.' } as const);
    if (!check.ok) {
      return { ok: false, bloqueos: [{ regla: 'R-19', nivel: 'bloqueo', mensaje: check.error }], advertencias: [], creado: false };
    }
    ventanaControl = check.ventana;
    traerLaboratorio = check.requiereLaboratorio;
  }

  // Turnos ocupados de hoy (todos los recursos) para capacidad.
  const reservasExistentes = await cargarReservasDelDia(medplum, inicio);

  const resultado = validarReserva({
    servicio,
    inicio,
    fin,
    recursoCodigo: e.recursoCodigo,
    reservasExistentes,
    perfil: e.perfil,
    ahora,
    ventanaControl,
  });

  if (!resultado.ok || e.confirmar === false) {
    return { ...resultado, creado: false };
  }

  // Crear Slot ocupado + Appointment.
  const scheduleId = await scheduleIdDeRecurso(medplum, e.recursoCodigo);
  if (!scheduleId) {
    return {
      ok: false,
      bloqueos: [{ regla: 'R-07', nivel: 'bloqueo', mensaje: `El recurso ${e.recursoCodigo} no tiene agenda (Schedule).` }],
      advertencias: resultado.advertencias,
      creado: false,
    };
  }

  const slot: Slot = await medplum.createResource<Slot>({
    resourceType: 'Slot',
    status: 'busy',
    schedule: { reference: `Schedule/${scheduleId}` },
    start: inicio.toISOString(),
    end: fin.toISOString(),
    extension: [{ url: EXT.recursoFisico, valueString: e.recursoCodigo }],
  });

  const participant: AppointmentParticipant[] = [{ actor: { reference: e.pacienteRef }, status: 'accepted' }];
  // Consultas con médico asignado: sumar al profesional como participante.
  if (servicio.practitionerCodigo) {
    const pract = await medplum.searchOne('Practitioner', `identifier=${SYSTEM.medico}|${servicio.practitionerCodigo}`);
    if (pract?.id) {
      participant.push({
        actor: { reference: `Practitioner/${pract.id}`, display: pract.name?.[0]?.text },
        status: 'accepted',
      });
    }
  }

  // Turno TENTATIVO hasta cobrar la seña del 50% (pasa a 'booked' al pagar).
  const appointment: Appointment = await medplum.createResource<Appointment>({
    resourceType: 'Appointment',
    status: 'pending',
    description: servicio.nombre,
    start: inicio.toISOString(),
    end: fin.toISOString(),
    slot: [{ reference: `Slot/${slot.id}` }],
    participant,
    extension: [
      { url: EXT.recursoFisico, valueString: e.recursoCodigo },
      { url: EXT.ocupantes, valueInteger: e.ocupantes ?? 1 },
      { url: EXT.itemTipo, valueCode: 'servicio' },
      { url: EXT.itemCodigo, valueString: e.servicioCodigo },
    ],
  });

  // La tarea de Recepción queda resuelta con este turno.
  if (tarea) {
    await medplum.updateResource<Task>({
      ...tarea,
      status: 'completed',
      lastModified: new Date().toISOString(),
      output: [{ type: { text: 'turno' }, valueReference: { reference: `Appointment/${appointment.id}` } }],
    });
  }

  await enviarWhatsApp(medplum, event.secrets, {
    template: 'reserva-tentativa',
    pacienteRef: e.pacienteRef,
    body:
      `Segunda Opinión Médica: reservamos tu turno de ${servicio.nombre} para el ${fmtFechaHora.format(inicio)} (tentativo). Aboná la seña del 50% para confirmarlo.` +
      (traerLaboratorio ? ' Traé los resultados del laboratorio del control.' : '') +
      ' 💙',
  });

  return {
    ...resultado,
    creado: true,
    appointmentId: appointment.id,
    slotId: slot.id,
  };
}
