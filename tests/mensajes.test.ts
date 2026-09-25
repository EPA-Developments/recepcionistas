import { describe, it, expect } from 'vitest';
import type { Communication, Patient, Resource } from '@medplum/fhirtypes';
import { SYSTEM } from '../src/fhir/identifiers.js';
import {
  cambiarEstado,
  cargarConversaciones,
  cargarMensajes,
  contarSinLeer,
  marcarLeidos,
  motivoDe,
  responder,
} from '../src/lib/mensajes.js';
import { fakeMedplum } from './fake-medplum.js';

const RECEPCION = { reference: 'Practitioner/recepcion', display: 'Recepción SOM' };

const ana: Patient = { resourceType: 'Patient', id: 'ana', name: [{ given: ['Ana'], family: 'García' }] };
const beto: Patient = { resourceType: 'Patient', id: 'beto', name: [{ given: ['Beto'], family: 'Suárez' }] };

/** Conversación + mensajes tal como los crea el portal (`app/src/fhir/mensajes.ts`). */
function conversacion(
  id: string,
  paciente: Patient,
  motivo: string,
  mensajes: Array<{ texto: string; sent: string; delPaciente?: boolean; status?: Communication['status'] }>,
  status: Communication['status'] = 'in-progress',
): Resource[] {
  const ref = { reference: `Patient/${paciente.id}` };
  return [
    {
      resourceType: 'Communication',
      id,
      status,
      subject: ref,
      sender: ref,
      recipient: [ref],
      topic: { coding: [{ system: SYSTEM.motivoMensaje, code: motivo }], text: motivo },
    },
    ...mensajes.map(
      (m, i): Communication => ({
        resourceType: 'Communication',
        id: `${id}-m${i}`,
        status: m.status ?? 'in-progress',
        subject: ref,
        sender: m.delPaciente === false ? RECEPCION : ref,
        recipient: m.delPaciente === false ? [ref] : [],
        partOf: [{ reference: `Communication/${id}` }],
        sent: m.sent,
        payload: [{ contentString: m.texto }],
      }),
    ),
  ];
}

const novedad: Communication = {
  resourceType: 'Communication',
  id: 'novedad-1',
  status: 'in-progress',
  subject: { reference: 'Patient/ana' },
  recipient: [{ reference: 'Patient/ana' }],
  sent: '2026-09-25T12:00:00.000Z',
  category: [{ coding: [{ system: SYSTEM.notificacion, code: 'general' }] }],
  payload: [{ contentString: 'Aviso' }],
};

function escenario() {
  return fakeMedplum([
    ana,
    beto,
    novedad,
    ...conversacion('c-turnos', ana, 'turnos', [
      { texto: 'Quiero pasar mi turno al viernes.', sent: '2026-09-25T10:00:00.000Z' },
    ]),
    ...conversacion('c-pagos', beto, 'pagos', [
      { texto: 'No veo mi seña.', sent: '2026-09-24T09:00:00.000Z', status: 'completed' },
      { texto: 'Ya la registramos.', sent: '2026-09-24T09:30:00.000Z', delPaciente: false },
    ]),
    ...conversacion('c-vieja', ana, 'otro', [{ texto: 'Gracias!', sent: '2026-09-01T10:00:00.000Z' }], 'completed'),
  ]);
}

