import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { AuditEvent, Communication, DiagnosticReport, DocumentReference, Observation, Resource, Task } from '@medplum/fhirtypes';
import {
  catalogoDesdeObservationDefinitions,
  construirDiagnosticReportLaboratorio,
  construirObservaciones,
  normalizarExtraccion,
  relatedConInforme,
  type ExtraccionLaboratorio,
  estadoProcesamiento,
  huellaPdf,
  originalProcesado,
  pendientesDeProcesar,
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

describe('Laboratorio — reprocesar', () => {
  it('pendientes: solo los PDF de laboratorio vigentes sin informe, del más viejo al más nuevo', () => {
    const lab = (id: string, date: string, extra: Partial<DocumentReference> = {}): DocumentReference => ({
      resourceType: 'DocumentReference',
      id,
      status: 'current',
      date,
      category: [{ coding: [{ system: SYSTEM.documento, code: COD.resultadoLaboratorio }] }],
      content: [],
      ...extra,
    });
    const pendientes = pendientesDeProcesar([
      lab('nuevo', '2026-09-30T21:04:26Z'),
      lab('procesado', '2026-09-20T10:00:00Z', { context: { related: [{ reference: 'DiagnosticReport/r1' }] } }),
      lab('viejo', '2026-09-24T23:32:58Z'),
      lab('anulado', '2026-09-25T10:00:00Z', { status: 'entered-in-error' }),
      { ...lab('consentimiento', '2026-09-01T10:00:00Z'), category: [] },
    ]);
    expect(pendientes.map((d) => d.id)).toEqual(['viejo', 'nuevo']);
  });

  it('estado después de pasarlo por el bot: informe, revisión tocada en esta corrida, o en proceso', () => {
    const doc: DocumentReference = { resourceType: 'DocumentReference', id: 'd1', status: 'current', content: [] };
    const revision = (lastUpdated: string): Task => ({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      code: { coding: [{ system: SYSTEM.taskTipo, code: COD.revisarLaboratorio }] },
      description: 'Revisar a mano un PDF de laboratorio del paciente (no se pudo descargar el PDF (HTTP 403)).',
      meta: { lastUpdated },
    });
    const desde = '2026-09-30T21:40:00.000Z';
    expect(estadoProcesamiento({ ...doc, context: { related: [{ reference: 'DiagnosticReport/r1' }] } }, [], desde)).toEqual({
      estado: 'procesado',
      informe: 'DiagnosticReport/r1',
    });
    expect(estadoProcesamiento(doc, [revision('2026-09-30T21:41:00.000Z')], desde)).toEqual({
      estado: 'derivado',
      motivo: expect.stringContaining('HTTP 403'),
    });
    // Una revisión vieja (de una corrida anterior) no dice nada de esta.
    expect(estadoProcesamiento(doc, [revision('2026-09-30T18:06:25.000Z')], desde)).toEqual({ estado: 'en-proceso' });
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

  function respuestaClaude(json: unknown, usage: Record<string, unknown> = { input_tokens: 1, output_tokens: 1 }): Response {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(json) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  const llamadasClaude = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes('api.anthropic.com'));
  const detalleUso = (e: AuditEvent | undefined) =>
    Object.fromEntries((e?.entity?.[0]?.detail ?? []).map((d) => [d.type, d.valueString]));

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
      }, { input_tokens: 9000, output_tokens: 5000, iterations: null }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([consentimiento, docLab, ...defs]);

    const r = await procesar(medplum, evento(docLab));

    expect(r).toMatchObject({ ok: true, observaciones: 2 });
    const [llamada] = llamadasClaude(fetchMock);
    const init = llamada![1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.effort).toBe('high');
    expect(body.thinking).toBeUndefined(); // en Opus 5.5 no se puede apagar: no se envía
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

    // El uso de la llamada queda registrado, ligado al documento: 9000 × US$4 + 5000 × US$20 por millón.
    const [uso] = todos<AuditEvent>('AuditEvent');
    expect(uso).toMatchObject({
      type: { system: SYSTEM.usoIa, code: 'llamada-modelo' },
      subtype: [{ code: 'laboratorio-pdf' }],
      outcome: '0',
      entity: [{ what: { reference: 'DocumentReference/lab1' } }],
    });
    expect(detalleUso(uso)).toMatchObject({
      modelo: 'claude-opus-5-5',
      'tokens-entrada': '9000',
      'tokens-salida': '5000',
      'costo-usd': '0.136000',
      esfuerzo: 'high',
    });
  });

  it('registra el uso aunque la respuesta no sirva, y si el servidor no lo acepta el PDF igual se procesa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._a: unknown[]) => respuestaClaude({ esInformeDeLaboratorio: false, fechaExtraccion: null, laboratorio: null, analitos: [] })),
    );
    const sinLeer = fakeMedplum([consentimiento, docLab, ...defs]);
    await procesar(sinLeer.medplum, evento(docLab));
    const [uso] = sinLeer.todos<AuditEvent>('AuditEvent');
    expect(uso).toMatchObject({ outcome: '4', outcomeDesc: 'el PDF no parece un informe de laboratorio' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._a: unknown[]) =>
        respuestaClaude({
          esInformeDeLaboratorio: true,
          fechaExtraccion: '2026-09-18',
          laboratorio: null,
          analitos: [{ nombre: 'Colesterol LDL', codigo: LDL, valor: 131, valorTexto: null, unidad: 'mg/dL', referencia: null }],
        }),
      ),
    );
    const { medplum, todos } = fakeMedplum([consentimiento, docLab, ...defs]);
    const crear = medplum.createResource.bind(medplum);
    vi.spyOn(medplum, 'createResource').mockImplementation(async (recurso: Resource) => {
      if (recurso.resourceType === 'AuditEvent') {
        throw new Error('Forbidden');
      }
      return crear(recurso);
    });
    expect(await procesar(medplum, evento(docLab))).toMatchObject({ ok: true, observaciones: 1 });
    expect(todos('AuditEvent')).toHaveLength(0);
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
    expect(todos('AuditEvent')).toHaveLength(0);
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

  describe('PDF por link firmado del almacenamiento (S3)', () => {
    const S3 = 'https://s3.sa-east-1.amazonaws.com/storage/binary/b1/v1?X-Amz-Signature=abc';
    const docS3: DocumentReference = {
      ...docLab,
      content: [{ attachment: { contentType: 'application/pdf', url: S3, title: 'lab.pdf' } }],
    };
    const PDF = new TextEncoder().encode('%PDF-1.7\nresto');
    const extraccionOk = {
      esInformeDeLaboratorio: true,
      fechaExtraccion: '2026-09-18',
      laboratorio: null,
      analitos: [{ nombre: 'Colesterol LDL', codigo: LDL, valor: 131, valorTexto: null, unidad: 'mg/dL', referencia: null }],
    };
    /** S3 responde lo pedido; Claude, la extracción (o un error de la API). */
    const red = (s3: () => Response, claude: () => Response = () => respuestaClaude(extraccionOk)) =>
      vi.fn(async (...a: unknown[]) => (String(a[0]).startsWith('https://s3.') ? s3() : claude()));
    const revision: Task = {
      resourceType: 'Task',
      id: 'rev1',
      status: 'requested',
      intent: 'order',
      code: { coding: [{ system: SYSTEM.taskTipo, code: COD.revisarLaboratorio }] },
      focus: { reference: 'DocumentReference/lab1' },
    };

    it('lo baja SIN el token de Medplum (S3 rechaza firma + Authorization) y, al reprocesar, cierra la revisión', async () => {
      const fetchMock = red(() => new Response(PDF, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { medplum, todos } = fakeMedplum([consentimiento, docS3, revision, ...defs]);

      expect(await procesar(medplum, evento(docS3))).toMatchObject({ ok: true, observaciones: 1 });
      const [bajada] = fetchMock.mock.calls.filter((c) => String(c[0]) === S3);
      expect(new Headers((bajada?.[1] as RequestInit | undefined)?.headers).get('authorization')).toBeNull();
      const [llamada] = llamadasClaude(fetchMock);
      const body = JSON.parse(String((llamada![1] as RequestInit).body));
      expect(body.messages[0].content[0].source.data).toBe(Buffer.from(PDF).toString('base64'));
      expect(todos<Task>('Task').find((t) => t.id === 'rev1')).toMatchObject({ status: 'completed' });
    });

    it('si el almacenamiento responde error, o lo bajado no es un PDF, no llama a Claude y la tarea dice por qué', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      for (const [s3, motivo] of [
        [() => new Response('<Error><Code>InvalidArgument</Code></Error>', { status: 400 }), 'no se pudo descargar el PDF (HTTP 400)'],
        [() => new Response('<html>no</html>', { status: 200 }), 'el archivo descargado no es un PDF'],
      ] as const) {
        const fetchMock = red(s3);
        vi.stubGlobal('fetch', fetchMock);
        const { medplum, todos } = fakeMedplum([consentimiento, docS3, ...defs]);
        expect(await procesar(medplum, evento(docS3))).toMatchObject({ ok: false, derivadoAlEquipo: true });
        expect(llamadasClaude(fetchMock)).toHaveLength(0);
        expect(todos<Task>('Task')[0]?.description).toContain(motivo);
      }
    });

    it('si la API de Claude falla, la tarea lo dice (y no hay uso que registrar)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const errorApi = () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'The PDF specified was not valid.' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      vi.stubGlobal('fetch', red(() => new Response(PDF, { status: 200 }), errorApi));
      const { medplum, todos } = fakeMedplum([consentimiento, docS3, ...defs]);
      expect(await procesar(medplum, evento(docS3))).toMatchObject({ ok: false, derivadoAlEquipo: true });
      expect(todos<Task>('Task')[0]?.description).toContain('falló la llamada a Claude (HTTP 400)');
      expect(todos('AuditEvent')).toHaveLength(0);
    });
  });

  it('un reproceso que vuelve a fallar actualiza el motivo de la tarea abierta, sin duplicarla ni avisar de nuevo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const revision: Task = {
      resourceType: 'Task',
      id: 'rev1',
      status: 'requested',
      intent: 'order',
      code: { coding: [{ system: SYSTEM.taskTipo, code: COD.revisarLaboratorio }] },
      focus: { reference: 'DocumentReference/lab1' },
      description: 'Revisar a mano un PDF de laboratorio del paciente (no se pudieron leer resultados en el PDF).',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (..._a: unknown[]) => respuestaClaude({ esInformeDeLaboratorio: false, fechaExtraccion: null, laboratorio: null, analitos: [] })),
    );
    const { medplum, todos } = fakeMedplum([consentimiento, docLab, revision, ...defs]);

    expect(await procesar(medplum, evento(docLab))).toMatchObject({ ok: false, derivadoAlEquipo: true });
    expect(todos<Task>('Task')).toEqual([
      expect.objectContaining({ id: 'rev1', status: 'requested', description: expect.stringContaining('el PDF no parece un informe de laboratorio') }),
    ]);
    expect(todos('Communication')).toHaveLength(0);
  });

  describe('el mismo PDF mandado dos veces', () => {
    const huella = huellaPdf(Buffer.from('JVBERi0xLjQK', 'base64'));
    const original: DocumentReference = {
      ...docLab,
      id: 'lab0',
      date: '2026-09-24T23:32:58Z',
      identifier: [{ system: SYSTEM.huellaPdf, value: huella }],
      context: { related: [{ reference: 'DiagnosticReport/dr0' }] },
    };
    const otraVez: DocumentReference = { ...docLab, id: 'lab2', date: '2026-09-30T21:04:26Z' };

    it('reutiliza el informe del original: sin llamar a Claude, sin valores repetidos', async () => {
      const fetchMock = vi.fn(async (..._a: unknown[]) => respuestaClaude({}));
      vi.stubGlobal('fetch', fetchMock);
      const { medplum, todos } = fakeMedplum([consentimiento, original, otraVez, ...defs]);

      expect(await procesar(medplum, evento(otraVez))).toMatchObject({
        ok: true,
        diagnosticReportId: 'dr0',
        duplicadoDe: 'DocumentReference/lab0',
      });
      expect(llamadasClaude(fetchMock)).toHaveLength(0);
      expect(todos('Observation')).toHaveLength(0);
      expect(todos('DiagnosticReport')).toHaveLength(0);
      const doc = todos<DocumentReference>('DocumentReference').find((d) => d.id === 'lab2');
      expect(doc?.context?.related).toEqual([{ reference: 'DiagnosticReport/dr0' }]);
      expect(doc?.identifier).toEqual([{ system: SYSTEM.huellaPdf, value: huella }]);
    });

    it('si el original todavía no tiene informe, este se procesa normal (y guarda su huella)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (..._a: unknown[]) =>
          respuestaClaude({
            esInformeDeLaboratorio: true,
            fechaExtraccion: '2026-09-18',
            laboratorio: null,
            analitos: [{ nombre: 'Colesterol LDL', codigo: LDL, valor: 131, valorTexto: null, unidad: 'mg/dL', referencia: null }],
          }),
        ),
      );
      const sinInforme = { ...original, context: undefined };
      const { medplum, todos } = fakeMedplum([consentimiento, sinInforme, otraVez, ...defs]);
      expect(await procesar(medplum, evento(otraVez))).toMatchObject({ ok: true, observaciones: 1 });
      expect(todos<DocumentReference>('DocumentReference').find((d) => d.id === 'lab2')?.identifier).toEqual([
        { system: SYSTEM.huellaPdf, value: huella },
      ]);
    });

    it('originalProcesado: el más viejo con informe, nunca el mismo documento ni uno anulado', () => {
      const anulado = { ...original, id: 'anulado', date: '2026-09-01T00:00:00Z', status: 'entered-in-error' as const };
      expect(originalProcesado([otraVez, anulado, original], 'lab2')).toEqual({ documento: original, informe: 'DiagnosticReport/dr0' });
      expect(originalProcesado([original], 'lab0')).toBeUndefined();
      expect(huellaPdf(Buffer.from('%PDF-1.4'))).toMatch(/^[0-9a-f]{64}$/);
      expect(huellaPdf(Buffer.from('%PDF-1.4'))).not.toBe(huellaPdf(Buffer.from('%PDF-1.5')));
    });
  });

  it('ignora documentos que no son resultados de laboratorio (p. ej. el consentimiento)', async () => {
    const { medplum } = fakeMedplum([consentimiento]);
    expect((await procesar(medplum, evento(consentimiento as DocumentReference))).ok).toBe(false);
  });
});
