import { describe, it, expect } from 'vitest';
import type { MedplumClient } from '@medplum/core';
import type { ProjectSetting } from '@medplum/fhirtypes';
import { fusionarSecretos, guardarSecretos, valorSecreto } from '../src/seed/secretos.js';

const S = (name: string, valueString: string): ProjectSetting => ({ name, valueString });

/** Servidor falso: `admin/projects/{id}` devuelve los secrets; `…/secrets` los reemplaza enteros (como Medplum). */
function servidor(inicial: ProjectSetting[] | undefined): { medplum: MedplumClient; posts: unknown[]; secretos: () => ProjectSetting[] | undefined } {
  let secretos = inicial;
  const posts: unknown[] = [];
  const medplum = {
    get: async () => ({ project: { id: 'p', secret: secretos } }),
    post: async (_url: string, body: ProjectSetting[]) => {
      posts.push(body);
      secretos = body;
      return {};
    },
  } as unknown as MedplumClient;
  return { medplum, posts, secretos: () => secretos };
}

describe('Project Secrets · fusionar sin pisar los demás', () => {
  it('Reemplaza por nombre, conserva el orden y agrega los nuevos al final', () => {
    const actuales = [S('A', '1'), S('TWILIO_WEBHOOK_URL', 'vieja'), S('B', '2')];
    expect(fusionarSecretos(actuales, [S('TWILIO_WEBHOOK_URL', 'nueva'), S('C', '3')])).toEqual([
      S('A', '1'),
      S('TWILIO_WEBHOOK_URL', 'nueva'),
      S('B', '2'),
      S('C', '3'),
    ]);
  });

  it('valorSecreto lee el texto por nombre', () => {
    expect(valorSecreto([S('A', '1')], 'A')).toBe('1');
    expect(valorSecreto([S('A', '1')], 'B')).toBeUndefined();
  });

  it('guardarSecretos manda la lista completa (el endpoint reemplaza todo)', async () => {
    const srv = servidor([S('TWILIO_ACCOUNT_SID', 'AC1'), S('TWILIO_AUTH_TOKEN', 't')]);
    await guardarSecretos(srv.medplum, 'p', [S('TWILIO_WEBHOOK_URL', 'u')]);
    expect(srv.secretos()).toEqual([S('TWILIO_ACCOUNT_SID', 'AC1'), S('TWILIO_AUTH_TOKEN', 't'), S('TWILIO_WEBHOOK_URL', 'u')]);
  });

  it('Sin secrets visibles no escribe: podría borrarlos todos', async () => {
    for (const inicial of [[], undefined]) {
      const srv = servidor(inicial);
      await expect(guardarSecretos(srv.medplum, 'p', [S('TWILIO_WEBHOOK_URL', 'u')])).rejects.toThrow(/no escribo/);
      expect(srv.posts).toHaveLength(0);
    }
  });
});
