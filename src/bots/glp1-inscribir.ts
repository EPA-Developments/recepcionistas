/**
 * Bot · som-glp1-inscribir — Recepción inscribe al paciente en el programa de
 * seguimiento de tratamiento GLP-1.
 *
 * Recepción no carga nada clínico: este bot solo deja la tarea al equipo médico
 * para que complete la indicación (molécula, indicación y esquema de titulación).
 * Con esa indicación, `som-glp1-plan` arma el calendario y las tareas de agenda.
 *
 * Idempotente: si el paciente ya está en seguimiento o ya tiene la indicación
 * pendiente, no crea nada nuevo y devuelve el estado (dato administrativo, sin
 * detalle clínico).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Task } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../fhir/identifiers.js';
import { construirTareaIndicacion, esPacienteRef } from '../lib/glp1-plan.js';

export interface EntradaInscribirGlp1 {
  /** "Patient/123". */
  pacienteRef: string;
}

export interface ResultadoInscribirGlp1 {
  ok: boolean;
  mensaje?: string;
  /** `indicacion-pendiente`: falta la indicación médica · `activo`: el programa ya está armado. */
  estado?: 'indicacion-pendiente' | 'activo';
  /** true si en esta llamada se creó la tarea de indicación. */
  creado?: boolean;
  taskId?: string;
  /** Controles del programa que Recepción todavía tiene que agendar. */
  controlesPorAgendar?: number;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaInscribirGlp1>,
): Promise<ResultadoInscribirGlp1> {
  const pacienteRef = event.input?.pacienteRef;
  if (!esPacienteRef(pacienteRef)) {
    return { ok: false, mensaje: 'Falta el paciente (Patient/…).' };
  }
  try {
    await medplum.readResource('Patient', pacienteRef.split('/')[1]!);

    const activo = await medplum.searchOne('CarePlan', {
      subject: pacienteRef,
      status: 'active',
      category: `${SYSTEM.programa}|${COD.seguimientoGlp1}`,
    });
    if (activo?.id) {
      const porAgendar = await medplum.searchResources('Task', {
        'based-on': `CarePlan/${activo.id}`,
        code: COD.agendarControlGlp1,
        status: 'requested',
        _count: '100',
      });
      return {
        ok: true,
        estado: 'activo',
        creado: false,
        controlesPorAgendar: porAgendar.length,
        mensaje: 'El paciente ya está en seguimiento GLP-1.',
      };
    }

    const pendiente = await medplum.searchOne('Task', {
      patient: pacienteRef,
      code: COD.indicacionGlp1,
      status: 'requested',
    });
    if (pendiente?.id) {
      return {
        ok: true,
        estado: 'indicacion-pendiente',
        creado: false,
        taskId: pendiente.id,
        mensaje: 'Ya está inscripto: falta la indicación del equipo médico.',
      };
    }

    const tarea = await medplum.createResource<Task>(construirTareaIndicacion(pacienteRef, new Date().toISOString()));
    return {
      ok: true,
      estado: 'indicacion-pendiente',
      creado: true,
      taskId: tarea.id,
      mensaje: 'Inscripto. El equipo médico completa la indicación y el sistema arma los controles.',
    };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo inscribir al paciente.' };
  }
}
