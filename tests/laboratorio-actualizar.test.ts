import { describe, it, expect } from 'vitest';
import type { DiagnosticReport, DocumentReference, Observation, Patient } from '@medplum/fhirtypes';
import {
  aplicarDuplicado,
  aplicarEgfr,
  detectarDuplicados,
  faltaParaEgfr,
  firmaInforme,
  planActualizacion,
  reemplazarInforme,
  valoresSinCodigo,
  type InformeConValores,
} from '../src/lib/laboratorio-actualizar.js';
import { catalogoDesdeObservationDefinitions } from '../src/lib/laboratorio.js';
import { buildSeed } from '../src/seed/builders.js';
import { COD, SYSTEM } from '../src/fhir/identifiers.js';
import { fakeMedplum } from './fake-medplum.js';

const catalogo = catalogoDesdeObservationDefinitions(buildSeed().observationDefinitions);
const CATALOGO_DESDE = '2026-10-01T02:40:00Z';
const LOINC = 'http://loinc.org';

const p1: Patient = { resourceType: 'Patient', id: 'p1', gender: 'female', birthDate: '1976-03-10' };
const p2: Patient = { resourceType: 'Patient', id: 'p2' };
const pacientes = new Map([
  ['Patient/p1', p1],
  ['Patient/p2', p2],
]);

let n = 0;
function obs(paciente: string, code: { text?: string; loinc?: string }, valor: Observation['valueQuantity'] | string): Observation {
  n += 1;
  return {
    resourceType: 'Observation',
    id: `o${n}`,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { ...(code.loinc ? { coding: [{ system: LOINC, code: code.loinc }] } : {}), ...(code.text ? { text: code.text } : {}) },
    subject: { reference: paciente },
    effectiveDateTime: '2026-09-18',
    ...(typeof valor === 'string' ? { valueString: valor } : { valueQuantity: valor }),
    derivedFrom: [{ reference: 'DocumentReference/lab0' }],
  };
}

function informe(id: string, issued: string, observaciones: Observation[], paciente = 'Patient/p1'): InformeConValores {
  return {
    informe: {
      resourceType: 'DiagnosticReport',
      id,
      status: 'final',
      code: { coding: [{ system: LOINC, code: '11502-2' }] },
      subject: { reference: paciente },
      effectiveDateTime: '2026-09-18',
      issued,
      result: observaciones.map((o) => ({ reference: `Observation/${o.id}` })),
    },
    observaciones,
  };
}

function documento(id: string, date: string, informeId: string): DocumentReference {
  return {
    resourceType: 'DocumentReference',
    id,
    status: 'current',
    date,
    category: [{ coding: [{ system: SYSTEM.documento, code: COD.resultadoLaboratorio }] }],
    subject: { reference: 'Patient/p1' },
    content: [{ attachment: { contentType: 'application/pdf', url: 'Binary/b1' } }],
    context: { related: [{ reference: `DiagnosticReport/${informeId}` }] },
  };
}

const mgdl = (value: number) => ({ value, unit: 'mg/dL' });

// A: leído con el catálogo viejo (creatinina sin código). B: el mismo estudio cargado otra vez.
const A = informe('A', '2026-09-24T23:40:00Z', [obs('Patient/p1', { text: 'Creatinina' }, mgdl(0.8)), obs('Patient/p1', { text: 'Colesterol LDL', loinc: '13457-7' }, mgdl(131))]);
const B = informe('B', '2026-09-30T21:10:00Z', [obs('Patient/p1', { text: 'Colesterol LDL', loinc: '13457-7' }, mgdl(131)), obs('Patient/p1', { text: 'Creatinina' }, mgdl(0.8))]);
// C: catálogo vigente con el eGFR "> 60". D: solo creatinina. E: eGFR con número. F: paciente sin datos.
const egfrTexto = obs('Patient/p1', { text: 'Filtrado glomerular', loinc: '62238-1' }, { comparator: '>', value: 60 });
const C = informe('C', '2026-10-02T10:00:00Z', [obs('Patient/p1', { text: 'Creatinina', loinc: '2160-0' }, mgdl(0.8)), egfrTexto]);
const D = informe('D', '2026-10-02T11:00:00Z', [obs('Patient/p1', { text: 'Creatinina', loinc: '2160-0' }, mgdl(1.0))]);
const E = informe('E', '2026-10-02T12:00:00Z', [
  obs('Patient/p1', { text: 'Creatinina', loinc: '2160-0' }, mgdl(0.9)),
  obs('Patient/p1', { text: 'eGFR', loinc: '62238-1' }, { value: 88, unit: 'mL/min/1,73 m²' }),
]);
const F = informe('F', '2026-10-02T13:00:00Z', [obs('Patient/p2', { text: 'Creatinina', loinc: '2160-0' }, mgdl(0.8))], 'Patient/p2');
// G: catálogo viejo, todo codificado. H: catálogo viejo, solo un valor que no está en el catálogo.
const G = informe('G', '2026-09-20T10:00:00Z', [obs('Patient/p1', { text: 'Colesterol LDL', loinc: '13457-7' }, mgdl(120))]);
const H = informe('H', '2026-09-21T10:00:00Z', [obs('Patient/p1', { text: 'Leucocitos' }, { value: 6.2, unit: '10^3/µL' })]);

const documentos = [documento('lab0', '2026-09-24T23:32:58Z', 'A'), documento('lab2', '2026-09-30T21:04:26Z', 'B')];
const plan = planActualizacion({ informes: [A, B, C, D, E, F, G, H], documentos, pacientes, catalogo, catalogoDesde: CATALOGO_DESDE });

