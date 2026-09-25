/**
 * Bot · Estado del turno (check-in / check-out).
 *
 * Cambia el estado de un Appointment (llegó / en curso / completado / cancelado),
 * gestiona el Encounter de la visita (lo abre al llegar, lo cierra al completar) y,
 * al completar o cancelar, libera la sala (pone el Slot en 'free') para que pueda
 * reutilizarse (Documento de Requerimientos §6.7: "Check-out libera la sala").
 *
 * El Encounter lleva la modalidad del turno en `class` (v3-ActCode `AMB` presencial,
 * `VR` teleconsulta; R-21). Si el turno es una consulta del Plan Bienestar 100 Días®,
 * actualiza el plan: completada, o —si se cancela— la consulta vuelve a quedar por
 * agendar (la tarea se reabre: la consulta incluida no se pierde).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, CarePlan, Encounter, Task } from '@medplum/fhirtypes';
import { leerTareaConsultaPlan, marcarActividad } from '../lib/plan-bienestar.js';
import { codingModalidad, modalidadDe } from '../lib/teleconsulta.js';

export type EstadoTurno = 'arrived' | 'checked-in' | 'fulfilled' | 'cancelled';

export interface EntradaEstado {
  appointmentId: string;
  estado: EstadoTurno;
}

/** Estados en los que la sala se libera (el turno terminó). */
export const ESTADOS_QUE_LIBERAN: ReadonlySet<EstadoTurno> = new Set(['fulfilled', 'cancelled']);

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaEstado>): Promise<Appointment> {
  const { appointmentId, estado } = event.input;

  const appt = await medplum.readResource('Appointment', appointmentId);
  appt.status = estado;
  const actualizado = await medplum.updateResource(appt);

  const pacienteRef = appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;

  // Encounter de la visita.
  if (estado === 'arrived' || estado === 'checked-in') {
    await asegurarEncounter(medplum, appt, pacienteRef);
  } else if (estado === 'fulfilled' || estado === 'cancelled') {
    await cerrarEncounter(medplum, appointmentId, estado === 'fulfilled' ? 'finished' : 'cancelled');
    await actualizarPlanBienestar(medplum, appt, estado);
  }

  // Liberar la(s) sala(s) al terminar.
  if (ESTADOS_QUE_LIBERAN.has(estado)) {
    for (const s of appt.slot ?? []) {
      const id = s.reference?.split('/')[1];
      if (!id) {
        continue;
      }
      const slot = await medplum.readResource('Slot', id);
      slot.status = 'free';
      await medplum.updateResource(slot);
    }
  }

  return actualizado;
}

async function asegurarEncounter(
  medplum: MedplumClient,
  appt: Appointment,
  pacienteRef: string | undefined,
): Promise<void> {
  const appointmentId = appt.id!;
  const existente = await medplum.searchOne('Encounter', `appointment=Appointment/${appointmentId}`);
  if (existente) {
    return;
  }
  const encounter: Encounter = {
    resourceType: 'Encounter',
    status: 'in-progress',
    class: codingModalidad(modalidadDe(appt) ?? 'presencial'),
    appointment: [{ reference: `Appointment/${appointmentId}` }],
    period: { start: new Date().toISOString() },
    ...(pacienteRef ? { subject: { reference: pacienteRef } } : {}),
  };
  await medplum.createResource(encounter);
}

async function cerrarEncounter(
  medplum: MedplumClient,
  appointmentId: string,
  status: 'finished' | 'cancelled',
): Promise<void> {
  const enc = await medplum.searchOne('Encounter', `appointment=Appointment/${appointmentId}`);
  if (!enc) {
    return;
  }
  enc.status = status;
  enc.period = { ...(enc.period ?? {}), end: new Date().toISOString() };
  await medplum.updateResource(enc);
}

/**
 * Consulta del Plan Bienestar (el turno referencia su tarea y su plan): al completarse,
 * la actividad del plan queda `completed`; al cancelarse, la tarea se reabre y la
 * actividad vuelve a `not-started`, para reagendarla.
 */
async function actualizarPlanBienestar(medplum: MedplumClient, appt: Appointment, estado: 'fulfilled' | 'cancelled'): Promise<void> {
  const ref = (tipo: string) => appt.supportingInformation?.find((r) => r.reference?.startsWith(`${tipo}/`))?.reference;
  const tareaRef = ref('Task');
  const planRef = ref('CarePlan');
  if (!tareaRef || !planRef) {
    return;
  }
  const tarea = await medplum.readResource('Task', tareaRef.split('/')[1]!).catch(() => undefined);
  const clave = tarea ? leerTareaConsultaPlan(tarea).clave : undefined;
  if (!tarea || !clave) {
    return;
  }
  if (estado === 'cancelled' && tarea.status === 'completed') {
    const { output: _turno, ...resto } = tarea;
    await medplum.updateResource<Task>({ ...resto, status: 'requested', lastModified: new Date().toISOString() });
  }
  const plan = await medplum.readResource('CarePlan', planRef.split('/')[1]!).catch(() => undefined);
  if (plan) {
    await medplum.updateResource<CarePlan>(marcarActividad(plan, clave, estado === 'fulfilled' ? 'completed' : 'not-started'));
  }
}
