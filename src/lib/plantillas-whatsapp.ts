/**
 * Plantillas de WhatsApp (Meta) — lógica pura: validar una plantilla antes de mandarla a
 * aprobación, reconocer con qué plantilla sale un texto (y sus variables) y armar lo que se
 * le manda a Twilio. Sin red. Ver `config/plantillas-whatsapp.ts`.
 */
import { PLANTILLA_AVISO, PLANTILLAS_WHATSAPP, type PlantillaWhatsApp } from '../config/plantillas-whatsapp.js';

/** Largo máximo del cuerpo de una plantilla de WhatsApp (Meta). */
export const MAX_CUERPO_PLANTILLA = 1024;

const VARIABLE = /\{\{\s*(\d+)\s*\}\}/g;

/** Las variables de un texto ({{1}}, {{2}}…), en el orden en que aparecen. */
export function variablesDe(cuerpo: string): string[] {
  return [...cuerpo.matchAll(VARIABLE)].map((m) => m[1]!);
}

/** Qué rechazaría Meta de la plantilla (vacío = se puede mandar a aprobación). */
export function problemasPlantilla(p: PlantillaWhatsApp): string[] {
  const problemas: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(p.nombre)) {
    problemas.push('el nombre solo puede tener minúsculas, números y guiones bajos');
  }
  const cuerpo = p.cuerpo.trim();
  if (/^\{\{/.test(cuerpo) || /\}\}$/.test(cuerpo)) {
    problemas.push('el cuerpo no puede empezar ni terminar con una variable');
  }
  if (cuerpo.length > MAX_CUERPO_PLANTILLA) {
    problemas.push(`el cuerpo supera ${MAX_CUERPO_PLANTILLA} caracteres`);
  }
  const vars = variablesDe(cuerpo);
  const esperadas = vars.map((_, i) => String(i + 1));
  if (vars.join() !== esperadas.join()) {
    problemas.push('las variables tienen que ser {{1}}, {{2}}… en orden y sin repetir');
  }
  if (/\}\}\s*\{\{/.test(cuerpo)) {
    problemas.push('dos variables seguidas, sin texto entre ellas');
  }
  for (const v of vars) {
    if (!p.ejemplo[v]?.trim()) {
      problemas.push(`falta el ejemplo de {{${v}}}`);
    }
  }
  return problemas;
}

/** El texto que recibe el paciente: el cuerpo con las variables reemplazadas. */
export function textoPlantilla(cuerpo: string, variables: Record<string, string>): string {
  return cuerpo.replace(VARIABLE, (todo, n: string) => variables[n] ?? todo);
}

/** Lo que Meta no admite dentro de una variable: saltos de línea, tabulaciones, 4 espacios seguidos. */
const VARIABLE_INVALIDA = /[\n\t]| {4,}/;

/** La firma con la que empiezan los avisos: la pone la plantilla genérica. */
const FIRMA = /^Segunda Opinión Médica\s*[:·]\s*/u;

/**
 * El aviso como variable de la plantilla genérica: sin la firma inicial ni el 💙 final (los
 * pone la plantilla). undefined si no se puede: Meta no admite saltos de línea, tabulaciones
 * ni 4 espacios seguidos en una variable, y el total no puede pasar de 1024 caracteres.
 */
