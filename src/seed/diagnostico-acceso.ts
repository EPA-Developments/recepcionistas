/**
 * Diagnóstico + reparación del acceso del paciente al portal.
 *
 *   npm run diagnostico-acceso                      → DRY-RUN: diagnostica el proyecto
 *                                                     (policy del portal + default del proyecto).
 *   npm run diagnostico-acceso -- --paciente=<x>    → además diagnostica la membership del
 *                                                     paciente (x = email | id | Patient/id).
 *   npm run diagnostico-acceso -- --paciente=<x> --apply
 *                                                   → REPARA: setea el defaultPatientAccessPolicy
 *                                                     del proyecto y re-apunta la membership del
 *                                                     paciente a la policy "Paciente SOM — Portal".
 *
 * Por qué existe: el portal le da 403 "Forbidden" al paciente cuando la policy efectiva no
 * concede un recurso que el portal busca (p. ej. sin `PractitionerRole`, "Reservar un
 * turno" no muestra profesionales). Pasa por dos motivos, y este script distingue cuál:
 *  - La AccessPolicy "Paciente SOM — Portal" del servidor quedó atrasada respecto del
 *    repo (`src/fhir/access-policies.ts`): el seed no corrió desde el último cambio.
 *    Se arregla con `npm run seed` (upsert por nombre); acá solo se informa.
 *  - El seed NO setea el `defaultPatientAccessPolicy` del proyecto ni re-apunta las
 *    `ProjectMembership` ya creadas: un paciente invitado antes de tener la policy
 *    correcta —o que quedó en otro proyecto— sigue con otra policy. Con --apply se
 *    corrige sin entrar a la consola.
 * La lista de recursos que busca el portal y la comparación con el repo viven en
 * `src/lib/diagnostico-acceso.ts` (lógica pura, testeada).
 *
 * Idempotente y seguro: sin --apply no escribe nada. Con --apply solo toca el
 * `defaultPatientAccessPolicy` del Project y el `accessPolicy` de la membership del
 * paciente indicado; no borra nada ni modifica la policy.
 */
import 'dotenv/config';
import type { MedplumClient } from '@medplum/core';
import type { AccessPolicy, Patient, Project, ProjectMembership, Reference } from '@medplum/fhirtypes';
import { NOMBRE_POLICY_PACIENTE } from '../fhir/access-policies.js';
import { RECURSOS_CLAVE_PORTAL, diagnosticarPolicy, tiposConcedidos } from '../lib/diagnostico-acceso.js';
import { conectarMedplum } from './conexion.js';

/** --paciente=<x> → x (email | id | Patient/id). undefined si no se pasó. */
function parsePaciente(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--paciente='));
  const v = arg?.split('=')[1]?.trim();
  return v || undefined;
}

/** Resuelve el Patient objetivo a partir de email | id | "Patient/id". */
async function resolverPaciente(medplum: MedplumClient, ref: string): Promise<Patient | undefined> {
  const id = ref.startsWith('Patient/') ? ref.slice('Patient/'.length) : ref;
  if (ref.includes('@')) {
    return medplum.searchOne('Patient', `email=${encodeURIComponent(ref)}`);
  }
  try {
    return await medplum.readResource('Patient', id);
  } catch {
    // Puede ser un nombre/identificador suelto: último intento por telecom/identifier.
    return medplum.searchOne('Patient', `identifier=${encodeURIComponent(ref)}`);
  }
}

