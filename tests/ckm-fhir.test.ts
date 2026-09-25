import { describe, it, expect } from 'vitest';
import type { Condition, MedicationRequest, Observation } from '@medplum/fhirtypes';
import { entradaCkmDesdeFhir, ultimoValor } from '../src/lib/ckm-fhir.js';
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
