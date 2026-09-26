import { describe, it, expect } from 'vitest';
import type { Communication, Patient, Task } from '@medplum/fhirtypes';
import { COD, EXT, SYSTEM } from '../src/fhir/identifiers.js';
import { TEXTO_ACUSE } from '../src/config/auto-respuesta.js';
import {
  avisosPendientes,
  busquedaAvisoContacto,
  cargarContactosNuevos,
  claveAvisoContacto,
  construirAvisoContacto,
  datoAviso,
  esAvisoContacto,
  esDemo,
  faltaResponder,
  resolverAviso,
  resolverAvisosDelPaciente,
  resolverContacto,
} from '../src/lib/contactos-whatsapp.js';
import { construirConversacionWhatsApp, construirLeadWhatsApp, construirMensajeEntrante } from '../src/lib/whatsapp.js';
import { cargarAvisos, marcarLeidos } from '../src/lib/mensajes.js';
import { fakeMedplum } from './fake-medplum.js';

const LLEGO = '2026-09-26T13:00:00.000Z';

function aviso(extra: Partial<Parameters<typeof construirAvisoContacto>[0]> = {}): Task {
  return construirAvisoContacto({
    pacienteRef: 'Patient/ana',
    conversacionRef: 'Communication/conv-ana',
    mensajeRef: 'Communication/m-ana',
    telefono: '+5491122334455',
    perfil: '  Ana   ✨ ',
    texto: 'Hola, quería una segunda opinión',
    ahora: LLEGO,
    ...extra,
  });
}

