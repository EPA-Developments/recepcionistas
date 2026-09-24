/**
 * Procesamiento de PDF de laboratorio que manda el paciente — lógica pura (sin
 * FHIR ni red). La orquesta el bot interno `som-procesar-laboratorio`.
 *
 * Contrato con el portal (`EPA-Developments/app`, `bot-som-interface.md` §3):
 *  - Entrada: el `DocumentReference` (type LOINC 11502-2, category
 *    `documento|resultado-laboratorio`) con el PDF en `url` (Binary) o embebido.
 *  - Salida: una `Observation` por analito (category `laboratory`, `code` del
 *    catálogo de biomarcadores = el de las ObservationDefinition, UCUM,
 *    `referenceRange` del informe, `derivedFrom` el documento), un
 *    `DiagnosticReport` (LAB, LOINC 11502-2) con esas `result`, y el documento con
 *    el informe en `context.related` ("Ver resultados" en el portal).
 *
 * Data-driven: Claude solo transcribe lo que dice el PDF; el código de cada analito
 * sale del catálogo que publica el servidor (ObservationDefinition). Si un analito no
 * está en el catálogo, se guarda con su nombre (`code.text`) sin inventar códigos.
 */
import type {
  Attachment,
  DiagnosticReport,
  DocumentReference,
  Observation,
  ObservationDefinition,
  ObservationReferenceRange,
} from '@medplum/fhirtypes';
import { COD, LOINC_INFORME_LABORATORIO, SYSTEM } from '../fhir/identifiers.js';

const UCUM = 'http://unitsofmeasure.org';

/** Un biomarcador del catálogo del servidor (derivado de su ObservationDefinition). */
export interface EntradaCatalogo {
  /** Clave `system|code` (la que Claude devuelve en `codigo`). */
  clave: string;
  system: string;
  code: string;
  nombre: string;
  /** Unidad UCUM de referencia del catálogo, si la tiene. */
  unidad?: string;
}

/** Catálogo de biomarcadores a partir de las ObservationDefinition del proyecto. */
export function catalogoDesdeObservationDefinitions(defs: ObservationDefinition[]): EntradaCatalogo[] {
  const out = new Map<string, EntradaCatalogo>();
  for (const od of defs) {
    const c = od.code?.coding?.[0];
    if (!c?.system || !c.code) {
      continue;
    }
    const clave = `${c.system}|${c.code}`;
    if (!out.has(clave)) {
      out.set(clave, {
        clave,
        system: c.system,
        code: c.code,
        nombre: c.display ?? od.code?.text ?? c.code,
        unidad: od.quantitativeDetails?.unit?.coding?.[0]?.code ?? od.quantitativeDetails?.unit?.text,
      });
    }
  }
  return [...out.values()];
}

/** Un analito tal como figura en el informe (lo que transcribe Claude). */
export interface AnalitoExtraido {
  /** Nombre del analito como figura en el informe. */
  nombre: string;
  /** Clave `system|code` del catálogo, o null si no corresponde a ninguno. */
  codigo: string | null;
  /** Valor numérico, o null si el resultado no es numérico. */
  valor: number | null;
  /** Resultado no numérico (p. ej. "Negativo", "< 5"), o null. */
  valorTexto: string | null;
  /** Unidad tal como figura en el informe, o null. */
  unidad: string | null;
  /** Rango de referencia del laboratorio, o null si no figura. */
  referencia: { bajo: number | null; alto: number | null; texto: string | null } | null;
}

export interface ExtraccionLaboratorio {
  /** ¿El documento es un informe de laboratorio legible? */
  esInformeDeLaboratorio: boolean;
  /** Fecha de extracción de la muestra (AAAA-MM-DD), o null si no figura. */
  fechaExtraccion: string | null;
  /** Nombre del laboratorio, o null. */
  laboratorio: string | null;
  analitos: AnalitoExtraido[];
}

const numeroONull = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const textoONull = { anyOf: [{ type: 'string' }, { type: 'null' }] };

