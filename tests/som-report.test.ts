import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { DiagnosticReport, DocumentReference, RiskAssessment, ServiceRequest } from '@medplum/fhirtypes';
import {
  construirExtensionSecciones,
  construirRiskAssessment,
  construirDiagnosticReport,
  construirPdf,
  parsearSecciones,
  resumenRiesgo,
} from '../src/lib/som-report.js';
import { COD, EXT, SOM_SECCIONES, SYSTEM } from '../src/fhir/identifiers.js';
import { handler as somReportHandler } from '../src/bots/som-report.js';
import { calcularPrevent, riesgoPrevent, type ResultadoPrevent } from '../src/lib/prevent.js';
import { fakeMedplum } from './fake-medplum.js';

const prevent: ResultadoPrevent = {
  pendienteValidacion: true,
  faltantes: ['Insuficiencia cardíaca a 10 años: falta IMC'],
  predicciones: [
    { desenlace: 'ascvd', horizonte: 10, probabilidad: 0.123, etiqueta: 'ASCVD a 10 años' },
    { desenlace: 'total-cvd', horizonte: 30, probabilidad: 0.456, etiqueta: 'ECV total a 30 años' },
  ],
  noEstimadas: [
    { desenlace: 'heart-failure', horizonte: 10, etiqueta: 'Insuficiencia cardíaca a 10 años', motivo: 'falta IMC' },
  ],
};

describe('Informe SOM — RiskAssessment', () => {
  it('mapea predicciones a prediction[] con probabilidad 0–1, basedOn la solicitud y queda preliminary', () => {
    const ra = construirRiskAssessment(prevent, { pacienteRef: 'Patient/1', serviceRequestRef: 'ServiceRequest/2' });
    expect(ra.status).toBe('preliminary');
    expect(ra.subject?.reference).toBe('Patient/1');
    // El portal filtra el RiskAssessment de cada solicitud por basedOn.
    expect(ra.basedOn?.reference).toBe('ServiceRequest/2');
    expect(ra.prediction?.[0]?.outcome?.text).toBe('ASCVD a 10 años');
    // Probabilidad 0–1: el portal la multiplica por 100 para mostrar el %.
    expect(ra.prediction?.[0]?.probabilityDecimal).toBe(0.123);
    // Lugares fijos: el desenlace no estimado ocupa su lugar sin probabilidad y con el motivo.
    expect(ra.prediction?.[1]).toMatchObject({ outcome: { text: 'Insuficiencia cardíaca a 10 años' }, rationale: 'No estimado: falta IMC.' });
    expect(ra.prediction?.[1]?.probabilityDecimal).toBeUndefined();
    expect(ra.prediction?.[2]?.probabilityDecimal).toBe(0.456);
    expect(ra.prediction?.[2]?.whenRange?.high?.value).toBe(30);
    expect(ra.note?.[0]?.text).toMatch(/preliminar/i);
  });
});

describe('Informe SOM — extensión de secciones', () => {
  it('usa las 6 claves EXACTAS y nunca deja value[x] vacío', () => {
    const ext = construirExtensionSecciones({ 'executive-summary': 'Hola' });
    expect(ext.url).toBe(EXT.somSections);
    expect(ext.extension?.map((e) => e.url)).toEqual([...SOM_SECCIONES]);
    expect(ext.extension?.every((e) => typeof e.valueString === 'string' && e.valueString.length > 0)).toBe(true);
  });

  it('el DiagnosticReport final es status final con la extensión som-sections', () => {
    const dr = construirDiagnosticReport({
      pacienteRef: 'Patient/1',
      serviceRequestRef: 'ServiceRequest/2',
      secciones: { conclusions: 'Todo bien' },
      pdfBinaryRef: 'Binary/9',
    });
    expect(dr.status).toBe('final');
    expect(dr.extension?.[0]?.url).toBe(EXT.somSections);
    expect(dr.presentedForm?.[0]?.url).toBe('Binary/9');
    expect(dr.basedOn?.[0]?.reference).toBe('ServiceRequest/2');
  });
});

