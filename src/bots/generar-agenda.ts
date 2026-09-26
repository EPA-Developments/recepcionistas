/**
 * Bot · Generar agenda (cron).
 *
 * Mantiene materializados los horarios libres (`Slot`) de cada profesional para los
 * próximos `dias` (default `DIAS_AGENDA_ADELANTE`), a partir de su disponibilidad
 * semanal y del horario del centro (`src/lib/agenda-profesional.ts`). Idempotente:
 * cada franja tiene identifier `medico@inicio` y se crea con `If-None-Exist`, así una
 * franja ya ocupada por una reserva nunca se vuelve a crear libre. Si cambió la
 * modalidad de una franja (p. ej. pasó a ser solo presencial), la corrige en las que
 * siguen libres; las ocupadas no se tocan.
 *
 * Los horarios libres son la fuente de la disponibilidad que ve el portal
 * (`Slot?schedule=…&status=free`, filtrando por la extensión `modalidad`). Sin este cron
 * (o sin `npm run seed -- --with-slots`) la reserva igual funciona: si el horario cae en
 * la disponibilidad del profesional, la franja se materializa en el momento (R-22).
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Slot } from '@medplum/fhirtypes';
import { HORARIO_SEMANAL } from '../config/horario.js';
import { MEDICOS } from '../config/medicos.js';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import {
  extensionesSlotProfesional,
  generarSlotsProfesional,
  identificadorSlotProfesional,
  mismasModalidades,
  modalidadesDeSlot,
} from '../lib/agenda-profesional.js';
import { extensionModalidad } from '../lib/teleconsulta.js';

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
  /** Por profesional: franjas aseguradas (existentes o creadas), libres corregidas de modalidad, y si tiene agenda. */
  profesionales: Array<{ codigo: string; franjas: number; actualizadas?: number; sinSchedule?: boolean; sinDisponibilidad?: boolean }>;
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaGenerarAgenda>): Promise<ResultadoGenerarAgenda> {
  const dias = event.input?.dias && event.input.dias > 0 ? Math.floor(event.input.dias) : DIAS_AGENDA_ADELANTE;
  const filtro = event.input?.medicos?.length ? new Set(event.input.medicos) : undefined;
  const desde = new Date();
  // Desde la medianoche (UTC) del día de hoy: cubre todas las franjas que se generan hoy.
  const desdeDia = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate()));
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
    // Lo que ya existe, por identifier: evita una búsqueda por franja y permite corregir modalidades.
    const existentes = await medplum.searchResources('Slot', `schedule=Schedule/${schedule.id}&start=ge${desdeDia.toISOString()}&_count=1000`);
    const porIdentifier = new Map<string, Slot>();
    for (const s of existentes) {
      const value = s.identifier?.find((i) => i.system === SYSTEM.medico)?.value;
      if (value) {
        porIdentifier.set(value, s);
      }
    }

    let franjas = 0;
    let actualizadas = 0;
    for (const d of generarSlotsProfesional(m, HORARIO_SEMANAL, { desde, dias })) {
      const value = identificadorSlotProfesional(m.codigo, d.inicio);
      const existente = porIdentifier.get(value);
      if (!existente) {
        const slot: Slot = {
          resourceType: 'Slot',
          identifier: [{ system: SYSTEM.medico, value }],
          schedule: { reference: `Schedule/${schedule.id}` },
          status: 'free',
          start: d.inicio,
          end: d.fin,
          extension: extensionesSlotProfesional(m.codigo, d.modalidades),
        };
        await medplum.createResourceIfNoneExist(slot, `identifier=${SYSTEM.medico}|${value}`);
      } else if (existente.status === 'free' && !mismasModalidades(modalidadesDeSlot(existente), d.modalidades)) {
        // Cambió la modalidad de la franja: se corrige solo mientras sigue libre.
        await medplum.updateResource<Slot>({
          ...existente,
          extension: [...(existente.extension ?? []).filter((e) => e.url !== EXT.modalidad), ...d.modalidades.map(extensionModalidad)],
        });
        actualizadas++;
      }
      franjas++;
    }
    profesionales.push({ codigo: m.codigo, franjas, ...(actualizadas ? { actualizadas } : {}) });
  }

  return { dias, profesionales };
}
