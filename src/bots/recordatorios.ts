/**
 * Bot · Recordatorios automáticos (cron): turnos a 48 h y 2 h, y avisos del Plan
 * Bienestar 100 Días®.
 *
 * Pensado para ejecutarse seguido (cronTimer, p. ej. cada 30 min):
 *  1. Turnos CONFIRMADOS (`booked`) que arrancan dentro de la ventana máxima (48 h):
 *     el recordatorio que corresponda (48 h → 2 h) por WhatsApp. En teleconsulta lleva
 *     el link de la videollamada.
 *  2. Consultas del Plan Bienestar sin agendar (R-20), solo de día: cuando se abre su
 *     ventana, un aviso al paciente; si a mitad de ventana sigue sin agendar, otro aviso
 *     y una alerta a Recepción (la tarea pasa a urgente y, si está el Project Secret
 *     `RECEPCION_WHATSAPP_TO`, un WhatsApp). Solo después de agendada la consulta
 *     inicial, que fija el día 1.
 *
 * Idempotente: registra cada aviso como `Communication` con un identifier único
 * (`recordatorio-{tipo}-{turno}`, `pb100d-{aviso}-{tarea}`); si ya existe, no reenvía.
 *
 * La decisión de "qué aviso toca" vive en `src/lib/recordatorios.ts` (pura) y los
 * textos en `src/lib/avisos.ts`.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Task } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../fhir/identifiers.js';
import { alertaRecepcionConsultaPlan, avisoConsultaPlan, avisoRecordatorio } from '../lib/avisos.js';
import { leerTareaConsultaPlan } from '../lib/plan-bienestar.js';
import { estadoTarea, hoyLocal } from '../lib/programas.js';
import { avisoConsultaPlanDue, enHorarioDeAvisos, recordatorioDue, VENTANA_MAX_MS } from '../lib/recordatorios.js';
import { modalidadDe, teleconsultaUrlDe } from '../lib/teleconsulta.js';
import { enviarWhatsApp } from './_shared.js';

type Secrets = BotEvent['secrets'];

export interface EntradaRecordatorios {
  /** Fecha de referencia ISO (default: ahora). Útil para pruebas/reprocesos. */
  ahora?: string;
}

export interface ResultadoRecordatorios {
  ok: boolean;
  /** Recordatorios de 48 h enviados en esta corrida. */
  enviados48: number;
  /** Recordatorios de 2 h enviados en esta corrida. */
  enviados2: number;
  /** Turnos que ya tenían el recordatorio (se omiten). */
  omitidos: number;
  /** Avisos del Plan Bienestar enviados en esta corrida (apertura / mitad de ventana). */
  avisosPlan: number;
}

const ESTADOS_PENDIENTES = 'draft,requested,received,accepted,ready,in-progress,on-hold';

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaRecordatorios>,
): Promise<ResultadoRecordatorios> {
  const ahora = event.input?.ahora ? new Date(event.input.ahora) : new Date();
  const fin = new Date(ahora.getTime() + VENTANA_MAX_MS);

  const turnos = await medplum.searchResources(
    'Appointment',
    `status=booked&date=ge${ahora.toISOString()}&date=le${fin.toISOString()}&_count=500`,
  );

  let enviados48 = 0;
  let enviados2 = 0;
  let omitidos = 0;
  for (const appt of turnos) {
    if (!appt.start || !appt.id) {
      continue;
    }
    const inicio = new Date(appt.start);
    const tipo = recordatorioDue(inicio, ahora);
    if (!tipo) {
      continue;
    }

    // Idempotencia: un recordatorio por (tipo, turno).
    const key = `recordatorio-${tipo}-${appt.id}`;
    const existente = await medplum.searchOne('Communication', `identifier=${SYSTEM.communication}|${key}`);
    if (existente) {
      omitidos++;
      continue;
    }

    const pacienteRef = appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
    const descripcion = (appt.description ?? 'tu turno').split(' · ')[0] ?? 'tu turno';

    await enviarWhatsApp(medplum, event.secrets, {
      template: `recordatorio-${tipo}`,
      identifier: { system: SYSTEM.communication, value: key },
      pacienteRef,
      body: avisoRecordatorio({ tipo, descripcion, inicio, modalidad: modalidadDe(appt), teleconsultaUrl: teleconsultaUrlDe(appt) }),
    });

    if (tipo === '2h') {
      enviados2++;
    } else {
      enviados48++;
    }
  }

  const avisosPlan = enHorarioDeAvisos(ahora) ? await avisosPlanBienestar(medplum, event.secrets, hoyLocal(ahora)) : 0;

  return { ok: true, enviados48, enviados2, omitidos, avisosPlan };
}