describe('WhatsApp · el aviso de un número nuevo es un Task de Recepción', () => {
  it('Pendiente, uno por número, con el paciente, su conversación y el primer mensaje', () => {
    const t = aviso();
    expect(t).toMatchObject({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      priority: 'routine',
      identifier: [{ system: SYSTEM.avisoRecepcion, value: 'whatsapp-nuevo-contacto-ana' }],
      code: { coding: [{ system: SYSTEM.taskTipo, code: COD.whatsappNuevoContacto }], text: 'Contacto nuevo por WhatsApp' },
      for: { reference: 'Patient/ana' },
      requester: { reference: 'Patient/ana' },
      focus: { reference: 'Communication/conv-ana' },
      reasonReference: { reference: 'Communication/m-ana' },
      authoredOn: LLEGO,
    });
    expect(t.input).toEqual([
      { type: { text: 'telefono' }, valueString: '+5491122334455' },
      { type: { text: 'perfil' }, valueString: 'Ana ✨' },
      { type: { text: 'texto' }, valueString: 'Hola, quería una segunda opinión' },
    ]);
    expect(t.description).toBe(
      'Escribió por WhatsApp un número que no estaba en SOM: Ana ✨ (+54 9 11 2233-4455). Respondele, completale la ficha o marcalo resuelto.',
    );
    expect(esAvisoContacto(t)).toBe(true);
    expect(datoAviso(t, 'perfil')).toBe('Ana ✨');
  });

  it('Sin nombre de perfil ni texto: el número y nada vacío (FHIR no admite strings vacíos)', () => {
    const t = aviso({ perfil: undefined, texto: '  ' });
    expect(t.input).toEqual([{ type: { text: 'telefono' }, valueString: '+5491122334455' }]);
    expect(t.description).toMatch(/SOM: \+54 9 11 2233-4455\./);
  });

  it('La clave hace idempotente la creación (If-None-Exist por identifier)', () => {
    expect(claveAvisoContacto('Patient/ana')).toBe('whatsapp-nuevo-contacto-ana');
    expect(new URLSearchParams(busquedaAvisoContacto('Patient/ana')).get('identifier')).toBe(
      `${SYSTEM.avisoRecepcion}|whatsapp-nuevo-contacto-ana`,
    );
  });

  it('Resolverlo: completado, cómo (codificado), cuándo y quién; sin tocar el original', () => {
    const t = aviso();
    const r = resolverAviso(t, { como: 'ficha-completada', ahora: '2026-09-26T14:00:00.000Z', owner: { reference: 'Practitioner/rec' } });
    expect(r).toMatchObject({
      status: 'completed',
      businessStatus: {
        coding: [{ system: SYSTEM.resolucionAviso, code: 'ficha-completada', display: 'Ficha completada' }],
        text: 'Ficha completada',
      },
      executionPeriod: { end: '2026-09-26T14:00:00.000Z' },
      lastModified: '2026-09-26T14:00:00.000Z',
      owner: { reference: 'Practitioner/rec' },
    });
    expect(resolverAviso(t, { como: 'resuelto', ahora: LLEGO }).owner).toBeUndefined();
    expect(t.status).toBe('requested');
  });

  it('La campanita: solo los pendientes de contacto nuevo, del más nuevo al más viejo', () => {
    const viejo = { ...aviso(), id: 't1' };
    const nuevo = { ...aviso({ pacienteRef: 'Patient/beto', conversacionRef: 'Communication/conv-beto', perfil: undefined, ahora: '2026-09-26T15:00:00.000Z' }), id: 't2' };
    const resuelto = { ...resolverAviso({ ...aviso(), id: 't3' }, { como: 'resuelto', ahora: LLEGO }) };
    const otraTarea: Task = { resourceType: 'Task', id: 't4', status: 'requested', intent: 'order', code: { coding: [{ system: SYSTEM.taskTipo, code: COD.solicitudTurno }] } };
    expect(avisosPendientes([viejo, resuelto, otraTarea, nuevo])).toEqual([
      {
        avisoId: 't2',
        pacienteRef: 'Patient/beto',
        conversacionId: 'conv-beto',
        nombre: '+54 9 11 2233-4455',
        telefono: '+5491122334455',
        texto: 'Hola, quería una segunda opinión',
        sent: '2026-09-26T15:00:00.000Z',
      },
      {
        avisoId: 't1',
        pacienteRef: 'Patient/ana',
        conversacionId: 'conv-ana',
        nombre: 'Ana ✨',
        telefono: '+5491122334455',
        texto: 'Hola, quería una segunda opinión',
        sent: LLEGO,
      },
    ]);
  });

  it('«Sin responder» hasta que le contesta una persona: el acuse automático no cuenta', () => {
    const msj = (id: string, sent: string, extra: Partial<Communication>): Communication => ({
      resourceType: 'Communication',
      id,
      status: 'completed',
      sent,
      ...extra,
    });
    const delContacto = msj('a', '2026-09-26T13:00:00Z', { sender: { reference: 'Patient/ana' } });
    const acuse = msj('b', '2026-09-26T13:00:01Z', {
      sender: { display: 'Segunda Opinión Médica · respuesta automática' },
      extension: [{ url: EXT.autoRespuesta, valueCode: 'acuse' }],
    });
    const deRecepcion = msj('c', '2026-09-26T13:05:00Z', { sender: { reference: 'Practitioner/lau' } });
    const otraVez = msj('d', '2026-09-26T13:10:00Z', { sender: { reference: 'Patient/ana' } });
    expect(faltaResponder([])).toBe(true);
    expect(faltaResponder([acuse, delContacto])).toBe(true);
    expect(faltaResponder([delContacto, acuse, deRecepcion])).toBe(false);
    expect(faltaResponder([otraVez, deRecepcion, acuse, delContacto])).toBe(true); // volvió a escribir
  });

  it('Un aviso de demostración se reconoce (la tarjeta lo dice)', () => {
    expect(esDemo({ meta: { tag: [{ system: SYSTEM.demo, code: 'demo' }] } })).toBe(true);
    expect(esDemo(aviso())).toBe(false);
  });
});

