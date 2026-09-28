import { describe, it, expect } from 'vitest';
import type { Communication } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../src/fhir/identifiers.js';
import {
  conEnvioWhatsApp,
  conPendienteWhatsApp,
  construirRespuestaAutomatica,
  decidirEnvioWhatsApp,
  esPendienteWhatsApp,
  pendientesDeReenvio,
  tipoAutomatica,
  yaAvisadoMensajeNuevo,
} from '../src/lib/whatsapp.js';

const H = 3_600_000;
const ahora = new Date('2026-09-26T15:00:00Z');
const hace = (horas: number): string => new Date(ahora.getTime() - horas * H).toISOString();
const REF = { reference: 'Patient/p1' };
const CONV = 'Communication/conv';

function delPaciente(id: string, sent: string): Communication {
  return {
    resourceType: 'Communication',
    id,
    status: 'completed',
    partOf: [{ reference: CONV }],
    subject: REF,
    sender: REF,
    sent,
    payload: [{ contentString: 'Hola' }],
    extension: [
      { url: EXT.canal, valueCode: 'whatsapp' },
      { url: EXT.telefonoWhatsapp, valueString: '+5491122334455' },
    ],
  };
}

function deRecepcion(id: string, sent: string, pendiente = false): Communication {
  const m: Communication = {
    resourceType: 'Communication',
    id,
    status: 'in-progress',
    partOf: [{ reference: CONV }],
    subject: REF,
    sender: { reference: 'Practitioner/ana', display: 'Ana' },
    recipient: [REF],
    sent,
    payload: [{ contentString: `Respuesta ${id}` }],
  };
  return conPendienteWhatsApp(m, pendiente);
}

/** El aviso «tenés una respuesta nueva» como queda en la conversación después de mandarlo. */
function avisoMensajeNuevo(sent: string, envio: { messageSids: string[]; entrega?: 'en-cola' | 'fallido'; motivo?: string }): Communication {
  return conEnvioWhatsApp(
    construirRespuestaAutomatica({ conversacionRef: CONV, pacienteRef: 'Patient/p1', tipo: 'mensaje-nuevo', texto: 'Tenés una respuesta.', ahora: sent }),
    { telefono: '+5491122334455', ...envio },
  );
}

describe('WhatsApp · respuestas de Recepción que esperan la ventana de 24 h', () => {
  it('Pasadas las 24 h, la decisión dice que la ventana está cerrada y a qué número avisar', () => {
    const r = decidirEnvioWhatsApp([delPaciente('a', hace(25))], ahora);
    expect(r).toMatchObject({ enviar: false, canal: 'whatsapp', ventanaCerrada: true, telefono: '+5491122334455' });
    expect(r.enviar === false && r.canal === 'whatsapp' ? r.motivo : '').toMatch(/24 h/);
    // Con la ventana abierta no hay nada de eso.
    expect(decidirEnvioWhatsApp([delPaciente('a', hace(1))], ahora)).toEqual({ enviar: true, telefono: '+5491122334455' });
  });

  it('Marcar y desmarcar una respuesta como pendiente', () => {
    const m = deRecepcion('r', hace(1));
    expect(esPendienteWhatsApp(m)).toBe(false);
    const pendiente = conPendienteWhatsApp(m, true);
    expect(esPendienteWhatsApp(pendiente)).toBe(true);
    expect(esPendienteWhatsApp(m)).toBe(false); // no muta el original
    // Marcar dos veces no duplica; desmarcar deja el mensaje sin la extensión.
    expect(conPendienteWhatsApp(pendiente, true).extension).toHaveLength(1);
    expect(conPendienteWhatsApp(pendiente, false).extension).toBeUndefined();
    // Conserva las demás extensiones (canal, ✓) al desmarcar.
    const enviado = conEnvioWhatsApp(pendiente, { telefono: '+5491122334455', entrega: 'en-cola', messageSids: ['SM1'] });
    expect(conPendienteWhatsApp(enviado, false).extension?.map((e) => e.url)).toEqual([EXT.canal, EXT.telefonoWhatsapp, EXT.estadoEntrega]);
  });

  it('Las pendientes de reenvío: solo las de Recepción marcadas, en orden; ni las del paciente ni las automáticas', () => {
    const hilo = [
      deRecepcion('r2', hace(2), true),
      delPaciente('a', hace(30)),
      deRecepcion('r1', hace(3), true),
      deRecepcion('r0', hace(4)),
      conPendienteWhatsApp(avisoMensajeNuevo(hace(3), { messageSids: ['SM1'], entrega: 'en-cola' }), true),
      conPendienteWhatsApp(delPaciente('b', hace(1)), true),
    ];
    expect(pendientesDeReenvio(hilo).map((m) => m.id)).toEqual(['r1', 'r2']);
    expect(pendientesDeReenvio([])).toEqual([]);
  });

  it('¿Ya se le avisó? Solo cuenta un aviso que Twilio aceptó después de su último mensaje', () => {
    const paciente = delPaciente('a', hace(30));
    const aceptado = avisoMensajeNuevo(hace(2), { messageSids: ['SM1'], entrega: 'en-cola' });
    expect(tipoAutomatica(aceptado)).toBe('mensaje-nuevo');
    expect(yaAvisadoMensajeNuevo([paciente, aceptado])).toBe(true);
    // Antes de su último mensaje: es de otro período.
    expect(yaAvisadoMensajeNuevo([paciente, avisoMensajeNuevo(hace(40), { messageSids: ['SM0'], entrega: 'en-cola' })])).toBe(false);
    // Rechazado por Twilio o nunca intentado (sin secrets): se vuelve a intentar.
    expect(yaAvisadoMensajeNuevo([paciente, avisoMensajeNuevo(hace(2), { messageSids: [], entrega: 'fallido', motivo: 'no tiene WhatsApp' })])).toBe(false);
    expect(yaAvisadoMensajeNuevo([paciente, avisoMensajeNuevo(hace(2), { messageSids: [] })])).toBe(false);
    expect(yaAvisadoMensajeNuevo([paciente])).toBe(false);
    expect(yaAvisadoMensajeNuevo([])).toBe(false);
    expect(aceptado.identifier).toEqual([{ system: SYSTEM.twilioMessageSid, value: 'SM1' }]);
  });
});
