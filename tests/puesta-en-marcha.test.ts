import { describe, expect, it } from 'vitest';
import { INSTRUMENTOS_PB100D } from '../src/config/instrumentos-pb100d.js';
import { MEDICOS } from '../src/config/medicos.js';
import { ACCESS_POLICIES, BOTS_RECEPCION, NOMBRE_POLICY_PACIENTE, POLICY_PACIENTE_PORTAL } from '../src/fhir/access-policies.js';
import {
  AGENDAS_DEL_SEED,
  ARREGLO_DEFAULT_POLICY,
  ARREGLO_DEPLOY,
  ARREGLO_SECRETS,
  ARREGLO_SEED,
  ARREGLO_SEMBRAR,
  PLAN_DEFINITIONS_DEL_SEED,
  RECURSOS_DEL_MONOREPO,
  SECRETS_ESPERADOS,
  agruparChequeos,
  evaluarPuestaEnMarcha,
  resumirPuestaEnMarcha,
  type EstadoServidor,
} from '../src/lib/puesta-en-marcha.js';

/** Un proyecto con todo cargado. */
function completo(): EstadoServidor {
  return {
    projectId: 'proyecto-som',
    nombreProyecto: 'Segunda Opinión Médica',
    bots: [...BOTS_RECEPCION],
    botsEsperados: [...BOTS_RECEPCION],
    policies: ACCESS_POLICIES.map((p, i) => ({ ...p, id: `policy-${i}` })),
    questionnaireUrls: [...INSTRUMENTOS_PB100D.map((q) => q.url!), ...RECURSOS_DEL_MONOREPO.filter((r) => r.tipo === 'Questionnaire').map((r) => r.url)],
    planDefinitionUrls: [...PLAN_DEFINITIONS_DEL_SEED.map((p) => p.url), ...RECURSOS_DEL_MONOREPO.filter((r) => r.tipo === 'PlanDefinition').map((r) => r.url)],
    practitionerCodigos: MEDICOS.map((m) => m.codigo),
    agendas: [...AGENDAS_DEL_SEED],
    secrets: SECRETS_ESPERADOS.map((s) => s.nombre),
    defaultPatientPolicyId: `policy-${ACCESS_POLICIES.findIndex((p) => p.name === NOMBRE_POLICY_PACIENTE)}`,
  };
}

