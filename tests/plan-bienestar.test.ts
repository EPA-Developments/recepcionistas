import { describe, it, expect } from 'vitest';
import type { BotEvent } from '@medplum/core';
import type { CarePlan } from '@medplum/fhirtypes';
import {
  DIAS_PLAN_BIENESTAR,
  construirCarePlanBienestar,
  esFechaValida,
  periodoPlanBienestar,
  sumarDias,
} from '../src/lib/plan-bienestar.js';
import { handler as inscribir, type EntradaInscribirBienestar } from '../src/bots/bienestar-inscribir.js';
import { BOT_BIENESTAR_INSCRIBIR, COD, SYSTEM } from '../src/fhir/identifiers.js';
import { BOTS_RECEPCION } from '../src/fhir/access-policies.js';
import { fakeMedplum } from './fake-medplum.js';

describe('Plan Bienestar · 100 días — período', () => {
  it('fin = inicio + 100 días (cruza meses y años bisiestos)', () => {
    expect(DIAS_PLAN_BIENESTAR).toBe(100);
    expect(periodoPlanBienestar('2026-09-24')).toEqual({ start: '2026-09-24', end: '2027-01-02' });
    expect(sumarDias('2028-02-01', 100)).toBe('2028-05-11');
  });

  it('valida fechas AAAA-MM-DD reales', () => {
    expect(esFechaValida('2026-09-24')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('24/09/2026')).toBe(false);
    expect(esFechaValida(undefined)).toBe(false);
  });

  it('el CarePlan tiene el shape que detecta el portal (category care-plans|plan-bienestar-100)', () => {
    const cp = construirCarePlanBienestar('Patient/p1', '2026-09-24');
    expect(cp.status).toBe('active');
    expect(cp.subject?.reference).toBe('Patient/p1');
    expect(cp.category?.[0]?.coding?.[0]).toMatchObject({
      system: 'https://segundaopinionmedica.org/fhir/CodeSystem/care-plans',
      code: 'plan-bienestar-100',
    });
    expect(cp.period).toEqual({ start: '2026-09-24', end: '2027-01-02' });
  });
});

describe('Bot som-bienestar-inscribir', () => {
  const evento = (input: EntradaInscribirBienestar) =>
    ({ input, secrets: {} }) as unknown as BotEvent<EntradaInscribirBienestar>;

  it('crea el plan una sola vez (idempotente) y devuelve el período', async () => {
    const { medplum, todos } = fakeMedplum([{ resourceType: 'Patient', id: 'p1' }]);
    const r1 = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-10-01' }));
    expect(r1).toMatchObject({ ok: true, creado: true, inicio: '2026-10-01', fin: '2027-01-09' });
    const r2 = await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-11-01' }));
    expect(r2).toMatchObject({ ok: true, creado: false, carePlanId: r1.carePlanId, inicio: '2026-10-01' });
    const planes = todos<CarePlan>('CarePlan').filter((c) =>
      c.category?.some((cc) => cc.coding?.some((x) => x.system === SYSTEM.planCuidado && x.code === COD.planBienestar100)),
    );
    expect(planes).toHaveLength(1);
  });

  it('rechaza paciente inexistente o fecha inválida', async () => {
    const { medplum } = fakeMedplum([]);
    expect((await inscribir(medplum, evento({ pacienteRef: 'Patient/nadie' }))).ok).toBe(false);
    expect((await inscribir(medplum, evento({ pacienteRef: 'Patient/p1', inicio: '2026-13-01' }))).ok).toBe(false);
    expect((await inscribir(medplum, evento({ pacienteRef: 'nadie' }))).ok).toBe(false);
  });

  it('Recepción puede ejecutarlo', () => {
    expect(BOTS_RECEPCION as readonly string[]).toContain(BOT_BIENESTAR_INSCRIBIR);
  });
});
