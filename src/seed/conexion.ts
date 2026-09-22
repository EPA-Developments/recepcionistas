/**
 * Conexión a Medplum para los scripts locales (seed, deploy de bots, datos demo,
 * limpieza y diagnósticos).
 *
 * Usa las credenciales de la ClientApplication del `.env` de la raíz y, si está
 * seteado `MEDPLUM_PROJECT_ID`, verifica que esas credenciales sean de ESE
 * proyecto antes de devolver el cliente. Así un `.env` con credenciales de otro
 * proyecto aborta en vez de cargar el seed o deployar bots en el lugar equivocado.
 */
import { MedplumClient } from '@medplum/core';

export function requireEnv(nombre: string): string {
  const v = process.env[nombre];
  if (!v) {
    throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example).`);
  }
  return v;
}

/**
 * Compara el proyecto de las credenciales con el esperado (`MEDPLUM_PROJECT_ID`).
 * Sin proyecto esperado solo exige que el real se conozca. Devuelve el id real.
 */
export function verificarProyecto(real: string | undefined, esperado: string | undefined): string {
  if (!real) {
    throw new Error('No pude determinar el projectId de las credenciales de Medplum.');
  }
  if (esperado && real !== esperado) {
    throw new Error(
      `Las credenciales de Medplum son del proyecto ${real}, pero MEDPLUM_PROJECT_ID=${esperado}. ` +
        'Abortado para no escribir en otro proyecto: revisá MEDPLUM_CLIENT_ID/MEDPLUM_CLIENT_SECRET.',
    );
  }
  return real;
}

export interface ConexionMedplum {
  medplum: MedplumClient;
  projectId: string;
  baseUrl: string;
}

/** Login con client credentials + verificación del proyecto. */
export async function conectarMedplum(): Promise<ConexionMedplum> {
  const baseUrl = requireEnv('MEDPLUM_BASE_URL');
  const medplum = new MedplumClient({ baseUrl, fetch });
  await medplum.startClientLogin(requireEnv('MEDPLUM_CLIENT_ID'), requireEnv('MEDPLUM_CLIENT_SECRET'));
  const projectId = verificarProyecto(
    medplum.getProject()?.id ?? medplum.getProfile()?.meta?.project,
    process.env.MEDPLUM_PROJECT_ID?.trim() || undefined,
  );
  return { medplum, projectId, baseUrl };
}
