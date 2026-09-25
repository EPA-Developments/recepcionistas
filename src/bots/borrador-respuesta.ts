/**
 * Bot · Borrador de respuesta para Mensajes de Recepción ("Sugerir").
 *
 * Lee la conversación y el contexto operativo del paciente y devuelve el BORRADOR de la
 * próxima respuesta. La recepcionista lo lee, lo corrige si hace falta y lo envía:
 * **nada sale sin que una persona toque Enviar**. Solo lectura: no escribe nada en
 * FHIR ni manda ningún mensaje. Lógica pura y reglas en `src/lib/borrador.ts`.
 *
 * Lo ejecuta Recepción (whitelisteado en su AccessPolicy). Requiere el Project Secret
 * ANTHROPIC_API_KEY; sin él devuelve un aviso claro y Recepción escribe a mano.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import { formatHumanName } from '@medplum/core';
import { MODELO_CLAUDE_BORRADOR, SYSTEM } from '../fhir/identifiers.js';
import {
  limpiarBorrador,
  promptBorrador,
  systemBorrador,
  type ContextoPaciente,
  type MensajeHilo,
  type ResultadoBorrador,
} from '../lib/borrador.js';
import { esDelPaciente, motivoDe, textoMensaje } from '../lib/mensajes.js';
import { clienteClaude, textoRespuesta } from './_claude.js';
import { tieneConsentimiento } from './_shared.js';

/** Cuántos mensajes de la conversación mira: alcanza para el contexto sin inflar el costo. */
const MENSAJES_CONTEXTO = 12;

const fmtTurno = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});

/** Programas de SOM por el código de `CarePlan.category` (SYSTEM.planCuidado). */
const PROGRAMAS: Record<string, string> = {
  'plan-bienestar-100': 'Plan Bienestar · 100 días',
  'seguimiento-glp1': 'Seguimiento GLP-1',
};

export interface EntradaBorrador {
  /** Conversación (Communication topic) para la que se pide el borrador. */
  hiloId: string;
}

/**
 * Junta lo que el modelo necesita (sin historia clínica), o el motivo por el que no
 * tiene sentido pedir un borrador.
 */
export async function armarEntradaBorrador(
  medplum: MedplumClient,
  hiloId: string,
): Promise<{ contexto: ContextoPaciente; mensajes: MensajeHilo[] } | { motivo: string }> {
  const topic = await medplum.readResource('Communication', hiloId).catch(() => undefined);
  const pacienteRef = topic?.subject?.reference;
  if (!topic || !pacienteRef?.startsWith('Patient/')) {
    return { motivo: 'No encontré la conversación (o no está asociada a un paciente).' };
  }

  const recientes = await medplum.searchResources('Communication', {
    'part-of': `Communication/${hiloId}`,
    _sort: '-sent',
    _count: String(MENSAJES_CONTEXTO),
  });
  const mensajes: MensajeHilo[] = [...recientes]
    .sort((a, b) => (a.sent ?? '').localeCompare(b.sent ?? ''))
    .slice(-MENSAJES_CONTEXTO)
    .map((c) => ({
      de: esDelPaciente(c) ? ('paciente' as const) : ('recepcion' as const),
      texto: textoMensaje(c) || '[adjunto]',
      ...(c.sent ? { cuandoISO: c.sent } : {}),
    }));
  if (mensajes.length === 0) {
    return { motivo: 'La conversación está vacía.' };
  }
  if (mensajes[mensajes.length - 1]?.de !== 'paciente') {
    return { motivo: 'El último mensaje es de Recepción: no hay nada pendiente de responder.' };
  }

  const pacienteId = pacienteRef.slice('Patient/'.length);
  const [paciente, turnos, planes, consentimiento] = await Promise.all([
    medplum.readResource('Patient', pacienteId).catch(() => undefined),
    medplum
      .searchResources('Appointment', {
        actor: pacienteRef,
        date: `ge${new Date().toISOString()}`,
        status: 'booked,pending,arrived',
        _sort: 'date',
        _count: '1',
      })
      .catch(() => []),
    medplum
      .searchResources('CarePlan', { subject: pacienteRef, status: 'active', category: `${SYSTEM.planCuidado}|` })
      .catch(() => []),
    tieneConsentimiento(medplum, pacienteRef).catch(() => undefined),
  ]);

  const proximo = turnos[0];
  const programas = [
    ...new Set(
      planes
        .flatMap((p) => p.category?.flatMap((c) => c.coding ?? []) ?? [])
        .map((c) => (c.code ? PROGRAMAS[c.code] : undefined))
        .filter((p): p is string => Boolean(p)),
    ),
  ];
  const contexto: ContextoPaciente = {
    ...(paciente?.name?.[0] ? { nombre: formatHumanName(paciente.name[0]) } : {}),
    motivo: motivoDe(topic).titulo,
    ...(proximo?.start
      ? {
          proximoTurno: `${fmtTurno.format(new Date(proximo.start))}${proximo.serviceType?.[0]?.text ? ` · ${proximo.serviceType[0].text}` : ''}`,
        }
      : {}),
    ...(consentimiento === undefined ? {} : { consentimientoFirmado: consentimiento }),
    ...(programas.length ? { programas } : {}),
  };
  return { contexto, mensajes };
}

export async function handler(medplum: MedplumClient, event: BotEvent<EntradaBorrador>): Promise<ResultadoBorrador> {
  const claude = clienteClaude(event.secrets);
  if (!claude) {
    return { motivo: 'Falta el secret ANTHROPIC_API_KEY en Medplum: "Sugerir" está desactivado.' };
  }

  const entrada = await armarEntradaBorrador(medplum, event.input.hiloId);
  if ('motivo' in entrada) {
    return entrada;
  }

  try {
    const resp = await claude.beta.messages.create({
      model: MODELO_CLAUDE_BORRADOR,
      max_tokens: 16000,
      // Un mensaje corto de atención: esfuerzo bajo alcanza y responde rápido.
      output_config: { effort: 'low' },
      // Si el modelo declina, el servidor reintenta con el modelo de respaldo recomendado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemBorrador(),
      messages: [{ role: 'user', content: promptBorrador(entrada.contexto, entrada.mensajes) }],
    });
    // Una negativa no es un error: se le avisa a Recepción y listo.
    if (resp.stop_reason === 'refusal') {
      return { motivo: 'El asistente no redactó este mensaje. Contestalo vos.' };
    }
    if (resp.stop_reason === 'max_tokens') {
      return { motivo: 'El borrador quedó incompleto. Escribí la respuesta a mano.' };
    }
    return limpiarBorrador(textoRespuesta(resp.content));
  } catch (err) {
    console.log(`som-borrador-respuesta: la API falló: ${err instanceof Error ? err.message : err}`);
    return { motivo: 'No pude generar el borrador ahora. Escribí la respuesta a mano.' };
  }
}