describe('Pestaña WhatsApp · carga y resolución (Medplum)', () => {
  /** Ana escribió por primera vez: lead, conversación, su mensaje, el acuse y el aviso. */
  function contactoNuevo(extra: Array<Patient | Communication | Task> = []) {
    const lead: Patient = { ...construirLeadWhatsApp('+5491122334455', 'Ana ✨'), id: 'ana' };
    const conv: Communication = { ...construirConversacionWhatsApp('Patient/ana'), id: 'conv-ana' };
    const primero: Communication = {
      ...construirMensajeEntrante({
        conversacionRef: 'Communication/conv-ana',
        pacienteRef: 'Patient/ana',
        texto: 'Hola, quería una segunda opinión',
        adjuntos: [],
        messageSid: 'SM1',
        telefono: '+5491122334455',
        inicioContacto: true,
        ahora: LLEGO,
      }),
      id: 'm-ana',
    };
    const acuse: Communication = {
      resourceType: 'Communication',
      id: 'm-acuse',
      status: 'in-progress',
      partOf: [{ reference: 'Communication/conv-ana' }],
      subject: { reference: 'Patient/ana' },
      sender: { display: 'Segunda Opinión Médica · respuesta automática' },
      sent: '2026-09-26T13:00:01.000Z',
      payload: [{ contentString: TEXTO_ACUSE }],
      extension: [{ url: EXT.autoRespuesta, valueCode: 'acuse' }],
    };
    return fakeMedplum([lead, conv, acuse, primero, { ...aviso(), id: 'aviso-ana' }, ...extra]);
  }

  it('Cada tarjeta trae el aviso, el lead (sin ficha), la conversación y sus mensajes en orden', async () => {
    const { medplum } = contactoNuevo();
    const [c, ...resto] = await cargarContactosNuevos(medplum);
    expect(resto).toEqual([]);
    expect(c).toMatchObject({
      pacienteRef: 'Patient/ana',
      nombre: 'Ana ✨',
      perfil: 'Ana ✨',
      telefono: '+5491122334455',
      texto: 'Hola, quería una segunda opinión',
      llego: LLEGO,
      sinFicha: true,
      sinResponder: true, // solo salió el acuse automático
      demo: false,
    });
    expect(c?.aviso.id).toBe('aviso-ana');
    expect(c?.conversacion?.id).toBe('conv-ana');
    expect(c?.paciente?.id).toBe('ana');
    expect(c?.mensajes.map((m) => m.id)).toEqual(['m-ana', 'm-acuse']);
  });

  it('Si la ficha ya tiene nombre real (se completó por otro lado), se muestra ese nombre', async () => {
    const { medplum, todos } = contactoNuevo();
    const [lead] = todos<Patient>('Patient');
    await medplum.updateResource<Patient>({ ...lead!, name: [{ use: 'official', text: 'Ana Gómez' }, ...(lead!.name ?? [])] });
    const [c] = await cargarContactosNuevos(medplum);
    expect(c).toMatchObject({ nombre: 'Ana Gómez', sinFicha: false });
  });

  it('Resolver: una vez; si otra recepcionista ya lo resolvió, no se pisa quién ni cómo', async () => {
    const { medplum } = contactoNuevo();
    const r1 = await resolverContacto(medplum, 'aviso-ana', 'resuelto', { reference: 'Practitioner/lau' });
    expect(r1).toMatchObject({ status: 'completed', owner: { reference: 'Practitioner/lau' }, businessStatus: { text: 'Resuelto' } });
    const r2 = await resolverContacto(medplum, 'aviso-ana', 'ficha-completada', { reference: 'Practitioner/otra' });
    expect(r2).toMatchObject({ owner: { reference: 'Practitioner/lau' }, businessStatus: { text: 'Resuelto' } });
    expect(await cargarContactosNuevos(medplum)).toEqual([]);
  });

  it('Resolver los de un paciente deja los de los demás', async () => {
    const beto = { ...aviso({ pacienteRef: 'Patient/beto', conversacionRef: 'Communication/conv-beto' }), id: 'aviso-beto' };
    const { medplum, todos } = contactoNuevo([beto]);
    expect(await resolverAvisosDelPaciente(medplum, 'Patient/ana', 'ficha-completada')).toBe(1);
    const estados = Object.fromEntries(todos<Task>('Task').map((t) => [t.id, t.status]));
    expect(estados).toEqual({ 'aviso-ana': 'completed', 'aviso-beto': 'requested' });
  });

  it('La campanita sigue hasta que se resuelve (leer la conversación no alcanza)', async () => {
    const { medplum } = contactoNuevo();
    const antes = await cargarAvisos(medplum);
    expect(antes.sinLeer).toBe(1); // el acuse automático no es del paciente
    expect(antes.nuevosContactos.map((a) => [a.avisoId, a.conversacionId, a.nombre])).toEqual([['aviso-ana', 'conv-ana', 'Ana ✨']]);

    await marcarLeidos(medplum, await medplum.searchResources('Communication', { 'part-of': 'Communication/conv-ana' }));
    const leido = await cargarAvisos(medplum);
    expect(leido.sinLeer).toBe(0);
    expect(leido.nuevosContactos).toHaveLength(1);

    await resolverContacto(medplum, 'aviso-ana', 'resuelto');
    expect(await cargarAvisos(medplum)).toEqual({ sinLeer: 0, nuevosContactos: [] });
  });
});
