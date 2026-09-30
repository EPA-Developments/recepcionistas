/**
 * Uso de IA del mes: suma los AuditEvent `uso-ia` (tokens y costo estimado) por proceso.
 *
 *   npm run uso:ia               → mes en curso
 *   npm run uso:ia -- 2026-10    → ese mes (hora de Argentina)
 *
 * Solo lectura. El costo es el estimado que guardó cada bot con la lista de precios de
 * `src/lib/uso-ia.ts`; la factura del proveedor manda.
 */
import 'dotenv/config';
import { SYSTEM } from '../fhir/identifiers.js';
import { TIPO_USO_IA, rangoMesAR, resumirUsoIa } from '../lib/uso-ia.js';
import { conectarMedplum } from './conexion.js';

const MAX_EVENTOS = 1000;

const numero = (n: number): string => n.toLocaleString('es-AR');
const dolares = (n: number): string => `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main(): Promise<void> {
  const mes = process.argv[2] ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
    console.error(`"${mes}" no es un mes. Uso: npm run uso:ia [-- AAAA-MM]`);
    process.exitCode = 1;
    return;
  }
  const { desde, hasta } = rangoMesAR(mes);
  const { medplum } = await conectarMedplum();
  const eventos = await medplum.searchResources('AuditEvent', [
    ['type', `${SYSTEM.usoIa}|${TIPO_USO_IA.code}`],
    ['date', `ge${desde}`],
    ['date', `lt${hasta}`],
    ['_count', String(MAX_EVENTOS)],
  ]);

  console.log(`Uso de IA · ${mes} (hora de Argentina)`);
  const resumen = resumirUsoIa(eventos);
  if (resumen.length === 0) {
    console.log('  Sin llamadas registradas.');
    return;
  }
  for (const r of resumen) {
    const conPrecio = r.llamadas - r.sinPrecio;
    console.log(
      `  ${r.nombre}: ${numero(r.llamadas)} llamadas` +
        `${r.sinResultado ? ` (${numero(r.sinResultado)} sin resultado: las resolvió una persona)` : ''}` +
        ` · ${numero(r.tokensEntrada)} tokens de entrada · ${numero(r.tokensSalida)} de salida` +
        ` · ≈ ${dolares(r.costoUsd)}` +
        `${conPrecio > 0 ? ` (≈ ${dolares(r.costoUsd / conPrecio)} por llamada)` : ''}`,
    );
    if (r.sinPrecio) {
      console.log(`    ! ${numero(r.sinPrecio)} con un modelo sin precio cargado: no suman al total (ver src/lib/uso-ia.ts).`);
    }
  }
  console.log(`  Total ≈ ${dolares(resumen.reduce((t, r) => t + r.costoUsd, 0))} (estimado; la factura del proveedor manda)`);
  if (eventos.length >= MAX_EVENTOS) {
    console.log(`  ! Se leyeron solo los primeros ${MAX_EVENTOS} registros: el total real es mayor.`);
  }
}

main().catch((err) => {
  console.error('Uso de IA: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
