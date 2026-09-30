/**
 * Seguimiento de la prueba del laboratorio en PDF de punta a punta (lógica pura, sin red).
 *
 * `npm run laboratorio:seguimiento -- <id del paciente>` lee de Medplum lo que dejó el
 * último PDF de laboratorio del paciente (documento, ejecuciones del bot, uso de IA,
 * informe o derivación al equipo) y lo que la cadena necesita (consentimiento, bot,
 * Subscription, secret); estas funciones lo convierten en el **paso a paso** de la prueba:
 * qué ya pasó, qué falta y qué falló, con el arreglo. Ver docs/som.md → Laboratorio en PDF.
 */
import type { AuditEvent, Communication, DiagnosticReport, DocumentReference, Patient, Task } from '@medplum/fhirtypes';
import { adjuntoPdf } from './laboratorio.js';
import type { PasoSeguimiento } from './seguimiento-whatsapp.js';
import { resumirUsoIa } from './uso-ia.js';
import { fechaHoraAR, nombreDePaciente } from './whatsapp.js';

/** Pasado este tiempo sin ninguna ejecución del bot, la Subscription no disparó. */
export const ESPERA_MAXIMA_MS = 5 * 60_000;

export interface DatosSeguimientoLaboratorio {
  paciente: Patient;
  consentimiento: boolean;
  /** El PDF de laboratorio a seguir (el último del paciente, o el pedido). */
  documento?: DocumentReference;
  /** Cuántos PDFs de laboratorio mandó el paciente en total. */
  documentosEnviados: number;
  /** Id del bot `som-procesar-laboratorio`, si está creado. */
  botId?: string;
  /** La Subscription "SOM laboratorio" apunta al bot y está activa. */
  subscriptionActiva: boolean;
  /** `ANTHROPIC_API_KEY` cargado (por nombre); undefined si no se pudo leer el proyecto. */
  secretClaude?: boolean;
  /** Ejecuciones del bot desde que se envió el documento (de cualquier paciente). */
  ejecuciones: AuditEvent[];
  /** Registros de uso de IA ligados al documento. */
  usoIa: AuditEvent[];
  /** El informe que el bot ligó al documento (`context.related`). */
  informe?: DiagnosticReport;
  /** La tarea `revisar-laboratorio` del documento, si el bot no pudo leerlo. */
  tarea?: Task;
  /** El mensaje al paciente sobre el documento ("te vamos a contactar por Mensajes"). */
  aviso?: Communication;
  ahora: Date;
}

/** Cuándo se envió el documento (la fecha que pone el portal; si no, la del recurso). */
export function envioDe(doc: DocumentReference): string | undefined {
  return doc.date ?? doc.meta?.lastUpdated;
}

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Primera línea útil del log de una ejecución (outcomeDesc), recortada. */
function primeraLinea(texto: string | undefined): string {
  const linea = (texto ?? '').split('\n').find((l) => l.trim()) ?? '';
  return linea.length > 160 ? `${linea.slice(0, 160)}…` : linea;
}

