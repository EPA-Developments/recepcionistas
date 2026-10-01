/**
 * Poner al día los laboratorios en PDF que ya se procesaron (`npm run laboratorio:actualizar`).
 *
 *  1. Duplicados: dos informes del mismo paciente con la misma fecha y exactamente los
 *     mismos valores son el mismo estudio cargado dos veces. Queda el más viejo; el otro
 *     (y sus Observation) pasa a `entered-in-error` y su documento se liga al original.
 *  2. Relectura: un informe leído con el catálogo viejo (antes de que el servidor publicara
 *     el laboratorio de rutina) tiene valores sin código, p. ej. la creatinina, y por eso
 *     no tiene eGFR ni aparece en los paneles nuevos. Se vuelve a leer el PDF con el
 *     catálogo vigente (bot `som-procesar-laboratorio` en modo `releer`).
 *  3. eGFR: un informe con la creatinina codificada y sin filtrado con un número lo recibe
 *     calculado (CKD-EPI 2021), como lo hace hoy el bot con cada PDF nuevo.
 *  4. Sin datos: a quién le falta la edad o el sexo (femenino o masculino) para el cálculo.
 */
import type { MedplumClient } from '@medplum/core';
import type { DiagnosticReport, DocumentReference, Observation, Patient } from '@medplum/fhirtypes';
import { LOINC_CKM } from './ckm-fhir.js';
import { completarEgfr, edadEn, type EntradaCatalogo } from './laboratorio.js';

const LOINC = 'http://loinc.org';
const CODIGOS_EGFR: ReadonlySet<string> = new Set(LOINC_CKM.egfr);
const CODIGOS_CREATININA: ReadonlySet<string> = new Set(['2160-0', '38483-4']);

