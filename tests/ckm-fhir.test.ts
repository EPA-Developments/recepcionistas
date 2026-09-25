import { describe, it, expect } from 'vitest';
import type { Condition, MedicationRequest, Observation } from '@medplum/fhirtypes';
import { entradaCkmDesdeFhir, potenciadoresCkm, ultimoValor } from '../src/lib/ckm-fhir.js';
import { estadificarCkm } from '../src/lib/ckm.js';

const obs = (code: string, value: number, unit: string, fecha = '2026-09-01'): Observation => ({
  resourceType: 'Observation',
  status: 'final',
  code: { coding: [{ system: 'http://loinc.org', code }] },
  effectiveDateTime: fecha,
  valueQuantity: { value, unit, code: unit, system: 'http://unitsofmeasure.org' },
});
const cond = (coding: { system: string; code: string }, estado = 'active', text?: string): Condition => ({
  resourceType: 'Condition',
  subject: { reference: 'Patient/p1' },
  clinicalStatus: { coding: [{ code: estado }] },
  code: { coding: [coding], ...(text ? { text } : {}) },
});
const ICD10 = 'http://hl7.org/fhir/sid/icd-10';

describe('CKM desde FHIR — observaciones (LOINC + UCUM)', () => {
  it('toma el valor más reciente y lee la presión del panel 85354-9 (componentes)', () => {
    const pa: Observation = {
      resourceType: 'Observation',
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }] },
      effectiveDateTime: '2026-09-10',
      component: [
        { code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }] }, valueQuantity: { value: 138, unit: 'mm[Hg]' } },
        { code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }] }, valueQuantity: { value: 86, unit: 'mm[Hg]' } },
      ],
    };
    const lista = [obs('8480-6', 120, 'mm[Hg]', '2026-01-01'), pa];
    expect(ultimoValor(lista, 'pas')).toBe(138);
    expect(ultimoValor(lista, 'pad')).toBe(86);
  });

  it('normaliza unidades a las de los umbrales y descarta mediciones anuladas', () => {
    expect(ultimoValor([obs('1558-6', 7, 'mmol/L')], 'glucemiaAyunas')).toBeCloseTo(126.1, 1);
    expect(ultimoValor([obs('67151-1', 0.03, 'ng/mL')], 'hsTnT')).toBeCloseTo(30);
    expect(ultimoValor([obs('4548-4', 48, 'mmol/mol')], 'hba1c')).toBeCloseTo(6.54, 2);
    expect(ultimoValor([{ ...obs('2571-8', 300, 'mg/dL'), status: 'entered-in-error' }], 'trigliceridos')).toBeUndefined();
  });
});

describe('CKM desde FHIR — problemas activos (ICD-10 / SNOMED / texto) y medicación', () => {
  it('reconoce ECV clínica, diabetes, HTA y ERC; ignora lo resuelto y la prediabetes', () => {
    const e = entradaCkmDesdeFhir({
      paciente: { resourceType: 'Patient', gender: 'male' },
      condiciones: [
        cond({ system: ICD10, code: 'I25.1' }),
        cond({ system: 'http://snomed.info/sct', code: '49436004' }),
        cond({ system: ICD10, code: 'I63.9' }, 'resolved'),
        cond({ system: ICD10, code: 'E11.9' }),
        cond({ system: ICD10, code: 'N18.4' }),
        { resourceType: 'Condition', subject: { reference: 'Patient/p1' }, code: { text: 'Prediabetes' } },
      ],
      observaciones: [],
      medicacion: [
        { resourceType: 'MedicationRequest', status: 'active', intent: 'order', subject: { reference: 'Patient/p1' }, medicationCodeableConcept: { text: 'Losartán 50 mg' } } as MedicationRequest,
      ],
    });
    expect(e.sexo).toBe('male');
    expect(e.ecvClinica).toEqual(['coronaria', 'fibrilacion-auricular']);
    expect(e).toMatchObject({ diabetes: true, tratamientoHta: true, ercDiagnosticada: 'G4' });
    expect(estadificarCkm(e).estadio).toBe('4a');
  });

  it('la prediabetes sola no se toma como diabetes', () => {
    const e = entradaCkmDesdeFhir({
      condiciones: [{ resourceType: 'Condition', subject: { reference: 'Patient/p1' }, code: { text: 'Prediabetes' } }],
      observaciones: [],
      medicacion: [],
    });
    expect(e.diabetes).toBeUndefined();
  });

  it('diálisis / N18.6 → falla renal (Estadío 4b con ECV clínica)', () => {
    const e = entradaCkmDesdeFhir({
      condiciones: [cond({ system: ICD10, code: 'I50.9' }), cond({ system: ICD10, code: 'Z99.2' }), cond({ system: ICD10, code: 'I10' })],
      observaciones: [],
      medicacion: [],
    });
    expect(e.dialisis).toBe(true);
    expect(estadificarCkm(e).estadio).toBe('4b');
  });
});

