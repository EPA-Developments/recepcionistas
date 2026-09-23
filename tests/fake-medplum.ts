/**
 * MedplumClient en memoria para tests de bots: guarda recursos y resuelve las
 * búsquedas que usan los bots y la app (_id, subject/patient, status, category,
 * code, based-on, identifier; en los tokens, la coma es OR). No es un servidor
 * FHIR: solo lo necesario para probar la orquestación sin red.
 */
import type { MedplumClient } from '@medplum/core';
import type { Resource } from '@medplum/fhirtypes';

type Coding = { system?: string; code?: string };
type Registro = Resource & Record<string, unknown>;

function token(valor: string, codings: Coding[]): boolean {
  const [sistema, codigo] = valor.includes('|') ? (valor.split('|') as [string, string]) : [undefined, valor];
  return codings.some((c) => (sistema === undefined || c.system === sistema) && (!codigo || c.code === codigo));
}

function codingsDe(campo: unknown): Coding[] {
  const lista = Array.isArray(campo) ? campo : campo ? [campo] : [];
  return lista.flatMap((cc: { coding?: Coding[] }) => cc?.coding ?? []);
}

function cumple(r: Registro, param: string, valor: string): boolean {
  // Token con varios valores separados por coma = OR (semántica FHIR).
  if (['category', 'code', 'identifier', '_id'].includes(param) && valor.includes(',')) {
    return valor.split(',').some((v) => cumple(r, param, v));
  }
  switch (param) {
    case '_id':
      return r.id === valor;
    case 'subject':
      return (r.subject as { reference?: string } | undefined)?.reference === valor;
    case 'patient': {
      const ref = (r.for as { reference?: string } | undefined)?.reference ?? (r.subject as { reference?: string } | undefined)?.reference;
      return ref === valor;
    }
    case 'status':
      return valor.split(',').includes(String(r.status));
    case 'category':
      return token(valor, codingsDe(r.category));
    case 'code':
      return token(valor, codingsDe(r.code));
    case 'based-on':
      return ((r.basedOn as Array<{ reference?: string }> | undefined) ?? []).some((b) => b.reference === valor);
    case 'identifier': {
      const [sistema, v] = valor.split('|') as [string, string];
      return ((r.identifier as Array<{ system?: string; value?: string }> | undefined) ?? []).some(
        (i) => i.system === sistema && i.value === v,
      );
    }
    default:
      return true; // _count, _sort, start, etc.: no filtran en el fake
  }
}

function params(query: unknown): Array<[string, string]> {
  if (!query) {
    return [];
  }
  if (typeof query === 'string') {
    return [...new URLSearchParams(query).entries()];
  }
  return Object.entries(query as Record<string, string>).map(([k, v]) => [k, String(v)]);
}

export function fakeMedplum(iniciales: Resource[] = []) {
  const store = new Map<string, Registro>();
  let n = 0;
  const clave = (tipo: string, id: string) => `${tipo}/${id}`;
  const copia = <T>(r: T): T => structuredClone(r);

  for (const r of iniciales) {
    store.set(clave(r.resourceType, r.id!), copia(r) as Registro);
  }

  const buscar = (tipo: string, query?: unknown): Registro[] =>
    [...store.values()].filter((r) => r.resourceType === tipo && params(query).every(([k, v]) => cumple(r, k, v)));

  const medplum = {
    getProfile: () => ({ meta: { project: 'proyecto-test' } }),
    createResource: async (r: Resource) => {
      const nuevo = { ...copia(r), id: `${r.resourceType.toLowerCase()}-${++n}` } as Registro;
      store.set(clave(nuevo.resourceType, nuevo.id!), nuevo);
      return copia(nuevo);
    },
    updateResource: async (r: Resource) => {
      if (!r.id || !store.has(clave(r.resourceType, r.id))) {
        throw new Error(`No existe ${r.resourceType}/${r.id}`);
      }
      store.set(clave(r.resourceType, r.id), copia(r) as Registro);
      return copia(r);
    },
    readResource: async (tipo: string, id: string) => {
      const r = store.get(clave(tipo, id));
      if (!r) {
        throw new Error(`Not found: ${tipo}/${id}`);
      }
      return copia(r);
    },
    searchResources: async (tipo: string, query?: unknown) => buscar(tipo, query).map(copia),
    searchOne: async (tipo: string, query?: unknown) => {
      const r = buscar(tipo, query)[0];
      return r ? copia(r) : undefined;
    },
  } as unknown as MedplumClient;

  /** Recursos de un tipo (para las aserciones). */
  const todos = <T extends Resource = Resource>(tipo: T['resourceType']): T[] =>
    [...store.values()].filter((r) => r.resourceType === tipo).map((r) => copia(r) as unknown as T);

  return { medplum, todos };
}
