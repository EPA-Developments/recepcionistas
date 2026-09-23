/**
 * Ejemplo del contrato con la app del paciente: `docs/ejemplos/glp1-paciente.json`.
 * Lo generan los bots reales (sobre un Medplum en memoria) y este test verifica que
 * el archivo siga igual a lo que producen hoy. Si cambia el contrato a propósito:
 *   ACTUALIZAR_EJEMPLOS=1 npx vitest run tests/glp1-ejemplo.test.ts
 * y avisar al portal (EPA-Developments/app), que lo usa como fixture.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Bundle, Resource, Schedule, Task } from '@medplum/fhirtypes';
import { handler as inscribir } from '../src/bots/glp1-inscribir.js';
import { handler as planificar } from '../src/bots/glp1-plan.js';
import { handler as reservar } from '../src/bots/reservar-turno.js';
import { SYSTEM } from '../src/fhir/identifiers.js';
import { fakeMedplum } from './fake-medplum.js';

const ARCHIVO = new URL('../docs/ejemplos/glp1-paciente.json', import.meta.url);
const AHORA = '2026-09-23T12:00:00.000Z';
const ev = (input: unknown) => ({ input, secrets: {} }) as never;

async function generar(): Promise<Bundle> {
  const schedule: Schedule = {
    resourceType: 'Schedule',
    id: 'schedule-consultorio-1',
    actor: [{ display: 'Consultorio 1' }],
    identifier: [{ system: SYSTEM.recursoCodigo, value: 'SCH_R_CONSULTORIO_1' }],
  };
  const { medplum, todos } = fakeMedplum([
    { resourceType: 'Patient', id: 'paciente-ejemplo', name: [{ given: ['Ana'], family: 'Pérez' }] },
    schedule,
  ]);
  // Recepción inscribe → el médico indica (DM2, retinopatía, peso basal) → Recepción agenda el basal.
  await inscribir(medplum, ev({ pacienteRef: 'Patient/paciente-ejemplo' }));
  const plan = await planificar(
    medplum,
    ev({
      pacienteRef: 'Patient/paciente-ejemplo',
      fechaInicio: '2026-10-05',
      molecula: 'Semaglutida',
      indicacion: 'dm2',
      titulacion: [
        { dosis: '0,25 mg semanal', semanas: 4 },
        { dosis: '0,5 mg semanal', semanas: 4 },
        { dosis: '1 mg semanal', semanas: 0, terapeutica: true },
      ],
      retinopatia: true,
      pesoBasalKg: 92,
    }),
  );
  expect(plan.ok).toBe(true);
  const basal = todos<Task>('Task').find((t) => t.input?.some((i) => i.type?.text === 'semana' && i.valueInteger === 0))!;
  const turno = await reservar(
    medplum,
    ev({
      pacienteRef: 'Patient/paciente-ejemplo',
      servicioCodigo: 'CONTROL_GLP1',
      recursoCodigo: 'R_CONSULTORIO_1',
      inicio: '2026-09-30T10:00:00-03:00',
      tareaId: basal.id,
    }),
  );
  expect(turno.creado).toBe(true);

  // Lo que lee la app del paciente (sin Slot, Communication ni Schedule).
  const recursos: Resource[] = (['CarePlan', 'Goal', 'Task', 'ServiceRequest', 'Appointment'] as const).flatMap((t) => todos(t));
  return {
    resourceType: 'Bundle',
    type: 'collection',
    meta: { tag: [{ code: 'ejemplo', display: 'Generado por los bots de recepcionistas (tests/glp1-ejemplo.test.ts)' }] },
    entry: recursos.map((resource) => ({ fullUrl: `${resource.resourceType}/${resource.id}`, resource })),
  };
}

describe('Ejemplo GLP-1 para la app del paciente', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(AHORA));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('docs/ejemplos/glp1-paciente.json coincide con lo que generan los bots', async () => {
    const generado = JSON.stringify(await generar(), null, 2) + '\n';
    if (process.env.ACTUALIZAR_EJEMPLOS) {
      writeFileSync(ARCHIVO, generado);
    }
    expect(JSON.parse(generado)).toEqual(JSON.parse(readFileSync(ARCHIVO, 'utf8')));
  });
});
