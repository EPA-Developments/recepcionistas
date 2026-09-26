/**
 * Bot · Alta de paciente (registrar cliente).
 *
 * Crea (o actualiza, sin duplicar) el recurso `Patient` con la demografía mínima:
 * nombre, DNI, teléfono y email. NO da acceso al portal — eso es un paso aparte
 * (`som-invitar-paciente`). Deduplica por DNI y, si no hay, por email/teléfono (el
 * teléfono en cualquiera de sus formas, sin unir a dos personas con DNI distinto: así
 * completa el contacto que llegó por WhatsApp). Al completar la ficha de un contacto
 * nuevo por WhatsApp, su aviso a Recepción (pestaña WhatsApp) se resuelve solo.
 *
 * No requiere admin del proyecto: la recepción ya tiene permiso de escritura sobre
 * `Patient` por su AccessPolicy.
 */
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { ContactPoint, Patient } from '@medplum/fhirtypes';
import { EXT, SYSTEM } from '../fhir/identifiers.js';
import { resolverAvisosDelPaciente } from '../lib/contactos-whatsapp.js';
import { normalizarValor } from '../lib/crm.js';
import { partirNombre, validarEmail } from '../lib/onboarding.js';
import { aE164AR, variantesTelefonoAR } from '../lib/whatsapp.js';

export interface EntradaAltaPaciente {
  /** Nombre completo (se parte en nombre + apellido). Alternativa a firstName/lastName. */
  nombre?: string;
  firstName?: string;
  lastName?: string;
  dni?: string;
  email?: string;
  telefono?: string;
  /** Etiqueta comercial (p. ej. 'PUBLICO'). */
  tipoCliente?: string;
  /**
   * Origen del lead para el embudo del CRM (red social / `utm_source`: instagram,
   * facebook, tiktok, google, …). Se guarda el PRIMERO: no pisa uno existente.
   */
  origenLead?: string;
}

export interface ResultadoAltaPaciente {
  ok: boolean;
  mensaje?: string;
  patientId?: string;
  /** true si se creó; false si se actualizó uno existente. */
  creado?: boolean;
  /** Avisos de contacto nuevo por WhatsApp que quedaron resueltos (ya tiene ficha). */
  avisosResueltos?: number;
}

function telecom(telefono?: string, email?: string): ContactPoint[] {
  const t: ContactPoint[] = [];
  if (telefono) {
    t.push({ system: 'phone', value: telefono.trim(), use: 'mobile' });
  }
  if (email) {
    t.push({ system: 'email', value: email.trim() });
  }
  return t;
}

/** Busca un paciente existente por DNI, luego email, luego teléfono. */
async function buscarExistente(
  medplum: MedplumClient,
  e: EntradaAltaPaciente,
): Promise<Patient | undefined> {
  if (e.dni) {
    const p = await medplum.searchOne('Patient', `identifier=${SYSTEM.dni}|${e.dni.trim()}`);
    if (p) {
      return p;
    }
  }
  if (e.email) {
    const p = await medplum.searchOne('Patient', `email=${encodeURIComponent(e.email.trim())}`);
    if (p) {
      return p;
    }
  }
  if (e.telefono) {
    // En cualquiera de las formas en que puede estar guardado (p. ej. el lead que creó
    // el primer WhatsApp del paciente, con "+549…").
    const e164 = aE164AR(e.telefono);
    const valores = e164 ? variantesTelefonoAR(e164) : [e.telefono.trim()];
    const candidatos = await medplum.searchResources('Patient', {
      phone: [...new Set([e.telefono.trim(), ...valores])].join(','),
      _count: '10',
    });
    // Un teléfono compartido (p. ej. de la familia) no une a dos personas con DNI distinto.
    const dni = e.dni?.trim();
    const p = candidatos.find((c) => !dni || !c.identifier?.some((i) => i.system === SYSTEM.dni && i.value !== dni));
    if (p) {
      return p;
    }
  }
  return undefined;
}

/** El mismo teléfono escrito de otra forma ("11 2233-4455" = "+5491122334455"). */
function mismoTelefono(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const na = aE164AR(a);
  return a.trim() === b.trim() || (na !== undefined && na === aE164AR(b));
}