describe('CKM desde FHIR — Guía 2026: pre-IC, aterosclerosis subclínica, AIT, ERC persistente', () => {
  const porNombre = (text: string, value: number, unit: string, fecha = '2026-09-01'): Observation => ({
    resourceType: 'Observation',
    status: 'final',
    code: { text },
    effectiveDateTime: fecha,
    valueQuantity: { value, unit },
  });

  it('lee BNP, FEVI (LOINC) y el ecocardiograma de la Tabla 16 por nombre', () => {
    const e = entradaCkmDesdeFhir({
      paciente: { resourceType: 'Patient', gender: 'female', birthDate: '1970-03-01' },
      condiciones: [],
      observaciones: [
        obs('30934-4', 60, 'pg/mL'),
        obs('10230-1', 45, '%'),
        porNombre('Volumen auricular izquierdo indexado', 34, 'mL/m2'),
        porNombre('Relación E/e′ promedio', 16, '1'),
        porNombre('e′ septal', 6, 'cm/s'),
        porNombre('Strain longitudinal global (GLS)', -14, '%'),
        porNombre('Índice tobillo-brazo', 0.82, '1'),
        porNombre('Score de calcio coronario (Agatston)', 180, '1'),
      ],
      medicacion: [],
      hoy: new Date('2026-09-25'),
    });
    expect(e).toMatchObject({ edad: 56, bnp: 60, cac: 180, itb: 0.82 });
    expect(e.ecocardiograma).toEqual({ fevi: 45, lavi: 34, eSobreEPrima: 16, eSeptal: 6, gls: -14 });
  });

  it('AIT y revascularización coronaria son ECV clínica; la placa no obstructiva es subclínica', () => {
    const e = entradaCkmDesdeFhir({
      condiciones: [
        cond({ system: ICD10, code: 'G45.9' }),
        cond({ system: ICD10, code: 'Z95.5' }),
        { resourceType: 'Condition', subject: { reference: 'Patient/p1' }, code: { text: 'Placa coronaria no obstructiva en angio-TC' } },
      ],
      observaciones: [],
      medicacion: [],
    });
    expect(e.ecvClinica).toEqual(['coronaria', 'acv']);
    expect(e.aterosclerosisSubclinica).toBe(true);
    const solo = entradaCkmDesdeFhir({
      condiciones: [{ resourceType: 'Condition', subject: { reference: 'Patient/p1' }, code: { text: 'Aterosclerosis coronaria subclínica' } }],
      observaciones: [],
      medicacion: [],
    });
    expect(solo.ecvClinica).toEqual([]);
    expect(solo.aterosclerosisSubclinica).toBe(true);
  });

  it('ERC persistente solo con valores alterados separados ≥ 3 meses; cuenta las lecturas de PA', () => {
    const unaVez = entradaCkmDesdeFhir({ condiciones: [], observaciones: [obs('62238-1', 52, 'mL/min/{1.73_m2}')], medicacion: [] });
    expect(unaVez.ercPersistente).toBe(false);
    const persistente = entradaCkmDesdeFhir({
      condiciones: [],
      observaciones: [obs('62238-1', 52, 'mL/min', '2026-01-10'), obs('62238-1', 55, 'mL/min', '2026-06-01')],
      medicacion: [],
    });
    expect(persistente.ercPersistente).toBe(true);
    // Alteraciones distintas (eGFR bajo una vez, albuminuria otra) no confirman la persistencia.
    const mezcla = entradaCkmDesdeFhir({
      condiciones: [],
      observaciones: [obs('62238-1', 52, 'mL/min', '2026-01-10'), obs('9318-7', 45, 'mg/g', '2026-06-01')],
      medicacion: [],
    });
    expect(mezcla.ercPersistente).toBe(false);
    const pa = entradaCkmDesdeFhir({
      condiciones: [],
      observaciones: [obs('8480-6', 134, 'mm[Hg]', '2026-08-01'), obs('8480-6', 136, 'mm[Hg]', '2026-09-01')],
      medicacion: [],
    });
    expect(pa.lecturasPa).toBe(2);
  });

  it('potenciadores de la Tabla 9, incluidos antecedentes resueltos, y PCR us ≥ 2', () => {
    const lista = potenciadoresCkm(
      [
        cond({ system: ICD10, code: 'M06.9' }),
        cond({ system: ICD10, code: 'O14.1' }, 'resolved'),
        cond({ system: ICD10, code: 'Z83.3' }),
        { ...cond({ system: ICD10, code: 'G47.33' }), verificationStatus: { coding: [{ code: 'refuted' }] } },
      ],
      [obs('30522-7', 3.1, 'mg/L')],
      2,
    );
    expect(lista).toEqual([
      'enfermedad inflamatoria crónica o autoinmune',
      'resultado adverso del embarazo (preeclampsia, hipertensión o diabetes gestacional)',
      'antecedente familiar de diabetes',
      'PCR us 3.1 mg/L (≥ 2)',
    ]);
  });
});