/** Avisos de las consultas del Plan Bienestar sin agendar (R-20). Devuelve cuántos salieron. */
async function avisosPlanBienestar(medplum: MedplumClient, secrets: Secrets, hoy: string): Promise<number> {
  const codigo = `${SYSTEM.taskTipo}|${COD.agendarConsultaPb100d}`;
  const pendientes = await medplum.searchResources('Task', { code: codigo, status: ESTADOS_PENDIENTES, _count: 500 });

  // ¿Ya está agendada la inicial de cada plan? (define el día 1: antes, las ventanas son provisorias).
  const inicialAgendada = new Map<string, boolean>();
  const planListo = async (carePlanRef: string): Promise<boolean> => {
    if (!inicialAgendada.has(carePlanRef)) {
      const tareas = await medplum.searchResources('Task', { 'based-on': carePlanRef, code: codigo });
      inicialAgendada.set(
        carePlanRef,
        tareas.some((t) => leerTareaConsultaPlan(t).clave === 'inicial' && estadoTarea(t) === 'cerrado'),
      );
    }
    return inicialAgendada.get(carePlanRef)!;
  };

  let enviados = 0;
  for (const t of pendientes) {
    const d = leerTareaConsultaPlan(t);
    const pacienteRef = t.for?.reference;
    if (estadoTarea(t) !== 'pendiente' || !t.id || !d.ventana || !d.titulo || !d.carePlanRef || !pacienteRef) {
      continue;
    }
    const aviso = avisoConsultaPlanDue(d.ventana, hoy);
    if (!aviso || !(await planListo(d.carePlanRef))) {
      continue;
    }
    const key = `pb100d-${aviso}-${t.id}`;
    if (await medplum.searchOne('Communication', `identifier=${SYSTEM.communication}|${key}`)) {
      continue;
    }

    await enviarWhatsApp(medplum, secrets, {
      template: `plan-bienestar-${aviso}`,
      identifier: { system: SYSTEM.communication, value: key },
      pacienteRef,
      about: `Task/${t.id}`,
      body: avisoConsultaPlan({ aviso, titulo: d.titulo, ventana: d.ventana }),
    });
    enviados++;

    if (aviso === 'mitad') {
      // Recepción: la tarea pasa a urgente en su cola y, si hay número, un WhatsApp.
      await medplum.updateResource<Task>({ ...t, priority: 'urgent' });
      const to = secrets['RECEPCION_WHATSAPP_TO']?.valueString;
      if (to) {
        const paciente = await medplum.readResource('Patient', pacienteRef.split('/')[1]!).catch(() => undefined);
        const nombre = paciente?.name?.[0]?.text ?? [paciente?.name?.[0]?.given?.join(' '), paciente?.name?.[0]?.family].filter(Boolean).join(' ');
        await enviarWhatsApp(medplum, secrets, {
          template: 'plan-bienestar-alerta-recepcion',
          to,
          about: `Task/${t.id}`,
          body: alertaRecepcionConsultaPlan({ paciente: nombre, titulo: d.titulo, ventana: d.ventana }),
        });
      }
    }
  }
  return enviados;
}
