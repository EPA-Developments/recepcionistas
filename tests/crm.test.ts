import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication, Group, GroupCharacteristic, Patient } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import {
  contactoCampania,
  cumpleCriterios,
  esSegmento,
  loincsRequeridos,
  parsearCriterios,
  perfilCrm,
  personalizar,
  validarCampania,
  type EntradaCampania,
} from '../src/lib/crm.js';
import { handler as segmentosHandler } from '../src/bots/recomputar-segmentos.js';
import { handler as campanaHandler } from '../src/bots/enviar-campana.js';
import { handler as altaHandler, type EntradaAltaPaciente } from '../src/bots/alta-paciente.js';

const LDL = '13457-7';

function rasgo(code: string, valor: string, exclude = false): GroupCharacteristic {
  return { code: { coding: [{ system: SYSTEM.rasgoSegmento, code }] }, valueCodeableConcept: { coding: [{ code: valor }] }, exclude };
}

function biomarcador(loinc: string, comparator: '<' | '<=' | '>=' | '>', value: number, exclude = false): GroupCharacteristic {
  return {
    code: { coding: [{ system: SYSTEM.rasgoSegmento, code: 'biomarcador' }, { system: 'http://loinc.org', code: loinc }] },
    valueQuantity: { comparator, value },
    exclude,
  };
}

function segmento(characteristic: GroupCharacteristic[], id = 'g1'): Group {
  return {
    resourceType: 'Group',
    id,
    type: 'person',
    actual: true,
    name: `Segmento ${id}`,
    identifier: [{ system: SYSTEM.segmento, value: id }],
    characteristic,
  };
}

function paciente(
  id: string,
  datos: { origen?: string; perfil?: string; ciclo?: string; email?: string; telefono?: string } = {},
): Patient {
  return {
    resourceType: 'Patient',
    id,
    name: [{ given: ['Ana'], family: 'Pérez' }],
    extension: [
      ...(datos.origen ? [{ url: EXT.origenLead, valueString: datos.origen }] : []),
      ...(datos.perfil ? [{ url: EXT.perfilInteres, valueCode: datos.perfil }] : []),
      ...(datos.ciclo ? [{ url: EXT.cicloVidaCliente, valueCode: datos.ciclo }] : []),
    ],
    telecom: [
      ...(datos.email ? [{ system: 'email' as const, value: datos.email }] : []),
      ...(datos.telefono ? [{ system: 'phone' as const, value: datos.telefono }] : []),
    ],
  };
}

describe('CRM · criterios de segmento', () => {
  it('Parsea origen del lead, perfil, ciclo y biomarcador', () => {
    const { criterios, invalidos } = parsearCriterios(
      segmento([
        rasgo('origen-lead', 'Instagram'),
        rasgo('perfil-interes', 'prevencion'),
        rasgo('ciclo-vida', 'lead', true),
        biomarcador(LDL, '>', 190),
      ]),
    );
    expect(invalidos).toBe(0);
    expect(criterios).toEqual([
      { tipo: 'origen', valor: 'instagram', excluir: false },
      { tipo: 'perfil', valor: 'prevencion', excluir: false },
      { tipo: 'ciclo', valor: 'lead', excluir: true },
      { tipo: 'biomarcador', loinc: LDL, comparador: '>', umbral: 190, excluir: false },
    ]);
    expect(loincsRequeridos(criterios)).toEqual([LDL]);
  });

  it('Rasgos desconocidos o incompletos cuentan como inválidos (no se ignoran)', () => {
    const { criterios, invalidos } = parsearCriterios(
      segmento([
        rasgo('gate-terapia', 'x'),
        { code: { coding: [{ system: SYSTEM.rasgoSegmento, code: 'origen-lead' }] }, exclude: false },
        { code: { coding: [{ system: SYSTEM.rasgoSegmento, code: 'biomarcador' }] }, valueQuantity: { value: 3 }, exclude: false },
      ]),
    );
    expect(criterios).toEqual([]);
    expect(invalidos).toBe(3);
  });

  it('Lee el perfil del paciente (extensiones o tag de ciclo) sin distinguir mayúsculas', () => {
    expect(perfilCrm(paciente('p1', { origen: ' Facebook ', perfil: 'Prevencion' }))).toEqual({
      origen: 'facebook',
      perfil: 'prevencion',
      ciclo: undefined,
    });
    const conTag: Patient = { resourceType: 'Patient', meta: { tag: [{ system: SYSTEM.cicloVidaCliente, code: 'paciente' }] } };
    expect(perfilCrm(conTag).ciclo).toBe('paciente');
  });

  it('Evalúa TODOS los criterios; exclude niega; biomarcador sin dato no cumple', () => {
    const { criterios } = parsearCriterios(segmento([rasgo('origen-lead', 'instagram'), biomarcador(LDL, '>', 190, true)]));
    const ig = perfilCrm(paciente('p1', { origen: 'instagram' }));
    expect(cumpleCriterios(criterios, ig, new Map([[LDL, 150]]))).toBe(true);
    expect(cumpleCriterios(criterios, ig, new Map([[LDL, 200]]))).toBe(false);
    expect(cumpleCriterios(criterios, ig)).toBe(true); // sin LDL: "no > 190" se cumple
    expect(cumpleCriterios(criterios, perfilCrm(paciente('p2', { origen: 'tiktok' })))).toBe(false);
  });

  it('Solo los Group con identifier de segmento son segmentos', () => {
    expect(esSegmento(segmento([]))).toBe(true);
    expect(esSegmento({ resourceType: 'Group', type: 'person', actual: true })).toBe(false);
  });
});