describe('Informe SOM — parseo de Claude', () => {
  it('parsea JSON directo', () => {
    const s = parsearSecciones('{"executive-summary":"Resumen","conclusions":"Fin"}');
    expect(s['executive-summary']).toBe('Resumen');
    expect(s.conclusions).toBe('Fin');
  });

  it('rescata el JSON aunque venga con texto alrededor', () => {
    const s = parsearSecciones('Acá tenés:\n{"risk-assessment":"riesgo"}\nGracias');
    expect(s['risk-assessment']).toBe('riesgo');
  });

  it('devuelve vacío si no hay JSON', () => {
    expect(parsearSecciones('sin json')).toEqual({});
  });
});

describe('Informe SOM — PDF', () => {
  it('genera un PDF válido (cabecera y EOF), con acentos transliterados', () => {
    const bytes = construirPdf('Informe', [{ titulo: 'Resumen', texto: 'Atención: presión y glóbulos. ' + 'x '.repeat(200) }]);
    const txt = new TextDecoder('latin1').decode(bytes);
    expect(txt.startsWith('%PDF-1.4')).toBe(true);
    expect(txt).toContain('%%EOF');
    expect(txt).toContain('/Type /Catalog');
    // Sin caracteres no ASCII en el contenido (transliterados).
    expect(/[^\x00-\x7F]/.test(txt)).toBe(false);
  });
});

describe('Informe SOM — resumen de riesgo', () => {
  it('lista las predicciones en texto', () => {
    expect(resumenRiesgo(prevent)).toContain('ASCVD a 10 años: 12.3%');
  });
  it('avisa cuando no hay predicciones', () => {
    expect(resumenRiesgo({ predicciones: [], noEstimadas: [], pendienteValidacion: true, faltantes: [] })).toMatch(/Sin estimación/);
  });
});

describe('Bot bot-som-report — aviso de informe listo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('El WhatsApp va al paciente aunque esté RECEPCION_WHATSAPP_TO (Recepción no ve lo clínico)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (..._a: unknown[]) => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const medplum = {
      searchOne: async () => undefined,
      searchResources: async () => [],
      readResource: async (tipo: string, id: string) => ({
        resourceType: tipo,
        id,
        telecom: [{ system: 'phone', value: '+5491111111111' }],
      }),
      createResource: async (r: Record<string, unknown>) => ({ ...r, id: 'nuevo' }),
      createBinary: async () => ({ id: 'bin1' }),
      updateResource: async (r: unknown) => r,
    } as unknown as MedplumClient;
    const sr: ServiceRequest = {
      resourceType: 'ServiceRequest',
      id: 'sr1',
      status: 'active',
      intent: 'order',
      code: { coding: [{ system: SYSTEM.somServices, code: COD.somCardiology }] },
      subject: { reference: 'Patient/p1' },
    };
    const secrets = {
      TWILIO_ACCOUNT_SID: { name: 'TWILIO_ACCOUNT_SID', valueString: 'AC123' },
      TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'tok' },
      TWILIO_WHATSAPP_FROM: { name: 'TWILIO_WHATSAPP_FROM', valueString: 'whatsapp:+5491100000000' },
      RECEPCION_WHATSAPP_TO: { name: 'RECEPCION_WHATSAPP_TO', valueString: '+5491199999999' },
    };

    const r = await somReportHandler(medplum, { input: sr, secrets } as unknown as BotEvent<ServiceRequest>);

    expect(r.ok).toBe(true);
    const twilio = fetchMock.mock.calls.filter((c) => String(c[0]).includes('api.twilio.com'));
    expect(twilio).toHaveLength(1);
    const body = new URLSearchParams(String((twilio[0]?.[1] as RequestInit).body));
    expect(body.get('To')).toBe('whatsapp:+5491111111111');
  });
});

