/**
 * CRM de Segunda Opinión Médica — embudo de captación (redes sociales, web,
 * referidos) → segmentos → campañas. Lógica pura (sin red): los bots
 * `som-recomputar-segmentos` y `som-enviar-campana` leen/escriben FHIR y envían;
 * acá se decide quién entra en cada segmento y qué mensaje recibe.
 *
 * Un **segmento** es un `Group` (identifier `SYSTEM.segmento`) cuyos
 * `characteristic[]` son criterios que el paciente cumple TODOS (`exclude: true`
 * niega el criterio). El tipo va en `characteristic.code` con el coding
 * `SYSTEM.rasgoSegmento`:
 *
 * - `origen-lead`: fuente del lead (red social / `utm_source`: instagram,
 *   facebook, tiktok, google, …), de la extensión `origen-lead` del Patient.
 * - `perfil-interes`: extensión `perfil-interes`.
 * - `ciclo-vida`: extensión `ciclo-vida-cliente` (o `meta.tag` de ese system).
 *   Estos tres se comparan sin distinguir mayúsculas contra
 *   `valueCodeableConcept.coding[0].code` (o `.text`).
 * - `biomarcador`: último valor de una Observation LOINC (coding LOINC en `code`)
 *   contra `valueQuantity` (`comparator` + `value`).
 */
import type { Group, Patient } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../fhir/identifiers.js';

export const LOINC_SYSTEM = 'http://loinc.org';

export type Comparador = '>' | '<' | '>=' | '<=';
export type RasgoTexto = 'origen' | 'perfil' | 'ciclo';

export type Criterio =
  | { tipo: RasgoTexto; valor: string; excluir: boolean }
  | { tipo: 'biomarcador'; loinc: string; comparador: Comparador; umbral: number; excluir: boolean };

const RASGOS_TEXTO: Readonly<Record<string, RasgoTexto>> = {
  'origen-lead': 'origen',
  'perfil-interes': 'perfil',
  'ciclo-vida': 'ciclo',
};

const COMPARADORES: ReadonlySet<string> = new Set(['>', '<', '>=', '<=']);

/** Valor comparable de un rasgo (origen, perfil, ciclo): sin espacios y en minúsculas. */
export function normalizarValor(v: string | undefined): string | undefined {
  const t = v?.trim().toLowerCase();
  return t || undefined;
}

/** ¿El Group es un segmento del CRM? (no se recalculan ni se campañean otros Group). */
export function esSegmento(g: Group): boolean {
  return g.identifier?.some((i) => i.system === SYSTEM.segmento) ?? false;
}

export interface CriteriosSegmento {
  criterios: Criterio[];
  /** `characteristic` que no se pudieron interpretar (rasgo desconocido o incompleto). */
  invalidos: number;
}

/**
 * Criterios de un segmento. Un `characteristic` inválido NO se ignora en silencio:
 * se cuenta en `invalidos` y el bot no recalcula ese segmento (un criterio perdido
 * lo ampliaría y la campaña le llegaría a quien no corresponde).
 */
export function parsearCriterios(group: Group): CriteriosSegmento {
  const criterios: Criterio[] = [];
  let invalidos = 0;
  for (const ch of group.characteristic ?? []) {
    const rasgo = ch.code?.coding?.find((c) => c.system === SYSTEM.rasgoSegmento)?.code;
    const excluir = ch.exclude ?? false;
    const tipo = rasgo ? RASGOS_TEXTO[rasgo] : undefined;
    if (tipo) {
      const valor = normalizarValor(ch.valueCodeableConcept?.coding?.[0]?.code ?? ch.valueCodeableConcept?.text);
      if (valor) {
        criterios.push({ tipo, valor, excluir });
        continue;
      }
    } else if (rasgo === 'biomarcador') {
      const loinc = ch.code?.coding?.find((c) => c.system === LOINC_SYSTEM)?.code;
      const comparador = ch.valueQuantity?.comparator;
      const umbral = ch.valueQuantity?.value;
      if (loinc && comparador && COMPARADORES.has(comparador) && typeof umbral === 'number') {
        criterios.push({ tipo: 'biomarcador', loinc, comparador: comparador as Comparador, umbral, excluir });
        continue;
      }
    }
    invalidos++;
  }
  return { criterios, invalidos };
}

