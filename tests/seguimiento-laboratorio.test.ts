import { describe, it, expect } from 'vitest';
import type { AuditEvent, DocumentReference, Patient } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '../src/fhir/identifiers.js';
import { CRITERIO_SUBSCRIPTION_LABORATORIO } from '../src/lib/laboratorio.js';
import {
  ESPERA_MAXIMA_MS,
  pasosSeguimientoLaboratorio,
  type DatosSeguimientoLaboratorio,
} from '../src/lib/seguimiento-laboratorio.js';
import { PROCESO_IA, auditEventUsoIa, usoDeRespuesta } from '../src/lib/uso-ia.js';

const ahora = new Date('2026-10-01T15:00:00Z');
const paciente: Patient = { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'García' }] };
const documento = (minutosAtras: number, conPdf = true): DocumentReference => ({
  resourceType: 'DocumentReference',
  id: 'd1',
  status: 'current',
  date: new Date(ahora.getTime() - minutosAtras * 60_000).toISOString(),
  category: [{ coding: [{ system: SYSTEM.documento, code: COD.resultadoLaboratorio }] }],
  subject: { reference: 'Patient/p1' },
  content: [{ attachment: conPdf ? { contentType: 'application/pdf', url: 'Binary/b1', title: 'hemograma.pdf' } : { title: 'nada' } }],
});
const ejecucion = (outcome: string, outcomeDesc?: string): AuditEvent => ({
  resourceType: 'AuditEvent',
  type: { code: 'execute' },
  recorded: '2026-10-01T14:59:00Z',
  outcome: outcome as AuditEvent['outcome'],
  ...(outcomeDesc ? { outcomeDesc } : {}),
  agent: [{ requestor: false }],
  source: { observer: { reference: 'Bot/b9' } },
});
const uso = (ok: boolean, motivo?: string): AuditEvent =>
  auditEventUsoIa({
    proceso: PROCESO_IA.laboratorioPdf,
    uso: usoDeRespuesta({ model: 'claude-opus-5-5', usage: { input_tokens: 9_000, output_tokens: 5_000 } }, 'claude-opus-5-5'),
    botNombre: 'som-procesar-laboratorio',
    origen: 'DocumentReference/d1',
    ok,
    ...(motivo ? { motivo } : {}),
  });

/** Todo en orden y sin PDF todavía: se pisan los campos de cada caso. */
const base = (extra: Partial<DatosSeguimientoLaboratorio> = {}): DatosSeguimientoLaboratorio => ({
  paciente,
  consentimiento: true,
  documentosEnviados: 0,
  botId: 'b9',
  subscriptionActiva: true,
  secretClaude: true,
  ejecuciones: [],
  usoIa: [],
  ahora,
  ...extra,
});
const paso = (pasos: ReturnType<typeof pasosSeguimientoLaboratorio>, titulo: string) => pasos.find((p) => p.titulo === titulo);

