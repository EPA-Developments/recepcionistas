/**
 * Datos de la estadificación CKM a partir de los recursos FHIR del paciente —
 * lógica pura (recibe los recursos ya leídos; no hace red).
 *
 * Data-driven e interoperable: los valores se reconocen por LOINC (y las unidades
 * se normalizan con UCUM), los problemas por ICD-10 / SNOMED CT con respaldo por
 * texto, y solo cuentan las condiciones activas. Los parámetros sin un LOINC de uso
 * extendido (calcio coronario, índice tobillo-brazo, ecocardiograma de la Tabla 16)
 * se reconocen por su nombre. Lo que no está codificado ni nombrado de forma
 * reconocible no se infiere.
 */
import type { CodeableConcept, Condition, MedicationRequest, Observation, Patient, Quantity } from '@medplum/fhirtypes';
import type { EcvClinica, Ecocardiograma, EntradaCkm } from './ckm.js';

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
  bnp: ['30934-4'],
  hsTnT: ['67151-1'],
  hsTnI: ['89579-7'],
  pcrUs: ['30522-7'],
  fevi: ['10230-1'],
} as const;

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
  bnp: { 'ng/L': 1 },
  pcrUs: { 'mg/dL': 10 },
};

const esLoinc = (system?: string): boolean => Boolean(system?.includes('loinc'));
const tieneCodigo = (cc: CodeableConcept | undefined, codigos: readonly string[]): boolean =>
  Boolean(cc?.coding?.some((c) => esLoinc(c.system) && codigos.includes(c.code ?? '')));
const textoDe = (cc: CodeableConcept | undefined): string =>
  `${cc?.text ?? ''} ${cc?.coding?.map((c) => c.display ?? '').join(' ') ?? ''}`;
const anulada = (o: Observation): boolean => o.status === 'entered-in-error' || o.status === 'cancelled';
const fechaDe = (o: Observation): string => o.effectiveDateTime ?? o.effectivePeriod?.start ?? o.issued ?? '';

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