describe('Informe SOM — contrato de lectura del portal (extractPrevent)', () => {
  // Mismas expresiones que `extractPrevent` en EPA-Developments/app (src/fhir/som.ts).
  const porTexto = (texto: string) => ({
    ascvd10: /ascvd/i.test(texto),
    hf10: /\b(ic|hf|insuf)/i.test(texto),
    total30: /(30|total)/i.test(texto),
  });

  it('cada etiqueta PREVENT la reconoce el portal como un único desenlace', () => {
    expect(porTexto('ASCVD a 10 años')).toEqual({ ascvd10: true, hf10: false, total30: false });
    expect(porTexto('Insuficiencia cardíaca a 10 años')).toEqual({ ascvd10: false, hf10: true, total30: false });
    expect(porTexto('ECV total a 30 años')).toEqual({ ascvd10: false, hf10: false, total30: true });
  });

  /** Copia de `extractPrevent` del portal: por texto y, si no, por posición. */
  function extractPrevent(risk: RiskAssessment) {
    const preds = risk.prediction ?? [];
    const byText = (re: RegExp) => preds.find((p) => re.test(p.outcome?.text ?? ''))?.probabilityDecimal;
    return {
      ascvd10: byText(/ascvd/i) ?? preds[0]?.probabilityDecimal,
      hf10: byText(/\b(ic|hf|insuf)/i) ?? preds[1]?.probabilityDecimal,
      total30: byText(/(30|total)/i) ?? preds[2]?.probabilityDecimal,
    };
  }
  const refs = { pacienteRef: 'Patient/1', serviceRequestRef: 'ServiceRequest/2' };
  const entrada = {
    sexo: 'female' as const,
    edad: 50,
    sbp: 160,
    tratamientoHta: true,
    colesterolTotalMgDl: 200,
    hdlMgDl: 45,
    estatina: false,
    diabetes: true,
    fumador: false,
    egfr: 90,
    imc: 35,
  };
  const r4 = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 10000) / 10000);

  it('con los 6 desenlaces, el portal lee ASCVD 10a, IC 10a y ECV total 30a (no la de 10 años)', () => {
    const p = calcularPrevent(entrada);
    expect(construirRiskAssessment(p, refs).prediction).toHaveLength(6);
    expect(extractPrevent(construirRiskAssessment(p, refs))).toEqual({
      ascvd10: r4(riesgoPrevent(p, 'ascvd', 10)),
      hf10: r4(riesgoPrevent(p, 'heart-failure', 10)),
      total30: r4(riesgoPrevent(p, 'total-cvd', 30)),
    });
  });

  it('sin riesgo a 30 años (> 59) o sin IMC, el portal muestra "—" y no un valor ajeno', () => {
    const mayor = calcularPrevent({ ...entrada, edad: 65 });
    expect(extractPrevent(construirRiskAssessment(mayor, refs)).total30).toBeUndefined();
    const sinImc = calcularPrevent({ ...entrada, imc: undefined });
    const leido = extractPrevent(construirRiskAssessment(sinImc, refs));
    expect(leido.hf10).toBeUndefined();
    expect(leido.total30).toBe(r4(riesgoPrevent(sinImc, 'total-cvd', 30)));
  });
});