/** Un informe de laboratorio del bot con sus valores. */
export interface InformeConValores {
  informe: DiagnosticReport;
  observaciones: Observation[];
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const vigente = (r: { status?: string }) => r.status !== 'entered-in-error' && r.status !== 'cancelled';

function valorComoTexto(o: Observation): string {
  const q = o.valueQuantity;
  if (q?.value !== undefined) {
    return `${q.comparator ?? ''}${q.value}${q.unit ? ` ${q.unit}` : ''}`;
  }
  return o.valueString ?? '';
}

/** "fecha|analito=valor|…": dos informes con la misma firma tienen los mismos resultados. */
export function firmaInforme(x: InformeConValores): string | undefined {
  const obs = x.observaciones.filter(vigente);
  if (obs.length === 0) {
    return undefined;
  }
  const valores = obs
    .map((o) => `${normalizar(o.code?.text ?? o.code?.coding?.[0]?.code ?? '')}=${valorComoTexto(o)}`)
    .sort();
  return [x.informe.subject?.reference ?? '', (x.informe.effectiveDateTime ?? '').slice(0, 10), ...valores].join('|');
}

const fechaInforme = (d: DiagnosticReport) => d.issued ?? d.meta?.lastUpdated ?? '';

/** Los informes repetidos y su original (el más viejo de cada grupo con la misma firma). */
export function detectarDuplicados(informes: InformeConValores[]): Array<{ duplicado: InformeConValores; original: InformeConValores }> {
  const grupos = new Map<string, InformeConValores[]>();
  for (const x of informes.filter((i) => vigente(i.informe))) {
    const firma = firmaInforme(x);
    if (firma) {
      grupos.set(firma, [...(grupos.get(firma) ?? []), x]);
    }
  }
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .flatMap((g) => {
      const [original, ...resto] = [...g].sort((a, b) => fechaInforme(a.informe).localeCompare(fechaInforme(b.informe)));
      return resto.map((duplicado) => ({ duplicado, original: original as InformeConValores }));
    });
}

/** Nombres del catálogo (nombre y sinónimos, normalizados) → analito. */
function nombresDelCatalogo(catalogo: EntradaCatalogo[]): Array<{ nombre: string; entrada: EntradaCatalogo }> {
  return catalogo.flatMap((c) =>
    [c.nombre, ...(c.sinonimos ?? [])].map((n) => ({ nombre: normalizar(n), entrada: c })).filter((x) => x.nombre.length >= 3),
  );
}

/**
 * Los valores guardados sin código cuyo nombre es el de un analito del catálogo (o lo
 * contiene). Solo sirve para decidir si vale la pena releer: el código lo elige Claude
 * leyendo el PDF completo (sección, unidad), no esta comparación de nombres.
 */
export function valoresSinCodigo(observaciones: Observation[], catalogo: EntradaCatalogo[]): Observation[] {
  const nombres = nombresDelCatalogo(catalogo);
  return observaciones.filter((o) => {
    if (!vigente(o) || o.code?.coding?.length || !o.code?.text) {
      return false;
    }
    const texto = ` ${normalizar(o.code.text)} `;
    return nombres.some((n) => texto.includes(` ${n.nombre} `));
  });
}

const tieneLoinc = (o: Observation, codigos: ReadonlySet<string>) =>
  Boolean(o.code?.coding?.some((c) => c.system === LOINC && c.code && codigos.has(c.code)));

/** ¿Tiene el filtrado con un número (no "> 60" ni texto)? */
const tieneEgfrNumerico = (obs: Observation[]) =>
  obs.some((o) => vigente(o) && tieneLoinc(o, CODIGOS_EGFR) && o.valueQuantity?.value !== undefined && !o.valueQuantity.comparator);

/** Qué le falta al paciente para calcular el eGFR (vacío = nada). */
export function faltaParaEgfr(paciente: Pick<Patient, 'gender' | 'birthDate'> | undefined, fecha: string): string[] {
  const falta: string[] = [];
  if (!paciente?.birthDate) {
    falta.push('la fecha de nacimiento');
  } else if ((edadEn(paciente.birthDate, fecha) ?? 0) < 18) {
    falta.push('ser mayor de 18 años (CKD-EPI es para adultos)');
  }
  if (paciente?.gender !== 'female' && paciente?.gender !== 'male') {
    falta.push('el sexo biológico (femenino o masculino)');
  }
  return falta;
}

export interface PlanActualizacion {
  duplicados: Array<{ duplicado: InformeConValores; original: InformeConValores }>;
  relecturas: Array<{ informe: InformeConValores; documento: DocumentReference; motivo: string }>;
  egfr: Array<{ informe: InformeConValores; calculada: Observation; reemplaza?: Observation }>;
  sinDatos: Array<{ pacienteRef: string; informe: InformeConValores; falta: string[] }>;
}

/**
 * Qué hacer con cada informe. `catalogoDesde`: cuándo el servidor empezó a publicar el
 * catálogo vigente (los informes emitidos antes se leyeron con el viejo).
 */
export function planActualizacion(opciones: {
  informes: InformeConValores[];
  documentos: DocumentReference[];
  pacientes: Map<string, Patient>;
  catalogo: EntradaCatalogo[];
  catalogoDesde: string;
}): PlanActualizacion {
  const { informes, documentos, pacientes, catalogo, catalogoDesde } = opciones;
  const duplicados = detectarDuplicados(informes);
  const anulados = new Set(duplicados.map((d) => d.duplicado.informe.id));
  const plan: PlanActualizacion = { duplicados, relecturas: [], egfr: [], sinDatos: [] };

  for (const x of informes.filter((i) => vigente(i.informe) && !anulados.has(i.informe.id))) {
    const ref = `DiagnosticReport/${x.informe.id}`;
    const pacienteRef = x.informe.subject?.reference ?? '';
    const paciente = pacientes.get(pacienteRef);
    const fecha = x.informe.effectiveDateTime ?? x.informe.issued ?? '';
    const falta = faltaParaEgfr(paciente, fecha);

    const sinCodigo = fechaInforme(x.informe) < catalogoDesde ? valoresSinCodigo(x.observaciones, catalogo) : [];
    // El documento del que salió (o el de un duplicado ya ligado a este informe).
    const documento = documentos
      .filter((d) => d.status === 'current' && d.context?.related?.some((r) => r.reference === ref))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))[0];
    if (sinCodigo.length > 0 && documento) {
      const ejemplos = [...new Set(sinCodigo.map((o) => o.code?.text as string))].slice(0, 4).join(', ');
      plan.relecturas.push({
        informe: x,
        documento,
        motivo: `${sinCodigo.length} valor(es) sin código del catálogo vigente (${ejemplos}${sinCodigo.length > 4 ? '…' : ''})`,
      });
      const creatininaSinCodigo = sinCodigo.some((o) => /creatinin/.test(normalizar(o.code?.text ?? '')));
      if (creatininaSinCodigo && !tieneEgfrNumerico(x.observaciones) && falta.length) {
        plan.sinDatos.push({ pacienteRef, informe: x, falta });
      }
      continue;
    }

