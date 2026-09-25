/**
 * Informe de Segunda Opinión Médica (SOM) — helpers puros (sin FHIR ni red).
 *
 * Arma las piezas del informe que el bot interno `bot-som-report` persiste:
 *  - RiskAssessment a partir del resultado PREVENT,
 *  - la extensión `som-sections` del DiagnosticReport (6 secciones, claves EXACTAS),
 *  - el prompt para Claude y el parseo de su respuesta,
 *  - un PDF mínimo (sin dependencias) para el DocumentReference.
 *
 * El bot solo orquesta (lee/escribe FHIR, llama a Claude). Acá vive lo testeable.
 */
import type { DiagnosticReport, Extension, RiskAssessment } from '@medplum/fhirtypes';
import { EXT, SOM_SECCIONES, type SomSeccion } from '../fhir/identifiers.js';
import { resumenCkm, type EntradaCkm, type ResultadoCkm } from './ckm.js';
import { resumenPlanCkm, type PlanCkm, type RiesgosPrevent } from './ckm-guia.js';
import { ORDEN_PREVENT, riesgoPrevent, type ResultadoPrevent } from './prevent.js';

export type Secciones = Record<SomSeccion, string>;

/** Títulos humanos de cada sección (para el PDF y el portal). */
export const TITULOS_SECCION: Record<SomSeccion, string> = {
  'executive-summary': 'Resumen ejecutivo',
  'risk-assessment': 'Evaluación de riesgo',
  'history-analysis': 'Análisis de la historia clínica',
  'studies-analysis': 'Análisis de estudios',
  conclusions: 'Conclusiones',
  'pending-studies': 'Estudios pendientes',
};

/** Nota que estampa que PREVENT está pendiente de la firma médica. */
export const NOTA_PENDIENTE_VALIDACION =
  'Riesgo estimado con las ecuaciones PREVENT de la AHA (modelo base; coeficientes verificados ' +
  'contra la implementación de referencia). Estimación preliminar: no usar como valor definitivo ' +
  'sin revisión del equipo médico.';

const UCUM = 'http://unitsofmeasure.org';

/**
 * RiskAssessment a partir del resultado PREVENT (y del estadío CKM y el plan de la guía).
 *
 * Contrato con el portal (`EPA-Developments/app`, `src/fhir/som.ts`):
 *  - `basedOn` = la ServiceRequest: el portal busca `RiskAssessment?subject=…` y
 *    filtra por `basedOn` (R4 no tiene search param `based-on` en RiskAssessment).
 *  - `probabilityDecimal` es una **probabilidad 0–1** (el portal la multiplica por
 *    100 para mostrar el %). Cumple igual la invariante ras-2 de R4 (≤ 100).
 *  - El portal lee ASCVD 10a, IC 10a y ECV total 30a por el texto del desenlace y, si
 *    no, por POSICIÓN (0, 1, 2). Por eso `prediction[]` tiene lugares fijos en el
 *    orden de `ORDEN_PREVENT`: esos 3 primero, después ECV total 10a, ASCVD 30a e IC
 *    30a. Un desenlace no estimado ocupa su lugar sin probabilidad y con `rationale`
 *    (el motivo): así nunca se corre otro valor a un lugar ajeno.
 */
