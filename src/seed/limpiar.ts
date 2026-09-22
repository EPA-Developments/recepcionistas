/**
 * Limpieza de Schedules ajenos / duplicados.
 *
 *   npm run limpiar            → DRY-RUN: lista qué se eliminaría, sin borrar.
 *   npm run limpiar -- --apply → elimina los Schedule no canónicos y sus Slots.
 *
 * "Canónico" = Schedule cuya extensión recurso-fisico apunta a un recurso del
 * catálogo (src/config/recursos.ts). Todo lo demás (otra convención de nombres,
 * la sede como recurso, duplicados de otro origen) se considera ajeno.
 *
 * Solo toca Schedule + Slot (datos de agenda). No borra Location ni Patient.
 */
import 'dotenv/config';
import type { Schedule } from '@medplum/fhirtypes';
import { RECURSOS_POR_CODIGO } from '../config/recursos.js';
import { EXT } from '../fhir/identifiers.js';
import { conectarMedplum } from './conexion.js';

function esCanonica(sch: Schedule): boolean {
  const code = sch.extension?.find((e) => e.url === EXT.recursoFisico)?.valueString;
  return Boolean(code && RECURSOS_POR_CODIGO.has(code));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const { medplum } = await conectarMedplum();

  const schedules = await medplum.searchResources('Schedule', { _count: 200 });
  const ajenas = schedules.filter((s) => !esCanonica(s));
  const canonicas = schedules.length - ajenas.length;

  console.log('=== Limpieza de Schedules ===');
  console.log(`  Total: ${schedules.length} · canónicas: ${canonicas} · a eliminar: ${ajenas.length}`);

  let slotsBorrados = 0;
  for (const s of ajenas) {
    const nombre = s.actor?.[0]?.display ?? s.id ?? '?';
    const slots = await medplum.searchResources('Slot', { schedule: `Schedule/${s.id}`, _count: 1000 });
    console.log(`  - ${nombre} (Schedule/${s.id}) · ${slots.length} slots`);
    if (!apply) {
      continue;
    }
    for (const slot of slots) {
      if (slot.id) {
        try {
          await medplum.deleteResource('Slot', slot.id);
          slotsBorrados++;
        } catch (e) {
          console.warn(`    ! No se pudo borrar Slot/${slot.id}: ${(e as Error).message}`);
        }
      }
    }
    if (s.id) {
      try {
        await medplum.deleteResource('Schedule', s.id);
      } catch (e) {
        console.warn(`    ! No se pudo borrar Schedule/${s.id} (¿referenciado?): ${(e as Error).message}`);
      }
    }
  }

  if (!apply) {
    console.log('\n[dry-run] No se borró nada. Corré `npm run limpiar -- --apply` para eliminar.');
  } else {
    console.log(`\nLimpieza completada. Schedules eliminados: ${ajenas.length} · Slots: ${slotsBorrados}`);
  }
}

main().catch((err) => {
  console.error('Limpieza falló:', err);
  process.exitCode = 1;
});