describe('Seguimiento del laboratorio en PDF', () => {
  it('sin PDF: lo previo en orden, el envío pendiente y lo demás no aplica', () => {
    const pasos = pasosSeguimientoLaboratorio(base());
    expect(pasos.map((p) => [p.titulo, p.estado])).toEqual([
      ['Paciente', 'ok'],
      ['Consentimiento informado', 'ok'],
      ['Bot som-procesar-laboratorio', 'ok'],
      ['Subscription "SOM laboratorio"', 'ok'],
      ['Secret ANTHROPIC_API_KEY', 'ok'],
      ['PDF enviado', 'pendiente'],
      ['El bot lo procesó', 'no-aplica'],
      ['Uso de IA', 'no-aplica'],
      ['Resultado', 'no-aplica'],
    ]);
    expect(paso(pasos, 'Paciente')?.detalle).toContain('Ana García');
    expect(paso(pasos, 'PDF enviado')?.detalle).toMatch(/Enviar estudios en PDF/);
  });

  it('la cadena completa: informe con sus valores, uso de IA y "Ver resultados"', () => {
    const pasos = pasosSeguimientoLaboratorio(
      base({
        documento: { ...documento(3), context: { related: [{ reference: 'DiagnosticReport/r1' }] } },
        documentosEnviados: 2,
        ejecuciones: [ejecucion('0')],
        usoIa: [uso(true)],
        informe: {
          resourceType: 'DiagnosticReport',
          id: 'r1',
          status: 'final',
          code: { text: 'Laboratorio' },
          result: [{ reference: 'Observation/o1' }, { reference: 'Observation/o2' }],
        },
      }),
    );
    expect(pasos.every((p) => p.estado === 'ok')).toBe(true);
    expect(paso(pasos, 'PDF enviado')?.detalle).toMatch(/hemograma\.pdf · archivo \(Binary\/b1\) · 2 PDFs en total/);
    expect(paso(pasos, 'Uso de IA')?.detalle).toMatch(/9000 tokens de entrada · 5000 de salida · ≈ US\$ 0\.1360/);
    expect(paso(pasos, 'Resultado')?.detalle).toMatch(/DiagnosticReport\/r1 con 2 valor\(es\).*Ver resultados/);
  });

  it('lo que falta del servidor sale como falla, con el arreglo', () => {
    const pasos = pasosSeguimientoLaboratorio(base({ consentimiento: false, subscriptionActiva: false, secretClaude: false, botId: undefined }));
    expect(paso(pasos, 'Consentimiento informado')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/portal/) });
    expect(paso(pasos, 'Bot som-procesar-laboratorio')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/deploy:bots/) });
    expect(paso(pasos, 'Subscription "SOM laboratorio"')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/deploy:bots/) });
    expect(paso(pasos, 'Secret ANTHROPIC_API_KEY')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/Secrets/) });
    // Sin permiso para leer el proyecto no se afirma nada del secret.
    const { secretClaude: _, ...sinSecret } = base();
    expect(paso(pasosSeguimientoLaboratorio(sinSecret), 'Secret ANTHROPIC_API_KEY')?.estado).toBe('pendiente');
  });

  it('sin ejecución del bot: pendiente recién enviado, falla (Subscription) pasado el margen', () => {
    const recien = pasosSeguimientoLaboratorio(base({ documento: documento(1), documentosEnviados: 1 }));
    expect(paso(recien, 'El bot lo procesó')?.estado).toBe('pendiente');
    expect(paso(recien, 'Resultado')?.estado).toBe('pendiente');

    const tarde = pasosSeguimientoLaboratorio(
      base({ documento: documento(ESPERA_MAXIMA_MS / 60_000 + 5), documentosEnviados: 1 }),
    );
    expect(paso(tarde, 'El bot lo procesó')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/Subscription no lo disparó/) });
  });

  it('pasó al equipo: tarea y aviso al paciente, con el motivo del uso de IA', () => {
    const pasos = pasosSeguimientoLaboratorio(
      base({
        documento: documento(4),
        documentosEnviados: 1,
        ejecuciones: [ejecucion('0')],
        usoIa: [uso(false, 'sin resultados legibles')],
        tarea: {
          resourceType: 'Task',
          id: 't1',
          status: 'requested',
          intent: 'order',
          description: 'Revisar a mano un PDF de laboratorio del paciente (no se pudieron leer resultados en el PDF).',
        },
        aviso: { resourceType: 'Communication', status: 'in-progress' },
      }),
    );
    expect(paso(pasos, 'Uso de IA')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/sin resultados legibles/) });
    expect(paso(pasos, 'Resultado')).toMatchObject({
      estado: 'falla',
      detalle: expect.stringMatching(/Task\/t1, requested.*recibió el aviso por Mensajes.*reprocesar/),
    });
  });

  it('la última ejecución falló: muestra la primera línea del log; un PDF sin adjunto es falla', () => {
    const fallo = pasosSeguimientoLaboratorio(
      base({ documento: documento(2), documentosEnviados: 1, ejecuciones: [ejecucion('8', '\nTypeError: x is undefined\n  at handler')] }),
    );
    expect(paso(fallo, 'El bot lo procesó')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/TypeError: x is undefined\./) });

    const sinPdf = pasosSeguimientoLaboratorio(base({ documento: documento(2, false), documentosEnviados: 1 }));
    expect(paso(sinPdf, 'PDF enviado')).toMatchObject({ estado: 'falla', detalle: expect.stringMatching(/vuelva a mandar/) });
  });

  it('el criterio de la Subscription es el del documento que manda el portal', () => {
    expect(CRITERIO_SUBSCRIPTION_LABORATORIO).toBe(
      'DocumentReference?category=https://segundaopinionmedica.org/fhir/CodeSystem/documento|resultado-laboratorio',
    );
  });
});
