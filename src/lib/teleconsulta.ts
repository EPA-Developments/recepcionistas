/**
 * Modalidad de atención y teleconsulta (R-21) — lógica pura (sin red).
 *
 *  - Modalidad ↔ HL7 v3 ActCode: `AMB` (presencial) y `VR` (virtual), el mismo código
 *    que lleva `Encounter.class`. La modalidad viaja con un código estándar en el turno,
 *    en la solicitud del portal y en el catálogo (`useContext` de tipo `workflow`).
 *  - Consentimiento de teleconsulta: genérico (uno por paciente), lo firma el paciente
 *    en el portal. Es un `Consent` activo con `policyRule`
 *    `CodeSystem/consentimiento|teleconsulta`. Sin él no se pide ni se agenda una
 *    teleconsulta.
 *  - Link de la videollamada: una sala del Jitsi de SOM (Project Secret
 *    `JITSI_BASE_URL`) con nombre imposible de adivinar, uno por turno.
 */
import type { Coding, Consent, Extension } from '@medplum/fhirtypes';
import type { Modalidad, Servicio } from '../domain/types.js';
import { COD, EXT, SYSTEM } from '../fhir/identifiers.js';
import type { ResultadoValidacion } from './reglas-turno.js';

export const V3_ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';

const CODIGO_MODALIDAD: Record<Modalidad, { code: 'AMB' | 'VR'; display: string }> = {
  presencial: { code: 'AMB', display: 'ambulatory' },
  teleconsulta: { code: 'VR', display: 'virtual' },
};

export const MODALIDADES: readonly Modalidad[] = ['presencial', 'teleconsulta'];

export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = {
  presencial: 'Presencial',
  teleconsulta: 'Teleconsulta',
};

export function esModalidad(v: unknown): v is Modalidad {
  return v === 'presencial' || v === 'teleconsulta';
}

/** Coding v3-ActCode de la modalidad (extensión `modalidad` y `Encounter.class`). */
export function codingModalidad(m: Modalidad): Coding {
  return { system: V3_ACT_CODE, ...CODIGO_MODALIDAD[m] };
}

/** Modalidad de un Coding v3-ActCode `AMB` / `VR`; undefined si es otro código. */
export function modalidadDeCoding(c: Coding | undefined): Modalidad | undefined {
  if (c?.system !== V3_ACT_CODE) {
    return undefined;
  }
  return MODALIDADES.find((m) => CODIGO_MODALIDAD[m].code === c.code);
}

/** Extensión `modalidad` para un turno o una solicitud. */
export function extensionModalidad(m: Modalidad): Extension {
  return { url: EXT.modalidad, valueCoding: codingModalidad(m) };
}

/** Modalidad registrada en un recurso (extensión `modalidad`), si la tiene. */
export function modalidadDe(r: { extension?: Extension[] }): Modalidad | undefined {
  return modalidadDeCoding(r.extension?.find((e) => e.url === EXT.modalidad)?.valueCoding);
}

/** Link de la videollamada registrado en un turno, si lo tiene. */
export function teleconsultaUrlDe(r: { extension?: Extension[] }): string | undefined {
  return r.extension?.find((e) => e.url === EXT.teleconsultaUrl)?.valueUrl;
}

// ───────────────────────────── R-21 ─────────────────────────────

const ok = (): ResultadoValidacion => ({ ok: true, bloqueos: [], advertencias: [] });
const bloqueo = (mensaje: string): ResultadoValidacion => ({
  ok: false,
  bloqueos: [{ regla: 'R-21', nivel: 'bloqueo', mensaje }],
  advertencias: [],
});

/** R-21 · El servicio tiene que ofrecerse en esa modalidad. */
export function validarModalidadServicio(servicio: Pick<Servicio, 'nombre' | 'modalidades'>, modalidad: Modalidad): ResultadoValidacion {
  if (servicio.modalidades.includes(modalidad)) {
    return ok();
  }
  return bloqueo(`${servicio.nombre} no se ofrece por ${modalidad === 'teleconsulta' ? 'teleconsulta' : 'atención presencial'}.`);
}

/** R-21 · La teleconsulta requiere el consentimiento de teleconsulta firmado. */
export function validarConsentimientoTeleconsulta(modalidad: Modalidad, tieneConsentimiento: boolean): ResultadoValidacion {
  if (modalidad !== 'teleconsulta' || tieneConsentimiento) {
    return ok();
  }
  return bloqueo(
    'Falta el consentimiento de teleconsulta del paciente: lo firma una sola vez en el portal. Mientras tanto, la consulta puede ser presencial.',
  );
}

/**
 * ¿Es un consentimiento de teleconsulta vigente? `Consent` activo con `policyRule`
 * `CodeSystem/consentimiento|teleconsulta` y, si tiene vencimiento, no vencido.
 */
export function esConsentimientoTeleconsulta(c: Consent, ahora: Date = new Date()): boolean {
  const esDeTeleconsulta = c.policyRule?.coding?.some(
    (k) => k.system === SYSTEM.consentimiento && k.code === COD.consentimientoTeleconsulta,
  );
  const fin = c.provision?.period?.end;
  const vigente = !fin || Date.parse(fin) >= ahora.getTime();
  return c.status === 'active' && Boolean(esDeTeleconsulta) && vigente;
}

/**
 * El `Consent` que registra el portal cuando el paciente acepta la teleconsulta
 * (contrato: ver docs/plan-bienestar.md). `textoAceptado` es el texto que leyó.
 */
export function construirConsentimientoTeleconsulta(pacienteRef: string, ahora: Date, textoAceptado?: string): Consent {
  return {
    resourceType: 'Consent',
    status: 'active',
    scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'treatment' }] },
    category: [{ coding: [{ system: 'http://loinc.org', code: '59284-0', display: 'Patient Consent' }] }],
    patient: { reference: pacienteRef },
    performer: [{ reference: pacienteRef }],
    dateTime: ahora.toISOString(),
    policyRule: {
      coding: [
        {
          system: SYSTEM.consentimiento,
          code: COD.consentimientoTeleconsulta,
          display: 'Consentimiento de teleconsulta (telemedicina)',
        },
      ],
      ...(textoAceptado ? { text: textoAceptado } : {}),
    },
    provision: { type: 'permit' },
  };
}

// ───────────────────────────── Jitsi ─────────────────────────────

/** Mínimo de caracteres aleatorios del nombre de la sala (128 bits en hexadecimal). */
const MIN_ALEATORIO = 32;

/**
 * Nombre de la sala de una teleconsulta: `som-` + el valor aleatorio (hexadecimal, en
 * minúsculas). Sin datos del paciente: el nombre no identifica a nadie.
 */
export function nombreSalaJitsi(aleatorio: string): string {
  const limpio = aleatorio.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (limpio.length < MIN_ALEATORIO) {
    throw new Error('El nombre de la sala necesita al menos 128 bits aleatorios.');
  }
  return `som-${limpio}`;
}

/**
 * Link de la videollamada en el Jitsi de SOM. Devuelve undefined si la base no es una
 * URL https válida (sin el Project Secret `JITSI_BASE_URL`, el turno queda sin link).
 */
export function urlTeleconsulta(base: string | undefined, sala: string): string | undefined {
  if (!base) {
    return undefined;
  }
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') {
      return undefined;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(sala)}`;
  } catch {
    return undefined;
  }
}
