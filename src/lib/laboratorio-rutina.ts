/**
 * Laboratorio de rutina: el pedido estándar del médico, armado con el mismo catálogo que
 * publica el servidor (`config/biomarcadores.ts`) y que el portal usa para "te faltan X
 * estudios esenciales".
 *
 *  - PlanDefinition `order-set` por nivel (esenciales / extensivos): la plantilla, con un
 *    grupo por panel y una acción por analito (LOINC).
 *  - ServiceRequest: un pedido por analito, agrupados por `requisition` (el pedido de ese
 *    día), con `instantiatesCanonical` a la plantilla de su nivel.
 *
 * Se piden los analitos principales: los que "cuentan como" otro (BUN, LDL directo, calcio
 * iónico, Lp(a) en mg/dL) son alternativas que el laboratorio puede informar en su lugar.
 */
import type { Coding, PlanDefinition, PlanDefinitionAction, ServiceRequest } from '@medplum/fhirtypes';
import {
  BIOMARCADORES,
  PANEL_DISPLAY,
  type Biomarcador,
  type NivelLaboratorio,
  type PanelBiomarcador,
} from '../config/biomarcadores.js';
import { FUENTE_CKM } from '../config/ckm.js';
import { PLAN_LABORATORIO_RUTINA_URL, PLAN_LABORATORIO_RUTINA_VERSION, SYSTEM } from '../fhir/identifiers.js';

const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';
const SNOMED_LABORATORIO = '108252007';

export const NIVELES: readonly NivelLaboratorio[] = ['esencial', 'extensivo'];
export const PANELES = Object.keys(PANEL_DISPLAY) as PanelBiomarcador[];

/** Los códigos del analito: el principal (LOINC, o local de SOM) y sus LOINC equivalentes. */
export function codingsBiomarcador(b: Biomarcador): Coding[] {
  return [
    { system: b.sistema === 'som' ? SYSTEM.biomarker : LOINC, code: b.codigo, display: b.nombre },
    ...(b.codigosEquivalentes ?? []).map((code) => ({ system: LOINC, code, display: b.nombre })),
  ];
}

/** Los analitos que se piden: los de esos niveles (y paneles), sin las alternativas. */
export function analitosDelPedido(niveles: readonly NivelLaboratorio[], paneles?: readonly PanelBiomarcador[]): Biomarcador[] {
  return BIOMARCADORES.filter(
    (b) => niveles.includes(b.nivel) && !b.cuentaComo && (!paneles?.length || paneles.includes(b.panel)),
  );
}

/** Los analitos agrupados por panel, en el orden del catálogo. */
export function porPanel(analitos: readonly Biomarcador[]): Array<{ panel: PanelBiomarcador; analitos: Biomarcador[] }> {
  return PANELES.map((panel) => ({ panel, analitos: analitos.filter((b) => b.panel === panel) })).filter(
    (g) => g.analitos.length > 0,
  );
}

const PLURAL: Record<NivelLaboratorio, string> = { esencial: 'esenciales', extensivo: 'extensivos' };

/** La plantilla del pedido estándar de un nivel (PlanDefinition `order-set`). */
export function construirPlanDefinitionLaboratorio(nivel: NivelLaboratorio): PlanDefinition {
  const grupos: PlanDefinitionAction[] = porPanel(analitosDelPedido([nivel])).map(({ panel, analitos }) => ({
    id: panel,
    title: PANEL_DISPLAY[panel],
    code: [{ coding: [{ system: SYSTEM.panelBiomarcador, code: panel, display: PANEL_DISPLAY[panel] }] }],
    groupingBehavior: 'logical-group',
    selectionBehavior: 'any',
    action: analitos.map((b) => ({ id: b.slug, title: b.nombre, code: [{ coding: codingsBiomarcador(b) }] })),
  }));
  return {
    resourceType: 'PlanDefinition',
    url: PLAN_LABORATORIO_RUTINA_URL[nivel],
    version: PLAN_LABORATORIO_RUTINA_VERSION,
    name: nivel === 'esencial' ? 'LaboratorioRutinaEsenciales' : 'LaboratorioRutinaExtensivos',
    title: `Laboratorio de rutina — ${PLURAL[nivel]}`,
    status: 'active',
    type: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/plan-definition-type', code: 'order-set', display: 'Order Set' }],
    },
    description:
      nivel === 'esencial'
        ? 'Laboratorio de rutina de base de la salud cardiovascular de la mujer en la menopausia: perfil básico ' +
          'y riesgo cardiovascular, función renal y electrolitos. Lo ejecuta el bot som-pedir-laboratorio.'
        : 'Laboratorio extensivo, según la clínica y el estadío cardio-reno-metabólico: biomarcadores cardíacos, ' +
          'inflamación y riesgo residual, hematología, eje endocrino y menopausia. Lo ejecuta el bot som-pedir-laboratorio.',
    useContext: [
      {
        code: { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'focus' },
        valueCodeableConcept: { text: 'Salud cardiovascular de la mujer en la menopausia (síndrome CKM)' },
      },
    ],
    relatedArtifact: [{ type: 'citation', citation: FUENTE_CKM }],
    action: grupos,
  };
}

