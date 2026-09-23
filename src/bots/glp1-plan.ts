/**
 * Bot · som-glp1-plan — arma o recalcula el programa de seguimiento GLP-1 de un
 * paciente con la indicación del equipo médico.
 *
 * Lo ejecuta el equipo médico (Recepción NO: su AccessPolicy no incluye este bot).
 * Entrada: `EntradaPlanGlp1` (`src/lib/glp1-plan.ts`): molécula, indicación, esquema
 * de titulación, fecha de inicio y los datos que suman controles.
 *
 * Crea (o actualiza) el CarePlan, la meta (Goal), los pedidos de laboratorio y las
 * tareas de agenda de Recepción. Un solo programa activo por paciente: volver a
 * ejecutarlo con una titulación nueva RECALCULA en el lugar (la revisión de
 * respuesta se corre): actualiza lo pendiente, cancela lo que ya no va y nunca toca
 * lo ya agendado, que devuelve en `aRevisar`. Completa la tarea de indicación
 * pendiente que dejó `som-glp1-inscribir`.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { CarePlan, Goal, ServiceRequest, Task } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../fhir/identifiers.js';
import {
  calendarioGlp1,
  construirCarePlan,
  construirGoal,
  construirPedidosLaboratorio,
  construirTareasAgenda,
  estadoPedido,
  estadoTarea,
  fmtDia,
  leerTareaControl,
  mismaVentanaTarea,
  mismoPeriodoPedido,
  sincronizar,
  validarEntradaGlp1,
  type EntradaPlanGlp1,
} from '../lib/glp1-plan.js';

export interface ResultadoPlanGlp1 {
  ok: boolean;
  mensaje?: string;
  carePlanId?: string;
  goalId?: string;
  /** true si el programa ya existía y se recalculó. */
  recalculado?: boolean;
  /** Semana de la revisión de respuesta (dosis terapéutica + 12). */
  semanaRevision?: number;
  controles?: Array<{ semana: number; desde: string; hasta: string; requiereLaboratorio: boolean }>;
  tareas?: { creadas: number; actualizadas: number; canceladas: number };
  pedidos?: { creados: number; actualizados: number; revocados: number };
  /** Controles ya agendados cuya ventana cambió o que ya no corresponden. */
  aRevisar?: string[];
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaPlanGlp1>,
): Promise<ResultadoPlanGlp1> {
  const e = event.input;
  const v = validarEntradaGlp1(e);
  if (!v.ok) {
    return { ok: false, mensaje: v.error };
  }
  try {
    await medplum.readResource('Patient', e.pacienteRef.split('/')[1]!);
    const cal = calendarioGlp1(e);
    const ahora = new Date().toISOString();

    // Un programa activo por paciente: si existe, se recalcula en el lugar.
    const existente = await medplum.searchOne('CarePlan', {
      subject: e.pacienteRef,
      status: 'active',
      category: `${SYSTEM.planCuidado}|${COD.seguimientoGlp1}`,
    });

    const goalNuevo = construirGoal(e, cal);
    const goalPrevio = existente?.goal?.[0]?.reference?.split('/')[1];
    const goal = goalPrevio
      ? await medplum.updateResource<Goal>({ ...goalNuevo, id: goalPrevio })
      : await medplum.createResource<Goal>(goalNuevo);

    const cpNuevo = construirCarePlan(e, cal, `Goal/${goal.id}`, existente?.created ?? ahora);
    const carePlan = existente?.id
      ? await medplum.updateResource<CarePlan>({ ...cpNuevo, id: existente.id })
      : await medplum.createResource<CarePlan>(cpNuevo);
    const cpId = carePlan.id!;

    // Pedidos de laboratorio.
    const pedidos = sincronizar(
      construirPedidosLaboratorio(e, cal, cpId, ahora),
      await medplum.searchResources('ServiceRequest', { 'based-on': `CarePlan/${cpId}`, _count: '200' }),
      { estado: estadoPedido, mismoContenido: mismoPeriodoPedido },
    );
    for (const s of pedidos.crear) {
      await medplum.createResource<ServiceRequest>(s);
    }
    for (const s of pedidos.actualizar) {
      await medplum.updateResource<ServiceRequest>(s);
    }
    for (const s of pedidos.cancelar) {
      await medplum.updateResource<ServiceRequest>({ ...s, status: 'revoked' });
    }

    // Tareas de agenda de Recepción.
    const tareas = sincronizar(
      construirTareasAgenda(e, cal, cpId, ahora),
      await medplum.searchResources('Task', { 'based-on': `CarePlan/${cpId}`, code: COD.agendarControlGlp1, _count: '100' }),
      { estado: estadoTarea, mismoContenido: mismaVentanaTarea },
    );
    for (const t of tareas.crear) {
      await medplum.createResource<Task>(t);
    }
    for (const t of tareas.actualizar) {
      await medplum.updateResource<Task>(t);
    }
    for (const t of tareas.cancelar) {
      await medplum.updateResource<Task>({ ...t, status: 'cancelled', statusReason: { text: 'Recalculado: el control ya no corresponde.' } });
    }
    const aRevisar = tareas.aRevisar.map((t) => {
      const { semana } = leerTareaControl(t);
      const nuevo = cal.controles.find((c) => c.semana === semana);
      return nuevo
        ? `Control semana ${semana}: ya agendado; la ventana ahora es del ${fmtDia(nuevo.ventana.desde)} al ${fmtDia(nuevo.ventana.hasta)}.`
        : `Control semana ${semana ?? '?'}: ya agendado, pero con el esquema nuevo ya no corresponde.`;
    });

    // La indicación que pidió Recepción queda resuelta.
    const indicaciones = await medplum.searchResources('Task', {
      patient: e.pacienteRef,
      code: COD.indicacionGlp1,
      status: 'requested',
    });
    for (const t of indicaciones) {
      await medplum.updateResource<Task>({
        ...t,
        status: 'completed',
        output: [{ type: { text: 'plan' }, valueReference: { reference: `CarePlan/${cpId}` } }],
      });
    }

    return {
      ok: true,
      carePlanId: cpId,
      goalId: goal.id,
      recalculado: Boolean(existente?.id),
      semanaRevision: cal.revision.semana,
      controles: cal.controles.map((c) => ({
        semana: c.semana,
        desde: c.ventana.desde,
        hasta: c.ventana.hasta,
        requiereLaboratorio: c.requiereLaboratorio,
      })),
      tareas: { creadas: tareas.crear.length, actualizadas: tareas.actualizar.length, canceladas: tareas.cancelar.length },
      pedidos: { creados: pedidos.crear.length, actualizados: pedidos.actualizar.length, revocados: pedidos.cancelar.length },
      aRevisar,
    };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo armar el plan GLP-1.' };
  }
}
