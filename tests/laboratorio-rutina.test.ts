import { describe, it, expect } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Communication, Patient, PlanDefinition, ServiceRequest } from '@medplum/fhirtypes';
import {
  analitosDelPedido,
  claveRequisicion,
  construirPedidoLaboratorio,
  construirPlanDefinitionLaboratorio,
  mensajePedidoPaciente,
  normalizarEntradaPedido,
  textoPedido,
} from '../src/lib/laboratorio-rutina.js';
import { handler as pedir, type EntradaPedirLaboratorio } from '../src/bots/pedir-laboratorio.js';
import { buildSeed } from '../src/seed/builders.js';
import { PLAN_LABORATORIO_RUTINA_URL, SYSTEM } from '../src/fhir/identifiers.js';
import { fakeMedplum } from './fake-medplum.js';

const slugs = (xs: Array<{ slug: string }>) => xs.map((x) => x.slug);

describe('Laboratorio de rutina — qué se pide', () => {
  it('esenciales: 17 analitos de perfil básico, renal y electrolitos, sin las alternativas', () => {
    const esenciales = analitosDelPedido(['esencial']);
    expect(esenciales).toHaveLength(17);
    expect(new Set(esenciales.map((b) => b.panel))).toEqual(new Set(['metabolico', 'renal', 'electrolitos']));
    expect(slugs(esenciales)).toEqual(expect.arrayContaining(['creatinina_serica', 'e_gfr', 'acr_urinaria', 'potasio_serico']));
    expect(slugs(esenciales)).not.toContain('bun');
    expect(slugs(esenciales)).not.toContain('colesterol_ldl_directo');
    expect(slugs(esenciales)).not.toContain('calcio_ionico');
  });

  it('extensivos y paneles sueltos', () => {
    const extensivos = analitosDelPedido(['extensivo']);
    expect(extensivos.every((b) => b.nivel === 'extensivo' && !b.cuentaComo)).toBe(true);
    expect(slugs(extensivos)).toContain('lp_a');
    expect(slugs(extensivos)).not.toContain('lp_a_masa');
    expect(analitosDelPedido(['esencial', 'extensivo'])).toHaveLength(17 + extensivos.length);
    expect(slugs(analitosDelPedido(['esencial'], ['renal']))).toEqual([
      'creatinina_serica',
      'e_gfr',
      'urea_serica',
      'cistatina_c',
      'acr_urinaria',
    ]);
    expect(analitosDelPedido(['esencial'], ['menopausia'])).toEqual([]);
  });
});

describe('Laboratorio de rutina — plantilla (PlanDefinition order-set)', () => {
  it('una por nivel, en el seed, con un grupo por panel y una acción por analito', () => {
    const esencial = construirPlanDefinitionLaboratorio('esencial');
    expect(esencial).toMatchObject({
      resourceType: 'PlanDefinition',
      url: PLAN_LABORATORIO_RUTINA_URL.esencial,
      title: 'Laboratorio de rutina — esenciales',
      status: 'active',
      type: { coding: [{ code: 'order-set' }] },
      relatedArtifact: [{ type: 'citation', citation: expect.stringMatching(/Ndumele/) }],
    });
    expect(esencial.action?.map((a) => a.id)).toEqual(['metabolico', 'renal', 'electrolitos']);
    const egfr = esencial.action?.[1]?.action?.find((a) => a.id === 'e_gfr');
    expect(egfr?.code?.[0]?.coding?.map((c) => c.code)).toEqual(['62238-1', '33914-3']);
    expect(esencial.action?.flatMap((a) => a.action ?? [])).toHaveLength(17);

    const extensivo = construirPlanDefinitionLaboratorio('extensivo');
    expect(extensivo.title).toBe('Laboratorio de rutina — extensivos');
    expect(extensivo.action?.map((a) => a.id)).toEqual(['cardiaco', 'inflamatorios', 'hematologia', 'endocrinologia', 'menopausia']);

    const urls = buildSeed().planDefinitions.map((p: PlanDefinition) => p.url);
    expect(urls).toEqual(expect.arrayContaining([PLAN_LABORATORIO_RUTINA_URL.esencial, PLAN_LABORATORIO_RUTINA_URL.extensivo]));
  });
});

