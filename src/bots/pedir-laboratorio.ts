/**
 * Bot · som-pedir-laboratorio — el equipo médico pide el laboratorio de rutina de un
 * paciente con el pedido estándar (esenciales, y extensivos si hace falta).
 *
 * Crea un `ServiceRequest` por analito del catálogo (LOINC), agrupados por `requisition`,
 * y le avisa al paciente por Mensajes qué estudios tiene que hacerse y que después mande el
 * PDF. Lo ejecuta el equipo médico (Recepción NO: su AccessPolicy no incluye este bot).
 *
 * Entrada (`executeBot`):
 *   { "pacienteRef": "Patient/123", "niveles": ["esencial", "extensivo"],
 *     "paneles": ["renal"], "solicitanteRef": "Practitioner/456", "avisar": true }
 * Solo `pacienteRef` es obligatorio: por defecto, los esenciales de todos los paneles.
 *
 * Idempotente: el mismo pedido (paciente, niveles y paneles) el mismo día no se duplica
 * ni se vuelve a avisar.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication, ServiceRequest } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';
import {
  analitosDelPedido,
  claveRequisicion,
  construirPedidoLaboratorio,
  mensajePedidoPaciente,
  normalizarEntradaPedido,
  textoPedido,
  type EntradaPedidoLaboratorio,
} from '../lib/laboratorio-rutina.js';

export interface EntradaPedirLaboratorio extends EntradaPedidoLaboratorio {
  /** Avisar al paciente por Mensajes (default true). */
  avisar?: boolean;
}

export interface ResultadoPedirLaboratorio {
  ok: boolean;
  mensaje?: string;
  /** El `requisition.value` del pedido. */
  requisicion?: string;
  /** true si en esta llamada se creó el pedido; false si ya existía. */
  creado?: boolean;
  serviceRequestIds?: string[];
  /** El pedido en texto, un panel por línea. */
  pedido?: string;
  communicationId?: string;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaPedirLaboratorio>,
): Promise<ResultadoPedirLaboratorio> {
  const norm = normalizarEntradaPedido(event.input);
  if (!norm.ok) {
    return { ok: false, mensaje: norm.mensaje };
  }
  const entrada = norm.entrada;
  const ahora = new Date().toISOString();
  const requisicion = claveRequisicion(entrada, ahora);
  const analitos = analitosDelPedido(entrada.niveles ?? ['esencial'], entrada.paneles);
  const pedido = textoPedido(analitos);

  try {
    await medplum.readResource('Patient', entrada.pacienteRef.split('/')[1] as string);

    const existentes = await medplum.searchResources('ServiceRequest', {
      subject: entrada.pacienteRef,
      requisition: `${SYSTEM.pedidoLaboratorio}|${requisicion}`,
      _count: '200',
    });
    const vigentes = existentes.filter((s) => s.status !== 'revoked' && s.status !== 'entered-in-error');
    if (vigentes.length > 0) {
      return {
        ok: true,
        creado: false,
        requisicion,
        serviceRequestIds: vigentes.map((s) => s.id as string),
        pedido,
        mensaje: 'Ese pedido ya estaba hecho hoy: no se duplica.',
      };
    }

    const creados: ServiceRequest[] = [];
    for (const sr of construirPedidoLaboratorio(entrada, ahora)) {
      creados.push(await medplum.createResource<ServiceRequest>(sr));
    }

    let communicationId: string | undefined;
    if (event.input?.avisar !== false) {
      const aviso = await medplum.createResource<Communication>({
        resourceType: 'Communication',
        status: 'in-progress',
        sent: ahora,
        topic: { text: 'Tu pedido de laboratorio' },
        subject: { reference: entrada.pacienteRef },
        recipient: [{ reference: entrada.pacienteRef }],
        ...(entrada.solicitanteRef ? { sender: { reference: entrada.solicitanteRef } } : {}),
        basedOn: creados.map((s) => ({ reference: `ServiceRequest/${s.id}` })),
        payload: [{ contentString: mensajePedidoPaciente(analitos) }],
      });
      communicationId = aviso.id;
    }

    return {
      ok: true,
      creado: true,
      requisicion,
      serviceRequestIds: creados.map((s) => s.id as string),
      pedido,
      ...(communicationId ? { communicationId } : {}),
      mensaje: `Pedido de laboratorio de rutina: ${creados.length} estudios.`,
    };
  } catch (err) {
    return { ok: false, mensaje: `No se pudo hacer el pedido: ${err instanceof Error ? err.message : String(err)}` };
  }
}
