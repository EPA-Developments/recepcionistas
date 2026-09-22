import { describe, it, expect } from 'vitest';
import { verificarProyecto } from '../src/seed/conexion.js';

const SOM = '7ce5e559-f315-4538-abf2-61fa4922f996';

describe('Conexión a Medplum · proyecto esperado (MEDPLUM_PROJECT_ID)', () => {
  it('Credenciales del proyecto esperado => devuelve el id', () => {
    expect(verificarProyecto(SOM, SOM)).toBe(SOM);
  });

  it('Credenciales de otro proyecto => aborta', () => {
    expect(() => verificarProyecto('otro-proyecto', SOM)).toThrow(/MEDPLUM_PROJECT_ID/);
  });

  it('Sin proyecto esperado => acepta el de las credenciales', () => {
    expect(verificarProyecto(SOM, undefined)).toBe(SOM);
  });

  it('Sin projectId en las credenciales => aborta', () => {
    expect(() => verificarProyecto(undefined, SOM)).toThrow(/projectId/);
  });
});