/** JSON Schema de la extracción (salida estructurada, `output_config.format`). */
export const ESQUEMA_EXTRACCION = {
  type: 'object',
  properties: {
    esInformeDeLaboratorio: { type: 'boolean' },
    fechaExtraccion: textoONull,
    laboratorio: textoONull,
    analitos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          codigo: textoONull,
          valor: numeroONull,
          valorTexto: textoONull,
          unidad: textoONull,
          referencia: {
            anyOf: [
              {
                type: 'object',
                properties: { bajo: numeroONull, alto: numeroONull, texto: textoONull },
                required: ['bajo', 'alto', 'texto'],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
          },
        },
        required: ['nombre', 'codigo', 'valor', 'valorTexto', 'unidad', 'referencia'],
        additionalProperties: false,
      },
    },
  },
  required: ['esInformeDeLaboratorio', 'fechaExtraccion', 'laboratorio', 'analitos'],
  additionalProperties: false,
} as const;

/** Instrucción de sistema para la extracción. */
export const SYSTEM_PROMPT_LABORATORIO =
  'Transcribís informes de laboratorio clínico para la historia clínica de Segunda Opinión Médica. ' +
  'Copiá exactamente lo que dice el documento: nombre de cada analito, valor, unidad y rango de ' +
  'referencia del laboratorio, y la fecha de extracción de la muestra. No interpretes, no calcules ' +
  'ni completes datos que no estén impresos; si algo no figura, devolvé null. Asigná `codigo` solo ' +
  'cuando el analito sea inequívocamente uno del catálogo (usá la clave exacta); si no, null. ' +
  'Si el documento no es un informe de laboratorio legible, devolvé esInformeDeLaboratorio=false ' +
  'y analitos vacío.';

/** Mensaje de usuario: el catálogo de códigos permitido (el PDF va aparte). */
export function construirPromptLaboratorio(catalogo: EntradaCatalogo[]): string {
  const lineas = catalogo.map((c) => `- ${c.clave} — ${c.nombre}${c.unidad ? ` (${c.unidad})` : ''}`);
  return [
    'Extraé los resultados del informe de laboratorio adjunto.',
    'Catálogo de biomarcadores (clave — nombre (unidad)):',
    lineas.length ? lineas.join('\n') : '- (catálogo vacío: codigo siempre null)',
  ].join('\n\n');
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}/;

/**
 * Normaliza la respuesta de Claude: descarta analitos sin nombre o sin resultado,
 * y códigos que no estén en el catálogo (nunca se inventan códigos).
 */
export function normalizarExtraccion(crudo: unknown, catalogo: EntradaCatalogo[]): ExtraccionLaboratorio {
  const o = (crudo ?? {}) as Partial<ExtraccionLaboratorio>;
  const claves = new Set(catalogo.map((c) => c.clave));
  const analitos = (Array.isArray(o.analitos) ? o.analitos : [])
    .filter((a): a is AnalitoExtraido => typeof a?.nombre === 'string' && a.nombre.trim() !== '')
    .filter((a) => typeof a.valor === 'number' || (typeof a.valorTexto === 'string' && a.valorTexto.trim() !== ''))
    .map((a) => ({
      nombre: a.nombre.trim(),
      codigo: a.codigo && claves.has(a.codigo) ? a.codigo : null,
      valor: typeof a.valor === 'number' && Number.isFinite(a.valor) ? a.valor : null,
      valorTexto: a.valorTexto?.trim() || null,
      unidad: a.unidad?.trim() || null,
      referencia: a.referencia ?? null,
    }));
  return {
    esInformeDeLaboratorio: o.esInformeDeLaboratorio === true,
    fechaExtraccion: typeof o.fechaExtraccion === 'string' && RE_FECHA.test(o.fechaExtraccion) ? o.fechaExtraccion.slice(0, 10) : null,
    laboratorio: o.laboratorio?.trim() || null,
    analitos,
  };
}

/** ¿El DocumentReference es un PDF de laboratorio del paciente (el que dispara el bot)? */
export function esDocumentoLaboratorio(doc: DocumentReference): boolean {
  return Boolean(
    doc.category?.some((cc) => cc.coding?.some((c) => c.system === SYSTEM.documento && c.code === COD.resultadoLaboratorio)),
  );
}

/** Informe ya generado para este documento (idempotencia): el DiagnosticReport en `context.related`. */
export function informeYaGenerado(doc: DocumentReference): string | undefined {
  return doc.context?.related?.find((r) => r.reference?.startsWith('DiagnosticReport/'))?.reference;
}

/** El PDF del documento: por `url` (Binary) o embebido (`data` base64). */
export function adjuntoPdf(doc: DocumentReference): Attachment | undefined {
  return doc.content?.map((c) => c.attachment).find((a) => a?.contentType === 'application/pdf' && (a.url || a.data));
}

