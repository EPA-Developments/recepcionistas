/**
 * Bot · som-recomputar-segmentos — CRM: materializa los miembros de los segmentos.
 *
 * Para cada segmento (Group con identifier `SYSTEM.segmento`) evalúa sus criterios
 * (origen del lead / red social, perfil de interés, ciclo de vida, biomarcadores;
 * ver `src/lib/crm.ts`) sobre los Patient y reescribe `member[]` + `quantity`.
 *
 * Disparo:
 *   - cron (sin input): recalcula todos los segmentos;
 *   - on-demand con un Group como input: recalcula solo ese.
 *
 * Un segmento con criterios inválidos NO se recalcula (queda como estaba y se
 * informa en `errores`): un criterio ignorado lo ampliaría. Recorre los Patient
 * por páginas; para volúmenes grandes conviene pre-filtrar con SearchParameters
 * propios sobre las extensiones.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Group, Observation } from '@medplum/fhirtypes';
import {
  LOINC_SYSTEM,
  cumpleCriterios,
  esSegmento,
  loincsRequeridos,
  parsearCriterios,
  perfilCrm,
  type Criterio,
} from '../lib/crm.js';

export interface ResultadoSegmentos {
  segmentos: { nombre: string; miembros: number }[];
  errores: { nombre: string; motivo: string }[];
}

async function ultimoValor(medplum: MedplumClient, pacienteRef: string, loinc: string): Promise<number | undefined> {
  const obs = await medplum.searchResources('Observation', {
    patient: pacienteRef,
    code: `${LOINC_SYSTEM}|${loinc}`,
    _sort: '-date',
    _count: '1',
  });
  return (obs[0] as Observation | undefined)?.valueQuantity?.value;
}

async function recomputar(medplum: MedplumClient, group: Group, criterios: Criterio[]): Promise<number> {
  // Primero los criterios de texto (sin red); los biomarcadores solo si hace falta.
  const deTexto = criterios.filter((c) => c.tipo !== 'biomarcador');
  const deBiomarcador = criterios.filter((c) => c.tipo === 'biomarcador');
  const loincs = loincsRequeridos(deBiomarcador);

  const miembros: NonNullable<Group['member']> = [];
  for await (const pagina of medplum.searchResourcePages('Patient', { _count: '500' })) {
    for (const p of pagina) {
      const perfil = perfilCrm(p);
      if (!cumpleCriterios(deTexto, perfil)) {
        continue;
      }
      const ref = `Patient/${p.id}`;
      const valores = new Map<string, number>();
      for (const loinc of loincs) {
        const v = await ultimoValor(medplum, ref, loinc);
        if (v !== undefined) {
          valores.set(loinc, v);
        }
      }
      if (cumpleCriterios(deBiomarcador, perfil, valores)) {
        miembros.push({ entity: { reference: ref } });
      }
    }
  }

  await medplum.updateResource<Group>({ ...group, quantity: miembros.length, member: miembros });
  return miembros.length;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<Group | undefined>,
): Promise<ResultadoSegmentos> {
  const input = event.input as Group | undefined;
  let groups: Group[];
  if (input?.resourceType === 'Group') {
    groups = [input];
  } else {
    groups = [];
    for await (const pagina of medplum.searchResourcePages('Group', { _count: '200' })) {
      groups.push(...pagina.filter(esSegmento));
    }
  }

  const resultado: ResultadoSegmentos = { segmentos: [], errores: [] };
  for (const g of groups) {
    const nombre = g.name ?? g.id ?? 'segmento';
    if (!esSegmento(g)) {
      resultado.errores.push({ nombre, motivo: 'El Group no es un segmento del CRM (falta el identifier de segmento).' });
      continue;
    }
    const { criterios, invalidos } = parsearCriterios(g);
    if (invalidos > 0) {
      resultado.errores.push({ nombre, motivo: `${invalidos} criterio(s) inválido(s): no se recalcula.` });
      continue;
    }
    resultado.segmentos.push({ nombre, miembros: await recomputar(medplum, g, criterios) });
  }
  return resultado;
}
