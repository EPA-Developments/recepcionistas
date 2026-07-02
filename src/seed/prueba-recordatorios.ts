/**
 * Seed de prueba para `bw-recordatorios`.
 *
 *   npm run seed:prueba-recordatorios -- --dry-run   → muestra qué crearía (sin red)
 *   npm run seed:prueba-recordatorios                → upsert en Medplum (.env)
 *
 * Crea/actualiza (idempotente) un paciente de prueba con un TURNO confirmado a
 * ~20h (dispara el recordatorio de 48h). Además limpia las Communication
 * previas de ese paciente, para que cada corrida deje el recordatorio listo
 * para volver a dispararse.
 *
 * Luego, para probar el bot:
 *   npx medplum bot execute bw-recordatorios '{}'
 */
import 'dotenv/config';
import { MedplumClient } from '@medplum/core';
import type { Appointment, Patient } from '@medplum/fhirtypes';
import { EXT } from '../fhir/identifiers.js';

/** Id del paciente de prueba (fijo por defecto; configurable para apuntar a uno real). */
const PATIENT_ID = process.env.PRUEBA_PATIENT_ID ?? '9647fb20-c13a-49c0-b32c-50549bb2c1d9';
/** Sistema de identifier para los recursos de prueba (upsert idempotente). */
const PRUEBA = 'https://segundaopinionmedica.org/fhir/Identifier/prueba';

/** Contacto del paciente (reemplazá por los tuyos para un envío real). */
const TELEFONO = process.env.PRUEBA_TELEFONO ?? '+5491100000000';
const EMAIL = process.env.PRUEBA_EMAIL ?? 'prueba@segundaopinionmedica.org';

function construir(ahora: Date) {
  const inicio = new Date(ahora.getTime() + 20 * 60 * 60_000); // +20h → dentro de la ventana de 48h
  const fin = new Date(inicio.getTime() + 45 * 60_000);

  const appointment: Appointment = {
    resourceType: 'Appointment',
    status: 'booked',
    description: 'Segunda Opinión — Cardiología',
    start: inicio.toISOString(),
    end: fin.toISOString(),
    identifier: [{ system: PRUEBA, value: 'recordatorio-turno' }],
    participant: [{ actor: { reference: `Patient/${PATIENT_ID}` }, status: 'accepted' }],
    extension: [
      { url: EXT.itemTipo, valueCode: 'servicio' },
      { url: EXT.itemCodigo, valueString: 'CARDIOLOGIA' },
    ],
  };

  return { appointment, inicio };
}

/** Upsert por identifier: actualiza si ya existe (PUT con su id) o crea si no (POST). */
async function upsertPorIdentifier<
  T extends { resourceType: string; id?: string; identifier?: { system?: string; value?: string }[] },
>(medplum: MedplumClient, recurso: T): Promise<T> {
  const id = recurso.identifier?.[0];
  const existente = id
    ? await medplum.searchOne(recurso.resourceType as 'Appointment', `identifier=${id.system}|${id.value}`)
    : undefined;
  if (existente?.id) {
    return (await medplum.updateResource({ ...recurso, id: existente.id } as never)) as T;
  }
  return (await medplum.createResource(recurso as never)) as T;
}

/**
 * Devuelve el paciente de prueba SIN pisar datos reales: si ya existe, lo respeta
 * (solo le agrega teléfono/email si le faltan, para poder notificar); si no existe,
 * crea uno de prueba con el id fijo.
 */
async function obtenerPaciente(medplum: MedplumClient): Promise<Patient> {
  const existente = await medplum.readResource('Patient', PATIENT_ID).catch(() => undefined);
  if (existente) {
    const tieneTel = existente.telecom?.some((t) => t.system === 'phone' || t.system === 'sms');
    const tieneMail = existente.telecom?.some((t) => t.system === 'email');
    if (tieneTel && tieneMail) {
      return existente;
    }
    const telecom = [...(existente.telecom ?? [])];
    if (!tieneTel) {
      telecom.push({ system: 'phone', value: TELEFONO });
    }
    if (!tieneMail) {
      telecom.push({ system: 'email', value: EMAIL });
    }
    return medplum.updateResource({ ...existente, telecom });
  }
  return medplum.updateResource({
    resourceType: 'Patient',
    id: PATIENT_ID,
    name: [{ given: ['Paciente'], family: 'Prueba Recordatorios' }],
    telecom: [
      { system: 'phone', value: TELEFONO },
      { system: 'email', value: EMAIL },
    ],
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const ahora = new Date();
  const { appointment, inicio } = construir(ahora);

  console.log('=== Seed de prueba · bw-recordatorios ===');
  console.log(`  • Patient ${PATIENT_ID} (tel/email de respaldo: ${TELEFONO} / ${EMAIL})`);
  console.log(`  • Turno 'booked' a las ${inicio.toLocaleString('es-AR')} (~20h → ventana 48h)`);

  if (dryRun) {
    console.log('\n[dry-run] No se conecta a Medplum. Recursos construidos OK.');
    return;
  }

  const medplum = new MedplumClient({ baseUrl: requireEnv('MEDPLUM_BASE_URL'), fetch });
  await medplum.startClientLogin(requireEnv('MEDPLUM_CLIENT_ID'), requireEnv('MEDPLUM_CLIENT_SECRET'));
  console.log('\nConectado a Medplum.');

  const p = await obtenerPaciente(medplum);
  const destinatario = [
    p.telecom?.find((t) => t.system === 'phone' || t.system === 'sms')?.value,
    p.telecom?.find((t) => t.system === 'email')?.value,
  ].filter(Boolean);
  console.log(`  ✓ Patient ${p.id} → ${destinatario.join(' / ') || '(sin teléfono/email!)'}`);
  const appt = await upsertPorIdentifier(medplum, appointment);
  console.log(`  ✓ Appointment ${appt.id} (${appt.start})`);

  // Limpiar Communication previas de este paciente, para re-disparar los avisos.
  const previas = await medplum.searchResources('Communication', `recipient=Patient/${PATIENT_ID}&_count=200`);
  for (const c of previas) {
    if (c.id) {
      await medplum.deleteResource('Communication', c.id);
    }
  }
  console.log(`  ✓ Communication previas borradas (${previas.length})`);

  console.log('\nListo. Probá el bot:');
  console.log("  npx medplum bot execute bw-recordatorios '{}'");
}

function requireEnv(nombre: string): string {
  const v = process.env[nombre];
  if (!v) {
    throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example).`);
  }
  return v;
}

main().catch((err) => {
  console.error('Seed de prueba falló:', err);
  process.exitCode = 1;
});
