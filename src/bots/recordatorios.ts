/**
 * Bot · Recordatorios automáticos de turnos (cron, 48 h y 2 h).
 *
 * Pensado para ejecutarse seguido (cronTimer, p. ej. cada 30 min). Busca los
 * turnos CONFIRMADOS (`booked`) que arrancan dentro de la ventana máxima (48 h) y,
 * para cada uno, manda el recordatorio que corresponda (48 h → 2 h) por WhatsApp.
 *
 * Idempotente: registra cada recordatorio como `Communication` con un identifier
 * único (`recordatorio-{tipo}-{turno}`); si ya existe, no reenvía.
 *
 * La decisión de "qué recordatorio toca" vive en `src/lib/recordatorios.ts` (pura).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { SYSTEM } from '../fhir/identifiers.js';
import { recordatorioDue, VENTANA_MAX_MS, type TipoRecordatorio } from '../lib/recordatorios.js';
import { enviarWhatsApp } from './_shared.js';

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
}

const fmtFechaHora = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});
const fmtHora = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});

function cuerpo(tipo: TipoRecordatorio, descripcion: string, inicio: Date): string {
  if (tipo === '2h') {
    return `Segunda Opinión Médica: ¡tu turno de ${descripcion} es hoy a las ${fmtHora.format(inicio)}! Te esperamos en un rato. 💙`;
  }
  return `Segunda Opinión Médica: te recordamos tu turno de ${descripcion} el ${fmtFechaHora.format(inicio)}. ¡Te esperamos! 💙`;
}

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
      body: cuerpo(tipo, descripcion, inicio),
    });

    if (tipo === '2h') {
      enviados2++;
    } else {
      enviados48++;
    }
  }

  return { ok: true, enviados48, enviados2, omitidos };
}