describe('Puesta en marcha — chequeo', () => {
  it('con todo cargado, todo ok y listo para la prueba de punta a punta', () => {
    const chequeos = evaluarPuestaEnMarcha(completo());
    expect(chequeos.filter((c) => c.estado !== 'ok')).toEqual([]);
    expect(resumirPuestaEnMarcha(chequeos)).toMatchObject({ atencion: 0, falta: 0, listo: true, arreglos: [] });
    expect(agruparChequeos(chequeos).map(([g]) => g)).toEqual(['Proyecto', 'Bots', 'Roles', 'Catálogo', 'Plan (monorepo)', 'Secrets']);
  });

  it('un proyecto vacío: falta todo, con el comando que lo arregla, en orden', () => {
    const chequeos = evaluarPuestaEnMarcha({
      projectId: 'proyecto-som',
      bots: [],
      botsEsperados: [...BOTS_RECEPCION],
      policies: [],
      questionnaireUrls: [],
      planDefinitionUrls: [],
      practitionerCodigos: [],
      agendas: [],
      secrets: [],
    });
    const r = resumirPuestaEnMarcha(chequeos);
    expect(r.listo).toBe(false);
    expect(r.arreglos).toEqual([ARREGLO_DEPLOY, ARREGLO_SEED, ARREGLO_SEMBRAR, ARREGLO_SECRETS]);
    expect(chequeos.find((c) => c.grupo === 'Bots')).toMatchObject({ estado: 'falta', titulo: `Faltan ${BOTS_RECEPCION.length} de ${BOTS_RECEPCION.length} bots` });
    // Cada rol del repo falta con el seed como arreglo.
    expect(chequeos.filter((c) => c.grupo === 'Roles')).toHaveLength(ACCESS_POLICIES.length);
    expect(chequeos.filter((c) => c.grupo === 'Roles').every((c) => c.estado === 'falta' && c.arreglo === ARREGLO_SEED)).toBe(true);
    // Los instrumentos del equipo nombran los que faltan.
    expect(chequeos.find((c) => c.titulo.includes('instrumentos'))).toMatchObject({ estado: 'falta', detalle: expect.stringContaining('pb100d-stop-bang-v1') });
    // Lo del monorepo se arregla allá.
    expect(chequeos.filter((c) => c.grupo === 'Plan (monorepo)').map((c) => c.arreglo)).toEqual([ARREGLO_SEMBRAR, ARREGLO_SEMBRAR, ARREGLO_SEMBRAR]);
    // Secrets: los obligatorios faltan, los opcionales son atención; nunca se ven valores.
    const secrets = chequeos.filter((c) => c.grupo === 'Secrets');
    expect(secrets.filter((c) => c.estado === 'falta').map((c) => c.titulo)).toEqual(SECRETS_ESPERADOS.filter((s) => s.obligatorio).map((s) => s.nombre));
    expect(secrets.filter((c) => c.estado === 'atencion').map((c) => c.titulo)).toEqual(SECRETS_ESPERADOS.filter((s) => !s.obligatorio).map((s) => s.nombre));
  });

  it('una policy atrasada respecto del repo es atención (npm run seed), no falta', () => {
    const estado = completo();
    estado.policies = estado.policies.map((p) =>
      p.name === NOMBRE_POLICY_PACIENTE ? { ...p, resource: (p.resource ?? []).filter((r) => !['Schedule', 'Slot'].includes(r.resourceType ?? '')) } : p,
    );
    const chequeos = evaluarPuestaEnMarcha(estado);
    const portal = chequeos.find((c) => c.grupo === 'Roles' && c.titulo === NOMBRE_POLICY_PACIENTE);
    expect(portal).toMatchObject({ estado: 'atencion', arreglo: ARREGLO_SEED, detalle: expect.stringMatching(/le faltan 2 entradas/) });
    expect(resumirPuestaEnMarcha(chequeos)).toMatchObject({ falta: 0, atencion: 1, listo: true, arreglos: [ARREGLO_SEED] });
  });

  it('el default patient access policy tiene que apuntar a la policy del portal', () => {
    const sinDefault = { ...completo(), defaultPatientPolicyId: undefined };
    expect(evaluarPuestaEnMarcha(sinDefault).find((c) => c.titulo.startsWith('Default patient'))).toMatchObject({
      estado: 'atencion',
      arreglo: ARREGLO_DEFAULT_POLICY,
      detalle: expect.stringMatching(/No está seteada/),
    });
    const otra = { ...completo(), defaultPatientPolicyId: 'policy-0' };
    expect(evaluarPuestaEnMarcha(otra).find((c) => c.titulo.startsWith('Default patient'))).toMatchObject({ estado: 'atencion', detalle: expect.stringMatching(/otra policy/) });
    // Sin la policy del portal en el servidor no hay chequeo del default (ya falta la policy).
    const sinPortal = { ...completo(), policies: ACCESS_POLICIES.filter((p) => p.name !== NOMBRE_POLICY_PACIENTE) };
    expect(evaluarPuestaEnMarcha(sinPortal).some((c) => c.titulo.startsWith('Default patient'))).toBe(false);
    expect(evaluarPuestaEnMarcha(sinPortal).find((c) => c.titulo === POLICY_PACIENTE_PORTAL.name)).toMatchObject({ estado: 'falta' });
  });

  it('dos nombres con el mismo id en medplum.config.json: un deploy pisó a otro bot', () => {
    const estado = completo();
    estado.idsConfig = { 'som-solicitar-turno': 'fa209611', 'som-solicitar': 'fa209611', 'som-alta-paciente': 'abc', 'som-limpiar-demo': '' };
    const chequeos = evaluarPuestaEnMarcha(estado);
    expect(chequeos.find((c) => c.titulo.startsWith('Un solo bot'))).toMatchObject({
      estado: 'falta',
      titulo: 'Un solo bot (fa209611) con 2 nombres',
      detalle: expect.stringMatching(/som-solicitar-turno y som-solicitar/),
      arreglo: ARREGLO_DEPLOY,
    });
    expect(resumirPuestaEnMarcha(chequeos).listo).toBe(false);
    // Ids vacíos (bots todavía no deployados) no cuentan como repetidos.
    expect(evaluarPuestaEnMarcha({ ...completo(), idsConfig: { a: '', b: '' } }).filter((c) => c.titulo.startsWith('Un solo bot'))).toEqual([]);
  });

  it('faltan un profesional y una agenda: los nombra', () => {
    const estado = completo();
    estado.practitionerCodigos = estado.practitionerCodigos.filter((c) => c !== 'MED_GOLD');
    estado.agendas = estado.agendas.filter((a) => a !== 'SCH_MED_GOLD');
    const chequeos = evaluarPuestaEnMarcha(estado);
    expect(chequeos.find((c) => c.titulo.includes('profesionales'))).toMatchObject({ estado: 'falta', detalle: 'MED_GOLD', arreglo: ARREGLO_SEED });
    expect(chequeos.find((c) => c.titulo.includes('agendas'))).toMatchObject({ estado: 'falta', detalle: 'SCH_MED_GOLD' });
  });

  it('las constantes cubren lo que el seed y los bots necesitan', () => {
    expect(AGENDAS_DEL_SEED).toHaveLength(7);
    expect(SECRETS_ESPERADOS.map((s) => s.nombre)).toEqual(expect.arrayContaining(['TWILIO_ACCOUNT_SID', 'MERCADOPAGO_ACCESS_TOKEN', 'JITSI_BASE_URL', 'PORTAL_BASE_URL']));
    expect(new Set(SECRETS_ESPERADOS.map((s) => s.nombre)).size).toBe(SECRETS_ESPERADOS.length);
    expect(RECURSOS_DEL_MONOREPO.map((r) => r.url)).toContain('https://epa-bienestar.ar/fhir/PlanDefinition/pb100d-ckm');
  });
});