describe('laboratorio:actualizar — qué hacer con cada informe', () => {
  it('duplicado: misma fecha y mismos valores (en cualquier orden); queda el más viejo', () => {
    expect(firmaInforme(A)).toBe(firmaInforme(B));
    expect(firmaInforme(A)).not.toBe(firmaInforme(G));
    expect(plan.duplicados.map((d) => [d.duplicado.informe.id, d.original.informe.id])).toEqual([['B', 'A']]);
    // Otro paciente con los mismos valores no es duplicado.
    const otro = informe('Z', '2026-09-30T00:00:00Z', A.observaciones.map((o) => ({ ...o, subject: { reference: 'Patient/p2' } })), 'Patient/p2');
    expect(detectarDuplicados([A, otro])).toEqual([]);
  });

  it('releer: solo lo leído con el catálogo viejo que tiene valores del catálogo sin código', () => {
    expect(plan.relecturas.map((r) => [r.informe.informe.id, r.documento.id])).toEqual([['A', 'lab0']]);
    expect(plan.relecturas[0]?.motivo).toMatch(/1 valor\(es\) sin código del catálogo vigente \(Creatinina\)/);
    expect(valoresSinCodigo([obs('Patient/p1', { text: 'CREATININA SÉRICA' }, mgdl(1))], catalogo)).toHaveLength(1);
    expect(valoresSinCodigo([obs('Patient/p1', { text: 'Leucocitos' }, mgdl(1))], catalogo)).toHaveLength(0);
  });

  it('eGFR: reemplaza el "> 60" en el lugar o se suma; si ya hay un número, nada', () => {
    expect(plan.egfr.map((e) => [e.informe.informe.id, e.calculada.valueQuantity?.value, e.reemplaza?.id])).toEqual([
      ['C', 90, egfrTexto.id],
      ['D', 69, undefined],
    ]);
    const [c] = plan.egfr;
    expect(c?.calculada.code?.coding?.map((x) => x.code)).toEqual(['62238-1', '33914-3', '98979-8']);
    expect(c?.calculada.note?.[0]?.text).toContain('El laboratorio lo informó como "> 60".');
  });

  it('sin datos: a quién le falta la fecha de nacimiento o el sexo', () => {
    expect(plan.sinDatos.map((s) => [s.pacienteRef, s.informe.informe.id, s.falta])).toEqual([
      ['Patient/p2', 'F', ['la fecha de nacimiento', 'el sexo biológico (femenino o masculino)']],
    ]);
    expect(faltaParaEgfr({ gender: 'female', birthDate: '2015-01-01' }, '2026-09-18')).toEqual([
      'ser mayor de 18 años (CKD-EPI es para adultos)',
    ]);
    expect(faltaParaEgfr({ gender: 'other', birthDate: '1976-03-10' }, '2026-09-18')).toEqual([
      'el sexo biológico (femenino o masculino)',
    ]);
    expect(faltaParaEgfr(p1, '2026-09-18')).toEqual([]);
  });

  it('reemplazarInforme no duplica ni toca otras referencias', () => {
    const doc = { ...documentos[0], context: { related: [{ reference: 'Encounter/e1' }, { reference: 'DiagnosticReport/A' }] } } as DocumentReference;
    expect(reemplazarInforme(doc, 'DiagnosticReport/A', 'DiagnosticReport/N').related).toEqual([
      { reference: 'Encounter/e1' },
      { reference: 'DiagnosticReport/N' },
    ]);
  });
});

describe('laboratorio:actualizar — escrituras', () => {
  it('duplicado: el informe y sus valores pasan a entered-in-error y su PDF muestra el original', async () => {
    const { medplum, todos } = fakeMedplum([A.informe, B.informe, ...A.observaciones, ...B.observaciones, ...documentos]);
    const religados = await aplicarDuplicado(medplum, plan.duplicados[0]!, documentos);
    expect(religados.map((d) => d.id)).toEqual(['lab2']);
    expect(todos<DocumentReference>('DocumentReference').find((d) => d.id === 'lab2')?.context?.related).toEqual([
      { reference: 'DiagnosticReport/A' },
    ]);
    const informes = todos<DiagnosticReport>('DiagnosticReport');
    expect(informes.find((d) => d.id === 'B')?.status).toBe('entered-in-error');
    expect(informes.find((d) => d.id === 'A')?.status).toBe('final');
    const estados = todos<Observation>('Observation').map((o) => [o.id, o.status]);
    for (const o of B.observaciones) {
      expect(estados).toContainEqual([o.id, 'entered-in-error']);
    }
    for (const o of A.observaciones) {
      expect(estados).toContainEqual([o.id, 'final']);
    }
  });

  it('eGFR: el "> 60" se reemplaza en el lugar; el nuevo se suma al informe', async () => {
    const { medplum, todos } = fakeMedplum([C.informe, D.informe, ...C.observaciones, ...D.observaciones]);
    const [c, d] = plan.egfr;
    const reemplazada = await aplicarEgfr(medplum, c!);
    expect(reemplazada.id).toBe(egfrTexto.id);
    expect(reemplazada.valueQuantity).toMatchObject({ value: 90, code: 'mL/min/{1.73_m2}' });
    expect(reemplazada.valueQuantity?.comparator).toBeUndefined();
    expect(todos<DiagnosticReport>('DiagnosticReport').find((x) => x.id === 'C')?.result).toHaveLength(2);

    const sumada = await aplicarEgfr(medplum, d!);
    expect(todos<DiagnosticReport>('DiagnosticReport').find((x) => x.id === 'D')?.result).toContainEqual({
      reference: `Observation/${sumada.id}`,
    });
  });
});