describe('Bot bot-som-report — consentimiento y Claude', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const secretos = { ANTHROPIC_API_KEY: { name: 'ANTHROPIC_API_KEY', valueString: 'sk-test' } };
  const sr: ServiceRequest = {
    resourceType: 'ServiceRequest',
    id: 'sr1',
    status: 'active',
    intent: 'order',
    code: { coding: [{ system: SYSTEM.somServices, code: COD.somCardiology }] },
    subject: { reference: 'Patient/p1' },
    reasonCode: [{ text: 'Palpitaciones' }],
  };
  const paciente = { resourceType: 'Patient' as const, id: 'p1', gender: 'female' as const, birthDate: '1970-01-01' };
  const consentimiento = {
    resourceType: 'DocumentReference' as const,
    id: 'consent1',
    status: 'current' as const,
    type: { coding: [{ system: 'http://loinc.org', code: '59284-0' }] },
    subject: { reference: 'Patient/p1' },
    content: [{ attachment: { title: 'Consentimiento' } }],
  };

  function respuestaClaude(secciones: Record<string, string>): Response {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: JSON.stringify(secciones) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('Sin consentimiento firmado NO llama a Claude (ningún dato clínico sale al LLM)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (..._a: unknown[]) => respuestaClaude({}));
    vi.stubGlobal('fetch', fetchMock);
    const { medplum, todos } = fakeMedplum([paciente, sr]);

    const r = await somReportHandler(medplum, { input: sr, secrets: secretos } as unknown as BotEvent<ServiceRequest>);

    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('api.anthropic.com'))).toBe(false);
    const dr = todos<DiagnosticReport>('DiagnosticReport')[0]!;
    const resumen = dr.extension?.[0]?.extension?.find((e) => e.url === 'executive-summary')?.valueString;
    expect(resumen).toMatch(/revisará la solicitud manualmente/);
  });

  it('Con consentimiento: Claude (modelo del contrato) redacta las secciones', async () => {
    const texto = Object.fromEntries(SOM_SECCIONES.map((s) => [s, `Texto de ${s}`]));
    const fetchMock = vi.fn(async (..._a: unknown[]) => respuestaClaude(texto));
    vi.stubGlobal('fetch', fetchMock);
    const trigliceridos = {
      resourceType: 'Observation' as const,
      status: 'final' as const,
      code: { coding: [{ system: 'http://loinc.org', code: '2571-8' }] },
      subject: { reference: 'Patient/p1' },
      effectiveDateTime: '2026-09-01',
      valueQuantity: { value: 160, unit: 'mg/dL' },
    };
    const { medplum, todos } = fakeMedplum([paciente, sr, consentimiento, trigliceridos]);

    const r = await somReportHandler(medplum, { input: sr, secrets: secretos } as unknown as BotEvent<ServiceRequest>);

    expect(r.ok).toBe(true);
    const llamada = fetchMock.mock.calls.find((c) => String(c[0]).includes('api.anthropic.com'));
    expect(llamada).toBeDefined();
    const body = JSON.parse(String((llamada![1] as RequestInit).body));
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.system).toContain('executive-summary');

    const dr = todos<DiagnosticReport>('DiagnosticReport')[0]!;
    expect(dr.basedOn?.[0]?.reference).toBe('ServiceRequest/sr1');
    const conclusiones = dr.extension?.[0]?.extension?.find((e) => e.url === 'conclusions')?.valueString;
    expect(conclusiones).toBe('Texto de conclusions');
    // El marco clínico es la Guía CKM 2026 (sin medicina funcional) y van el estadío y el plan.
    expect(body.system).toMatch(/Guía 2026 AHA\/ACC\/ADA\/ASN/);
    expect(body.system).toMatch(/NO uses parámetros.*medicina funcional/);
    expect(body.messages[0].content).toMatch(/Estadificación CKM \(Guía AHA\/ACC\/ADA\/ASN 2026\)/);
    expect(body.messages[0].content).toMatch(/Seguimiento según la guía/);
    // El RiskAssessment queda ligado a la solicitud (así lo encuentra el portal) y
    // lleva el estadío CKM en el mismo recurso (un solo RiskAssessment por solicitud).
    const [ra, ...otros] = todos<RiskAssessment>('RiskAssessment');
    expect(otros).toHaveLength(0);
    expect(ra?.basedOn?.reference).toBe('ServiceRequest/sr1');
    expect(ra?.extension?.find((x) => x.url === EXT.ckmStage)?.valueCode).toBe('2');
    expect(ra?.extension?.find((x) => x.url === EXT.ckmStageCompleto)?.valueBoolean).toBe(false);
    expect(ra?.note?.map((n) => n.text).join('\n')).toMatch(/al menos Estadío 2/);
    expect(todos<ServiceRequest>('ServiceRequest')[0]?.status).toBe('completed');
    // PDF del informe ligado a la solicitud (DocumentReference?related=ServiceRequest/<id>).
    const pdf = todos<DocumentReference>('DocumentReference').find((d) => d.type?.coding?.[0]?.code === '11488-4');
    expect(pdf?.context?.related?.[0]?.reference).toBe('ServiceRequest/sr1');
  });
});