export function construirRiskAssessment(
  prevent: ResultadoPrevent,
  refs: { pacienteRef: string; serviceRequestRef: string },
  ckm?: ResultadoCkm,
  plan?: PlanCkm,
): RiskAssessment {
  // El estadío CKM va en ESTE RiskAssessment (no en otro): el portal toma el primer
  // RiskAssessment con basedOn = la solicitud para leer PREVENT.
  const notas = [
    ...(prevent.pendienteValidacion && prevent.predicciones.length > 0 ? [{ text: NOTA_PENDIENTE_VALIDACION }] : []),
    ...(prevent.predicciones.length === 0 && prevent.faltantes.length > 0
      ? [{ text: `PREVENT no estimado: ${[...new Set(prevent.noEstimadas.map((n) => n.motivo))].join('; ')}.` }]
      : []),
    ...(ckm ? [{ text: resumenCkm(ckm) }] : []),
    ...(plan ? [{ text: resumenPlanCkm(plan) }] : []),
  ];
  const prediction =
    prevent.predicciones.length === 0
      ? []
      : ORDEN_PREVENT.map(({ desenlace, horizonte }) => {
          const p = prevent.predicciones.find((x) => x.desenlace === desenlace && x.horizonte === horizonte);
          const n = prevent.noEstimadas.find((x) => x.desenlace === desenlace && x.horizonte === horizonte);
          return {
            outcome: { text: p?.etiqueta ?? n?.etiqueta ?? `${desenlace} ${horizonte}` },
            ...(p ? { probabilityDecimal: Math.round(p.probabilidad * 10000) / 10000 } : {}),
            whenRange: { high: { value: horizonte, unit: 'años', system: UCUM, code: 'a' } },
            ...(n ? { rationale: `No estimado: ${n.motivo}.` } : {}),
          };
        });
  return {
    resourceType: 'RiskAssessment',
    status: prevent.pendienteValidacion ? 'preliminary' : 'final',
    subject: { reference: refs.pacienteRef },
    basedOn: { reference: refs.serviceRequestRef },
    method: { text: 'AHA PREVENT (modelo base) y estadificación CKM (Guía AHA/ACC/ADA/ASN 2026)' },
    occurrenceDateTime: new Date().toISOString(),
    ...(prediction.length ? { prediction } : {}),
    ...(ckm
      ? {
          extension: [
            { url: EXT.ckmStage, valueCode: ckm.estadio },
            { url: EXT.ckmStageCompleto, valueBoolean: ckm.completo },
          ],
        }
      : {}),
    ...(notas.length ? { note: notas } : {}),
  };
}

/** Riesgo PREVENT a 10 años (0–1) para la estadificación CKM (PREVENT-CVD = equivalente de riesgo). */
export function riesgo10aDePrevent(prevent: ResultadoPrevent): EntradaCkm['riesgo10a'] {
  return {
    ecvTotal: riesgoPrevent(prevent, 'total-cvd', 10),
    ascvd: riesgoPrevent(prevent, 'ascvd', 10),
    ic: riesgoPrevent(prevent, 'heart-failure', 10),
  };
}

/** Riesgos PREVENT que usa el plan de la guía (Tabla 8). */
export function riesgosDePrevent(prevent: ResultadoPrevent): RiesgosPrevent {
  return {
    ecv10: riesgoPrevent(prevent, 'total-cvd', 10),
    ascvd10: riesgoPrevent(prevent, 'ascvd', 10),
    ic10: riesgoPrevent(prevent, 'heart-failure', 10),
    ascvd30: riesgoPrevent(prevent, 'ascvd', 30),
  };
}

/** Texto legible de las predicciones, para incrustar en el prompt y el PDF. */
export function resumenRiesgo(prevent: ResultadoPrevent): string {
  if (prevent.predicciones.length === 0) {
    const motivos = [...new Set(prevent.noEstimadas.map((n) => n.motivo))];
    return `Sin estimación de riesgo PREVENT${motivos.length ? ` (${motivos.join('; ')})` : ' (faltan datos)'}.`;
  }
  const lineas = prevent.predicciones.map((p) => `- ${p.etiqueta}: ${(p.probabilidad * 100).toFixed(1)}%`);
  for (const n of prevent.noEstimadas) {
    lineas.push(`- ${n.etiqueta}: no estimado (${n.motivo})`);
  }
  return lineas.join('\n');
}

/**
 * Extensión `som-sections` del DiagnosticReport: una sub-extensión por sección,
 * con las claves EXACTAS del contrato. Garantiza value[x] no vacío (ext-1).
 */
export function construirExtensionSecciones(secciones: Partial<Secciones>): Extension {
  return {
    url: EXT.somSections,
    extension: SOM_SECCIONES.map((clave) => ({
      url: clave,
      valueString: (secciones[clave]?.trim() || '—'),
    })),
  };
}

