/**
 * Auditoría de rangos de medicina funcional en el servidor.
 *
 *   npm run biomarcadores:convencional            → DRY-RUN: lista las
 *       ObservationDefinition del proyecto que tienen rangos `funcional`.
 *   npm run biomarcadores:convencional -- --apply → les quita esos rangos
 *       (conserva los convencionales; no borra ninguna definición).
 *
 * Este backend es de salud convencional (AHA/ACC, ADA, KDIGO): no publica rangos
 * funcionales. Las definiciones que carga `npm run seed` ya salen sin ellos; esto
 * limpia las que se cargaron por otra vía (p. ej. el catálogo previo del portal).
 * Medplum guarda el historial de cada recurso: la versión anterior queda en `_history`.
 */
import 'dotenv/config';
import { quitarRangosFuncionales } from '../lib/rangos-convencionales.js';
import { conectarMedplum } from './conexion.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { medplum } = await conectarMedplum();

  const defs = await medplum.searchResources('ObservationDefinition', { _count: 1000 });
  const conFuncionales = defs.map((od) => ({ od, r: quitarRangosFuncionales(od) })).filter((x) => x.r.quitados > 0);

  console.log('=== Rangos de medicina funcional en ObservationDefinition ===');
  console.log(`  Total: ${defs.length} · con rangos funcionales: ${conFuncionales.length}`);
  for (const { od, r } of conFuncionales) {
    const c = od.code?.coding?.[0];
    const nombre = c?.display ?? od.code?.text ?? c?.code ?? od.id;
    console.log(
      `  - ${nombre} (${c?.system ?? '?'}|${c?.code ?? '?'}) · ${r.quitados} rango(s) funcional(es)` +
        (r.sinRangos ? ' · ⚠️ queda SIN rango convencional' : ''),
    );
    if (apply && od.id) {
      await medplum.updateResource(r.definicion);
    }
  }

  console.log(
    apply
      ? `\nListo: se quitaron los rangos funcionales de ${conFuncionales.length} definición(es).`
      : '\n[dry-run] No se modificó nada. Para aplicar: npm run biomarcadores:convencional -- --apply',
  );
}

main().catch((err) => {
  console.error('La auditoría falló:', err);
  process.exitCode = 1;
});
