/**
 * Borrador de respuesta para la bandeja de Mensajes de Recepción ("Sugerir") — lógica
 * pura (sin FHIR, sin red). La orquesta el bot `som-borrador-respuesta`.
 *
 * El sistema **redacta**, la recepcionista **decide y envía**: nada sale sin que una
 * persona toque Enviar. Pensado para SOM (salud cardiovascular convencional); el chat es
 * "Mensajes" del portal.
 *
 * La regla de oro: el borrador **no responde nada clínico, no cotiza y no afirma datos
 * que no estén en el contexto**. Hay una persona revisando, pero un borrador que propone
 * algo incorrecto igual es peligroso: se lee rápido y se manda. Por eso tampoco lleva
 * horario ni dirección: en SOM todavía son provisionales (`config/horario.ts`).
 */

/** Cuando el modelo decide que esto lo tiene que contestar una persona. */
export const SIN_BORRADOR = 'SIN_BORRADOR';

/** Un mensaje de la conversación, reducido a lo que el modelo necesita ver. */
export interface MensajeHilo {
  de: 'paciente' | 'recepcion';
  texto: string;
  /** Fecha ISO, para que el modelo entienda los tiempos de la conversación. */
  cuandoISO?: string;
}

/**
 * Lo que Recepción ve del paciente. **Nunca** historia clínica: estudios, resultados y
 * diagnósticos no pasan por el mostrador, y mucho menos por un modelo que redacta mensajes.
 */
export interface ContextoPaciente {
  nombre?: string;
  /** Motivo que eligió el paciente al escribir (p. ej. "Turnos y reservas"). */
  motivo?: string;
  /** Próximo turno en palabras ("jue 02/10 09:30"). */
  proximoTurno?: string;
  /** ¿Firmó el consentimiento informado? Señal binaria, nunca el documento. */
  consentimientoFirmado?: boolean;
  /** Programas activos, en palabras (p. ej. "Plan Bienestar · 100 días"). */
  programas?: string[];
}

/** El system prompt: fijo (sin datos del paciente), así se puede cachear. */
export function systemBorrador(): string {
  return [
    'Sos el asistente de la recepción de SEGUNDA OPINIÓN MÉDICA, un servicio de salud cardiovascular en la',
    'Ciudad de Buenos Aires (segunda opinión cardiológica, Plan Bienestar · 100 días y seguimiento GLP-1).',
    '',
    'Tu tarea: redactar el BORRADOR de la respuesta que la recepcionista le va a mandar al paciente por el chat',
    '"Mensajes" del portal. NO sos vos quien contesta: una persona lee tu borrador, lo corrige si hace falta y lo envía.',
    '',
    '## Cómo escribir',
    '- Español rioplatense (vos, no tú), cálido y breve. Como escribe una recepcionista, no como un folleto.',
    '- 2 a 4 líneas. Es un chat, no un email.',
    '- Sin saludos protocolares largos ni "Estimado/a". Sin firma.',
    '- Devolvé SOLO el texto del mensaje, sin comillas ni encabezados.',
    '- Separá las ideas con un salto de línea en blanco: en el celular se lee mucho mejor.',
    '',
    '## Lo que NO podés hacer (importante)',
    '- NO des indicaciones médicas, ni opines sobre tratamientos o medicación, ni interpretes síntomas,',
    '  estudios o resultados. Eso lo resuelve el equipo médico, nunca el mostrador.',
    '- NO inventes precios, horarios ni direcciones: si los piden, decí que Recepción se los confirma.',
    '- NO confirmes turnos, pagos ni excepciones que no estén en el contexto que te doy.',
    '- NO prometas plazos ("te lo resuelvo hoy") ni hables en nombre del médico.',
    '- Si no tenés el dato, decí que Recepción lo confirma. Es mejor que inventarlo.',
    '',
    `Si el mensaje necesita a una persona sí o sí —consulta clínica, síntomas, una posible urgencia (dolor de pecho,`,
    `falta de aire, desmayo…), un reclamo, un tema delicado, o no entendés qué piden— respondé EXACTAMENTE con`,
    `"${SIN_BORRADOR}: <motivo en pocas palabras>" y nada más.`,
    '',
    '## Lo que sí podés decir',
    '- Que para pedir, cambiar o cancelar un turno lo pueden escribir por acá o desde "Reservar" en el portal.',
    '- Que los resultados de laboratorio se pueden mandar en PDF desde el botón "+" → "Enviar estudios en PDF".',
    '- Que para pedir una Segunda Opinión hace falta tener firmado el consentimiento informado en el portal.',
  ].join('\n');
}

