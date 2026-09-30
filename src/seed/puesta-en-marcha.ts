/**
 * Chequeo de la puesta en marcha del Plan Bienestar 100 Días® en el proyecto SOM.
 *
 *   npm run puesta-en-marcha   → lee el estado del proyecto y lista qué está y qué falta,
 *                                 con el comando que lo arregla. SOLO LECTURA: no escribe nada.
 *
 * Mira: bots creados, roles (AccessPolicy) y si están al día con el repo, catálogo del seed
 * (instrumentos, programas, profesionales, agendas), recursos que siembra el monorepo del
 * plan, Project Secrets por nombre (nunca valores) y el default patient access policy.
 * La lógica vive en `src/lib/puesta-en-marcha.ts` (pura, testeada).
 *
 * Termina con código 1 si falta algo (sirve como gate antes de la prueba de punta a punta).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import type { MedplumClient } from '@medplum/core';
import type { AccessPolicy, Bot, PlanDefinition, Practitioner, Questionnaire, Schedule } from '@medplum/fhirtypes';
import { INSTRUMENTOS_PB100D } from '../config/instrumentos-pb100d.js';
import { MEDICOS } from '../config/medicos.js';
import { SYSTEM } from '../fhir/identifiers.js';
import {
  PLAN_DEFINITIONS_DEL_SEED,
  RECURSOS_DEL_MONOREPO,
  agruparChequeos,
  evaluarPuestaEnMarcha,
  resumirPuestaEnMarcha,
  type Chequeo,
  type EstadoServidor,
} from '../lib/puesta-en-marcha.js';
import { conectarMedplum } from './conexion.js';

/** Los bots que deploya `npm run deploy:bots` (misma lista que escribe en `medplum.config.json`), con el id que guardó. */
function botsDelConfig(): { nombres: string[]; ids: Record<string, string> } {
  const config = JSON.parse(readFileSync('medplum.config.json', 'utf8')) as { bots?: Array<{ name: string; id?: string }> };
  const bots = config.bots ?? [];
  return { nombres: bots.map((b) => b.name), ids: Object.fromEntries(bots.map((b) => [b.name, b.id ?? ''])) };
}

async function urlsExistentes(medplum: MedplumClient, tipo: 'PlanDefinition' | 'Questionnaire', urls: string[]): Promise<string[]> {
  const encontradas: string[] = [];
  for (const url of urls) {
    const r = await medplum.searchOne(tipo, { url }).catch(() => undefined);
    if ((r as PlanDefinition | Questionnaire | undefined)?.url === url) {
      encontradas.push(url);
    }
  }
  return encontradas;
}

async function leerEstado(medplum: MedplumClient, projectId: string): Promise<EstadoServidor> {
  const project = await medplum.readResource('Project', projectId);
  const bots = await medplum.searchResources('Bot', { _count: 500 }).catch(() => [] as Bot[]);
  const policies = await medplum.searchResources('AccessPolicy', { _count: 100 }).catch(() => [] as AccessPolicy[]);
  const schedules = await medplum.searchResources('Schedule', { _count: 200 }).catch(() => [] as Schedule[]);

  const practitionerCodigos: string[] = [];
  for (const m of MEDICOS) {
    const p = await medplum.searchOne('Practitioner', { identifier: `${SYSTEM.medico}|${m.codigo}` }).catch(() => undefined as Practitioner | undefined);
    if (p) {
      practitionerCodigos.push(m.codigo);
    }
  }

  const questionnaireUrls = await urlsExistentes(medplum, 'Questionnaire', [
    ...INSTRUMENTOS_PB100D.map((q) => q.url).filter((u): u is string => Boolean(u)),
    ...RECURSOS_DEL_MONOREPO.filter((r) => r.tipo === 'Questionnaire').map((r) => r.url),
  ]);
  const planDefinitionUrls = await urlsExistentes(medplum, 'PlanDefinition', [
    ...PLAN_DEFINITIONS_DEL_SEED.map((p) => p.url),
    ...RECURSOS_DEL_MONOREPO.filter((r) => r.tipo === 'PlanDefinition').map((r) => r.url),
  ]);

  const config = botsDelConfig();
  return {
    projectId,
    ...(project.name ? { nombreProyecto: project.name } : {}),
    bots: bots.map((b) => b.name).filter((n): n is string => Boolean(n)),
    botsEsperados: config.nombres,
    idsConfig: config.ids,
    policies,
    questionnaireUrls,
    planDefinitionUrls,
    practitionerCodigos,
    agendas: schedules.flatMap((s) => (s.identifier ?? []).map((i) => i.value ?? '')).filter((v) => v.startsWith('SCH_')),
    // Sólo los nombres: los valores no se leen ni se imprimen.
    secrets: (project.secret ?? []).map((s) => s.name).filter((n): n is string => Boolean(n)),
    ...(project.defaultPatientAccessPolicy?.reference ? { defaultPatientPolicyId: project.defaultPatientAccessPolicy.reference.split('/')[1] } : {}),
  };
}

const ICONO: Record<Chequeo['estado'], string> = { ok: '✓', atencion: '⚠️', falta: '❌' };

async function main(): Promise<void> {
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log('=== Puesta en marcha · Plan Bienestar 100 Días® ===');
  console.log(`  Servidor: ${baseUrl}`);

  const estado = await leerEstado(medplum, projectId);
  const chequeos = evaluarPuestaEnMarcha(estado);

  for (const [grupo, lista] of agruparChequeos(chequeos)) {
    console.log(`\n${grupo}`);
    for (const c of lista) {
      console.log(`  ${ICONO[c.estado]} ${c.titulo}${c.detalle ? ` · ${c.detalle}` : ''}`);
    }
  }

  const r = resumirPuestaEnMarcha(chequeos);
  console.log(`\n${r.ok} ok · ${r.atencion} con atención · ${r.falta} faltan`);
  if (r.arreglos.length) {
    console.log('\nPara resolverlo, en este orden:');
    for (const a of r.arreglos) {
      console.log(`  • ${a}`);
    }
  }
  if (r.listo) {
    console.log('\n✅ No falta nada: se puede hacer la prueba de punta a punta (docs/puesta-en-marcha.md del monorepo, paso 8).');
  } else {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Chequeo falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