export interface RefsLaboratorio {
  pacienteRef: string;
  documentoRef: string;
  /** Fecha de respaldo si el informe no trae la de extracción (fecha del documento). */
  fechaRespaldo: string;
}

function referenciaFhir(a: AnalitoExtraido, ucum?: string): ObservationReferenceRange[] | undefined {
  const r = a.referencia;
  if (!r || (r.bajo === null && r.alto === null && !r.texto)) {
    return undefined;
  }
  const q = (value: number) => ({ value, ...(a.unidad ? { unit: a.unidad } : {}), ...(ucum ? { system: UCUM, code: ucum } : {}) });
  return [
    {
      ...(r.bajo !== null ? { low: q(r.bajo) } : {}),
      ...(r.alto !== null ? { high: q(r.alto) } : {}),
      ...(r.texto ? { text: r.texto } : {}),
    },
  ];
}

/** Una Observation por analito (lo que buscan los paneles de Biomarcadores del portal). */
export function construirObservaciones(
  extraccion: ExtraccionLaboratorio,
  catalogo: EntradaCatalogo[],
  refs: RefsLaboratorio,
): Observation[] {
  const porClave = new Map(catalogo.map((c) => [c.clave, c]));
  const efectiva = extraccion.fechaExtraccion ?? refs.fechaRespaldo;
  return extraccion.analitos.map((a) => {
    const cat = a.codigo ? porClave.get(a.codigo) : undefined;
    // UCUM solo si la unidad del informe coincide con la del catálogo (no se adivina).
    const ucum = cat?.unidad && a.unidad && cat.unidad === a.unidad ? cat.unidad : undefined;
    const valor: Partial<Observation> =
      a.valor !== null
        ? { valueQuantity: { value: a.valor, ...(a.unidad ? { unit: a.unidad } : {}), ...(ucum ? { system: UCUM, code: ucum } : {}) } }
        : { valueString: a.valorTexto ?? '' };
    const referenceRange = referenciaFhir(a, ucum);
    return {
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }],
        },
      ],
      code: cat
        ? { coding: [{ system: cat.system, code: cat.code, display: cat.nombre }], text: a.nombre }
        : { text: a.nombre },
      subject: { reference: refs.pacienteRef },
      effectiveDateTime: efectiva,
      ...valor,
      ...(referenceRange ? { referenceRange } : {}),
      derivedFrom: [{ reference: refs.documentoRef }],
    };
  });
}

/** DiagnosticReport del laboratorio (el que abre "Ver resultados" en el portal). */
export function construirDiagnosticReportLaboratorio(
  extraccion: ExtraccionLaboratorio,
  observacionesRefs: string[],
  refs: RefsLaboratorio & { pdf?: Attachment },
  ahora = new Date(),
): DiagnosticReport {
  // presentedForm solo con el PDF por url: copiar el base64 embebido duplicaría el
  // archivo y puede superar el tamaño máximo de un recurso en el servidor.
  const pdf = refs.pdf?.url ? { contentType: 'application/pdf', url: refs.pdf.url, title: refs.pdf.title } : undefined;
  return {
    resourceType: 'DiagnosticReport',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: LOINC_INFORME_LABORATORIO, display: 'Laboratory report' }] },
    subject: { reference: refs.pacienteRef },
    effectiveDateTime: extraccion.fechaExtraccion ?? refs.fechaRespaldo,
    issued: ahora.toISOString(),
    ...(extraccion.laboratorio ? { performer: [{ display: extraccion.laboratorio }] } : {}),
    result: observacionesRefs.map((reference) => ({ reference })),
    ...(pdf ? { presentedForm: [pdf] } : {}),
  };
}

/** `context.related` del documento con el informe sumado (sin duplicar). */
export function relatedConInforme(doc: DocumentReference, informeRef: string): NonNullable<DocumentReference['context']> {
  const related = doc.context?.related ?? [];
  return {
    ...doc.context,
    related: related.some((r) => r.reference === informeRef) ? related : [...related, { reference: informeRef }],
  };
}

/** Mensaje al paciente cuando el PDF no se pudo procesar automáticamente. */
export const MENSAJE_NO_PROCESADO =
  'Recibimos tu estudio de laboratorio, pero no pudimos leerlo automáticamente. ' +
  'Nuestro equipo lo va a revisar y te vamos a contactar por Mensajes.';
