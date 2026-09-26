/**
 * Bot · Generar agenda (cron).
 *
 * Mantiene materializados los horarios libres (`Slot`) de cada profesional para los
 * próximos `dias` (default `DIAS_AGENDA_ADELANTE`), a partir de su disponibilidad
 * semanal y del horario del centro (`src/lib/agenda-profesional.ts`). Idempotente:
 * cada franja tiene identifier `medico@inicio` y se crea con `If-None-Exist`, así una
 * franja ya ocupada por una reserva nunca se vuelve a crear libre.
 *
 * Los horarios libres son la fuente de la disponibilidad que ve el portal
 * (`Slot?schedule=…&status=free`). Sin este cron (o sin `npm run seed -- --with-slots`)
 * la reserva igual funciona: si el horario cae en la disponibilidad del profesional,
 * la franja se materializa en el momento (R-22).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Slot } from '@medplum/fhirtypes';
import { HORARIO_SEMANAL } from '../config/horario.js';
import { MEDICOS } from '../config/medicos.js';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import { generarSlotsProfesional, identificadorSlotProfesional } from '../lib/agenda-profesional.js';

/** Cuántos días hacia adelante se mantienen generados. */
export const DIAS_AGENDA_ADELANTE = 45;

export interface EntradaGenerarAgenda {
  /** Días hacia adelante (default `DIAS_AGENDA_ADELANTE`). */
  dias?: number;
  /** Solo estos profesionales (códigos); default todos. */
  medicos?: string[];
}

export interface ResultadoGenerarAgenda {
  dias: number;
  /** Por profesional: franjas aseguradas (existentes o creadas) y si tiene agenda. */
  profesionales: Array<{ codigo: string; franjas: number; sinSchedule?: boolean; sinDisponibilidad?: boolean }>;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaGenerarAgenda>): Promise<ResultadoGenerarAgenda> {
  const dias = event.input?.dias && event.input.dias > 0 ? Math.floor(event.input.dias) : DIAS_AGENDA_ADELANTE;
  const filtro = event.input?.medicos?.length ? new Set(event.input.medicos) : undefined;
  const desde = new Date();
  const profesionales: ResultadoGenerarAgenda['profesionales'] = [];

  for (const m of MEDICOS) {
    if (filtro && !filtro.has(m.codigo)) {
      continue;
    }
    if (m.disponibilidad.length === 0) {
      profesionales.push({ codigo: m.codigo, franjas: 0, sinDisponibilidad: true });
      continue;
    }
    const schedule = await medplum.searchOne('Schedule', `identifier=${SYSTEM.medico}|SCH_${m.codigo}`);
    if (!schedule?.id) {
      profesionales.push({ codigo: m.codigo, franjas: 0, sinSchedule: true });
      continue;
    }
    let franjas = 0;
    for (const d of generarSlotsProfesional(m, HORARIO_SEMANAL, { desde, dias })) {
      const value = identificadorSlotProfesional(m.codigo, d.inicio);
      const slot: Slot = {
        resourceType: 'Slot',
        identifier: [{ system: SYSTEM.medico, value }],
        schedule: { reference: `Schedule/${schedule.id}` },
        status: 'free',
        start: d.inicio,
        end: d.fin,
        extension: [{ url: EXT.profesional, valueString: m.codigo }],
      };
      await medplum.createResourceIfNoneExist(slot, `identifier=${SYSTEM.medico}|${value}`);
      franjas++;
    }
    profesionales.push({ codigo: m.codigo, franjas });
  }

  return { dias, profesionales };
}
