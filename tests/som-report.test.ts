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
import type { ResultadoPrevent } from '../src/lib/prevent.js';
import { fakeMedplum } from './fake-medplum.js';

const prevent: ResultadoPrevent = {
  pendienteValidacion: true,
  faltantes: [],
  predicciones: [
    { desenlace: 'ascvd', horizonte: 10, probabilidad: 0.123, etiqueta: 'ASCVD a 10 años' },
    { desenlace: 'total-cvd', horizonte: 30, probabilidad: 0.456, etiqueta: 'ECV total a 30 años' },
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
    expect(ra.prediction?.[1]?.probabilityDecimal).toBe(0.456);
    expect(ra.note?.[0]?.text).toMatch(/pendiente/i);
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
    expect(resumenRiesgo({ predicciones: [], pendienteValidacion: true, faltantes: [] })).toMatch(/Sin estimación/);
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
    const { medplum, todos } = fakeMedplum([paciente, sr, consentimiento]);

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
    // El RiskAssessment queda ligado a la solicitud (así lo encuentra el portal).
    expect(todos<RiskAssessment>('RiskAssessment')[0]?.basedOn?.reference).toBe('ServiceRequest/sr1');
    expect(todos<ServiceRequest>('ServiceRequest')[0]?.status).toBe('completed');
    // PDF del informe ligado a la solicitud (DocumentReference?related=ServiceRequest/<id>).
    const pdf = todos<DocumentReference>('DocumentReference').find((d) => d.type?.coding?.[0]?.code === '11488-4');
    expect(pdf?.context?.related?.[0]?.reference).toBe('ServiceRequest/sr1');
  });
});