describe('Laboratorio de rutina — el pedido', () => {
  const ahora = '2026-10-01T13:00:00.000Z';

  it('valida la entrada: paciente, niveles, paneles y solicitante', () => {
    expect(normalizarEntradaPedido(undefined)).toEqual({ ok: false, mensaje: 'Falta el paciente (Patient/…).' });
    expect(normalizarEntradaPedido({ pacienteRef: 'Patient/p1' })).toEqual({
      ok: true,
      entrada: { pacienteRef: 'Patient/p1', niveles: ['esencial'], paneles: [] },
    });
    expect(normalizarEntradaPedido({ pacienteRef: 'Patient/p1', niveles: ['basico' as 'esencial'] })).toMatchObject({ ok: false });
    expect(normalizarEntradaPedido({ pacienteRef: 'Patient/p1', paneles: ['longevidad' as 'renal'] })).toMatchObject({ ok: false });
    expect(normalizarEntradaPedido({ pacienteRef: 'Patient/p1', solicitanteRef: 'Patient/p2' })).toMatchObject({ ok: false });
    expect(normalizarEntradaPedido({ pacienteRef: 'Patient/p1', paneles: ['menopausia'] })).toEqual({
      ok: false,
      mensaje: 'Esos paneles no tienen estudios de ese nivel.',
    });
    // Ordena niveles y paneles: el mismo pedido escrito de otra forma es el mismo pedido.
    expect(
      normalizarEntradaPedido({ pacienteRef: 'Patient/p1', niveles: ['extensivo', 'esencial'], paneles: ['renal', 'metabolico'] }),
    ).toMatchObject({ ok: true, entrada: { niveles: ['esencial', 'extensivo'], paneles: ['metabolico', 'renal'] } });
  });

  it('un ServiceRequest por analito, agrupados por requisition, con su plantilla y sus códigos', () => {
    const pedido = construirPedidoLaboratorio({ pacienteRef: 'Patient/p1', solicitanteRef: 'Practitioner/m1' }, ahora);
    expect(pedido).toHaveLength(17);
    const requisicion = 'p1:2026-10-01:esencial';
    expect(claveRequisicion({ pacienteRef: 'Patient/p1' }, ahora)).toBe(requisicion);
    expect(pedido.every((s) => s.requisition?.value === requisicion && s.requisition.system === SYSTEM.pedidoLaboratorio)).toBe(true);
    const egfr = pedido.find((s) => s.identifier?.[0]?.value === `${requisicion}:e_gfr`);
    expect(egfr).toMatchObject({
      status: 'active',
      intent: 'order',
      priority: 'routine',
      subject: { reference: 'Patient/p1' },
      requester: { reference: 'Practitioner/m1' },
      authoredOn: ahora,
      instantiatesCanonical: [`${PLAN_LABORATORIO_RUTINA_URL.esencial}|1`],
      code: { text: 'Filtrado glomerular estimado (eGFR)' },
    });
    expect(egfr?.code?.coding?.map((c) => c.code)).toEqual(['62238-1', '33914-3']);
    expect(egfr?.category?.flatMap((c) => c.coding?.map((x) => x.code))).toEqual(['108252007', 'renal']);
  });

  it('el pedido en texto y el aviso al paciente', () => {
    const renal = analitosDelPedido(['esencial'], ['renal']);
    expect(textoPedido(renal)).toBe(
      '• Función renal y síndrome cardiorrenal: Creatinina sérica, Filtrado glomerular estimado (eGFR), Urea sérica, Cistatina C, Cociente albúmina/creatinina en orina (UACR).',
    );
    const aviso = mensajePedidoPaciente(analitosDelPedido(['esencial']));
    expect(aviso).toMatch(/^Tu equipo te pidió un laboratorio de rutina \(17 estudios\):/);
    expect(aviso).toContain('• Electrolitos y conducción eléctrica:');
    expect(aviso).toContain('Enviar estudios en PDF');
  });
});

describe('Bot som-pedir-laboratorio', () => {
  const paciente: Patient = { resourceType: 'Patient', id: 'p1', gender: 'female', birthDate: '1976-03-10' };
  const evento = (input: Partial<EntradaPedirLaboratorio>) => ({ input }) as unknown as BotEvent<EntradaPedirLaboratorio>;

  it('pide los esenciales y avisa al paciente; el mismo pedido el mismo día no se duplica', async () => {
    const { medplum, todos } = fakeMedplum([paciente]);
    const r = await pedir(medplum, evento({ pacienteRef: 'Patient/p1', solicitanteRef: 'Practitioner/m1' }));
    expect(r).toMatchObject({ ok: true, creado: true, mensaje: 'Pedido de laboratorio de rutina: 17 estudios.' });
    expect(r.serviceRequestIds).toHaveLength(17);
    expect(r.pedido).toContain('• Perfil básico y riesgo cardiovascular:');

    const pedidos = todos<ServiceRequest>('ServiceRequest');
    expect(pedidos).toHaveLength(17);
    const [aviso] = todos<Communication>('Communication');
    expect(aviso).toMatchObject({
      status: 'in-progress',
      topic: { text: 'Tu pedido de laboratorio' },
      subject: { reference: 'Patient/p1' },
      recipient: [{ reference: 'Patient/p1' }],
      sender: { reference: 'Practitioner/m1' },
    });
    expect(aviso?.basedOn).toHaveLength(17);
    expect(aviso?.payload?.[0]?.contentString).toMatch(/17 estudios/);
    expect(r.communicationId).toBe(aviso?.id);

    const otraVez = await pedir(medplum, evento({ pacienteRef: 'Patient/p1' }));
    expect(otraVez).toMatchObject({ ok: true, creado: false, requisicion: r.requisicion });
    expect(otraVez.serviceRequestIds).toEqual(r.serviceRequestIds);
    expect(todos('ServiceRequest')).toHaveLength(17);
    expect(todos('Communication')).toHaveLength(1);
  });

  it('esenciales + extensivos de un panel, sin aviso; otro pedido el mismo día sí se crea', async () => {
    const { medplum, todos } = fakeMedplum([paciente]);
    await pedir(medplum, evento({ pacienteRef: 'Patient/p1' }));
    const r = await pedir(
      medplum,
      evento({ pacienteRef: 'Patient/p1', niveles: ['esencial', 'extensivo'], paneles: ['cardiaco'], avisar: false }),
    );
    expect(r).toMatchObject({ ok: true, creado: true, requisicion: 'p1:' + r.requisicion?.split(':')[1] + ':esencial+extensivo:cardiaco' });
    expect(r.serviceRequestIds).toHaveLength(6);
    expect(r.communicationId).toBeUndefined();
    expect(todos('ServiceRequest')).toHaveLength(17 + 6);
    expect(todos('Communication')).toHaveLength(1);
  });

  it('sin paciente válido o inexistente no crea nada', async () => {
    const { medplum, todos } = fakeMedplum([paciente]);
    expect(await pedir(medplum, evento({}))).toEqual({ ok: false, mensaje: 'Falta el paciente (Patient/…).' });
    expect(await pedir(medplum, evento({ pacienteRef: 'Patient/nadie' }))).toMatchObject({ ok: false });
    expect(todos('ServiceRequest')).toHaveLength(0);
    expect(todos('Communication')).toHaveLength(0);
  });
});
