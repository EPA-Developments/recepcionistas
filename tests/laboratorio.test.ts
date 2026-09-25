import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Communication, DiagnosticReport, DocumentReference, Observation, Resource, Task } from '@medplum/fhirtypes';
import {
  catalogoDesdeObservationDefinitions,
  construirDiagnosticReportLaboratorio,
  construirObservaciones,
  normalizarExtraccion,
  relatedConInforme,
  type ExtraccionLaboratorio,
} from '../src/lib/laboratorio.js';
import { handler as procesar } from '../src/bots/som-procesar-laboratorio.js';
import { buildSeed } from '../src/seed/builders.js';
import { COD, SYSTEM } from '../src/fhir/identifiers.js';
import { fakeMedplum } from './fake-medplum.js';

const defs = buildSeed().observationDefinitions.map((d, i) => ({ ...d, id: `od${i}` }));
const catalogo = catalogoDesdeObservationDefinitions(defs);
const LDL = 'http://loinc.org|13457-7';
const refs = { pacienteRef: 'Patient/p1', documentoRef: 'DocumentReference/lab1', fechaRespaldo: '2026-09-20' };

describe('Laboratorio — catálogo y normalización', () => {
  it('el catálogo sale de las ObservationDefinition del servidor (system|code + unidad)', () => {
    expect(catalogo.find((c) => c.clave === LDL)).toMatchObject({ code: '13457-7', unidad: 'mg/dL' });
    expect(catalogo.find((c) => c.clave === 'http://loinc.org|4548-4')).toMatchObject({ unidad: '%' });
  });

  it('descarta códigos que no están en el catálogo y analitos sin resultado; valida la fecha', () => {
    const n = normalizarExtraccion(
      {
        esInformeDeLaboratorio: true,
        fechaExtraccion: '2026-09-18T08:00:00',
        laboratorio: ' Lab Central ',
        analitos: [
          { nombre: 'LDL', codigo: LDL, valor: 131, valorTexto: null, unidad: 'mg/dL', referencia: null },
          { nombre: 'Glucemia', codigo: 'http://loinc.org|inventado', valor: 98, valorTexto: null, unidad: 'mg/dL', referencia: null },
          { nombre: 'Sin resultado', codigo: null, valor: null, valorTexto: null, unidad: null, referencia: null },
          { nombre: '', codigo: null, valor: 1, valorTexto: null, unidad: null, referencia: null },
        ],
      },
      catalogo,
    );
    expect(n.fechaExtraccion).toBe('2026-09-18');
    expect(n.laboratorio).toBe('Lab Central');
    expect(n.analitos.map((a) => [a.nombre, a.codigo])).toEqual([
      ['LDL', LDL],
      ['Glucemia', null],
    ]);
    expect(normalizarExtraccion({ fechaExtraccion: '18/09/2026' }, catalogo)).toMatchObject({
      esInformeDeLaboratorio: false,
      fechaExtraccion: null,
      analitos: [],
    });
  });
});

