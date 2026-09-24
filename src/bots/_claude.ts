/**
 * Cliente de Claude para los bots SOM (SDK oficial `@anthropic-ai/sdk`).
 *
 * La clave va como Project Secret `ANTHROPIC_API_KEY` de Medplum: nunca en el repo
 * ni en el portal. Sin clave, los bots siguen su camino de respaldo (no fallan).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BotEvent } from '@medplum/core';

/** Cliente con la clave del Project Secret, o undefined si no está cargada. */
export function clienteClaude(secrets: BotEvent['secrets']): Anthropic | undefined {
  const apiKey = secrets['ANTHROPIC_API_KEY']?.valueString;
  return apiKey ? new Anthropic({ apiKey }) : undefined;
}

/** Texto de la respuesta (concatena los bloques `text`; ignora `thinking`). */
export function textoRespuesta(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('');
}