/** Todos los valores (con fecha) de un dato: en la Observation o en sus componentes (p. ej. PA 85354-9). */
function valores(obs: Observation[], dato: keyof typeof LOINC_CKM): Array<{ fecha: string; valor: number }> {
  const codigos = LOINC_CKM[dato];
  const out: Array<{ fecha: string; valor: number }> = [];
  for (const o of obs) {
    if (anulada(o)) continue;
    const fecha = fechaDe(o);
    if (tieneCodigo(o.code, codigos) && o.valueQuantity) {
      const v = convertir(dato, o.valueQuantity);
      if (v !== undefined) out.push({ fecha, valor: v });
    }
    for (const comp of o.component ?? []) {
      if (tieneCodigo(comp.code, codigos) && comp.valueQuantity) {
        const v = convertir(dato, comp.valueQuantity);
        if (v !== undefined) out.push({ fecha, valor: v });
      }
    }
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Último valor (por fecha) de un dato. */
export function ultimoValor(obs: Observation[], dato: keyof typeof LOINC_CKM): number | undefined {
  return valores(obs, dato)[0]?.valor;
}

/** Parámetros sin LOINC de uso extendido: se reconocen por el nombre (el orden importa). */
const POR_NOMBRE: Array<{ clave: keyof Ecocardiograma | 'cac' | 'itb'; re: RegExp }> = [
  { clave: 'eSobreEPrima', re: /\bE\s*\/\s*e\b|E\/e['′´]|relaci[oó]n E\/e/i },
  { clave: 'eSeptal', re: /\be['′´]?\s*septal|septal\s*e['′´]/i },
  { clave: 'lavi', re: /volumen (de la )?aur[ií]cula izquierda indexado|volumen auricular izquierdo indexado|\bLAVI\b|left atri(al|um) volume index/i },
  { clave: 'lvmi', re: /masa (ventricular izquierda|del VI) indexada|\bLVMI\b|left ventricular mass index/i },
  { clave: 'rwt', re: /espesor parietal relativo|grosor parietal relativo|\bRWT\b|relative wall thickness/i },
  { clave: 'gls', re: /strain longitudinal global|\bGLS\b|global longitudinal strain/i },
  { clave: 'velocidadIt', re: /velocidad (m[aá]xima )?(de |del )?(la )?(insuficiencia|regurgitaci[oó]n) tricusp[ií]dea|TR (peak )?velocity|tricuspid regurgitation (peak )?velocity/i },
  { clave: 'psap', re: /presi[oó]n sist[oó]lica (de la )?(arteria )?pulmonar|\bPSAP\b|\bPASP\b|pulmonary artery systolic pressure/i },
  { clave: 'fevi', re: /fracci[oó]n de eyecci[oó]n|\bFEVI\b|\bLVEF\b|ejection fraction/i },
  { clave: 'espesorPared', re: /espesor (de (la )?)?pared|espesor del septum|septum interventricular|pared posterior|wall thickness/i },
  { clave: 'cac', re: /agatston|calcio coronario|score de calcio|coronary artery calcium|calcium score|\bCAC\b/i },
  { clave: 'itb', re: /tobillo.?brazo|\bITB\b|ankle.?brachial|\bABI\b/i },
];

/** Último valor de cada parámetro reconocido por nombre (FEVI también por LOINC). */
function valoresPorNombre(obs: Observation[]): Partial<Record<(typeof POR_NOMBRE)[number]['clave'], number>> {
  const out: Partial<Record<(typeof POR_NOMBRE)[number]['clave'], { fecha: string; valor: number }>> = {};
  for (const o of obs) {
    if (anulada(o) || typeof o.valueQuantity?.value !== 'number') continue;
    const clave = tieneCodigo(o.code, LOINC_CKM.fevi)
      ? 'fevi'
      : POR_NOMBRE.find((p) => p.re.test(textoDe(o.code)))?.clave;
    if (!clave) continue;
    const fecha = fechaDe(o);
    if (!out[clave] || fecha > out[clave]!.fecha) out[clave] = { fecha, valor: o.valueQuantity.value };
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v!.valor]));
}

/**
 * ERC confirmada por laboratorio: la MISMA alteración (eGFR < 60, o UACR ≥ 30) en ≥ 2
 * mediciones separadas ≥ 3 meses (definición de la guía). undefined si no hay
 * valores alterados.
 */
function ercPersistente(obs: Observation[]): boolean | undefined {
  const noventaDias = 90 * 24 * 3600 * 1000;
  const persiste = (fechas: string[]): boolean => {
    const t = fechas.map((f) => Date.parse(f)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return t.length >= 2 && t[t.length - 1]! - t[0]! >= noventaDias;
  };
  const egfrBajo = valores(obs, 'egfr').filter((v) => v.valor < 60).map((v) => v.fecha);
  const albuminuria = valores(obs, 'uacr').filter((v) => v.valor >= 30).map((v) => v.fecha);
  if (egfrBajo.length === 0 && albuminuria.length === 0) return undefined;
  return persiste(egfrBajo) || persiste(albuminuria);
}

/** ¿La condición está activa? (sin clinicalStatus se toma como activa). */
function activa(c: Condition): boolean {
  const estado = c.clinicalStatus?.coding?.[0]?.code;
  const verificacion = c.verificationStatus?.coding?.[0]?.code;
  return (
    (!estado || ['active', 'recurrence', 'relapse'].includes(estado)) &&
    verificacion !== 'refuted' &&
    verificacion !== 'entered-in-error'
  );
}

export interface Criterio {
  icd10?: RegExp;
  snomed?: string[];
  texto?: RegExp;
  /** Texto que descarta la coincidencia por texto (p. ej. "subclínica"). */
  excluir?: RegExp;
}

export function cumple(c: Condition, k: Criterio): boolean {
  const codings = c.code?.coding ?? [];
  if (k.icd10 && codings.some((x) => x.system?.includes('icd-10') && k.icd10!.test((x.code ?? '').toUpperCase()))) {
    return true;
  }
  if (k.snomed && codings.some((x) => x.system === 'http://snomed.info/sct' && k.snomed!.includes(x.code ?? ''))) {
    return true;
  }
  const texto = textoDe(c.code);
  return Boolean(k.texto?.test(texto)) && !k.excluir?.test(texto);
}

/** Aterosclerosis coronaria subclínica documentada (no es ECV clínica). */
const SUBCLINICA: Criterio = {
  texto:
    /aterosclerosis coronaria subcl[ií]nica|placa coronaria no obstructiva|calcificaci[oó]n coronaria (moderada|severa)|subclinical coronary atherosclerosis|non-?obstructive coronary/i,
};

/** ECV clínica (Tabla 4, Estadío 4; ASCVD clínica según la sección 2.1). */
export const CRITERIOS_ECV = {
  coronaria: {
    // I20–I25 cardiopatía isquémica; Z95.1 / Z95.5 portador de bypass o angioplastia coronaria.
    icd10: /^I2[0-5]|^Z95\.?[15]/,
    snomed: ['53741008', '22298006', '194828000', '414545008'],
    texto:
      /infarto|angina|cardiopat[ií]a isqu[eé]mica|enfermedad coronaria|s[ií]ndrome coronario|revascularizaci[oó]n coronaria|angioplastia coronaria|bypass coronario|coronary (artery|heart) disease|myocardial infarction/i,
    excluir: /subcl[ií]nica|no obstructiva|subclinical|non-?obstructive/i,
  },
  'insuficiencia-cardiaca': {
    icd10: /^I50/,
    snomed: ['84114007'],
    texto: /insuficiencia card[ií]aca|heart failure/i,
  },
  acv: {
    // I60–I64 ACV; G45 AIT (excepto G45.4, amnesia global transitoria).
    icd10: /^I6[0-4]|^G45(?!\.?4)/,
    snomed: ['230690007', '266257000'],
    texto: /accidente cerebrovascular|\bACV\b|\bictus\b|\bstroke\b|isqu[eé]mico transitorio|\bAIT\b|transient ischemic attack/i,
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
const CLAUDICACION: Criterio = {
  icd10: /^I70\.?21/,
  texto: /claudicaci[oó]n|claudication/i,
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

export function textoMedicacion(m: MedicationRequest): string {
  return textoDe(m.medicationCodeableConcept);
}

/** Edad en años cumplidos a una fecha. */
export function edadEn(birthDate: string | undefined, hoy: Date = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const nac = new Date(birthDate);
  if (Number.isNaN(nac.getTime())) return undefined;
  let edad = hoy.getUTCFullYear() - nac.getUTCFullYear();
  const cumple = new Date(Date.UTC(hoy.getUTCFullYear(), nac.getUTCMonth(), nac.getUTCDate()));
  if (hoy < cumple) edad--;
  return edad;
}

/** Condiciones activas (sin resueltas, refutadas ni cargadas por error). */
export function condicionesActivas(condiciones: Condition[]): Condition[] {
  return condiciones.filter(activa);
}

/** Entrada de la estadificación CKM con lo que haya en la historia del paciente. */
export function entradaCkmDesdeFhir(d: {
  paciente?: Patient;
  condiciones: Condition[];
  observaciones: Observation[];
  medicacion: MedicationRequest[];
  riesgo10a?: EntradaCkm['riesgo10a'];
  hoy?: Date;
}): EntradaCkm {
  const conds = condicionesActivas(d.condiciones);
  const obs = d.observaciones;
  const sexo = d.paciente?.gender === 'female' || d.paciente?.gender === 'male' ? d.paciente.gender : undefined;
  const medsActivas = d.medicacion.filter((m) => !m.status || m.status === 'active');
  const ecvClinica = (Object.keys(CRITERIOS_ECV) as EcvClinica[]).filter((k) =>
    conds.some((c) => cumple(c, CRITERIOS_ECV[k])),
  );
  const porNombre = valoresPorNombre(obs);
  const { cac, itb, ...eco } = porNombre;
  const ecocardiograma = Object.keys(eco).length ? (eco as Ecocardiograma) : undefined;

  return {
    sexo,
    edad: edadEn(d.paciente?.birthDate, d.hoy),
    imc: ultimoValor(obs, 'imc'),
    cintura: ultimoValor(obs, 'cintura'),
    glucemiaAyunas: ultimoValor(obs, 'glucemiaAyunas'),
    hba1c: ultimoValor(obs, 'hba1c'),
    pas: ultimoValor(obs, 'pas'),
    pad: ultimoValor(obs, 'pad'),
    lecturasPa: valores(obs, 'pas').length || undefined,
    trigliceridos: ultimoValor(obs, 'trigliceridos'),
    hdl: ultimoValor(obs, 'hdl'),
    egfr: ultimoValor(obs, 'egfr'),
    uacr: ultimoValor(obs, 'uacr'),
    ercPersistente: ercPersistente(obs),
    ntProBnp: ultimoValor(obs, 'ntProBnp'),
    bnp: ultimoValor(obs, 'bnp'),
    hsTnT: ultimoValor(obs, 'hsTnT'),
    hsTnI: ultimoValor(obs, 'hsTnI'),
    cac,
    itb,
    claudicacion: conds.some((c) => cumple(c, CLAUDICACION)) || undefined,
    aterosclerosisSubclinica: conds.some((c) => cumple(c, SUBCLINICA)) || undefined,
    ecocardiograma,
    diabetes: conds.some((c) => cumple(c, DIABETES)) || undefined,
    hipertension: conds.some((c) => cumple(c, HIPERTENSION)) || undefined,
    tratamientoHta: medsActivas.some((m) => RE_ANTIHIPERTENSIVO.test(textoMedicacion(m))) || undefined,
    dialisis: conds.some((c) => cumple(c, DIALISIS)) || undefined,
    ercDiagnosticada: ercDiagnosticada(conds),
    riesgo10a: d.riesgo10a,
    ecvClinica,
  };
}

/** Potenciadores de riesgo CKM (Guía 2026, Tabla 9) reconocibles en la historia. */
const POTENCIADORES: Array<{ etiqueta: string; criterio: Criterio }> = [
  {
    etiqueta: 'enfermedad inflamatoria crónica o autoinmune',
    criterio: {
      icd10: /^M0[56]|^M32|^B2[0-4]|^Z21|^L40/,
      texto: /artritis reumatoide|lupus|\bVIH\b|\bHIV\b|psoriasis|rheumatoid arthritis/i,
    },
  },
  { etiqueta: 'apnea obstructiva del sueño', criterio: { icd10: /^G47\.?33/, texto: /apnea (obstructiva )?del sue[nñ]o|\bSAHOS\b|obstructive sleep apnea/i } },
  { etiqueta: 'depresión o ansiedad', criterio: { icd10: /^F3[23]|^F41/, texto: /depresi[oó]n|ansiedad|depression|anxiety/i } },
  {
    etiqueta: 'menopausia prematura (< 40 años)',
    criterio: { icd10: /^E28\.?3/, texto: /menopausia (precoz|prematura)|insuficiencia ov[aá]rica prematura|premature menopause/i },
  },
  {
    etiqueta: 'resultado adverso del embarazo (preeclampsia, hipertensión o diabetes gestacional)',
    criterio: {
      icd10: /^O1[3-6]|^O24\.?4|^Z86\.?32/,
      texto: /preeclampsia|eclampsia|diabetes gestacional|hipertensi[oó]n gestacional|gestational diabetes/i,
    },
  },
  { etiqueta: 'síndrome de ovario poliquístico', criterio: { icd10: /^E28\.?2/, texto: /ovario poliqu[ií]stico|polycystic ovary/i } },
  { etiqueta: 'disfunción eréctil', criterio: { icd10: /^N52/, texto: /disfunci[oó]n er[eé]ctil|erectile dysfunction/i } },
  {
    etiqueta: 'antecedente familiar de diabetes',
    criterio: { icd10: /^Z83\.?3/, texto: /antecedente(s)? familiar(es)? de diabetes|family history of diabetes/i },
  },
  {
    etiqueta: 'antecedente familiar de falla renal',
    criterio: {
      texto: /antecedente(s)? familiar(es)? de (insuficiencia renal|falla renal|di[aá]lisis)|family history of (kidney failure|end.stage (renal|kidney))/i,
    },
  },
];

/**
 * Potenciadores de riesgo CKM detectados (Tabla 9). Incluye antecedentes resueltos
 * (una preeclampsia pasada sigue contando); no incluye lo refutado ni lo cargado
 * por error. Los determinantes sociales y el grupo demográfico no se infieren.
 */
export function potenciadoresCkm(condiciones: Condition[], obs: Observation[], umbralPcrUs: number): string[] {
  const validas = condiciones.filter((c) => {
    const v = c.verificationStatus?.coding?.[0]?.code;
    return v !== 'refuted' && v !== 'entered-in-error';
  });
  const out = POTENCIADORES.filter((p) => validas.some((c) => cumple(c, p.criterio))).map((p) => p.etiqueta);
  const pcr = ultimoValor(obs, 'pcrUs');
  if (pcr !== undefined && pcr >= umbralPcrUs) out.push(`PCR us ${pcr} mg/L (≥ ${umbralPcrUs})`);
  return out;
}
