/**
 * Reserva por agenda de profesional (R-22): el turno ocupa las franjas libres del
 * profesional (y, en presencial, las del consultorio) sin crear franjas duplicadas; dos
 * reservas simultáneas no toman la misma hora; al cancelar, las franjas vuelven a libre.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { Appointment, Consent, Practitioner, Resource, ResourceType, Schedule, Slot } from '@medplum/fhirtypes';
import { handler as reservar, type EntradaReserva } from '../src/bots/reservar-turno.js';
import { handler as cambiarEstado } from '../src/bots/estado-turno.js';
import { handler as generarAgenda } from '../src/bots/generar-agenda.js';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { construirConsentimientoTeleconsulta } from '../src/lib/teleconsulta.js';
import { fakeMedplum } from './fake-medplum.js';

// Una cardióloga de prueba con agenda: lunes 18–20 (teleconsulta y presencial en el Consultorio 1).
vi.mock('../src/config/medicos.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/config/medicos.js')>();
  const MEDICOS = [
    {
      codigo: 'MED_TEST',
      nombre: 'Dra. Prueba',
      matricula: 'MN 1',
      esDirector: false,
      especialidad: { snomed: '394579002', snomedDisplay: 'Cardiology', nombre: 'Cardiología' },
      servicios: ['CARDIOLOGIA', 'CONSULTA_PB100D'],
      modalidades: ['presencial', 'teleconsulta'],
      seguimientoPB100D: true,
      disponibilidad: [{ dia: 1, desde: '18:00', hasta: '20:00' }],
      consultorioCodigo: 'R_CONSULTORIO_1',
    },
  ];
  const porCodigo = new Map(MEDICOS.map((m) => [m.codigo, m]));
  return {
    ...real,
    MEDICOS,
    MEDICOS_POR_CODIGO: porCodigo,
    getMedico: (c: string) => porCodigo.get(c),
    medicosPara: (s: string, m: string) => MEDICOS.filter((x) => x.servicios.includes(s) && x.modalidades.includes(m)),
    medicosSeguimientoPB100D: () => MEDICOS,
  };
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T12:00:00Z')); // viernes 25/09, 09:00 en Buenos Aires
});
afterAll(() => vi.useRealTimers());

const LUNES_18 = '2026-09-28T18:00:00-03:00';
const LUNES_1830 = '2026-09-28T18:30:00-03:00';

function ev<T>(input: T): BotEvent<T> {
  return { input, secrets: {}, bot: { reference: 'Bot/test' }, contentType: 'application/json' } as BotEvent<T>;
}

function entorno(extra: Resource[] = []) {
  const consultorio: Schedule = {
    resourceType: 'Schedule',
    id: 'sch-consultorio-1',
    identifier: [{ system: SYSTEM.recursoCodigo, value: 'SCH_R_CONSULTORIO_1' }],
    actor: [{ display: 'Consultorio 1' }],
  };
  const agenda: Schedule = {
    resourceType: 'Schedule',
    id: 'sch-med-test',
    identifier: [{ system: SYSTEM.medico, value: 'SCH_MED_TEST' }],
    actor: [{ display: 'Dra. Prueba' }],
    extension: [{ url: EXT.profesional, valueString: 'MED_TEST' }],
  };
  const practitioner: Practitioner = {
    resourceType: 'Practitioner',
    id: 'pract-test',
    identifier: [{ system: SYSTEM.medico, value: 'MED_TEST' }],
    name: [{ text: 'Dra. Prueba' }],
  };
  const consentimiento: Consent = { ...construirConsentimientoTeleconsulta('Patient/p1', new Date('2026-09-20T10:00:00Z')), id: 'consent-tele' };
  const f = fakeMedplum([
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Ana'], family: 'Pérez' }] },
    consultorio,
    agenda,
    practitioner,
    consentimiento,
    ...extra,
  ]);
  const slots = () => f.todos<Slot>('Slot');
  const deAgenda = (id: string) => slots().filter((s) => s.schedule?.reference === `Schedule/${id}`);
  const turno = (id: string | undefined) => f.todos<Appointment>('Appointment').find((a) => a.id === id)!;
  return { ...f, slots, deAgenda, turno };
}

/** Una franja libre materializada (como las que deja el seed o el cron). */
function franjaLibre(inicio: string, fin: string): Slot {
  return {
    resourceType: 'Slot',
    id: `slot-${inicio}`,
    identifier: [{ system: SYSTEM.medico, value: `MED_TEST@${inicio}` }],
    schedule: { reference: 'Schedule/sch-med-test' },
    status: 'free',
    start: inicio,
    end: fin,
    extension: [{ url: EXT.profesional, valueString: 'MED_TEST' }],
    meta: { versionId: '1' },
  };
}

const base: EntradaReserva = { pacienteRef: 'Patient/p1', servicioCodigo: 'CARDIOLOGIA' };

