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
  Coding,
  DiagnosticReport,
  DocumentReference,
  Observation,
  ObservationDefinition,
  ObservationReferenceRange,
  Patient,
  Quantity,
  Task,
} from '@medplum/fhirtypes';
import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import {
  COD,
  ESFUERZO_CLAUDE_LABORATORIO,
  EXT,
  LOINC_INFORME_LABORATORIO,
  MODELO_CLAUDE_LABORATORIO,
  SYSTEM,
} from '../fhir/identifiers.js';
import { LOINC_CKM } from './ckm-fhir.js';

const UCUM = 'http://unitsofmeasure.org';
const LOINC = 'http://loinc.org';

/** Un biomarcador del catálogo del servidor (derivado de su ObservationDefinition). */
export interface EntradaCatalogo {
  /** Clave `system|code` (la que Claude devuelve en `codigo`). */
  clave: string;
  system: string;
  code: string;
  nombre: string;
  /** Unidad UCUM de referencia del catálogo, si la tiene. */
  unidad?: string;
  /** Todos los códigos del analito (el principal y sus equivalentes): van todos a la Observation. */
  codings?: Coding[];
  /** Otros nombres con los que aparece en los informes. */
  sinonimos?: string[];
  /** Slug del analito (`e_gfr`, `creatinina_serica`, …). */
  slug?: string;
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
      const nombre = c.display ?? od.code?.text ?? c.code;
      const sinonimos = (od.extension ?? []).filter((e) => e.url === EXT.sinonimoAnalito && e.valueString).map((e) => e.valueString as string);
      const slug = od.identifier?.find((i) => i.system === SYSTEM.analito)?.value;
      out.set(clave, {
        clave,
        system: c.system,
        code: c.code,
        nombre,
        unidad: od.quantitativeDetails?.unit?.coding?.[0]?.code ?? od.quantitativeDetails?.unit?.text,
        codings: (od.code?.coding ?? [])
          .filter((x) => x.system && x.code)
          .map((x) => ({ system: x.system, code: x.code, display: x.display ?? nombre })),
        ...(sinonimos.length ? { sinonimos } : {}),
        ...(slug ? { slug } : {}),
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
  const lineas = catalogo.map(
    (c) => `- ${c.clave} — ${c.nombre}${c.unidad ? ` (${c.unidad})` : ''}${c.sinonimos?.length ? ` · también: ${c.sinonimos.join(', ')}` : ''}`,
  );
  return [
    'Extraé los resultados del informe de laboratorio adjunto.',
    'Catálogo de biomarcadores (clave — nombre (unidad) · también: otros nombres con los que aparece en los informes):',
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

/**
 * Criterio de la Subscription "SOM laboratorio" que dispara el bot. La crea `deploy:bots`
 * y la verifica `laboratorio:seguimiento`: un solo string para los dos.
 */
export const CRITERIO_SUBSCRIPTION_LABORATORIO = `DocumentReference?category=${SYSTEM.documento}|${COD.resultadoLaboratorio}`;

/**
 * ¿La URL del adjunto es externa a Medplum? El servidor devuelve el `Binary` como link
 * firmado del almacenamiento (S3: `X-Amz-Signature`); ése se baja sin el token de Medplum.
 */
export function esUrlExterna(url: string, baseUrlMedplum: string): boolean {
  return /^https?:\/\//i.test(url) && !url.startsWith(baseUrlMedplum);
}

/** ¿Los bytes son un PDF? La firma `%PDF-` puede venir tras basura inicial (hasta 1 KB). */
export function pareceUnPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-');
}

/** Por qué una lectura de Claude no dio resultados (para la tarea del equipo y el uso de IA). */
export function motivoSinResultados(extraccion: ExtraccionLaboratorio | undefined): string {
  if (!extraccion) {
    return 'no se pudieron leer resultados en el PDF';
  }
  return extraccion.esInformeDeLaboratorio ? 'no se encontraron valores en el PDF' : 'el PDF no parece un informe de laboratorio';
}

/**
 * El pedido a Claude que transcribe un PDF de laboratorio: el que manda el bot y el que
 * prueba `npm run claude:probar` (así la prueba mide exactamente lo mismo).
 */
export function pedidoExtraccionLaboratorio(
  base64: string,
  catalogo: EntradaCatalogo[],
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model: MODELO_CLAUDE_LABORATORIO,
    max_tokens: 16000,
    // Si el modelo declina, el servidor reintenta con el modelo de respaldo recomendado.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT_LABORATORIO,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: construirPromptLaboratorio(catalogo) },
        ],
      },
    ],
    output_config: { effort: ESFUERZO_CLAUDE_LABORATORIO, format: { type: 'json_schema', schema: ESQUEMA_EXTRACCION } },
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

/**
 * Los PDF de laboratorio que siguen "En proceso" (sin DiagnosticReport ligado), del más
 * viejo al más nuevo: los que `laboratorio:reprocesar` vuelve a pasar por el bot.
 */
export function pendientesDeProcesar(docs: DocumentReference[]): DocumentReference[] {
  return docs
    .filter((d) => esDocumentoLaboratorio(d) && d.status === 'current' && !informeYaGenerado(d))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

/** Huella de un PDF: SHA-256 del archivo en hex. Mismo archivo ⇒ misma huella. */
export function huellaPdf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** La huella guardada en el DocumentReference, si ya se calculó. */
export function huellaDe(doc: DocumentReference): string | undefined {
  return doc.identifier?.find((i) => i.system === SYSTEM.huellaPdf)?.value;
}

/** El documento con su huella (reemplaza una anterior; no toca otros identifiers). */
export function conHuella(doc: DocumentReference, huella: string): DocumentReference {
  return {
    ...doc,
    identifier: [...(doc.identifier ?? []).filter((i) => i.system !== SYSTEM.huellaPdf), { system: SYSTEM.huellaPdf, value: huella }],
  };
}

/**
 * Entre los PDF del paciente con la misma huella, el que ya tiene informe (el más viejo):
 * el original del que `docId` es un duplicado. undefined si no hay ninguno procesado.
 */
export function originalProcesado(
  candidatos: DocumentReference[],
  docId: string | undefined,
): { documento: DocumentReference; informe: string } | undefined {
  const original = candidatos
    .filter((d) => d.id !== docId && d.status === 'current' && informeYaGenerado(d))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))[0];
  const informe = original ? informeYaGenerado(original) : undefined;
  return original && informe ? { documento: original, informe } : undefined;
}