describe('Bot bot-som-report — PREVENT, estadío CKM y plan de la Guía 2026', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sr: ServiceRequest = {
    resourceType: 'ServiceRequest',
    id: 'sr9',
    status: 'active',
    intent: 'order',
    code: { coding: [{ system: SYSTEM.somServices, code: COD.somCardiology }] },
    subject: { reference: 'Patient/p9' },
  };
  const hoy = new Date();
  const nacimiento = `${hoy.getUTCFullYear() - 50}-01-01`;
  const paciente = { resourceType: 'Patient' as const, id: 'p9', gender: 'female' as const, birthDate: nacimiento };
  const lab = (code: string, value: number, unit: string) => ({
    resourceType: 'Observation' as const,
    id: `obs-${code}`,
    status: 'final' as const,
    code: { coding: [{ system: 'http://loinc.org', code }] },
    subject: { reference: 'Patient/p9' },
    effectiveDateTime: '2026-09-01',
    valueQuantity: { value, unit },
  });
  // Caso de referencia de PREVENT (mujer 50 años, PAS 160 tratada, CT 200, HDL 45, DM2, eGFR 90, IMC 35).
  const historia = [
    lab('8480-6', 160, 'mm[Hg]'),
    lab('8462-4', 85, 'mm[Hg]'),
    lab('2093-3', 200, 'mg/dL'),
    lab('2085-9', 45, 'mg/dL'),
    lab('62238-1', 90, 'mL/min/{1.73_m2}'),
    lab('39156-5', 35, 'kg/m2'),
    lab('4548-4', 7.0, '%'),
    {
      resourceType: 'MedicationRequest' as const,
      id: 'm1',
      status: 'active' as const,
      intent: 'order' as const,
      subject: { reference: 'Patient/p9' },
      medicationCodeableConcept: { text: 'Losartán 50 mg' },
    },
  ];
  const evento = { input: sr, secrets: {} } as unknown as BotEvent<ServiceRequest>;

  it('con la historia completa: 6 riesgos PREVENT, Estadío 2 y el plan de la guía en la nota y el informe', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { medplum, todos } = fakeMedplum([paciente, sr, ...historia]);

    const r = await somReportHandler(medplum, evento);

    expect(r.ok).toBe(true);
    const [ra] = todos<RiskAssessment>('RiskAssessment');
    expect(ra?.prediction?.map((p) => p.outcome?.text)).toEqual([
      'ASCVD a 10 años',
      'Insuficiencia cardíaca a 10 años',
      'ECV total a 30 años',
      'ECV total a 10 años',
      'ASCVD a 30 años',
      'Insuficiencia cardíaca a 30 años',
    ]);
    expect(Math.round(ra!.prediction![3]!.probabilityDecimal! * 1000) / 1000).toBe(0.147); // PREVENT-CVD 10a
    expect(ra?.extension?.find((x) => x.url === EXT.ckmStage)?.valueCode).toBe('2');
    const notas = ra?.note?.map((n) => n.text).join('\n') ?? '';
    expect(notas).toMatch(/Guía AHA\/ACC\/ADA\/ASN 2026/);
    expect(notas).toMatch(/SGLT2i o terapia basada en GLP-1/); // DM2 con PREVENT-CVD ≥ 7,5 %
    expect(notas).toMatch(/iniciar tratamiento hipolipemiante/); // PREVENT-ASCVD ≥ 5 %
    // Sin Claude (sin consentimiento), "pending-studies" lista lo que sugiere la guía.
    const dr = todos<DiagnosticReport>('DiagnosticReport')[0]!;
    const pendientes = dr.extension?.[0]?.extension?.find((e) => e.url === 'pending-studies')?.valueString ?? '';
    expect(pendientes).toMatch(/albuminuria \(UACR\)/);
    expect(pendientes).toMatch(/NT-proBNP/); // PREVENT-HF ≥ 5 %
    expect(pendientes).toMatch(/calcio coronario/); // PREVENT-ASCVD 3 % a < 10 %
  });

  it('con ECV clínica no usa PREVENT (Estadío 4a) y lo explica en la nota', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const iam = {
      resourceType: 'Condition' as const,
      id: 'c1',
      subject: { reference: 'Patient/p9' },
      clinicalStatus: { coding: [{ code: 'active' }] },
      code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: 'I21.9' }] },
    };
    const { medplum, todos } = fakeMedplum([paciente, sr, ...historia, iam]);

    await somReportHandler(medplum, evento);

    const [ra] = todos<RiskAssessment>('RiskAssessment');
    expect(ra?.prediction).toBeUndefined();
    expect(ra?.extension?.find((x) => x.url === EXT.ckmStage)?.valueCode).toBe('4a');
    const notas = ra?.note?.map((n) => n.text).join('\n') ?? '';
    expect(notas).toMatch(/no se usa con ECV clínica/);
    expect(notas).not.toMatch(/hipolipemiante/);
  });
});
