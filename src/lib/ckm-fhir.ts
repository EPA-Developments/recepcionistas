/**
 * Datos de la estadificación CKM a partir de los recursos FHIR del paciente —
 * lógica pura (recibe los recursos ya leídos; no hace red).
 *
 * Data-driven e interoperable: los valores se reconocen por LOINC (y las unidades
 * se normalizan con UCUM), los problemas por ICD-10 / SNOMED CT con respaldo por
 * texto, y solo cuentan las condiciones activas. Lo que no está codificado ni
 * nombrado de forma reconocible no se infiere.
 */
import type { CodeableConcept, Condition, MedicationRequest, Observation, Patient, Quantity } from '@medplum/fhirtypes';
import type { EcvClinica, EntradaCkm } from './ckm.js';

/** Códigos LOINC por dato (solo códigos estándar conocidos). */
export const LOINC_CKM = {
  imc: ['39156-5'],
  cintura: ['8280-0'],
  glucemiaAyunas: ['1558-6'],
  hba1c: ['4548-4', '17856-6'],
  pas: ['8480-6'],
  pad: ['8462-4'],
  trigliceridos: ['2571-8'],
  hdl: ['2085-9'],
  colesterolTotal: ['2093-3'],
  egfr: ['33914-3', '48642-3', '48643-1', '62238-1', '98979-8'],
  uacr: ['9318-7', '14959-1'],
  ntProBnp: ['33762-6'],
  hsTnT: ['67151-1'],
  hsTnI: ['89579-7'],
} as const;

/** Calcio coronario: sin un LOINC de uso extendido; se reconoce por el nombre. */
const RE_CAC = /agatston|calcio coronario|score de calcio|coronary artery calcium|calcium score|\bCAC\b/i;

/** Conversión a la unidad de los umbrales (mg/dL, mg/g, ng/L, pg/mL). */
const CONVERSIONES: Record<string, Record<string, number>> = {
  glucemiaAyunas: { 'mmol/L': 18.016 },
  trigliceridos: { 'mmol/L': 88.57 },
  hdl: { 'mmol/L': 38.67 },
  colesterolTotal: { 'mmol/L': 38.67 },
  uacr: { 'mg/mmol': 8.84 },
  hsTnT: { 'ng/mL': 1000, 'ug/L': 1000 },
  hsTnI: { 'ng/mL': 1000, 'ug/L': 1000 },
  ntProBnp: { 'ng/L': 1 },
};

const esLoinc = (system?: string): boolean => Boolean(system?.includes('loinc'));
const tieneCodigo = (cc: CodeableConcept | undefined, codigos: readonly string[]): boolean =>
  Boolean(cc?.coding?.some((c) => esLoinc(c.system) && codigos.includes(c.code ?? '')));

function convertir(dato: string, q: Quantity): number | undefined {
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    return undefined;
  }
  const unidad = q.code ?? q.unit ?? '';
  if (dato === 'hba1c' && unidad === 'mmol/mol') {
    return q.value / 10.929 + 2.15; // IFCC → NGSP (%)
  }
  const factor = CONVERSIONES[dato]?.[unidad] ?? 1;
  return q.value * factor;
}

/** Último valor (por fecha) de un dato: en la Observation o en sus componentes (p. ej. PA 85354-9). */
export function ultimoValor(obs: Observation[], dato: keyof typeof LOINC_CKM): number | undefined {
  const codigos = LOINC_CKM[dato];
  const candidatos: Array<{ fecha: string; valor: number }> = [];
  for (const o of obs) {
    if (o.status === 'entered-in-error' || o.status === 'cancelled') {
      continue;
    }
    const fecha = o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.issued ?? '';
    if (tieneCodigo(o.code, codigos) && o.valueQuantity) {
      const v = convertir(dato, o.valueQuantity);
      if (v !== undefined) candidatos.push({ fecha, valor: v });
    }
    for (const comp of o.component ?? []) {
      if (tieneCodigo(comp.code, codigos) && comp.valueQuantity) {
        const v = convertir(dato, comp.valueQuantity);
        if (v !== undefined) candidatos.push({ fecha, valor: v });
      }
    }
  }
  candidatos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return candidatos[0]?.valor;
}

function ultimoCac(obs: Observation[]): number | undefined {
  const cac = obs
    .filter((o) => RE_CAC.test(`${o.code?.text ?? ''} ${o.code?.coding?.map((c) => c.display).join(' ') ?? ''}`))
    .filter((o) => typeof o.valueQuantity?.value === 'number')
    .sort((a, b) => (b.effectiveDateTime ?? '').localeCompare(a.effectiveDateTime ?? ''));
  return cac[0]?.valueQuantity?.value;
}

/** ¿La condición está activa? (sin clinicalStatus se toma como activa). */
function activa(c: Condition): boolean {
  const estado = c.clinicalStatus?.coding?.[0]?.code;
  const verificacion = c.verificationStatus?.coding?.[0]?.code;
  return (!estado || ['active', 'recurrence', 'relapse'].includes(estado)) && verificacion !== 'refuted' && verificacion !== 'entered-in-error';
}

interface Criterio {
  icd10?: RegExp;
  snomed?: string[];
  texto?: RegExp;
}

function cumple(c: Condition, k: Criterio): boolean {
  const codings = c.code?.coding ?? [];
  if (k.icd10 && codings.some((x) => x.system?.includes('icd-10') && k.icd10!.test((x.code ?? '').toUpperCase()))) {
    return true;
  }
  if (k.snomed && codings.some((x) => x.system === 'http://snomed.info/sct' && k.snomed!.includes(x.code ?? ''))) {
    return true;
  }
  const texto = `${c.code?.text ?? ''} ${codings.map((x) => x.display ?? '').join(' ')}`;
  return Boolean(k.texto?.test(texto));
}