function refId(ref?: Reference): string | undefined {
  return ref?.reference?.split('/')[1];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const pacienteArg = parsePaciente();

  // 1) Proyecto de las credenciales (el ClientApplication define el proyecto que se toca;
  //    si no coincide con MEDPLUM_PROJECT_ID, conectarMedplum aborta).
  const { medplum, projectId } = await conectarMedplum();
  const project = await medplum.readResource('Project', projectId);

  console.log('=== Diagnóstico de acceso del paciente al portal ===');
  console.log(`  Proyecto: ${project.name ?? '(sin nombre)'} · ${projectId}`);
  console.log(`  Servidor: ${medplum.getBaseUrl()}`);

  // 2) AccessPolicy "Paciente SOM — Portal".
  const policy = await medplum.searchOne('AccessPolicy', `name=${encodeURIComponent(NOMBRE_POLICY_PACIENTE)}`);
  if (!policy?.id) {
    console.log(`\n❌ No existe la AccessPolicy "${NOMBRE_POLICY_PACIENTE}" en este proyecto.`);
    console.log('   Aplicá primero el seed:  npm run seed');
    process.exitCode = 1;
    return;
  }
  const { faltantes, entradasFaltantes } = diagnosticarPolicy(policy);
  const policyOk = faltantes.length === 0 && entradasFaltantes.length === 0;
  console.log(`\n  AccessPolicy "${policy.name}" → AccessPolicy/${policy.id}`);
  console.log(`    Recursos concedidos: ${[...tiposConcedidos(policy)].sort().join(', ')}`);
  if (faltantes.length) {
    console.log('    ⚠️  Le faltan recursos que el portal busca (Medplum responde 403 y la pantalla queda vacía):');
    for (const f of faltantes) {
      console.log(`        • ${f.resourceType} → ${f.pantalla}`);
    }
  } else {
    console.log(`    ✓ Concede los ${RECURSOS_CLAVE_PORTAL.length} recursos de solo lectura que el portal busca.`);
  }
  if (entradasFaltantes.length) {
    console.log('    ⚠️  Está atrasada respecto del repo (src/fhir/access-policies.ts); le faltan estas entradas:');
    for (const e of entradasFaltantes) {
      console.log(`        • ${e}`);
    }
    console.log('        Aplicá el seed: npm run seed  (hace upsert de la policy por nombre; este script no la toca)');
  } else {
    console.log('    ✓ Igual a la del repo (src/fhir/access-policies.ts).');
  }

  const policyRef: Reference<AccessPolicy> = { reference: `AccessPolicy/${policy.id}` };

  // 3) Default Patient Access Policy del proyecto (lo heredan los nuevos invitados).
  const defaultId = refId(project.defaultPatientAccessPolicy);
  const defaultOk = defaultId === policy.id;
  console.log('\n  Default Patient Access Policy del proyecto:');
  if (!defaultId) {
    console.log('    ⚠️  No está seteada → los pacientes nuevos no heredan la policy del portal.');
  } else if (defaultOk) {
    console.log(`    ✓ Apunta a "${NOMBRE_POLICY_PACIENTE}" (AccessPolicy/${defaultId}).`);
  } else {
    console.log(`    ⚠️  Apunta a otra policy (AccessPolicy/${defaultId}), no a "${NOMBRE_POLICY_PACIENTE}".`);
  }

  // 4) Membership del paciente (si se pidió).
  let membership: ProjectMembership | undefined;
  let membershipOk = false;
  if (pacienteArg) {
    const paciente = await resolverPaciente(medplum, pacienteArg);
    if (!paciente?.id) {
      console.log(`\n❌ No encontré al paciente "${pacienteArg}" en este proyecto.`);
      console.log('   Si está en OTRO proyecto, corré este script con las credenciales de ese proyecto.');
      process.exitCode = 1;
      return;
    }
    const display = paciente.name?.[0]?.text ?? `${paciente.name?.[0]?.given?.join(' ') ?? ''} ${paciente.name?.[0]?.family ?? ''}`.trim();
    membership = await medplum.searchOne('ProjectMembership', `profile=Patient/${paciente.id}`);
    console.log(`\n  Paciente: ${display || '(sin nombre)'} → Patient/${paciente.id}`);
    if (!membership?.id) {
      console.log('    ❌ No tiene ProjectMembership en este proyecto (no puede loguearse acá).');
      console.log('       Quizá su login/membership está en otro proyecto: revisá cuál y reapuntá front+seed.');
      process.exitCode = 1;
      return;
    }
    const memPolicyId = refId(membership.accessPolicy);
    membershipOk = memPolicyId === policy.id;
    console.log(`    ProjectMembership/${membership.id}`);
    if (!memPolicyId) {
      console.log('    ⚠️  Su membership NO referencia ninguna AccessPolicy → acceso denegado por defecto (403).');
    } else if (membershipOk) {
      console.log(`    ✓ Su membership ya apunta a "${NOMBRE_POLICY_PACIENTE}".`);
    } else {
      console.log(`    ⚠️  Su membership apunta a OTRA policy (AccessPolicy/${memPolicyId}) → de ahí el 403.`);
    }
  }

  // 5) Resumen / reparación.
  const reparaDefault = !defaultOk;
  const reparaMembership = Boolean(membership) && !membershipOk;

  if (!reparaDefault && !reparaMembership) {
    if (policyOk) {
      console.log('\n✅ Todo en orden: la policy concede los recursos y los punteros apuntan bien.');
      console.log('   Si el portal sigue dando 403, el login del paciente está en OTRO proyecto.');
    } else {
      console.log('\n⚠️  Los punteros apuntan bien, pero la policy del servidor está atrasada: corré npm run seed.');
    }
    return;
  }

  console.log('\n  Cambios necesarios:');
  if (!policyOk) {
    console.log('    • Correr npm run seed para actualizar la policy (este script no la modifica)');
  }
  if (reparaDefault) {
    console.log(`    • Setear defaultPatientAccessPolicy → AccessPolicy/${policy.id}`);
  }
  if (reparaMembership && membership) {
    console.log(`    • Re-apuntar ProjectMembership/${membership.id}.accessPolicy → AccessPolicy/${policy.id}`);
  }

  if (!apply) {
    console.log('\n[dry-run] No se escribió nada. Volvé a correr con --apply para aplicar los cambios.');
    return;
  }

  if (reparaDefault) {
    const actualizado: Project = { ...project, defaultPatientAccessPolicy: policyRef };
    try {
      await medplum.updateResource(actualizado);
      console.log('    ✓ defaultPatientAccessPolicy actualizado.');
    } catch (e) {
      console.warn(`    ! No pude actualizar el Project (¿faltan permisos de admin?): ${(e as Error).message}`);
    }
  }
  if (reparaMembership && membership) {
    const actualizada: ProjectMembership = { ...membership, accessPolicy: policyRef };
    try {
      // Endpoint de administración para actualizar una membership existente.
      await medplum.post(`admin/projects/${projectId}/members/${membership.id}`, actualizada);
      console.log('    ✓ Membership del paciente re-apuntada a la policy del portal.');
    } catch (e) {
      console.warn(`    ! No pude actualizar la membership (¿faltan permisos de admin?): ${(e as Error).message}`);
    }
  }

  console.log('\nReparación completada. Pedile al paciente que recargue el portal (puede requerir re-login).');
}

main().catch((err) => {
  console.error('Diagnóstico falló:', err);
  process.exitCode = 1;
});
