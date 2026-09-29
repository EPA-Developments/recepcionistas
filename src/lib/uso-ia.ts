/**
 * Uso de IA por llamada: tokens y costo estimado, registrado como `AuditEvent` FHIR.
 *
 * Cada bot que llama a un modelo deja un AuditEvent (type `uso-ia|llamada-modelo`,
 * subtype = el proceso, p. ej. `laboratorio-pdf`) que apunta al recurso que originó la
 * llamada y detalla modelo, tokens y costo en dólares. Así el costo real sale de una
 * búsqueda FHIR (`npm run uso:ia -- AAAA-MM`), sin depender de la consola del proveedor.
 *
 * El costo es una estimación con la lista de precios de abajo (US$ por millón de tokens):
 * actualizarla si cambian los precios o se suma un modelo. Con el respaldo del servidor
 * (`fallbacks`), cada intento se cobra aparte a la tarifa de su modelo: se suman todos los
 * de `usage.iterations` (el `usage` de arriba cuenta solo el intento que respondió).
 */
import type { AuditEvent, AuditEventEntityDetail, Bot, Reference } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';

export interface PrecioModelo {
  entrada: number;
  salida: number;
  cacheLectura: number;
  cacheEscritura: number;
}

/** US$ por millón de tokens (lista pública de Anthropic; escritura de caché a 5 minutos). */
export const PRECIOS_USD_POR_MTOK: Readonly<Record<string, PrecioModelo>> = {
  'claude-opus-5-5': { entrada: 4, salida: 20, cacheLectura: 0.2, cacheEscritura: 5 },
  // Respaldos posibles de Opus 5.5 ante una negativa.
  'claude-opus-5': { entrada: 5, salida: 25, cacheLectura: 0.5, cacheEscritura: 6.25 },
  'claude-opus-4-8': { entrada: 5, salida: 25, cacheLectura: 0.5, cacheEscritura: 6.25 },
  'claude-sonnet-4-6': { entrada: 3, salida: 15, cacheLectura: 0.3, cacheEscritura: 3.75 },
};

/** Procesos que registran uso (`AuditEvent.subtype`). */
export const PROCESO_IA = {
  laboratorioPdf: { code: 'laboratorio-pdf', display: 'Transcripción de laboratorio en PDF' },
} as const;

/** `AuditEvent.type` de todos los registros de uso de IA. */
export const TIPO_USO_IA = { system: SYSTEM.usoIa, code: 'llamada-modelo', display: 'Llamada a un modelo de IA' } as const;

