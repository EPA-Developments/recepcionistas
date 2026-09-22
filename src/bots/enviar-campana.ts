/**
 * Bot · som-enviar-campana — CRM: envía una campaña a un segmento.
 *
 * Recorre los miembros del segmento (Group con identifier `SYSTEM.segmento`),
 * personaliza el mensaje (`{nombre}`) y lo envía por el canal elegido, dejando una
 * Communication por destinatario con el identifier de la campaña (tracking de
 * enviados / respuestas). Idempotente por destinatario: si ese paciente ya tiene
 * la campaña enviada o encolada, no se repite (reintentar es seguro).
 *
 * - email → SES (`medplum.sendEmail`; el bot necesita membership admin).
 * - whatsapp → queda en `preparation`: con la WABA, los mensajes de marketing
 *   salen solo como plantilla aprobada por Meta (envío por plantilla pendiente).
 *
 * Input (no es un recurso FHIR): ver `EntradaCampania` en `src/lib/crm.ts`.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Communication } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import {
  contactoCampania,
  esSegmento,
  personalizar,
  validarCampania,
  type EntradaCampania,
} from '../lib/crm.js';

export interface ResultadoCampania {
  ok: boolean;
  campania: string;
  total: number;
  /** Emails enviados de verdad. */
  enviados: number;
  /** WhatsApp encolados (`preparation`) hasta tener plantilla aprobada. */
  pendientes: number;
  /** Pacientes que ya tenían esta campaña enviada o encolada (no se repite). */
  yaEnviados: number;
  sinContacto: number;
  fallidos: number;
  mensaje: string;
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaCampania>,
): Promise<ResultadoCampania> {
  const input = event.input;
  const r: ResultadoCampania = {
    ok: false,
    campania: input?.campaniaId ?? '',
    total: 0,
    enviados: 0,
    pendientes: 0,
    yaEnviados: 0,
    sinContacto: 0,
    fallidos: 0,
    mensaje: '',
  };
  const v = validarCampania(input);
  if (!v.ok) {
    return { ...r, mensaje: v.error ?? 'Entrada inválida.' };
  }
  const canal = input.canal ?? 'email';
  const group = await medplum.readResource('Group', input.groupId);
  if (!esSegmento(group)) {
    return { ...r, mensaje: `El Group "${group.name ?? group.id}" no es un segmento del CRM.` };
  }
  const miembros = group.member ?? [];
  r.total = miembros.length;

  for (const m of miembros) {
    const ref = m.entity?.reference;
    if (!ref?.startsWith('Patient/')) {
      continue;
    }
    const p = await medplum.readResource('Patient', ref.split('/')[1]!).catch(() => undefined);
    if (!p) {
      r.fallidos++;
      continue;
    }
    const pacienteRef = `Patient/${p.id}`;

    // Idempotencia: ya enviada (completed) o encolada (preparation) → no se repite.
    const previa = await medplum.searchOne(
      'Communication',
      `identifier=${SYSTEM.campania}|${input.campaniaId}&recipient=${pacienteRef}&status=completed,preparation`,
    );
    if (previa) {
      r.yaEnviados++;
      continue;
    }

    const destino = contactoCampania(p, canal);
    if (!destino) {
      r.sinContacto++;
      continue;
    }
    const cuerpo = personalizar(input.cuerpo, p);

    let status: Communication['status'] = 'preparation';
    if (canal === 'email') {
      try {
        await medplum.sendEmail({
          to: destino,
          subject: input.asunto ?? 'Segunda Opinión Médica',
          text: cuerpo,
          ...(input.from ? { from: input.from } : {}),
        });
        status = 'completed';
        r.enviados++;
      } catch (err) {
        console.error('som-enviar-campana: SES falló:', err instanceof Error ? err.message : err);
        status = 'entered-in-error';
        r.fallidos++;
      }
    } else {
      r.pendientes++;
    }

    await medplum.createResource<Communication>({
      resourceType: 'Communication',
      status,
      identifier: [{ system: SYSTEM.campania, value: input.campaniaId }],
      category: [{ coding: [{ system: SYSTEM.categoriaComunicacion, code: 'campania', display: 'Campaña' }] }],
      medium: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode',
              code: canal === 'email' ? 'EMAILWRIT' : 'WRITTEN',
              display: canal,
            },
          ],
        },
      ],
      subject: { reference: pacienteRef },
      recipient: [{ reference: pacienteRef }],
      sent: new Date().toISOString(),
      payload: [{ contentString: cuerpo }],
      extension: [{ url: EXT.canal, valueCode: canal }],
    });
  }

  return {
    ...r,
    ok: true,
    mensaje:
      `Campaña "${input.campaniaId}" a "${group.name ?? group.id}": ${r.enviados} enviados, ` +
      `${r.pendientes} WhatsApp pendientes de plantilla, ${r.yaEnviados} ya la tenían, ` +
      `${r.sinContacto} sin contacto, ${r.fallidos} fallidos.`,
  };
}