/** ¿Es la tarea "revisar-laboratorio" que el bot le deja al equipo cuando no puede leer un PDF? */
export function esRevisionLaboratorio(t: Task): boolean {
  return Boolean(t.code?.coding?.some((c) => c.system === SYSTEM.taskTipo && c.code === COD.revisarLaboratorio));
}

export type EstadoProcesamiento =
  | { estado: 'procesado'; informe: string }
  | { estado: 'derivado'; motivo: string }
  | { estado: 'en-proceso' };

/**
 * Dónde quedó un PDF después de pasarlo por el bot: con informe, pasado al equipo (una
 * revisión creada o actualizada desde `desde`) o todavía en proceso.
 */
export function estadoProcesamiento(doc: DocumentReference, tareas: Task[], desde: string): EstadoProcesamiento {
  const informe = informeYaGenerado(doc);
  if (informe) {
    return { estado: 'procesado', informe };
  }
  const revision = tareas.find((t) => esRevisionLaboratorio(t) && (t.meta?.lastUpdated ?? '') >= desde);
  return revision ? { estado: 'derivado', motivo: revision.description ?? 'sin motivo' } : { estado: 'en-proceso' };
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

/** Formas equivalentes conocidas de cada unidad UCUM del catálogo (en minúsculas, sin espacios). */
const UNIDADES_EQUIVALENTES: Readonly<Record<string, readonly string[]>> = {
  'mL/min/{1.73_m2}': ['ml/min/1.73m2', 'ml/min/1.73m²', 'ml/min/1,73m2', 'ml/min/1,73m²', 'ml/min/1.73_m2', 'ml/min/sc'],
  'meq/L': ['meq/l', 'mmol/l'],
  'm[IU]/L': ['mui/l', 'miu/l', 'uui/ml', 'µui/ml'],
  'm[IU]/mL': ['mui/ml', 'miu/ml'],
  'u[IU]/mL': ['uui/ml', 'µui/ml', 'uiu/ml', 'µiu/ml', 'uu/ml', 'µu/ml'],
  'umol/L': ['umol/l', 'µmol/l'],
  'ug/dL': ['ug/dl', 'µg/dl', 'mcg/dl'],
  '10*3/uL': ['10*3/ul', '10^3/ul', '10³/µl', '10³/ul', 'x10³/µl', 'x10^3/ul', 'mil/µl', 'mil/ul'],
  'ng/mL{FEU}': ['ng/mlfeu', 'ngfeu/ml', 'ng/ml'],
  '{INR}': ['rin', 'inr'],
  s: ['s', 'seg', 'segundos', 'sec'],
  '{index}': ['índice', 'indice'],
};

const normalizarUnidad = (u: string) => u.toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'µ');