describe('Laboratorio — recursos FHIR', () => {
  const extraccion: ExtraccionLaboratorio = {
    esInformeDeLaboratorio: true,
    fechaExtraccion: '2026-09-18',
    laboratorio: 'Lab Central',
    analitos: [
      { nombre: 'Colesterol LDL', codigo: LDL, valor: 131, valorTexto: null, unidad: 'mg/dL', referencia: { bajo: null, alto: 100, texto: '< 100' } },
      { nombre: 'Proteína C reactiva us', codigo: null, valor: 1.2, valorTexto: null, unidad: 'mg/L', referencia: null },
      { nombre: 'HIV', codigo: null, valor: null, valorTexto: 'No reactivo', unidad: null, referencia: null },
    ],
  };

  it('Observation codificada con el catálogo (LOINC + UCUM), rango del informe y derivedFrom', () => {
    const [ldl, pcr, hiv] = construirObservaciones(extraccion, catalogo, refs);
    expect(ldl).toMatchObject({
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '13457-7' }], text: 'Colesterol LDL' },
      subject: { reference: 'Patient/p1' },
      effectiveDateTime: '2026-09-18',
      valueQuantity: { value: 131, unit: 'mg/dL', system: 'http://unitsofmeasure.org', code: 'mg/dL' },
      derivedFrom: [{ reference: 'DocumentReference/lab1' }],
    });
    expect(ldl?.category?.[0]?.coding?.[0]?.code).toBe('laboratory');
    expect(ldl?.referenceRange?.[0]).toMatchObject({ high: { value: 100 }, text: '< 100' });
    // Fuera del catálogo: solo el nombre (no se inventan códigos) y sin UCUM adivinado.
    expect(pcr?.code).toEqual({ text: 'Proteína C reactiva us' });
    expect(pcr?.valueQuantity).toEqual({ value: 1.2, unit: 'mg/L' });
    expect(hiv?.valueString).toBe('No reactivo');
  });

  it('sin fecha de extracción usa la del documento', () => {
    const [o] = construirObservaciones({ ...extraccion, fechaExtraccion: null }, catalogo, refs);
    expect(o?.effectiveDateTime).toBe('2026-09-20');
  });

  it('DiagnosticReport LAB 11502-2 con los resultados; presentedForm solo con el PDF por url', () => {
    const dr = construirDiagnosticReportLaboratorio(extraccion, ['Observation/o1'], {
      ...refs,
      pdf: { contentType: 'application/pdf', url: 'Binary/b1', title: 'lab.pdf' },
    });
    expect(dr).toMatchObject({
      status: 'final',
      code: { coding: [{ system: 'http://loinc.org', code: '11502-2' }] },
      category: [{ coding: [{ code: 'LAB' }] }],
      result: [{ reference: 'Observation/o1' }],
      presentedForm: [{ url: 'Binary/b1' }],
    });
    const embebido = construirDiagnosticReportLaboratorio(extraccion, [], {
      ...refs,
      pdf: { contentType: 'application/pdf', data: 'JVBERi0=' },
    });
    expect(embebido.presentedForm).toBeUndefined();
  });

  it('relatedConInforme suma el informe sin duplicar', () => {
    const doc = { resourceType: 'DocumentReference', status: 'current', content: [], context: { related: [{ reference: 'X/1' }] } } as DocumentReference;
    const una = relatedConInforme(doc, 'DiagnosticReport/d1');
    expect(una.related).toEqual([{ reference: 'X/1' }, { reference: 'DiagnosticReport/d1' }]);
    expect(relatedConInforme({ ...doc, context: una }, 'DiagnosticReport/d1').related).toHaveLength(2);
  });
});