describe('CRM · campañas (lógica pura)', () => {
  it('Valida la entrada', () => {
    expect(validarCampania({ groupId: 'g', cuerpo: 'hola', campaniaId: 'c1' }).ok).toBe(true);
    expect(validarCampania({ groupId: 'g', cuerpo: ' ', campaniaId: 'c1' }).ok).toBe(false);
    expect(validarCampania({ groupId: 'g', cuerpo: 'x', campaniaId: 'c1', canal: 'sms' as never }).ok).toBe(false);
  });

  it('Contacto por canal y personalización de {nombre}', () => {
    const p = paciente('p1', { email: 'ana@ejemplo.com', telefono: '+5491111111111' });
    expect(contactoCampania(p, 'email')).toBe('ana@ejemplo.com');
    expect(contactoCampania(p, 'whatsapp')).toBe('+5491111111111');
    expect(personalizar('Hola {nombre}, {nombre}!', p)).toBe('Hola Ana, Ana!');
  });
});

describe('Bot som-recomputar-segmentos', () => {
  function fakeMedplum(pacientes: Patient[], ldl: Record<string, number>, grupos: Group[] = []) {
    const actualizados: Group[] = [];
    const medplum = {
      async *searchResourcePages(tipo: string) {
        yield tipo === 'Patient' ? pacientes : grupos;
      },
      searchResources: async (_tipo: string, q: Record<string, string>) => {
        const v = ldl[q.patient ?? ''];
        return v === undefined ? [] : [{ resourceType: 'Observation', valueQuantity: { value: v } }];
      },
      updateResource: async (g: Group) => {
        actualizados.push(g);
        return g;
      },
    } as unknown as MedplumClient;
    return { medplum, actualizados };
  }

  it('Materializa los miembros: leads de Instagram sin LDL > 190', async () => {
    const pacientes = [
      paciente('p1', { origen: 'instagram' }),
      paciente('p2', { origen: 'instagram' }),
      paciente('p3', { origen: 'facebook' }),
      paciente('p4', { origen: 'Instagram ' }),
    ];
    const { medplum, actualizados } = fakeMedplum(pacientes, { 'Patient/p1': 150, 'Patient/p2': 200 });
    const g = segmento([rasgo('origen-lead', 'instagram'), biomarcador(LDL, '>', 190, true)]);

    const r = await segmentosHandler(medplum, { input: g } as unknown as BotEvent<Group>);

    expect(r.errores).toEqual([]);
    expect(r.segmentos).toEqual([{ nombre: 'Segmento g1', miembros: 2 }]);
    expect(actualizados[0]?.member?.map((m) => m.entity.reference)).toEqual(['Patient/p1', 'Patient/p4']);
    expect(actualizados[0]?.quantity).toBe(2);
  });

  it('Cron: recalcula solo los segmentos y NO toca uno con criterios inválidos', async () => {
    const valido = segmento([rasgo('origen-lead', 'instagram')], 'ok');
    const invalido = segmento([rasgo('gate-terapia', 'x')], 'mal');
    const otroGroup: Group = { resourceType: 'Group', id: 'x', type: 'person', actual: true };
    const { medplum, actualizados } = fakeMedplum([paciente('p1', { origen: 'instagram' })], {}, [valido, invalido, otroGroup]);

    const r = await segmentosHandler(medplum, { input: undefined } as unknown as BotEvent<Group | undefined>);

    expect(r.segmentos).toEqual([{ nombre: 'Segmento ok', miembros: 1 }]);
    expect(r.errores.map((e) => e.nombre)).toEqual(['Segmento mal']);
    expect(actualizados.map((g) => g.id)).toEqual(['ok']);
  });
});

