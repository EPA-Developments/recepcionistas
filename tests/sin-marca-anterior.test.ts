/**
 * Regla de naming SOM (CLAUDE.md): ningún prefijo de bots ni referencia a la marca
 * anterior fuera de CLAUDE.md. Es el mismo chequeo que corre en CI con `git grep`, pero
 * dentro de `npm test`: si alguien la rompe, falla localmente antes de subir.
 *
 * Recorre los archivos del repo (sin depender de git), saltea binarios y dependencias,
 * y falla listando archivo, línea y texto de cada coincidencia. Este archivo no contiene
 * ninguna: los ejemplos se arman por partes (el grep de CI también lo revisa).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
/** El mismo patrón de CLAUDE.md y del workflow de CI (`[w]` para no coincidir consigo mismo). */
const PATRON = /\bbw[-_]|bio[w]ellness|bio\.medplum/i;
/** Donde vive la regla: la única excepción, igual que en CI. */
const EXCEPCIONES = new Set(['CLAUDE.md']);
/** Lo que no es del repo (dependencias, builds, secretos locales) no se revisa. */
const IGNORADOS = new Set(['node_modules', 'dist', 'coverage', '.git', '.env', '.env.local', 'package-lock.json']);
const MAX_BYTES = 2 * 1024 * 1024;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    if (IGNORADOS.has(nombre)) {
      return [];
    }
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

function coincidencias(ruta: string): string[] {
  if (statSync(ruta).size > MAX_BYTES) {
    return [];
  }
  const contenido = readFileSync(ruta);
  if (contenido.includes(0)) {
    return []; // binario (imágenes, etc.), como `git grep -I`
  }
  return contenido
    .toString('utf8')
    .split('\n')
    .flatMap((linea, i) => (PATRON.test(linea) ? [`${relative(RAIZ, ruta)}:${i + 1}: ${linea.trim()}`] : []));
}

describe('Naming SOM — sin la marca anterior', () => {
  it('revisa el repo entero (la raíz es la del repo)', () => {
    expect(JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).name).toBe('@som/recepcionistas');
    const rutas = archivos(RAIZ).map((r) => relative(RAIZ, r));
    expect(rutas).toEqual(expect.arrayContaining(['CLAUDE.md', 'src/lib/mensajes.ts', 'app/src/App.tsx']));
  });

  it('el patrón detecta las tres formas (prefijo de bot, marca y servidor)', () => {
    // Armados por partes: este archivo no puede contener el texto que busca el chequeo.
    const prohibidos = [
      ['b', 'w-reservar-turno'],
      ['B', 'W_TOKEN'],
      ['bio', 'wellness.ar'],
      ['bio', '.medplum.com.ar'],
    ];
    expect(prohibidos.every((partes) => PATRON.test(partes.join('')))).toBe(true);
    expect(['som-reservar-turno', 'segundaopinionmedica.org', 'biomarcadores'].some((s) => PATRON.test(s))).toBe(false);
  });

  it('ningún archivo (salvo CLAUDE.md) nombra la marca anterior ni usa sus prefijos', () => {
    const encontradas = archivos(RAIZ)
      .filter((ruta) => !EXCEPCIONES.has(relative(RAIZ, ruta)))
      .flatMap(coincidencias);
    expect(encontradas).toEqual([]);
  });
});