/** ¿La unidad del informe es la del catálogo? (igual, sin distinguir mayúsculas, o una forma equivalente). */
export function mismaUnidad(delInforme: string, delCatalogo: string): boolean {
  const u = normalizarUnidad(delInforme);
  return u === normalizarUnidad(delCatalogo) || (UNIDADES_EQUIVALENTES[delCatalogo] ?? []).includes(u);
}

const COMPARADORES: Readonly<Record<string, NonNullable<Quantity['comparator']>>> = {
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  '≤': '<=',
  '≥': '>=',
  'menor a': '<',
  'menor de': '<',
  'mayor a': '>',
  'mayor de': '>',
};

/** "> 90", "≥ 60", "menor a 5", "<0,5": el número con su comparador (undefined si no es eso). */
export function cantidadConComparador(texto: string): { comparator: NonNullable<Quantity['comparator']>; value: number } | undefined {
  const m = /^\s*(<=|>=|≤|≥|<|>|menor (?:a|de)|mayor (?:a|de))\s*(\d+(?:[.,]\d+)?)(?:\s*[^\d\s<>≤≥=][^<>≤≥]*)?$/i.exec(texto);
  if (!m) {
    return undefined;
  }
  const comparator = COMPARADORES[m[1]!.toLowerCase()];
  const value = Number(m[2]!.replace(',', '.'));
  return comparator && Number.isFinite(value) ? { comparator, value } : undefined;
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
    // UCUM solo si la unidad del informe es la del catálogo (escrita igual o de una forma
    // equivalente conocida): no se adivina.
    const ucum = cat?.unidad && a.unidad && mismaUnidad(a.unidad, cat.unidad) ? cat.unidad : undefined;
    const unidad = { ...(a.unidad ? { unit: a.unidad } : {}), ...(ucum ? { system: UCUM, code: ucum } : {}) };
    // "> 90" o "< 5" son números con comparador (Quantity.comparator), no texto: así los
    // gráficos y los cálculos (eGFR, PREVENT, hGraph) los pueden usar.
    const comparado = a.valor === null && a.valorTexto ? cantidadConComparador(a.valorTexto) : undefined;
    const valor: Partial<Observation> =
      a.valor !== null
        ? { valueQuantity: { value: a.valor, ...unidad } }
        : comparado
          ? { valueQuantity: { comparator: comparado.comparator, value: comparado.value, ...unidad } }
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
        ? { coding: cat.codings?.length ? cat.codings : [{ system: cat.system, code: cat.code, display: cat.nombre }], text: a.nombre }
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

// ───────────────────── Filtrado glomerular estimado (eGFR) ─────────────────────

/** Todos los códigos LOINC de eGFR que leen el portal, Recepción y hGraph (62238-1, 33914-3, …). */
const CODIGOS_EGFR: ReadonlySet<string> = new Set(LOINC_CKM.egfr);
/** Creatinina en suero/plasma (2160-0) o en sangre (38483-4). */
const CODIGOS_CREATININA: ReadonlySet<string> = new Set(['2160-0', '38483-4']);
/** eGFR por creatinina, ecuación CKD-EPI 2021. */
export const LOINC_EGFR_CKD_EPI_2021 = '98979-8';

/**
 * eGFR por creatinina con la ecuación CKD-EPI 2021, sin coeficiente de raza (Inker LA et al.,
 * N Engl J Med 2021;385:1737-49), la que usan KDIGO y la guía CKM 2026. En mL/min/1,73 m².
 */
export function egfrCkdEpi2021(creatininaMgDl: number, edad: number, sexo: 'female' | 'male'): number {
  const mujer = sexo === 'female';
  const kappa = mujer ? 0.7 : 0.9;
  const alfa = mujer ? -0.241 : -0.302;
  const r = creatininaMgDl / kappa;
  return 142 * Math.min(r, 1) ** alfa * Math.max(r, 1) ** -1.2 * 0.9938 ** edad * (mujer ? 1.012 : 1);
}

/** Edad en años cumplidos a una fecha (AAAA-MM-DD…). */
export function edadEn(fechaNacimiento: string, fecha: string): number | undefined {
  const n = new Date(fechaNacimiento.slice(0, 10));
  const f = new Date(fecha.slice(0, 10));
  if (Number.isNaN(n.getTime()) || Number.isNaN(f.getTime())) {
    return undefined;
  }
  const cumplio = f.getUTCMonth() > n.getUTCMonth() || (f.getUTCMonth() === n.getUTCMonth() && f.getUTCDate() >= n.getUTCDate());
  return f.getUTCFullYear() - n.getUTCFullYear() - (cumplio ? 0 : 1);
}

const tieneCodigoLoinc = (o: Observation, codigos: ReadonlySet<string>) =>
  Boolean(o.code?.coding?.some((c) => c.system === LOINC && c.code && codigos.has(c.code)));

/** La creatinina en mg/dL (convierte µmol/L); undefined si la unidad no se reconoce. */
function creatininaMgDl(q: Quantity | undefined): number | undefined {
  if (q?.value === undefined || q.comparator) {
    return undefined;
  }
  const u = normalizarUnidad(q.code ?? q.unit ?? 'mg/dL');
  if (u === 'mg/dl') {
    return q.value;
  }
  return u === 'umol/l' || u === 'µmol/l' ? q.value / 88.4 : undefined;
}

/**
 * El filtrado glomerular del informe, siempre que haya creatinina. Si el laboratorio lo
 * informó con un número, queda el suyo. Si no lo informó, o lo informó como "> 90" o en
 * texto, se calcula con CKD-EPI 2021 desde la creatinina, la edad a la fecha del estudio y
 * el sexo (adultos; sin sexo masculino/femenino no se calcula). La Observation calculada
 * lleva los códigos del catálogo (62238-1, que lee hGraph, y 33914-3, que leen el portal y
 * el Plan Bienestar) más 98979-8 (CKD-EPI 2021), y dice cómo se obtuvo.
 */
export function completarEgfr(
  observaciones: Observation[],
  paciente: Pick<Patient, 'gender' | 'birthDate'>,
  catalogo: EntradaCatalogo[],
): Observation[] {
  const egfr = observaciones.find((o) => tieneCodigoLoinc(o, CODIGOS_EGFR));
  if (egfr?.valueQuantity?.value !== undefined && !egfr.valueQuantity.comparator) {
    return observaciones;
  }
  const creatinina = observaciones.find((o) => tieneCodigoLoinc(o, CODIGOS_CREATININA) && creatininaMgDl(o.valueQuantity) !== undefined);
  const mgDl = creatininaMgDl(creatinina?.valueQuantity);
  const sexo = paciente.gender === 'female' || paciente.gender === 'male' ? paciente.gender : undefined;
  const fecha = creatinina?.effectiveDateTime;
  const edad = paciente.birthDate && fecha ? edadEn(paciente.birthDate, fecha) : undefined;
  if (!creatinina || mgDl === undefined || !sexo || edad === undefined || edad < 18) {
    return observaciones;
  }
  const delCatalogo = catalogo.find((c) => CODIGOS_EGFR.has(c.code))?.codings ?? [
    { system: LOINC, code: '62238-1', display: 'Filtrado glomerular estimado (eGFR)' },
    { system: LOINC, code: '33914-3', display: 'Filtrado glomerular estimado (eGFR)' },
  ];
  const informado = egfr
    ? egfr.valueString || `${egfr.valueQuantity?.comparator ?? ''} ${egfr.valueQuantity?.value ?? ''}`.trim()
    : undefined;
  const calculada: Observation = {
    resourceType: 'Observation',
    status: 'final',
    category: creatinina.category,
    code: {
      coding: [...delCatalogo, { system: LOINC, code: LOINC_EGFR_CKD_EPI_2021, display: 'eGFR por creatinina (CKD-EPI 2021)' }],
      text: 'Filtrado glomerular estimado (CKD-EPI 2021)',
    },
    subject: creatinina.subject,
    effectiveDateTime: fecha,
    valueQuantity: { value: Math.round(egfrCkdEpi2021(mgDl, edad, sexo)), unit: 'mL/min/1,73 m²', system: UCUM, code: 'mL/min/{1.73_m2}' },
    method: { text: 'CKD-EPI 2021 (sin coeficiente de raza), calculado desde la creatinina' },
    note: [
      {
        text:
          `Calculado con la creatinina del informe (${Number(mgDl.toFixed(2))} mg/dL), la edad (${edad} años) y el sexo.` +
          (informado ? ` El laboratorio lo informó como "${informado}".` : ' El informe no traía el filtrado.'),
      },
    ],
    ...(creatinina.derivedFrom ? { derivedFrom: creatinina.derivedFrom } : {}),
  };
  return egfr ? observaciones.map((o) => (o === egfr ? calculada : o)) : [...observaciones, calculada];
}