export function variablesAviso(aviso: string): Record<string, string> | undefined {
  const texto = aviso.trim().replace(FIRMA, '').replace(/\s*💙\s*$/u, '').trim();
  const fijo = PLANTILLA_AVISO.cuerpo.length - '{{1}}'.length;
  if (!texto || VARIABLE_INVALIDA.test(texto) || fijo + texto.length > MAX_CUERPO_PLANTILLA) {
    return undefined;
  }
  return { '1': texto };
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** El cuerpo de la plantilla como patrón: el texto fijo literal y un grupo por variable. */
function patronDe(cuerpo: string): RegExp {
  const fijas = cuerpo.split(VARIABLE).filter((_, i) => i % 2 === 0);
  return new RegExp(`^${fijas.map(escaparRegex).join('([\\s\\S]+?)')}$`, 'u');
}

/**
 * ¿`texto` es exactamente esta plantilla con sus variables llenas? Devuelve las variables
 * (que vuelven a dar el mismo texto con `textoPlantilla`) o undefined si el texto no es el
 * de la plantilla, alguna variable quedaría vacía o inválida para Meta, o el total no entra.
 */
export function variablesSegunPlantilla(p: PlantillaWhatsApp, texto: string): Record<string, string> | undefined {
  const limpio = texto.trim();
  const m = patronDe(p.cuerpo).exec(limpio);
  if (!m) {
    return undefined;
  }
  const variables: Record<string, string> = {};
  for (const [i, n] of variablesDe(p.cuerpo).entries()) {
    const v = m[i + 1] ?? '';
    if (!v.trim() || VARIABLE_INVALIDA.test(v)) {
      return undefined;
    }
    variables[n] = v;
  }
  return limpio.length > MAX_CUERPO_PLANTILLA ? undefined : variables;
}

/** Las plantillas propias de un aviso o respuesta automática (por su clave `template`), en orden. */
export function plantillasDeAviso(clave: string): PlantillaWhatsApp[] {
  return PLANTILLAS_WHATSAPP.filter((p) => p.avisos?.includes(clave));
}

export interface PlantillaElegida {
  plantilla: PlantillaWhatsApp;
  /** El ContentSid (HX…) aprobado, del Project Secret de la plantilla. */
  contentSid: string;
  variables: Record<string, string>;
  /** Lo que recibe el paciente (el cuerpo con las variables). */
  texto: string;
}

/**
 * Con qué plantilla sale un mensaje: la propia del aviso si está aprobada (su ContentSid
 * en el secret) y el texto es el suyo; si no, la genérica (`generica: false` la excluye:
 * las respuestas automáticas salen dentro de la ventana y como texto libre están bien);
 * si ninguna, undefined = texto libre. `contentSidDe` lee el secret (en los bots,
 * `event.secrets`).
 */
export function elegirPlantilla(
  clave: string,
  texto: string,
  contentSidDe: (secret: string) => string | undefined,
  opciones: { generica?: boolean } = {},
): PlantillaElegida | undefined {
  // Primero una que reconozca el texto tal cual; si no, una que lo reconozca ajustado.
  const propias = plantillasDeAviso(clave);
  for (const ajustar of [false, true]) {
    for (const plantilla of propias) {
      if (ajustar && !plantilla.adaptar) {
        continue;
      }
      const contentSid = contentSidDe(plantilla.secret)?.trim();
      const variables = contentSid ? variablesSegunPlantilla(plantilla, ajustar ? plantilla.adaptar!(texto) : texto) : undefined;
      if (contentSid && variables) {
        return { plantilla, contentSid, variables, texto: textoPlantilla(plantilla.cuerpo, variables) };
      }
    }
  }
  if (opciones.generica === false) {
    return undefined;
  }
  const contentSid = contentSidDe(PLANTILLA_AVISO.secret)?.trim();
  const variables = contentSid ? variablesAviso(texto) : undefined;
  return contentSid && variables
    ? { plantilla: PLANTILLA_AVISO, contentSid, variables, texto: textoPlantilla(PLANTILLA_AVISO.cuerpo, variables) }
    : undefined;
}

/** Lo que se le manda a Twilio en vez de `Body`: la plantilla y sus variables. */
export function paramsPlantilla(contentSid: string, variables: Record<string, string>): { ContentSid: string; ContentVariables: string } {
  return { ContentSid: contentSid, ContentVariables: JSON.stringify(variables) };
}

/** El pedido para crear la plantilla en Twilio (Content API, tipo texto). */
export function contenidoTwilio(p: PlantillaWhatsApp): Record<string, unknown> {
  return {
    friendly_name: p.nombre,
    language: p.idioma,
    variables: p.ejemplo,
    types: { 'twilio/text': { body: p.cuerpo } },
  };
}

/** Las respuestas automáticas que no caen en la genérica: salen dentro de la ventana que abrió el paciente. */
const SOLO_EN_VENTANA: readonly string[] = ['bienvenida', 'acuse', 'fuera-de-horario'];

/**
 * Con qué sale lo de una plantilla mientras Meta no la aprueba: la genérica si está aprobada
 * y el texto entra en ella (una línea), o texto libre (llega solo dentro de las 24 h, salvo
 * las respuestas automáticas, que siempre van dentro de la ventana). Para el informe de
 * `npm run whatsapp:plantillas`.
 */
export function mientrasNoSeAprueba(p: PlantillaWhatsApp, genericaAprobada: boolean): string {
  if (p.avisos?.length && p.avisos.every((a) => SOLO_EN_VENTANA.includes(a))) {
    return 'sale como texto libre: es una respuesta dentro de las 24 h que abrió el paciente, así que llega igual';
  }
  const ejemplo = textoPlantilla(p.cuerpo, p.ejemplo);
  if (genericaAprobada && variablesAviso(ejemplo)) {
    return `sale con la genérica ${PLANTILLA_AVISO.nombre} (llega aunque pasen 24 h)`;
  }
  return 'sale como texto libre: llega solo si el paciente escribió en las últimas 24 h';
}