describe('Reserva por franja elegida (slotId)', () => {
  it('ocupa esa franja (no crea otra), suma al profesional y no toca ningún consultorio', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    const r = await reservar(e.medplum, ev({ ...base, slotId: `slot-${LUNES_18}` }));
    expect(r.ok).toBe(true);
    expect(r.creado).toBe(true);
    expect(r).toMatchObject({ modalidad: 'teleconsulta', medicoCodigo: 'MED_TEST', slotIds: [`slot-${LUNES_18}`] });

    const deLaDra = e.deAgenda('sch-med-test');
    expect(deLaDra).toHaveLength(1); // la misma franja, ahora ocupada
    expect(deLaDra[0]?.status).toBe('busy');
    expect(e.deAgenda('sch-consultorio-1')).toEqual([]); // la teleconsulta no ocupa consultorio

    const t = e.turno(r.appointmentId);
    expect(t.status).toBe('pending'); // con cargo: tentativo hasta la seña
    expect(t.start).toBe(new Date(LUNES_18).toISOString());
    expect(t.participant?.map((p) => p.actor?.reference)).toEqual(['Patient/p1', 'Practitioner/pract-test']);
    expect(t.extension?.find((x) => x.url === EXT.profesional)?.valueString).toBe('MED_TEST');
    expect(t.extension?.find((x) => x.url === EXT.recursoFisico)).toBeUndefined();
    expect(t.slot).toEqual([{ reference: `Slot/slot-${LUNES_18}` }]);
  });

  it('la misma franja no se puede reservar dos veces', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    await reservar(e.medplum, ev({ ...base, slotId: `slot-${LUNES_18}` }));
    const r = await reservar(e.medplum, ev({ ...base, slotId: `slot-${LUNES_18}` }));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.regla)).toEqual(['R-22']);
    expect(r.bloqueos[0]?.mensaje).toMatch(/ya está ocupado/);
    expect(e.todos<Appointment>('Appointment')).toHaveLength(1);
  });

  it('dos reservas simultáneas: la segunda pierde por la escritura condicional (If-Match) y no pisa nada', async () => {
    const e = entorno([franjaLibre(LUNES_18, LUNES_1830)]);
    // La reserva lee la franja (versión 1)… y en el medio otra reserva la toma (versión 2).
    const busquedaReal = e.medplum.searchResources.bind(e.medplum);
    const vieja = await e.medplum.readResource('Slot', `slot-${LUNES_18}`);
    await e.medplum.updateResource<Slot>({ ...vieja, status: 'busy' });
    vi.spyOn(e.medplum, 'searchResources').mockImplementation((async (tipo: ResourceType, query?: unknown) =>
      tipo === 'Slot' ? [vieja] : busquedaReal(tipo, query as string)) as typeof e.medplum.searchResources);
    vi.spyOn(e.medplum, 'readResource').mockImplementation((async (tipo: string, id: string) =>
      tipo === 'Slot' && id === vieja.id ? vieja : e.todos(tipo as 'Slot').find((r) => r.id === id)) as typeof e.medplum.readResource);

    const r = await reservar(e.medplum, ev({ ...base, slotId: `slot-${LUNES_18}` }));
    expect(r.ok).toBe(false);
    expect(r.bloqueos[0]).toMatchObject({ regla: 'R-22' });
    expect(e.todos<Appointment>('Appointment')).toEqual([]);
    vi.restoreAllMocks();
    expect(e.slots()[0]?.status).toBe('busy'); // la de la otra reserva sigue ocupada
  });
});