export function pasosSeguimientoLaboratorio(d: DatosSeguimientoLaboratorio): PasoSeguimiento[] {
  const pasos: PasoSeguimiento[] = [];
  const doc = d.documento;

  pasos.push({ titulo: 'Paciente', estado: 'ok', detalle: `${nombreDePaciente(d.paciente)} (Patient/${d.paciente.id})` });

  pasos.push(
    d.consentimiento
      ? { titulo: 'Consentimiento informado', estado: 'ok', detalle: 'Firmado: el portal deja enviar y el bot procesa.' }
      : {
          titulo: 'Consentimiento informado',
          estado: 'falla',
          detalle: 'Sin firmar: el portal no deja enviar y el bot no procesa. El paciente lo firma desde el portal (la pantalla de envío lo lleva).',
        },
  );

  pasos.push(
    d.botId
      ? { titulo: 'Bot som-procesar-laboratorio', estado: 'ok', detalle: `Creado (Bot/${d.botId}).` }
      : { titulo: 'Bot som-procesar-laboratorio', estado: 'falla', detalle: 'No existe en el proyecto: npm run deploy:bots.' },
  );

  pasos.push(
    d.subscriptionActiva
      ? { titulo: 'Subscription "SOM laboratorio"', estado: 'ok', detalle: 'Activa: cada PDF nuevo dispara el bot.' }
      : {
          titulo: 'Subscription "SOM laboratorio"',
          estado: 'falla',
          detalle: 'No está (o no está activa): ningún PDF dispara el bot. npm run deploy:bots la crea.',
        },
  );

  pasos.push(
    d.secretClaude === undefined
      ? { titulo: 'Secret ANTHROPIC_API_KEY', estado: 'pendiente', detalle: 'No pude leer el proyecto (hace falta admin): revisalo en Medplum App → Project → Secrets.' }
      : d.secretClaude
        ? { titulo: 'Secret ANTHROPIC_API_KEY', estado: 'ok', detalle: 'Cargado.' }
        : {
            titulo: 'Secret ANTHROPIC_API_KEY',
            estado: 'falla',
            detalle: 'No está: el bot no puede leer el PDF y lo pasa al equipo. Cargalo en Medplum App → Project → Secrets.',
          },
  );

  if (!doc) {
    pasos.push({
      titulo: 'PDF enviado',
      estado: 'pendiente',
      detalle: 'El paciente todavía no mandó ningún PDF de laboratorio: en el portal, "+" → Enviar estudios en PDF.',
    });
    for (const titulo of ['El bot lo procesó', 'Uso de IA', 'Resultado']) {
      pasos.push({ titulo, estado: 'no-aplica', detalle: 'Falta el PDF.' });
    }
    return pasos;
  }

  const envio = envioDe(doc);
  const pdf = adjuntoPdf(doc);
  const viaje = !pdf
    ? 'sin PDF adjunto'
    : pdf.url
      ? `archivo (${pdf.url})`
      : `embebido en el documento${pdf.size ? `, ${kb(pdf.size)}` : ''}`;
  pasos.push({
    titulo: 'PDF enviado',
    estado: pdf ? 'ok' : 'falla',
    detalle:
      `DocumentReference/${doc.id} · ${fechaHoraAR(envio) || 'sin fecha'} · ${pdf?.title ?? 'sin título'} · ${viaje}` +
      `${d.documentosEnviados > 1 ? ` · ${d.documentosEnviados} PDFs en total (este es el último)` : ''}` +
      `${pdf ? '' : '. El bot no tiene qué leer: que lo vuelva a mandar desde el portal.'}`,
  });

  // Hubo ejecución si hay registro del bot o si dejó algo ligado al documento.
  const dejoRastro = Boolean(d.informe || d.tarea || d.usoIa.length);
  const ultima = [...d.ejecuciones].sort((a, b) => (b.recorded ?? '').localeCompare(a.recorded ?? ''))[0];
  const esperando = envio ? d.ahora.getTime() - new Date(envio).getTime() : Infinity;
  if (d.ejecuciones.length === 0 && !dejoRastro) {
    pasos.push(
      esperando < ESPERA_MAXIMA_MS
        ? { titulo: 'El bot lo procesó', estado: 'pendiente', detalle: `Todavía no corrió (se envió hace ${Math.round(esperando / 1000)} s). Volvé a correr esto en un rato.` }
        : {
            titulo: 'El bot lo procesó',
            estado: 'falla',
            detalle: 'Ninguna ejecución del bot desde el envío: la Subscription no lo disparó. Revisá que esté activa (npm run deploy:bots) o reprocesalo ejecutando el bot con el DocumentReference.',
          },
    );
  } else if (ultima && ultima.outcome !== '0' && !d.informe) {
    pasos.push({
      titulo: 'El bot lo procesó',
      estado: 'falla',
      detalle:
        `La última ejecución falló (${fechaHoraAR(ultima.recorded)}): ` +
        (primeraLinea(ultima.outcomeDesc)
          ? `${primeraLinea(ultima.outcomeDesc)}. Log completo en Medplum → Bot → som-procesar-laboratorio.`
          : 'sin log. Una ejecución que falla sin log suele ser el corte por tiempo de Lambda (10 s por defecto): npm run deploy:bots le fija 300 s al bot.'),
    });
  } else {
    pasos.push({
      titulo: 'El bot lo procesó',
      estado: 'ok',
      detalle: d.ejecuciones.length
        ? `${d.ejecuciones.length} ejecución(es) del bot desde el envío (de cualquier paciente); la última, ${fechaHoraAR(ultima?.recorded)}.`
        : 'Sin registro de ejecución, pero dejó su resultado en el documento.',
    });
  }

  const [uso] = resumirUsoIa(d.usoIa);
  if (uso) {
    const conCosto = uso.llamadas - uso.sinPrecio;
    pasos.push({
      titulo: 'Uso de IA',
      estado: uso.sinResultado === uso.llamadas ? 'falla' : 'ok',
      detalle:
        `${uso.llamadas} llamada(s) · ${uso.tokensEntrada} tokens de entrada · ${uso.tokensSalida} de salida` +
        `${conCosto > 0 ? ` · ≈ US$ ${uso.costoUsd.toFixed(4)}` : ''}` +
        `${uso.sinResultado ? ` · ${uso.sinResultado} sin resultado (${d.usoIa.map((e) => e.outcomeDesc).filter(Boolean).join(', ') || 'sin motivo'})` : ''}.`,
    });
  } else {
    pasos.push(
      d.informe || d.tarea
        ? {
            titulo: 'Uso de IA',
            estado: 'no-aplica',
            detalle:
              d.tarea && !d.informe
                ? 'Sin llamada a Claude registrada: el bot lo pasó al equipo antes de leerlo (el motivo está en la tarea) o el servidor no aceptó el registro (log del bot).'
                : 'Sin registro de uso: el bot es anterior al registro o el servidor no aceptó el AuditEvent (ver el log del bot).',
          }
        : { titulo: 'Uso de IA', estado: 'pendiente', detalle: 'Todavía no hay llamada registrada.' },
    );
  }

  if (d.informe) {
    const valores = d.informe.result?.length ?? 0;
    pasos.push({
      titulo: 'Resultado',
      estado: 'ok',
      detalle: `DiagnosticReport/${d.informe.id} con ${valores} valor(es): el portal muestra "Ver resultados" y los valores en Salud → Biomarcadores.`,
    });
  } else if (d.tarea) {
    pasos.push({
      titulo: 'Resultado',
      estado: 'falla',
      detalle:
        `No se pudo leer: tarea "revisar-laboratorio" para el equipo (Task/${d.tarea.id}, ${d.tarea.status})` +
        `${d.tarea.description ? ` — ${d.tarea.description}` : ''}` +
        `${d.aviso ? '; el paciente recibió el aviso por Mensajes' : ''}. Para reprocesar: ejecutar el bot con el DocumentReference.`,
    });
  } else {
    pasos.push({ titulo: 'Resultado', estado: 'pendiente', detalle: 'En proceso: todavía no hay informe ni tarea para el equipo.' });
  }

  return pasos;
}