describe('bandeja de Mensajes', () => {
  it('lista las abiertas: más activa primero, con paciente, motivo, último mensaje y sin leer; sin Novedades', async () => {
    const { medplum } = escenario();
    const abiertas = await cargarConversaciones(medplum, 'abiertas');
    expect(abiertas.map((c) => [c.paciente, c.motivo.titulo, c.sinLeer])).toEqual([
      ['Ana García', 'Turnos y reservas', 1],
      ['Beto Suárez', 'Pagos y membresía', 0],
    ]);
    expect(abiertas[1]?.ultimo?.payload?.[0]?.contentString).toBe('Ya la registramos.');
    expect(abiertas[0]?.pacienteRef).toBe('Patient/ana');

    const cerradas = await cargarConversaciones(medplum, 'cerradas');
    expect(cerradas.map((c) => c.topic.id)).toEqual(['c-vieja']);
  });

  it('el motivo sale del código del portal; una conversación del equipo sin código muestra su texto', () => {
    expect(
      motivoDe({
        resourceType: 'Communication',
        status: 'in-progress',
        topic: { coding: [{ system: SYSTEM.motivoMensaje, code: 'consulta-salud' }] },
      }),
    ).toEqual({
      code: 'consulta-salud',
      titulo: 'Consulta sobre mi salud',
    });
    expect(
      motivoDe({ resourceType: 'Communication', status: 'in-progress', topic: { text: 'Firmar consentimiento' } }),
    ).toEqual({
      titulo: 'Firmar consentimiento',
    });
  });

  it('al abrirla marca leídos los mensajes del paciente (no los propios)', async () => {
    const { medplum } = escenario();
    expect(await contarSinLeer(medplum)).toBe(2); // c-turnos + c-vieja
    const turnos = (await cargarConversaciones(medplum, 'abiertas'))[0]!;
    const mensajes = await cargarMensajes(medplum, turnos.topic);
    expect(await marcarLeidos(medplum, mensajes)).toBe(1);
    const leido = (await cargarMensajes(medplum, turnos.topic))[0]!;
    expect(leido.status).toBe('completed');
    expect(leido.received).toBeDefined();
    expect(await contarSinLeer(medplum)).toBe(1);
  });

  it('responder: mensaje en la conversación + una Novedad para el paciente (una por tanda)', async () => {
    const { medplum, todos } = escenario();
    const turnos = (await cargarConversaciones(medplum, 'abiertas'))[0]!;
    const previos = await cargarMensajes(medplum, turnos.topic);

    const primera = await responder(
      medplum,
      RECEPCION,
      turnos.topic,
      '  Listo, te lo pasamos al viernes 9:30.  ',
      previos,
    );
    expect(primera.mensaje).toMatchObject({
      status: 'in-progress',
      subject: { reference: 'Patient/ana' },
      sender: RECEPCION,
      recipient: [{ reference: 'Patient/ana' }],
      partOf: [{ reference: 'Communication/c-turnos' }],
      payload: [{ contentString: 'Listo, te lo pasamos al viernes 9:30.' }],
    });
    expect(primera.aviso).toMatchObject({
      subject: { reference: 'Patient/ana' },
      recipient: [{ reference: 'Patient/ana' }],
      category: [{ coding: [{ system: SYSTEM.notificacion, code: 'mensaje-nuevo' }] }],
      about: [{ reference: 'Communication/c-turnos' }],
    });
    expect(primera.aviso?.partOf).toBeUndefined();

    // Segunda respuesta seguida: sin otra Novedad.
    const segunda = await responder(
      medplum,
      RECEPCION,
      turnos.topic,
      '¿Te queda bien?',
      await cargarMensajes(medplum, turnos.topic),
    );
    expect(segunda.aviso).toBeUndefined();
    expect(
      todos<Communication>('Communication').filter((c) => c.category?.[0]?.coding?.[0]?.code === 'mensaje-nuevo'),
    ).toHaveLength(1);

    // La Novedad nunca aparece como conversación.
    expect((await cargarConversaciones(medplum, 'abiertas')).map((c) => c.topic.id)).toEqual(['c-turnos', 'c-pagos']);
    await expect(responder(medplum, RECEPCION, turnos.topic, '   ', [])).rejects.toThrow(/respuesta/);
  });

  it('cerrar y reabrir una conversación', async () => {
    const { medplum } = escenario();
    const turnos = (await cargarConversaciones(medplum, 'abiertas'))[0]!;
    await cambiarEstado(medplum, turnos.topic, 'cerradas');
    expect((await cargarConversaciones(medplum, 'cerradas')).map((c) => c.topic.id)).toEqual(['c-turnos', 'c-vieja']);
    await cambiarEstado(medplum, turnos.topic, 'abiertas');
    expect((await cargarConversaciones(medplum, 'abiertas')).map((c) => c.topic.id)).toContain('c-turnos');
  });
});
