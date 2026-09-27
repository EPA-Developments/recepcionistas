/**
 * Plantillas de WhatsApp (Meta) — lógica pura: validar una plantilla antes de mandarla a
 * aprobación, convertir un aviso en las variables de la genérica y armar lo que se le manda
 * a Twilio. Sin red. Ver `config/plantillas-whatsapp.ts`.
 */
import { PLANTILLA_AVISO, type PlantillaWhatsApp } from '../config/plantillas-whatsapp.js';

/** Largo máximo del cuerpo de una plantilla de WhatsApp (Meta). */
export const MAX_CUERPO_PLANTILLA = 1024;

/** Las variables de un texto ({{1}}, {{2}}…), en el orden en que aparecen. */
export function variablesDe(cuerpo: string): string[] {
  return [...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]!);
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
  return cuerpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (todo, n: string) => variables[n] ?? todo);
}

/** La firma con la que empiezan los avisos: la pone la plantilla. */
const FIRMA = /^Segunda Opinión Médica\s*[:·]\s*/u;

/**
 * El aviso como variable de la plantilla genérica: sin la firma inicial ni el 💙 final (los
 * pone la plantilla). undefined si no se puede: Meta no admite saltos de línea, tabulaciones
 * ni 4 espacios seguidos en una variable, y el total no puede pasar de 1024 caracteres.
 */
export function variablesAviso(aviso: string): Record<string, string> | undefined {
  const texto = aviso.trim().replace(FIRMA, '').replace(/\s*💙\s*$/u, '').trim();
  const fijo = PLANTILLA_AVISO.cuerpo.length - '{{1}}'.length;
  if (!texto || /[\n\t]| {4,}/.test(texto) || fijo + texto.length > MAX_CUERPO_PLANTILLA) {
    return undefined;
  }
  return { '1': texto };
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