/** Tokens de un intento (misma forma que `usage` / `usage.iterations[]` del SDK). */
interface TokensIntento {
  model?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Lo que se usa de la respuesta del modelo (`model` + `usage`). */
export interface RespuestaConUso {
  model: string;
  usage: TokensIntento & { iterations?: ReadonlyArray<TokensIntento & { type: string }> | null };
}

export interface UsoIa {
  /** Modelo que respondió (con respaldo, puede no ser el pedido). */
  modelo: string;
  /** Intentos cobrados (más de uno si actuó el respaldo). */
  intentos: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCacheLectura: number;
  tokensCacheEscritura: number;
  /** Estimado en US$; undefined si algún intento usó un modelo sin precio cargado. */
  costoUsd?: number;
}

/** Tokens y costo de una respuesta, sumando cada intento. */
export function usoDeRespuesta(resp: RespuestaConUso, modeloPedido: string): UsoIa {
  const intentos: TokensIntento[] = resp.usage.iterations?.length
    ? [...resp.usage.iterations]
    : [{ ...resp.usage, model: resp.model }];
  const uso: UsoIa = {
    modelo: resp.model,
    intentos: intentos.length,
    tokensEntrada: 0,
    tokensSalida: 0,
    tokensCacheLectura: 0,
    tokensCacheEscritura: 0,
  };
  let costo: number | undefined = 0;
  for (const it of intentos) {
    const lectura = it.cache_read_input_tokens ?? 0;
    const escritura = it.cache_creation_input_tokens ?? 0;
    uso.tokensEntrada += it.input_tokens;
    uso.tokensSalida += it.output_tokens;
    uso.tokensCacheLectura += lectura;
    uso.tokensCacheEscritura += escritura;
    const p = PRECIOS_USD_POR_MTOK[it.model ?? modeloPedido];
    costo =
      p && costo !== undefined
        ? costo +
          (it.input_tokens * p.entrada + it.output_tokens * p.salida + lectura * p.cacheLectura + escritura * p.cacheEscritura) / 1e6
        : undefined;
  }
  return costo === undefined ? uso : { ...uso, costoUsd: Math.round(costo * 1e6) / 1e6 };
}

export interface RegistroUsoIa {
  proceso: { code: string; display: string };
  uso: UsoIa;
  /** El bot que llamó al modelo (`event.bot`) y su nombre. */
  bot?: Reference<Bot>;
  botNombre: string;
  /** El recurso por el que se llamó (p. ej. `DocumentReference/<id>` del PDF). */
  origen: string;
  /** ¿La respuesta sirvió? (`outcome` 0; si no, 4 con el motivo). */
  ok: boolean;
  motivo?: string;
  esfuerzo?: string;
  cuando?: Date;
}

/**
 * El AuditEvent de una llamada: el detalle va en `entity[0].detail` (valores como texto,
 * R4). El bot va como `source.observer` (R4 no admite un Bot en `agent.who`).
 */
export function auditEventUsoIa(r: RegistroUsoIa): AuditEvent {
  const observador: Reference<Bot> = r.bot?.reference
    ? { reference: r.bot.reference, display: r.botNombre }
    : { display: r.botNombre };
  const u = r.uso;
  const detalle: AuditEventEntityDetail[] = [
    { type: 'modelo', valueString: u.modelo },
    { type: 'intentos', valueString: String(u.intentos) },
    { type: 'tokens-entrada', valueString: String(u.tokensEntrada) },
    { type: 'tokens-salida', valueString: String(u.tokensSalida) },
    { type: 'tokens-cache-lectura', valueString: String(u.tokensCacheLectura) },
    { type: 'tokens-cache-escritura', valueString: String(u.tokensCacheEscritura) },
    ...(u.costoUsd === undefined ? [] : [{ type: 'costo-usd', valueString: u.costoUsd.toFixed(6) }]),
    ...(r.esfuerzo ? [{ type: 'esfuerzo', valueString: r.esfuerzo }] : []),
  ];
  return {
    resourceType: 'AuditEvent',
    type: { ...TIPO_USO_IA },
    subtype: [{ system: SYSTEM.usoIa, code: r.proceso.code, display: r.proceso.display }],
    action: 'E',
    recorded: (r.cuando ?? new Date()).toISOString(),
    outcome: r.ok ? '0' : '4',
    ...(r.ok || !r.motivo ? {} : { outcomeDesc: r.motivo }),
    agent: [{ name: r.botNombre, requestor: false }],
    source: { observer: observador },
    entity: [{ what: { reference: r.origen }, detail: detalle }],
  };
}

export interface ResumenUsoIa {
  proceso: string;
  nombre: string;
  llamadas: number;
  /** Llamadas cuya respuesta no sirvió (el caso pasó al equipo). */
  sinResultado: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  /** Llamadas sin costo (modelo sin precio cargado): el total las deja afuera. */
  sinPrecio: number;
}

/** Suma los AuditEvent de uso por proceso (ignora los que no son de uso de IA). */
export function resumirUsoIa(eventos: AuditEvent[]): ResumenUsoIa[] {
  const porProceso = new Map<string, ResumenUsoIa>();
  for (const e of eventos) {
    if (e.type?.system !== TIPO_USO_IA.system || e.type.code !== TIPO_USO_IA.code) {
      continue;
    }
    const sub = e.subtype?.[0];
    const clave = sub?.code ?? 'sin-proceso';
    const r = porProceso.get(clave) ?? {
      proceso: clave,
      nombre: sub?.display ?? clave,
      llamadas: 0,
      sinResultado: 0,
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
      sinPrecio: 0,
    };
    const valor = (tipo: string): string | undefined => e.entity?.[0]?.detail?.find((d) => d.type === tipo)?.valueString;
    r.llamadas += 1;
    r.sinResultado += e.outcome === '0' ? 0 : 1;
    r.tokensEntrada += Number(valor('tokens-entrada') ?? 0);
    r.tokensSalida += Number(valor('tokens-salida') ?? 0);
    const costo = valor('costo-usd');
    if (costo === undefined) {
      r.sinPrecio += 1;
    } else {
      r.costoUsd += Number(costo);
    }
    porProceso.set(clave, r);
  }
  return [...porProceso.values()].map((r) => ({ ...r, costoUsd: Math.round(r.costoUsd * 1e6) / 1e6 }));
}

/** Un mes en hora de Argentina (UTC−3), para buscar por `date`. */
export function rangoMesAR(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split('-').map(Number) as [number, number];
  const siguiente = m === 12 ? `${anio + 1}-01` : `${anio}-${String(m + 1).padStart(2, '0')}`;
  return { desde: `${mes}-01T00:00:00-03:00`, hasta: `${siguiente}-01T00:00:00-03:00` };
}