export interface EntradaPedidoLaboratorio {
  /** "Patient/123". */
  pacienteRef: string;
  /** Default: solo esenciales. */
  niveles?: NivelLaboratorio[];
  /** Solo estos paneles (default: todos los del nivel). */
  paneles?: PanelBiomarcador[];
  /** "Practitioner/…": quien pide. */
  solicitanteRef?: string;
}

/** Valida y completa la entrada del bot (undefined + motivo si no sirve). */
export function normalizarEntradaPedido(
  e: Partial<EntradaPedidoLaboratorio> | undefined,
): { ok: true; entrada: EntradaPedidoLaboratorio } | { ok: false; mensaje: string } {
  if (!e?.pacienteRef || !/^Patient\/[^/]+$/.test(e.pacienteRef)) {
    return { ok: false, mensaje: 'Falta el paciente (Patient/…).' };
  }
  const niveles = e.niveles?.length ? [...new Set(e.niveles)] : (['esencial'] as NivelLaboratorio[]);
  const invalido = niveles.find((n) => !NIVELES.includes(n));
  if (invalido) {
    return { ok: false, mensaje: `Nivel desconocido: ${invalido} (esencial | extensivo).` };
  }
  const paneles = [...new Set(e.paneles ?? [])];
  const panelInvalido = paneles.find((p) => !PANELES.includes(p));
  if (panelInvalido) {
    return { ok: false, mensaje: `Panel desconocido: ${panelInvalido}.` };
  }
  if (e.solicitanteRef && !/^Practitioner\/[^/]+$/.test(e.solicitanteRef)) {
    return { ok: false, mensaje: 'El solicitante tiene que ser un Practitioner/….' };
  }
  if (analitosDelPedido(niveles, paneles).length === 0) {
    return { ok: false, mensaje: 'Esos paneles no tienen estudios de ese nivel.' };
  }
  return {
    ok: true,
    entrada: {
      pacienteRef: e.pacienteRef,
      niveles: NIVELES.filter((n) => niveles.includes(n)),
      paneles: PANELES.filter((p) => paneles.includes(p)),
      ...(e.solicitanteRef ? { solicitanteRef: e.solicitanteRef } : {}),
    },
  };
}

/** El pedido del día: el mismo paciente, niveles y paneles el mismo día es el mismo pedido. */
export function claveRequisicion(e: EntradaPedidoLaboratorio, fecha: string): string {
  const paciente = e.pacienteRef.split('/')[1];
  const niveles = (e.niveles?.length ? e.niveles : ['esencial']).join('+');
  return `${paciente}:${fecha.slice(0, 10)}:${niveles}${e.paneles?.length ? `:${e.paneles.join('+')}` : ''}`;
}

/** Un ServiceRequest por analito, agrupados por `requisition`. */
export function construirPedidoLaboratorio(e: EntradaPedidoLaboratorio, ahora: string): ServiceRequest[] {
  const requisicion = claveRequisicion(e, ahora);
  return analitosDelPedido(e.niveles?.length ? e.niveles : ['esencial'], e.paneles).map((b) => ({
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    priority: 'routine',
    identifier: [{ system: SYSTEM.pedidoLaboratorio, value: `${requisicion}:${b.slug}` }],
    requisition: { system: SYSTEM.pedidoLaboratorio, value: requisicion },
    instantiatesCanonical: [`${PLAN_LABORATORIO_RUTINA_URL[b.nivel]}|${PLAN_LABORATORIO_RUTINA_VERSION}`],
    category: [
      { coding: [{ system: SNOMED, code: SNOMED_LABORATORIO, display: 'Laboratory procedure' }] },
      { coding: [{ system: SYSTEM.panelBiomarcador, code: b.panel, display: PANEL_DISPLAY[b.panel] }] },
    ],
    code: { coding: codingsBiomarcador(b), text: b.nombre },
    subject: { reference: e.pacienteRef },
    authoredOn: ahora,
    ...(e.solicitanteRef ? { requester: { reference: e.solicitanteRef } } : {}),
  }));
}

/** El pedido en texto, un panel por línea (para imprimir o mandar). */
export function textoPedido(analitos: readonly Biomarcador[]): string {
  return porPanel(analitos)
    .map(({ panel, analitos: a }) => `• ${PANEL_DISPLAY[panel]}: ${a.map((b) => b.nombre).join(', ')}.`)
    .join('\n');
}

/** El aviso a la paciente por Mensajes. */
export function mensajePedidoPaciente(analitos: readonly Biomarcador[]): string {
  return [
    `Tu equipo te pidió un laboratorio de rutina (${analitos.length} estudios):`,
    textoPedido(analitos),
    'Seguí las indicaciones de preparación de tu laboratorio (ayuno y horario). Cuando tengas los resultados, ' +
      'envianos el PDF desde el portal: «+» → Enviar estudios en PDF.',
  ].join('\n\n');
}