describe('Reserva por profesional + horario (sin franja materializada)', () => {
  it('teleconsulta dentro de su disponibilidad: materializa la franja ocupada con su identifier', async () => {
    const e = entorno();
    const r = await reservar(e.medplum, ev({ ...base, medicoCodigo: 'MED_TEST', inicio: LUNES_1830, modalidad: 'teleconsulta' }));
    expect(r.ok).toBe(true);
    const [franja] = e.deAgenda('sch-med-test');
    expect(franja).toMatchObject({ status: 'busy', identifier: [{ system: SYSTEM.medico, value: `MED_TEST@${LUNES_1830}` }] });
    expect(new Date(franja!.start!).toISOString()).toBe(new Date(LUNES_1830).toISOString());
    // El cron no la vuelve a crear libre: ya existe con ese identifier.
    await generarAgenda(e.medplum, ev({ dias: 7 }));
    expect(e.deAgenda('sch-med-test').filter((s) => s.identifier?.[0]?.value === `MED_TEST@${LUNES_1830}`)).toHaveLength(1);
    expect(e.deAgenda('sch-med-test').find((s) => s.identifier?.[0]?.value === `MED_TEST@${LUNES_1830}`)?.status).toBe('busy');
  });

  it('fuera de su disponibilidad (martes) => bloqueo R-22', async () => {
    const e = entorno();
    const r = await reservar(e.medplum, ev({ ...base, medicoCodigo: 'MED_TEST', inicio: '2026-09-29T18:00:00-03:00', modalidad: 'teleconsulta' }));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-22' && /no atiende en ese horario/.test(b.mensaje))).toBe(true);
    expect(e.slots()).toEqual([]);
  });

  it('una consulta que no atiende (Neurología) => bloqueo R-22', async () => {
    const e = entorno();
    const r = await reservar(e.medplum, ev({ ...base, servicioCodigo: 'NEUROLOGIA', medicoCodigo: 'MED_TEST', inicio: LUNES_18, modalidad: 'teleconsulta' }));
    expect(r.ok).toBe(false);
    expect(r.bloqueos.some((b) => b.regla === 'R-22' && /no atiende teleconsulta de neurología/i.test(b.mensaje))).toBe(true);
  });

  it('presencial: ocupa su franja y la del consultorio del profesional; al cancelar, las dos vuelven a libre', async () => {
    const e = entorno();
    const r = await reservar(e.medplum, ev({ ...base, medicoCodigo: 'MED_TEST', inicio: LUNES_18, modalidad: 'presencial' }));
    expect(r.ok).toBe(true);
    expect(r.modalidad).toBe('presencial');
    expect(e.deAgenda('sch-med-test').map((s) => s.status)).toEqual(['busy']);
    expect(e.deAgenda('sch-consultorio-1').map((s) => s.status)).toEqual(['busy']);
    const t = e.turno(r.appointmentId);
    expect(t.slot).toHaveLength(2);
    expect(t.extension?.find((x) => x.url === EXT.recursoFisico)?.valueString).toBe('R_CONSULTORIO_1');

    await cambiarEstado(e.medplum, ev({ appointmentId: t.id!, estado: 'cancelled' }));
    expect(e.slots().map((s) => s.status)).toEqual(['free', 'free']);
    expect(e.slots()).toHaveLength(2); // nada se borra: siguen siendo la agenda
  });

  it('un profesional desconocido => bloqueo R-22', async () => {
    const e = entorno();
    const r = await reservar(e.medplum, ev({ ...base, medicoCodigo: 'MED_NADIE', inicio: LUNES_18 }));
    expect(r.ok).toBe(false);
    expect(r.bloqueos[0]).toMatchObject({ regla: 'R-22', mensaje: 'El profesional no existe.' });
  });
});

describe('Reserva por recurso (camino de la app de Recepción, sin profesional)', () => {
  it('ocupa la franja libre materializada del consultorio en vez de crear otra', async () => {
    const libre: Slot = {
      resourceType: 'Slot',
      id: 'slot-c1',
      identifier: [{ system: SYSTEM.recursoCodigo, value: `R_CONSULTORIO_1|${LUNES_18}` }],
      schedule: { reference: 'Schedule/sch-consultorio-1' },
      status: 'free',
      start: LUNES_18,
      end: LUNES_1830,
      extension: [{ url: EXT.recursoFisico, valueString: 'R_CONSULTORIO_1' }],
    };
    const e = entorno([libre]);
    const r = await reservar(e.medplum, ev({ ...base, recursoCodigo: 'R_CONSULTORIO_1', inicio: LUNES_18 }));
    expect(r.ok).toBe(true);
    expect(e.deAgenda('sch-consultorio-1')).toHaveLength(1);
    expect(e.deAgenda('sch-consultorio-1')[0]).toMatchObject({ id: 'slot-c1', status: 'busy' });
  });

  it('sin franja materializada la crea ocupada (como antes), con identifier para no duplicarla después', async () => {
    const e = entorno();
    const r = await reservar(e.medplum, ev({ ...base, recursoCodigo: 'R_CONSULTORIO_1', inicio: LUNES_18 }));
    expect(r.ok).toBe(true);
    const [s] = e.deAgenda('sch-consultorio-1');
    expect(s).toMatchObject({ status: 'busy', identifier: [{ system: SYSTEM.recursoCodigo, value: `R_CONSULTORIO_1|${LUNES_18}` }] });
  });
});

describe('Cron som-generar-agenda', () => {
  it('materializa los horarios libres de la disponibilidad y es idempotente', async () => {
    const e = entorno();
    const r1 = await generarAgenda(e.medplum, ev({ dias: 7 }));
    expect(r1.profesionales).toEqual([{ codigo: 'MED_TEST', franjas: 4 }]); // lunes 18, 18:30, 19, 19:30
    expect(e.deAgenda('sch-med-test').map((s) => s.status)).toEqual(['free', 'free', 'free', 'free']);
    const r2 = await generarAgenda(e.medplum, ev({ dias: 7 }));
    expect(r2.profesionales[0]?.franjas).toBe(4);
    expect(e.deAgenda('sch-med-test')).toHaveLength(4);
  });
});
