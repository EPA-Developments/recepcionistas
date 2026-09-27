/**
 * Project Secrets de Medplum desde los scripts locales (API de admin del proyecto; la
 * ClientApplication del `.env` tiene que ser admin).
 *
 * `POST admin/projects/{id}/secrets` REEMPLAZA la lista entera: para cambiar uno se leen
 * todos, se fusiona (`fusionarSecretos`) y se manda la lista completa. Los valores nunca
 * se imprimen.
 */
import type { MedplumClient, MedplumRequestOptions } from '@medplum/core';
import type { ProjectSetting } from '@medplum/fhirtypes';

/** Sin la cache de 60 s del cliente (el `RequestInit` de Node no declara `cache`). */
const SIN_CACHE = { cache: 'no-cache' } as MedplumRequestOptions;

/** Los secrets actuales con los cambios aplicados: reemplaza por nombre y agrega los nuevos al final. */
export function fusionarSecretos(actuales: ProjectSetting[], cambios: ProjectSetting[]): ProjectSetting[] {
  const porNombre = new Map(cambios.map((c) => [c.name, c]));
  const fusion = actuales.map((s) => porNombre.get(s.name) ?? s);
  for (const c of cambios) {
    if (!actuales.some((s) => s.name === c.name)) {
      fusion.push(c);
    }
  }
  return fusion;
}

/** Los Project Secrets (sin cache). Falla si las credenciales no pueden leer el proyecto. */
export async function leerSecretos(medplum: MedplumClient, projectId: string): Promise<ProjectSetting[]> {
  const r = (await medplum.get(`admin/projects/${projectId}`, SIN_CACHE)) as {
    project?: { secret?: ProjectSetting[] };
  };
  if (!r?.project) {
    throw new Error('No pude leer el proyecto: la ClientApplication del .env tiene que ser admin del proyecto SOM.');
  }
  return r.project.secret ?? [];
}

/**
 * Guarda `cambios` sin tocar los demás secrets. Si no hay ninguno cargado no escribe: la
 * lista vacía puede ser un servidor que no los devuelve, y mandarla los borraría todos.
 */
export async function guardarSecretos(medplum: MedplumClient, projectId: string, cambios: ProjectSetting[]): Promise<void> {
  const actuales = await leerSecretos(medplum, projectId);
  if (actuales.length === 0) {
    throw new Error('No veo ningún Project Secret: no escribo para no borrar los que haya. Cargalo a mano (Project → Secrets).');
  }
  await medplum.post(`admin/projects/${projectId}/secrets`, fusionarSecretos(actuales, cambios));
  const despues = new Set((await leerSecretos(medplum, projectId)).map((s) => s.name));
  const perdidos = actuales.filter((s) => !despues.has(s.name)).map((s) => s.name);
  if (perdidos.length > 0) {
    throw new Error(`Después de guardar faltan estos Project Secrets: ${perdidos.join(', ')}. Revisalos en Project → Secrets.`);
  }
}

/** El valor de texto de un secret, o undefined. */
export function valorSecreto(secretos: ProjectSetting[], nombre: string): string | undefined {
  return secretos.find((s) => s.name === nombre)?.valueString;
}