    const conCreatinina = x.observaciones.some((o) => vigente(o) && tieneLoinc(o, CODIGOS_CREATININA));
    if (!conCreatinina || tieneEgfrNumerico(x.observaciones)) {
      continue;
    }
    if (falta.length) {
      plan.sinDatos.push({ pacienteRef, informe: x, falta });
      continue;
    }
    const vigentes = x.observaciones.filter(vigente);
    const completas = completarEgfr(vigentes, paciente ?? {}, catalogo);
    const calculada = completas.find((o) => !vigentes.includes(o));
    if (calculada) {
      const reemplaza = vigentes.find((o) => !completas.includes(o));
      plan.egfr.push({ informe: x, calculada, ...(reemplaza ? { reemplaza } : {}) });
    }
  }
  return plan;
}

/** `context.related` con un informe reemplazado por otro (sin duplicar). */
export function reemplazarInforme(doc: DocumentReference, anterior: string, nuevo: string): NonNullable<DocumentReference['context']> {
  const resto = (doc.context?.related ?? []).filter((r) => r.reference !== anterior && r.reference !== nuevo);
  return { ...doc.context, related: [...resto, { reference: nuevo }] };
}

// ───────────────────────────── Escrituras ─────────────────────────────

/** El informe y sus valores pasan a `entered-in-error` (quedan en el historial, fuera de los gráficos). */
export async function anularInforme(medplum: MedplumClient, informeRef: string, motivo: string): Promise<void> {
  const informe = await medplum.readResource('DiagnosticReport', informeRef.split('/')[1] as string);
  for (const r of informe.result ?? []) {
    const id = r.reference?.split('/')[1];
    const o = id ? await medplum.readResource('Observation', id).catch(() => undefined) : undefined;
    if (o && vigente(o)) {
      await medplum.updateResource<Observation>({ ...o, status: 'entered-in-error', note: [...(o.note ?? []), { text: motivo }] });
    }
  }
  if (vigente(informe)) {
    await medplum.updateResource<DiagnosticReport>({ ...informe, status: 'entered-in-error', conclusion: motivo });
  }
}

/** Los documentos que muestran `anterior` pasan a mostrar `nuevo` (el portal sigue en "Ver resultados"). */
export async function religarDocumentos(
  medplum: MedplumClient,
  documentos: DocumentReference[],
  anterior: string,
  nuevo: string,
): Promise<DocumentReference[]> {
  const out: DocumentReference[] = [];
  for (const d of documentos.filter((x) => x.context?.related?.some((r) => r.reference === anterior))) {
    out.push(await medplum.updateResource<DocumentReference>({ ...d, context: reemplazarInforme(d, anterior, nuevo) }));
  }
  return out;
}

/** Duplicado: se anula y su documento queda ligado al informe original. */
export async function aplicarDuplicado(
  medplum: MedplumClient,
  d: PlanActualizacion['duplicados'][number],
  documentos: DocumentReference[],
): Promise<DocumentReference[]> {
  const anterior = `DiagnosticReport/${d.duplicado.informe.id}`;
  const original = `DiagnosticReport/${d.original.informe.id}`;
  const religados = await religarDocumentos(medplum, documentos, anterior, original);
  await anularInforme(medplum, anterior, `Duplicado de ${original}: el mismo estudio se cargó dos veces.`);
  return religados;
}

/** eGFR calculado: se suma al informe (o reemplaza en el lugar al "> 60" del laboratorio). */
export async function aplicarEgfr(medplum: MedplumClient, e: PlanActualizacion['egfr'][number]): Promise<Observation> {
  if (e.reemplaza?.id) {
    return medplum.updateResource<Observation>({ ...e.calculada, id: e.reemplaza.id });
  }
  const creada = await medplum.createResource<Observation>(e.calculada);
  const informe = await medplum.readResource('DiagnosticReport', e.informe.informe.id as string);
  await medplum.updateResource<DiagnosticReport>({
    ...informe,
    result: [...(informe.result ?? []), { reference: `Observation/${creada.id}` }],
  });
  return creada;
}