export interface DatosInforme {
  pacienteRef: string;
  serviceRequestRef: string;
  secciones: Partial<Secciones>;
  /** Binary del PDF, si ya se subió (DiagnosticReport.presentedForm). */
  pdfBinaryRef?: string;
}

/** DiagnosticReport final con las 6 secciones en la extensión `som-sections`. */
export function construirDiagnosticReport(d: DatosInforme): DiagnosticReport {
  return {
    resourceType: 'DiagnosticReport',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '11488-4', display: 'Consultation note' }], text: 'Segunda opinión cardiológica' },
    subject: { reference: d.pacienteRef },
    basedOn: [{ reference: d.serviceRequestRef }],
    issued: new Date().toISOString(),
    extension: [construirExtensionSecciones(d.secciones)],
    ...(d.pdfBinaryRef
      ? { presentedForm: [{ contentType: 'application/pdf', url: d.pdfBinaryRef, title: 'Informe SOM' }] }
      : {}),
  };
}

// ───────────────────────────── Claude (prompt + parseo) ─────────────────────────────

export interface ContextoClinico {
  motivo?: string;
  paciente?: { edad?: number; sexo?: string };
  condiciones: string[];
  observaciones: string[];
  medicacion: string[];
  estudios: string[];
  resumenRiesgo: string;
  /** Estadificación CKM (Guía 2026) con sus criterios y faltantes. */
  resumenCkm?: string;
  /** Plan de la guía: seguimiento, evaluaciones, umbrales y potenciadores. */
  resumenPlan?: string;
  /** Evaluaciones que sugiere la guía (para "pending-studies" si Claude no está). */
  evaluacionesSugeridas?: string[];
}

/** Instrucción de sistema para Claude (rol, marco clínico y formato de salida). */
export const SYSTEM_PROMPT =
  'Sos un cardiólogo que redacta una segunda opinión médica para Segunda Opinión ' +
  'Médica (Dr. Barbagelata). Trabajás con cardiología CONVENCIONAL basada en guías: ' +
  'la Guía 2026 AHA/ACC/ADA/ASN del síndrome cardiovascular-renal-metabólico (CKM, ' +
  'Ndumele) con las ecuaciones PREVENT de la AHA, y las guías AHA/ACC de presión arterial ' +
  'y lípidos, KDIGO para la función renal y ADA para la glucemia. NO uses parámetros, ' +
  'rangos "óptimos" ni recomendaciones de medicina funcional o integrativa. Usá el estadío ' +
  'CKM, el riesgo PREVENT y el plan de la guía que te damos (son estimaciones del sistema ' +
  'pendientes de validación médica; no los recalcules) en "risk-assessment", y las ' +
  'evaluaciones sugeridas en "pending-studies". Analizá la información del paciente y ' +
  'devolvé EXCLUSIVAMENTE un JSON válido con estas claves exactas (strings, en español, ' +
  'claras y prudentes): ' +
  SOM_SECCIONES.map((s) => `"${s}"`).join(', ') +
  '. No agregues texto fuera del JSON. No inventes datos que no estén en la entrada; ' +
  'si faltan estudios, listalos en "pending-studies".';

/** Mensaje de usuario para Claude con el contexto clínico estructurado. */
export function construirPromptUsuario(c: ContextoClinico): string {
  const bloque = (titulo: string, items: string[]): string =>
    `${titulo}:\n${items.length ? items.map((i) => `- ${i}`).join('\n') : '- (sin datos)'}`;
  return [
    `Motivo de consulta: ${c.motivo?.trim() || '(no especificado)'}`,
    `Paciente: ${c.paciente?.sexo ?? 'sexo n/d'}, ${c.paciente?.edad ?? 'edad n/d'} años`,
    bloque('Condiciones', c.condiciones),
    bloque('Observaciones / laboratorio / signos', c.observaciones),
    bloque('Medicación', c.medicacion),
    bloque('Estudios adjuntos', c.estudios),
    `Riesgo PREVENT (AHA, modelo base; pendiente de validación médica):\n${c.resumenRiesgo}`,
    ...(c.resumenCkm ? [c.resumenCkm] : []),
    ...(c.resumenPlan ? [c.resumenPlan] : []),
  ].join('\n\n');
}