describe('Bot som-enviar-campana', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fakeMedplum(group: Group, pacientes: Patient[], opts: { yaEnviadaA?: string; falla?: string } = {}) {
    const creadas: Communication[] = [];
    const sendEmail = vi.fn(async (m: { to: string }) => {
      if (m.to === opts.falla) {
        throw new Error('SES down');
      }
      return {};
    });
    const medplum = {
      readResource: async (tipo: string, id: string) => (tipo === 'Group' ? group : pacientes.find((p) => p.id === id)),
      searchOne: async (_tipo: string, q: string) =>
        opts.yaEnviadaA && q.includes(`recipient=${opts.yaEnviadaA}&`) ? { resourceType: 'Communication' } : undefined,
      createResource: async (c: Communication) => {
        creadas.push(c);
        return c;
      },
      sendEmail,
    } as unknown as MedplumClient;
    return { medplum, creadas, sendEmail };
  }

  const evento = (input: EntradaCampania) => ({ input, secrets: {} }) as unknown as BotEvent<EntradaCampania>;

  it('Email: envía, saltea a quien ya la tiene y cuenta sin contacto / fallidos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pacientes = [
      paciente('p1', { email: 'ana@ejemplo.com' }),
      paciente('p2'),
      paciente('p3', { email: 'ya@ejemplo.com' }),
      paciente('p4', { email: 'falla@ejemplo.com' }),
    ];
    const g = { ...segmento([]), member: pacientes.map((p) => ({ entity: { reference: `Patient/${p.id}` } })) };
    const { medplum, creadas, sendEmail } = fakeMedplum(g, pacientes, { yaEnviadaA: 'Patient/p3', falla: 'falla@ejemplo.com' });

    const r = await campanaHandler(medplum, evento({ groupId: 'g1', canal: 'email', cuerpo: 'Hola {nombre}', campaniaId: 'c1' }));

    expect(r).toMatchObject({ ok: true, total: 4, enviados: 1, yaEnviados: 1, sinContacto: 1, fallidos: 1, pendientes: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(creadas.map((c) => c.status)).toEqual(['completed', 'entered-in-error']);
    expect(creadas[0]?.identifier?.[0]).toEqual({ system: SYSTEM.campania, value: 'c1' });
    expect(creadas[0]?.payload?.[0]?.contentString).toBe('Hola Ana');
  });

  it('WhatsApp: queda pendiente de plantilla (preparation), sin envío', async () => {
    const p = paciente('p1', { telefono: '+5491111111111' });
    const g = { ...segmento([]), member: [{ entity: { reference: 'Patient/p1' } }] };
    const { medplum, creadas, sendEmail } = fakeMedplum(g, [p]);

    const r = await campanaHandler(medplum, evento({ groupId: 'g1', canal: 'whatsapp', cuerpo: 'Hola', campaniaId: 'c2' }));

    expect(r).toMatchObject({ ok: true, enviados: 0, pendientes: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(creadas[0]?.status).toBe('preparation');
  });

  it('No manda campañas a un Group que no es segmento', async () => {
    const g: Group = { resourceType: 'Group', id: 'x', type: 'person', actual: true, member: [{ entity: { reference: 'Patient/p1' } }] };
    const { medplum, creadas } = fakeMedplum(g, [paciente('p1', { email: 'ana@ejemplo.com' })]);

    const r = await campanaHandler(medplum, evento({ groupId: 'x', cuerpo: 'Hola', campaniaId: 'c3' }));

    expect(r.ok).toBe(false);
    expect(creadas).toEqual([]);
  });
});

describe('Bot som-alta-paciente · origen del lead', () => {
  function fakeMedplum(existente?: Patient) {
    const escritos: Patient[] = [];
    const medplum = {
      searchOne: async () => existente,
      createResource: async (p: Patient) => {
        escritos.push(p);
        return { ...p, id: 'nuevo' };
      },
      updateResource: async (p: Patient) => {
        escritos.push(p);
        return p;
      },
    } as unknown as MedplumClient;
    return { medplum, escritos };
  }
  const evento = (input: EntradaAltaPaciente) => ({ input, secrets: {} }) as unknown as BotEvent<EntradaAltaPaciente>;
  const origenDe = (p?: Patient) => p?.extension?.find((e) => e.url === EXT.origenLead)?.valueString;

  it('Guarda el origen normalizado al crear', async () => {
    const { medplum, escritos } = fakeMedplum();
    const r = await altaHandler(medplum, evento({ nombre: 'Ana Pérez', dni: '30111222', origenLead: ' Instagram ' }));
    expect(r.creado).toBe(true);
    expect(origenDe(escritos[0])).toBe('instagram');
  });

  it('No pisa el origen de un paciente existente (primer contacto)', async () => {
    const { medplum, escritos } = fakeMedplum(paciente('p1', { origen: 'facebook' }));
    await altaHandler(medplum, evento({ nombre: 'Ana Pérez', dni: '30111222', origenLead: 'instagram' }));
    expect(origenDe(escritos[0])).toBe('facebook');
  });
});