/** El contexto del paciente, en el formato que lee el modelo. */
export function textoContexto(ctx: ContextoPaciente): string {
  const lineas: string[] = [`Paciente: ${ctx.nombre ?? '(sin nombre en el sistema)'}`];
  if (ctx.motivo) {
    lineas.push(`Motivo que eligió al escribir: ${ctx.motivo}`);
  }
  lineas.push(ctx.proximoTurno ? `Próximo turno: ${ctx.proximoTurno}` : 'Próximo turno: no tiene ninguno agendado.');
  if (ctx.programas?.length) {
    lineas.push(`Programas activos: ${ctx.programas.join(', ')}.`);
  }
  if (ctx.consentimientoFirmado === false) {
    lineas.push('Consentimiento informado: NO firmado.');
  }
  return lineas.join('\n');
}

/** La conversación, de más vieja a más nueva. */
export function textoHilo(mensajes: MensajeHilo[]): string {
  return mensajes.map((m) => `${m.de === 'paciente' ? 'PACIENTE' : 'RECEPCIÓN'}: ${m.texto}`).join('\n');
}

/** El mensaje de usuario completo: contexto + conversación + qué se pide. */
export function promptBorrador(ctx: ContextoPaciente, mensajes: MensajeHilo[]): string {
  return [
    '## Contexto del paciente',
    textoContexto(ctx),
    '',
    '## Conversación',
    textoHilo(mensajes),
    '',
    'Redactá el borrador de la próxima respuesta de Recepción.',
  ].join('\n');
}

export interface ResultadoBorrador {
  /** El texto sugerido. Ausente si conviene que lo conteste una persona. */
  borrador?: string;
  /** Por qué no hay borrador (para mostrárselo a la recepcionista). */
  motivo?: string;
}

/**
 * Limpia y valida lo que devolvió el modelo: reconoce "esto lo tiene que contestar una
 * persona", saca las comillas que a veces envuelven la respuesta y corta un borrador
 * desmedido (un texto larguísimo se manda sin leer).
 */
export function limpiarBorrador(salida: string | undefined, maxCaracteres = 900): ResultadoBorrador {
  const texto = (salida ?? '').trim();
  if (!texto) {
    return { motivo: 'El asistente no devolvió nada.' };
  }
  if (texto.toUpperCase().startsWith(SIN_BORRADOR)) {
    const motivo = texto
      .slice(SIN_BORRADOR.length)
      .replace(/^[:\s-]+/, '')
      .trim();
    return { motivo: motivo || 'Conviene que lo conteste una persona.' };
  }
  const sinComillas = texto
    .replace(/^["'«“]+/, '')
    .replace(/["'»”]+$/, '')
    .trim();
  return {
    borrador: sinComillas.length > maxCaracteres ? `${sinComillas.slice(0, maxCaracteres).trimEnd()}…` : sinComillas,
  };
}

/** Cómo se usó el borrador al enviar: el dato para decidir si se automatiza más. */
export function usoDelBorrador(enviado: string, sugerido: string | undefined): 'sin-editar' | 'editado' | undefined {
  if (!sugerido) {
    return undefined;
  }
  return enviado.trim() === sugerido.trim() ? 'sin-editar' : 'editado';
}