/** Datos comerciales del paciente que usan los criterios de texto. */
export interface PerfilCrm {
  origen?: string;
  perfil?: string;
  ciclo?: string;
}

export function perfilCrm(p: Patient): PerfilCrm {
  const ext = (url: string) => p.extension?.find((e) => e.url === url);
  const origen = ext(EXT.origenLead);
  const perfil = ext(EXT.perfilInteres);
  const ciclo = ext(EXT.cicloVidaCliente);
  const cicloTag = p.meta?.tag?.find((t) => t.system === SYSTEM.cicloVidaCliente)?.code;
  return {
    origen: normalizarValor(origen?.valueString ?? origen?.valueCode),
    perfil: normalizarValor(perfil?.valueCode ?? perfil?.valueString),
    ciclo: normalizarValor(ciclo?.valueCode ?? ciclo?.valueString ?? cicloTag),
  };
}

function comparar(c: Comparador, valor: number, umbral: number): boolean {
  switch (c) {
    case '>':
      return valor > umbral;
    case '<':
      return valor < umbral;
    case '>=':
      return valor >= umbral;
    case '<=':
      return valor <= umbral;
  }
}

/**
 * ¿El paciente cumple TODOS los criterios? `biomarcadores` = último valor por
 * LOINC: sin dato, el criterio no se cumple (y con `exclude`, sí).
 */
export function cumpleCriterios(
  criterios: readonly Criterio[],
  perfil: PerfilCrm,
  biomarcadores: ReadonlyMap<string, number> = new Map(),
): boolean {
  return criterios.every((c) => {
    let cumple: boolean;
    if (c.tipo === 'biomarcador') {
      const valor = biomarcadores.get(c.loinc);
      cumple = valor !== undefined && comparar(c.comparador, valor, c.umbral);
    } else {
      cumple = perfil[c.tipo] === c.valor;
    }
    return c.excluir ? !cumple : cumple;
  });
}

/** Códigos LOINC que hace falta leer para evaluar los criterios de biomarcador. */
export function loincsRequeridos(criterios: readonly Criterio[]): string[] {
  return [...new Set(criterios.flatMap((c) => (c.tipo === 'biomarcador' ? [c.loinc] : [])))];
}

// ───────────────────────────── campañas ─────────────────────────────

export type CanalCampania = 'email' | 'whatsapp';

export interface EntradaCampania {
  groupId: string;
  canal?: CanalCampania;
  asunto?: string;
  /** Admite el placeholder {nombre}. */
  cuerpo: string;
  campaniaId: string;
  /** Remitente del email (identidad SES verificada). */
  from?: string;
}

export function validarCampania(e: Partial<EntradaCampania> | undefined): { ok: boolean; error?: string } {
  if (!e?.groupId || !e.cuerpo?.trim() || !e.campaniaId?.trim()) {
    return { ok: false, error: 'Faltan groupId, cuerpo o campaniaId.' };
  }
  if (e.canal && e.canal !== 'email' && e.canal !== 'whatsapp') {
    return { ok: false, error: 'Canal inválido (email / whatsapp).' };
  }
  return { ok: true };
}

/** Contacto del paciente para el canal: email, o teléfono para WhatsApp. */
export function contactoCampania(p: Patient, canal: CanalCampania): string | undefined {
  return canal === 'email'
    ? p.telecom?.find((t) => t.system === 'email')?.value
    : p.telecom?.find((t) => t.system === 'phone' || t.system === 'sms')?.value;
}

/** Cuerpo personalizado: `{nombre}` → primer nombre del paciente. */
export function personalizar(cuerpo: string, p: Patient): string {
  const nombre = p.name?.[0]?.given?.[0] ?? p.name?.[0]?.family ?? '';
  return cuerpo.replace(/\{nombre\}/g, nombre);
}