/** Parsea la respuesta de Claude (JSON) a las 6 secciones, tolerante a ruido. */
export function parsearSecciones(texto: string): Partial<Secciones> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) {
      return {};
    }
    try {
      crudo = JSON.parse(m[0]);
    } catch {
      return {};
    }
  }
  if (!crudo || typeof crudo !== 'object') {
    return {};
  }
  const obj = crudo as Record<string, unknown>;
  const out: Partial<Secciones> = {};
  for (const clave of SOM_SECCIONES) {
    const v = obj[clave];
    if (typeof v === 'string' && v.trim()) {
      out[clave] = v.trim();
    }
  }
  return out;
}

// ───────────────────────────── PDF mínimo (sin dependencias) ─────────────────────────────

const ANCHO_LINEA = 95;
const LINEAS_POR_PAGINA = 50;

/** Translitera a ASCII (Helvetica/WinAnsi) y escapa caracteres PDF. */
function aLatin(texto: string): string {
  const map: Record<string, string> = {
    á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
    Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
    '¿': '?', '¡': '!', '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '•': '-',
  };
  return texto.replace(/[^\x00-\x7F]/g, (ch) => map[ch] ?? '');
}

function escapar(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Parte un texto en líneas que entran en el ancho dado (corte por palabras). */
function ajustar(texto: string, ancho: number): string[] {
  const lineas: string[] = [];
  for (const parrafo of texto.split('\n')) {
    if (parrafo.trim() === '') {
      lineas.push('');
      continue;
    }
    let actual = '';
    for (const palabra of parrafo.split(/\s+/)) {
      if ((actual + ' ' + palabra).trim().length > ancho) {
        if (actual) {
          lineas.push(actual);
        }
        actual = palabra;
      } else {
        actual = (actual ? actual + ' ' : '') + palabra;
      }
    }
    if (actual) {
      lineas.push(actual);
    }
  }
  return lineas;
}

/**
 * Genera un PDF mínimo (texto, Helvetica) multipágina a partir de las secciones.
 * Sin dependencias: arma los objetos y la xref a mano. Devuelve los bytes.
 */
export function construirPdf(titulo: string, secciones: Array<{ titulo: string; texto: string }>): Uint8Array {
  // 1) Componer todas las líneas (con títulos de sección).
  const lineas: string[] = [titulo, ''];
  for (const s of secciones) {
    lineas.push(s.titulo.toUpperCase());
    lineas.push(...ajustar(s.texto, ANCHO_LINEA));
    lineas.push('');
  }

  // 2) Paginar.
  const paginas: string[][] = [];
  for (let i = 0; i < lineas.length; i += LINEAS_POR_PAGINA) {
    paginas.push(lineas.slice(i, i + LINEAS_POR_PAGINA));
  }
  if (paginas.length === 0) {
    paginas.push([titulo]);
  }

  // 3) Construir objetos PDF. Numeración:
  //    1 Catalog, 2 Pages, 3 Font, luego por página: Page y Contents.
  const objetos: string[] = [];
  const kids: string[] = [];
  const numPaginas = paginas.length;
  // ids de página/contenido: empiezan en 4.
  for (let p = 0; p < numPaginas; p++) {
    const pageId = 4 + p * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
  }

  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${numPaginas} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  for (let p = 0; p < numPaginas; p++) {
    const pageId = 4 + p * 2;
    const contentId = pageId + 1;
    const cuerpo =
      'BT\n/F1 10 Tf\n50 800 Td\n13 TL\n' +
      paginas[p]!.map((l, idx) => (idx === 0 ? `(${escapar(aLatin(l))}) Tj` : `T* (${escapar(aLatin(l))}) Tj`)).join('\n') +
      '\nET';
    objetos[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objetos[contentId] = `<< /Length ${cuerpo.length} >>\nstream\n${cuerpo}\nendstream`;
  }

  // 4) Serializar con xref.
  const totalObjetos = objetos.length - 1; // índice 0 sin usar
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= totalObjetos; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${totalObjetos + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjetos; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjetos + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