describe('Bot som-procesar-laboratorio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const secretos = { ANTHROPIC_API_KEY: { name: 'ANTHROPIC_API_KEY', valueString: 'sk-test' } };
  const consentimiento: Resource = {
    resourceType: 'DocumentReference',
    id: 'consent1',
    status: 'current',
    type: { coding: [{ system: 'http://loinc.org', code: '59284-0' }] },
    subject: { reference: 'Patient/p1' },
    content: [{ attachment: { title: 'Consentimiento' } }],
  };
  const docLab: DocumentReference = {
    resourceType: 'DocumentReference',
    id: 'lab1',
    status: 'current',
    date: '2026-09-20T12:00:00Z',
    type: { coding: [{ system: 'http://loinc.org', code: '11502-2' }] },
    category: [{ coding: [{ system: SYSTEM.documento, code: COD.resultadoLaboratorio }] }],
    subject: { reference: 'Patient/p1' },
    content: [{ attachment: { contentType: 'application/pdf', data: 'JVBERi0xLjQK', title: 'lab.pdf' } }],
  };
  const evento = (doc: DocumentReference) => ({ input: doc, secrets: secretos }) as unknown as BotEvent<DocumentReference>;

  function respuestaClaude(json: unknown): Response {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(json) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  const llamadasClaude = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes('api.anthropic.com'));

  it('transcribe el PDF: Observations + DiagnosticReport y cierra el circuito en el documento', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) =>
      respuestaClaude({
        esInformeDeLaboratorio: true,
        fechaExtraccion: '2026-09-18',
        laboratorio: 'Lab Central',
        analitos: [
          { nombre: 'Colesterol LDL', codigo: LDL, valor: 131, valorTexto: null, unidad: 'mg/dL', referencia: null },
          { nombre: 'Triglicéridos', codigo: 'http://loinc.org|2571-8', valor: 90, valorTexto: null, unidad: 'mg/dL', referencia: null },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([consentimiento, docLab, ...defs]);

    const r = await procesar(medplum, evento(docLab));

    expect(r).toMatchObject({ ok: true, observaciones: 2 });
    const [llamada] = llamadasClaude(fetchMock);
    const init = llamada![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-opus-5');
    expect(body.fallbacks).toBe('default');
    expect(new Headers(init.headers).get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.messages[0].content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf', data: 'JVBERi0xLjQK' } });
    expect(body.messages[0].content[1].text).toContain(LDL);

    const obs = todos<Observation>('Observation');
    expect(obs.map((o) => o.code?.coding?.[0]?.code)).toEqual(['13457-7', '2571-8']);
    const [dr] = todos<DiagnosticReport>('DiagnosticReport');
    expect(dr?.result?.map((x) => x.reference)).toEqual(obs.map((o) => `Observation/${o.id}`));
    const doc = todos<DocumentReference>('DocumentReference').find((d) => d.id === 'lab1');
    expect(doc?.context?.related).toEqual([{ reference: `DiagnosticReport/${dr?.id}` }]);
  });

  it('es idempotente: si el documento ya tiene su informe, no vuelve a llamar a Claude', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => respuestaClaude({}));
    vi.stubGlobal('fetch', fetchMock);
    const procesado = { ...docLab, context: { related: [{ reference: 'DiagnosticReport/d9' }] } };
    const { medplum } = fakeMedplum([consentimiento, procesado]);
    expect(await procesar(medplum, evento(procesado))).toMatchObject({ ok: true, diagnosticReportId: 'd9' });
    expect(llamadasClaude(fetchMock)).toHaveLength(0);
  });

  it('sin consentimiento firmado no procesa ni envía nada al LLM', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (..._a: unknown[]) => respuestaClaude({}));
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([docLab, ...defs]);
    expect((await procesar(medplum, evento(docLab))).ok).toBe(false);
    expect(llamadasClaude(fetchMock)).toHaveLength(0);
    expect(todos('Observation')).toHaveLength(0);
  });

  it('si no se puede leer: mensaje al paciente y tarea al equipo, sin Observations', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._a: unknown[]) => respuestaClaude({ esInformeDeLaboratorio: false, fechaExtraccion: null, laboratorio: null, analitos: [] })));
    const { medplum, todos } = fakeMedplum([consentimiento, docLab, ...defs]);

    const r = await procesar(medplum, evento(docLab));

    expect(r).toMatchObject({ ok: false, derivadoAlEquipo: true });
    expect(todos('Observation')).toHaveLength(0);
    const [msg] = todos<Communication>('Communication');
    expect(msg).toMatchObject({ subject: { reference: 'Patient/p1' }, about: [{ reference: 'DocumentReference/lab1' }] });
    const [tarea] = todos<Task>('Task');
    expect(tarea).toMatchObject({ status: 'requested', focus: { reference: 'DocumentReference/lab1' } });
    expect(tarea?.code?.coding?.[0]?.code).toBe(COD.revisarLaboratorio);
  });

  it('ignora documentos que no son resultados de laboratorio (p. ej. el consentimiento)', async () => {
    const { medplum } = fakeMedplum([consentimiento]);
    expect((await procesar(medplum, evento(consentimiento as DocumentReference))).ok).toBe(false);
  });
});
