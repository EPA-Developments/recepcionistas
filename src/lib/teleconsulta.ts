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
import { TZ } from '../config/horario.js';
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

// ─────────────────────── Entrada a la sala (token) ───────────────────────
//
// El profesional entra a la sala como moderador: abre la sala, admite al paciente
// y puede cerrarla. Para eso Jitsi necesita un token firmado (JWT) que dice quién
// es moderador. Acá está lo que ese token dice y cuándo vale; la firma la hace el
// bot `som-teleconsulta-token`, porque usa un secreto y `node:crypto`.
//
// El bot es la puerta, y por eso estas reglas son puras y están testeadas en sus
// bordes: la ventana, el nombre de la sala y la forma del token no se deciden en
// el bot, se deciden acá.

/** Con qué rol se pide entrar. El profesional sale moderador; el paciente, no. */
export type RolSala = 'profesional' | 'paciente';

export function esRolSala(v: unknown): v is RolSala {
  return v === 'profesional' || v === 'paciente';
}

/** Minutos antes del inicio en que se abre la sala. */
export const MINUTOS_ANTES = 15;
/** Minutos después del fin en que la sala sigue abierta (las consultas se estiran). */
export const MINUTOS_DESPUES = 60;

/**
 * Estados del turno con la sala viva. `pending` no está: es el turno con la seña
 * sin pagar, y un turno impago no entra a la consulta.
 */
export const ESTADOS_CON_SALA: ReadonlySet<string> = new Set(['booked', 'arrived', 'checked-in']);

/** Un nombre de sala de SOM: `som-` y al menos 128 bits en hexadecimal (ver `nombreSalaJitsi`). */
export function esNombreSala(v: unknown): v is string {
  return typeof v === 'string' && new RegExp(`^som-[0-9a-f]{${MIN_ALEATORIO},}$`).test(v);
}

/**
 * El host del Jitsi de SOM, desde el Project Secret `JITSI_BASE_URL`. Va al claim
 * `sub` del token, que Jitsi compara con su propio dominio. Solo `https`: con otra
 * cosa no se emite nada.
 */
export function dominioJitsi(base: string | undefined): string | undefined {
  if (!base) {
    return undefined;
  }
  try {
    const url = new URL(base.trim());
    return url.protocol === 'https:' && url.hostname ? url.host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * La sala de un turno, leída de su link (`teleconsulta-url`).
 *
 * El link tiene que apuntar al mismo Jitsi que firma el token. Si no, el paciente
 * entra por el link a un servidor y el profesional entra con el token a otro: los
 * dos esperan en salas vacías y nadie ve un error. Por eso, si no coincide, no hay
 * sala.
 */
export function salaDelLink(link: string | undefined, dominio: string): string | undefined {
  if (!link) {
    return undefined;
  }
  try {
    const url = new URL(link);
    if (url.host.toLowerCase() !== dominio.toLowerCase()) {
      return undefined;
    }
    const sala = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
    return esNombreSala(sala) ? sala : undefined;
  } catch {
    return undefined;
  }
}

const fmtHoraSala = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

/** Desde y hasta cuándo se puede entrar a la sala de un turno. */
export function ventanaDeSala(inicio: Date, fin: Date): { desde: Date; hasta: Date } {
  return {
    desde: new Date(inicio.getTime() - MINUTOS_ANTES * 60_000),
    hasta: new Date(fin.getTime() + MINUTOS_DESPUES * 60_000),
  };
}

/**
 * Por qué todavía no (o ya no) se puede entrar, en palabras para quien lo lee.
 * `undefined` quiere decir que la sala está abierta. La hora sale en la hora de
 * Argentina, no en la del servidor donde corre el bot.
 */
export function motivoSinAcceso(inicio: Date, fin: Date, ahora: Date): string | undefined {
  const { desde, hasta } = ventanaDeSala(inicio, fin);
  if (ahora < desde) {
    return `La sala se abre a las ${fmtHoraSala.format(desde)}, ${MINUTOS_ANTES} minutos antes del turno.`;
  }
  if (ahora > hasta) {
    return 'Esta videollamada ya terminó.';
  }
  return undefined;
}

/** Lo que va adentro del token de Jitsi. */
export interface ClaimsSala {
  aud: 'jitsi';
  /** El `JITSI_APP_ID` del servidor. */
  iss: string;
  /** El host del Jitsi. */
  sub: string;
  /** El token sirve para esta sala y ninguna otra. */
  room: string;
  /** Desde cuándo vale (segundos): la apertura de la sala. */
  nbf: number;
  /** Hasta cuándo vale (segundos): el cierre de la sala. */
  exp: number;
  context: {
    user: {
      name: string;
      /** Lo que Jitsi lee para dar el rol de moderador. */
      moderator: boolean;
      /** Lo mismo, en la forma que leen otras configuraciones de Jitsi. */
      affiliation: 'owner' | 'member';
    };
  };
}

export interface DatosToken {
  appId: string;
  dominio: string;
  sala: string;
  /** El nombre visible en la sala. Nunca documento ni email. */
  nombre: string;
  rol: RolSala;
  inicio: Date;
  fin: Date;
}

/**
 * Los claims del token. Vence cuando cierra la sala, no antes ni después: si se
 * corta la llamada, se pide otro token y se vuelve a entrar.
 */
export function claimsToken(d: DatosToken): ClaimsSala {
  const { desde, hasta } = ventanaDeSala(d.inicio, d.fin);
  const moderador = d.rol === 'profesional';
  return {
    aud: 'jitsi',
    iss: d.appId,
    sub: d.dominio,
    room: d.sala,
    nbf: Math.floor(desde.getTime() / 1000),
    exp: Math.floor(hasta.getTime() / 1000),
    context: {
      user: { name: d.nombre, moderator: moderador, affiliation: moderador ? 'owner' : 'member' },
    },
  };
}