/** Problemas relevantes para CKM (ICD-10 / SNOMED CT / texto). */
const CRITERIOS = {
  coronaria: {
    icd10: /^I2[0-5]/,
    snomed: ['53741008', '22298006', '194828000', '414545008'],
    texto: /coronari|infarto|angina|cardiopat[ií]a isqu[eé]mica|coronary|myocardial infarction/i,
  },
  'insuficiencia-cardiaca': {
    icd10: /^I50/,
    snomed: ['84114007'],
    texto: /insuficiencia card[ií]aca|heart failure/i,
  },
  acv: {
    icd10: /^I6[0-4]/,
    snomed: ['230690007'],
    texto: /accidente cerebrovascular|\bACV\b|\bictus\b|\bstroke\b/i,
  },
  'arterial-periferica': {
    icd10: /^I70\.?2|^I73\.?9/,
    snomed: ['399957001'],
    texto: /arteriopat[ií]a perif|enfermedad arterial perif|peripheral arter/i,
  },
  'fibrilacion-auricular': {
    icd10: /^I48/,
    snomed: ['49436004'],
    texto: /fibrilaci[oó]n auricular|atrial fibrillation/i,
  },
} satisfies Record<EcvClinica, Criterio>;

const DIABETES: Criterio = {
  icd10: /^E1[0-4]/,
  snomed: ['44054006', '73211009', '46635009'],
  texto: /(^|[^e])diabetes(?! gestacional)/i,
};
const HIPERTENSION: Criterio = {
  icd10: /^I1[0-5]/,
  snomed: ['38341003'],
  texto: /hipertensi[oó]n arterial|\bHTA\b|hypertension/i,
};
const DIALISIS: Criterio = {
  icd10: /^Z99\.?2|^N18\.?6/,
  texto: /di[aá]lisis|dialysis/i,
};

/** Categoría de ERC por diagnóstico (ICD-10 N18.x), para cuando no hay eGFR. */
function ercDiagnosticada(conds: Condition[]): EntradaCkm['ercDiagnosticada'] {
  let peor: EntradaCkm['ercDiagnosticada'];
  const orden = { G3: 3, G4: 4, G5: 5 } as const;
  for (const c of conds) {
    for (const x of c.code?.coding ?? []) {
      if (!x.system?.includes('icd-10')) continue;
      const m = /^N18\.?([3456])/.exec((x.code ?? '').toUpperCase());
      if (!m) continue;
      const g = m[1] === '3' ? 'G3' : m[1] === '4' ? 'G4' : 'G5';
      if (!peor || orden[g] > orden[peor]) peor = g;
    }
  }
  return peor;
}

const RE_ANTIHIPERTENSIVO =
  /enalapril|lisinopril|ramipril|perindopril|losart|valsart|irbesart|telmisart|olmesart|candesart|amlodip|nifedip|hidroclorotiaz|clortalid|indapamid|atenolol|bisoprolol|metoprolol|nebivolol|carvedilol|espironolact|antihipertensiv/i;

function textoMedicacion(m: MedicationRequest): string {
  const cc = m.medicationCodeableConcept;
  return `${cc?.text ?? ''} ${cc?.coding?.map((c) => c.display ?? '').join(' ') ?? ''}`;
}

/** Entrada de la estadificación CKM con lo que haya en la historia del paciente. */
export function entradaCkmDesdeFhir(d: {
  paciente?: Patient;
  condiciones: Condition[];
  observaciones: Observation[];
  medicacion: MedicationRequest[];
  riesgo10a?: EntradaCkm['riesgo10a'];
}): EntradaCkm {
  const conds = d.condiciones.filter(activa);
  const obs = d.observaciones;
  const sexo = d.paciente?.gender === 'female' || d.paciente?.gender === 'male' ? d.paciente.gender : undefined;
  const medsActivas = d.medicacion.filter((m) => !m.status || m.status === 'active');
  const ecvClinica = (Object.keys(CRITERIOS) as EcvClinica[]).filter((k) => conds.some((c) => cumple(c, CRITERIOS[k])));

  return {
    sexo,
    imc: ultimoValor(obs, 'imc'),
    cintura: ultimoValor(obs, 'cintura'),
    glucemiaAyunas: ultimoValor(obs, 'glucemiaAyunas'),
    hba1c: ultimoValor(obs, 'hba1c'),
    pas: ultimoValor(obs, 'pas'),
    pad: ultimoValor(obs, 'pad'),
    trigliceridos: ultimoValor(obs, 'trigliceridos'),
    hdl: ultimoValor(obs, 'hdl'),
    egfr: ultimoValor(obs, 'egfr'),
    uacr: ultimoValor(obs, 'uacr'),
    ntProBnp: ultimoValor(obs, 'ntProBnp'),
    hsTnT: ultimoValor(obs, 'hsTnT'),
    hsTnI: ultimoValor(obs, 'hsTnI'),
    cac: ultimoCac(obs),
    diabetes: conds.some((c) => cumple(c, DIABETES)) || undefined,
    hipertension: conds.some((c) => cumple(c, HIPERTENSION)) || undefined,
    tratamientoHta: medsActivas.some((m) => RE_ANTIHIPERTENSIVO.test(textoMedicacion(m))) || undefined,
    dialisis: conds.some((c) => cumple(c, DIALISIS)) || undefined,
    ercDiagnosticada: ercDiagnosticada(conds),
    riesgo10a: d.riesgo10a,
    ecvClinica,
  };
}