/**
 * Con la ficha completa, el aviso del contacto nuevo por WhatsApp ya cumplió. Best-effort:
 * si falla, el alta igual vale (el aviso queda para resolverlo a mano).
 */
async function resolverAvisos(medplum: MedplumClient, patientId: string | undefined): Promise<number> {
  if (!patientId) {
    return 0;
  }
  try {
    return await resolverAvisosDelPaciente(medplum, `Patient/${patientId}`, 'ficha-completada');
  } catch (err) {
    console.error('som-alta-paciente: no se pudo resolver el aviso de WhatsApp:', err instanceof Error ? err.message : err);
    return 0;
  }
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaAltaPaciente>,
): Promise<ResultadoAltaPaciente> {
  const e = event.input;
  try {
    const { firstName, lastName } =
      e.firstName || e.lastName
        ? { firstName: e.firstName ?? '', lastName: e.lastName ?? '' }
        : partirNombre(e.nombre ?? '');

    if (!firstName && !lastName) {
      return { ok: false, mensaje: 'Falta el nombre del paciente.' };
    }
    if (e.email && !validarEmail(e.email)) {
      return { ok: false, mensaje: 'El email no es válido.' };
    }

    const nombreText = [firstName, lastName].filter(Boolean).join(' ');
    const existente = await buscarExistente(medplum, e);

    if (existente) {
      // Merge no destructivo: completa datos que falten, no pisa identifiers previos.
      const extension = [...(existente.extension ?? [])].filter((x) => x.url !== EXT.tipoCliente);
      if (e.tipoCliente) {
        extension.push({ url: EXT.tipoCliente, valueCode: e.tipoCliente });
      }
      const origen = normalizarValor(e.origenLead);
      if (origen && !extension.some((x) => x.url === EXT.origenLead)) {
        extension.push({ url: EXT.origenLead, valueString: origen });
      }
      const identifier = [...(existente.identifier ?? [])];
      if (e.dni && !identifier.some((i) => i.system === SYSTEM.dni)) {
        identifier.push({ system: SYSTEM.dni, value: e.dni.trim() });
      }
      const nuevosTelecom = telecom(e.telefono, e.email).filter(
        (n) =>
          !(existente.telecom ?? []).some(
            (t) => t.system === n.system && (t.value === n.value || (n.system === 'phone' && mismoTelefono(t.value, n.value))),
          ),
      );
      // Si solo tenía el apodo del perfil de WhatsApp (un lead), el nombre real va primero.
      const nombreReal = { use: 'official' as const, text: nombreText, given: [firstName], family: lastName };
      const soloApodos = (existente.name ?? []).every((n) => n.use === 'nickname');
      const actualizado = await medplum.updateResource<Patient>({
        ...existente,
        name: soloApodos ? [nombreReal, ...(existente.name ?? [])] : existente.name,
        identifier,
        telecom: [...(existente.telecom ?? []), ...nuevosTelecom],
        extension: extension.length ? extension : undefined,
      });
      const avisosResueltos = await resolverAvisos(medplum, actualizado.id);
      return { ok: true, patientId: actualizado.id, creado: false, ...(avisosResueltos ? { avisosResueltos } : {}) };
    }

    const origen = normalizarValor(e.origenLead);
    const extension = [
      ...(e.tipoCliente ? [{ url: EXT.tipoCliente, valueCode: e.tipoCliente }] : []),
      ...(origen ? [{ url: EXT.origenLead, valueString: origen }] : []),
    ];
    const creado = await medplum.createResource<Patient>({
      resourceType: 'Patient',
      active: true,
      name: [{ text: nombreText, given: [firstName], family: lastName }],
      identifier: e.dni ? [{ system: SYSTEM.dni, value: e.dni.trim() }] : undefined,
      telecom: telecom(e.telefono, e.email),
      extension: extension.length ? extension : undefined,
    });
    return { ok: true, patientId: creado.id, creado: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'No se pudo dar de alta el paciente.' };
  }
}
