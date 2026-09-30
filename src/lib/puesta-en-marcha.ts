/**
 * Chequeo de la puesta en marcha del Plan Bienestar 100 Días® en un proyecto Medplum:
 * lógica pura (sin red). La usa `src/seed/puesta-en-marcha.ts`, que lee el estado del
 * servidor y lo pasa acá. Devuelve una lista de chequeos con su estado y, si algo falta,
 * el comando que lo arregla. Sólo nombres: nunca valores de secretos.
 *
 * Qué mira: los bots creados, los roles (AccessPolicy) del seed y si están al día con el
 * repo, el catálogo del seed (instrumentos, programas, profesionales y agendas), los
 * recursos que siembra el monorepo del plan (`npm run sembrar`), los Project Secrets por
 * nombre y el default patient access policy del proyecto.
 */
import type { AccessPolicy } from '@medplum/fhirtypes';
import { INSTRUMENTOS_PB100D } from '../config/instrumentos-pb100d.js';
import { MEDICOS } from '../config/medicos.js';
import { RECURSOS } from '../config/recursos.js';
import { ACCESS_POLICIES, NOMBRE_POLICY_PACIENTE } from '../fhir/access-policies.js';
import { PLAN_BIENESTAR_URL, PLAN_GLP1_URL } from '../fhir/identifiers.js';
import { describirEntrada } from './diagnostico-acceso.js';

export type EstadoChequeo = 'ok' | 'atencion' | 'falta';

export interface Chequeo {
  grupo: string;
  titulo: string;
  estado: EstadoChequeo;
  detalle?: string;
  /** Qué correr o hacer para arreglarlo (sólo si no está ok). */
  arreglo?: string;
}

export interface SecretEsperado {
  nombre: string;
  paraQue: string;
  /** Sin él, algo del circuito no funciona (falta); si no, es una mejora (atención). */
  obligatorio: boolean;
}

/** Project Secrets que leen los bots (`docs/bots.md`). Nombres, nunca valores. */
export const SECRETS_ESPERADOS: readonly SecretEsperado[] = [
  { nombre: 'TWILIO_ACCOUNT_SID', paraQue: 'WhatsApp (confirmaciones, recordatorios, avisos del plan)', obligatorio: true },
  { nombre: 'TWILIO_AUTH_TOKEN', paraQue: 'WhatsApp', obligatorio: true },
  { nombre: 'TWILIO_WHATSAPP_FROM', paraQue: 'WhatsApp: número de la WABA', obligatorio: true },
  { nombre: 'TWILIO_WEBHOOK_URL', paraQue: 'WhatsApp entrante y estados de entrega (la guarda `npm run webhooks`)', obligatorio: true },
  { nombre: 'RECEPCION_WHATSAPP_TO', paraQue: 'alertas a Recepción (consultas del plan sin agendar, solicitudes del portal)', obligatorio: false },
  { nombre: 'TWILIO_CONTENT_SID_AVISO', paraQue: 'avisos fuera de la ventana de 24 h (plantilla aprobada por Meta)', obligatorio: false },
  { nombre: 'MERCADOPAGO_ACCESS_TOKEN', paraQue: 'link de la seña y webhook de pagos (Access Token de producción)', obligatorio: true },
  { nombre: 'MP_WEBHOOK_URL', paraQue: 'confirmación automática del pago (la guarda `npm run webhooks`)', obligatorio: false },
  { nombre: 'JITSI_BASE_URL', paraQue: 'link de la videollamada de cada teleconsulta', obligatorio: true },
  { nombre: 'JITSI_APP_ID', paraQue: 'el profesional entra como moderador (con JITSI_APP_SECRET)', obligatorio: false },
  { nombre: 'JITSI_APP_SECRET', paraQue: 'el profesional entra como moderador (con JITSI_APP_ID)', obligatorio: false },
  { nombre: 'PORTAL_BASE_URL', paraQue: 'links al portal del paciente (default https://app.segundaopinionmedica.org)', obligatorio: false },
  { nombre: 'ANTHROPIC_API_KEY', paraQue: 'informe SOM, lectura de laboratorios y "Sugerir" en Mensajes', obligatorio: false },
];

/**
 * Recursos del monorepo del plan (`EPA-Developments/plan-bienestar-100-dias`) que siembra
 * `npm run sembrar` allá: el portal instancia el plan clínico desde `pb100d-ckm` y el menú
 * del equipo lo lee.
 */
export const RECURSOS_DEL_MONOREPO: ReadonlyArray<{ tipo: 'PlanDefinition' | 'Questionnaire'; url: string; paraQue: string }> = [
  { tipo: 'PlanDefinition', url: 'https://epa-bienestar.ar/fhir/PlanDefinition/pb100d-ckm', paraQue: 'el plan clínico por estadío CKM (portal y menú del equipo)' },
  { tipo: 'PlanDefinition', url: 'https://epa-bienestar.ar/fhir/PlanDefinition/menopausia-cardiovascular', paraQue: 'la definición anterior: los planes ya escritos con ella se siguen leyendo' },
  { tipo: 'Questionnaire', url: 'https://epa-bienestar.ar/fhir/Questionnaire/pb100d-baseline', paraQue: 'el cuestionario inicial del portal (de sus respuestas sale el perfil)' },
];

/** PlanDefinition que carga el seed de Recepción. */
export const PLAN_DEFINITIONS_DEL_SEED: ReadonlyArray<{ url: string; paraQue: string }> = [
  { url: PLAN_BIENESTAR_URL, paraQue: 'la inscripción al plan (tres consultas programadas)' },
  { url: PLAN_GLP1_URL, paraQue: 'el seguimiento GLP-1' },
];

/** Identificadores (`SCH_…`) de las agendas que crea el seed: una por recurso físico y una por profesional. */
export const AGENDAS_DEL_SEED: readonly string[] = [...RECURSOS.map((r) => `SCH_${r.codigo}`), ...MEDICOS.map((m) => `SCH_${m.codigo}`)];

export const ARREGLO_SEED = 'npm run seed (en recepcionistas)';
export const ARREGLO_DEPLOY = 'npm run deploy:bots (en recepcionistas)';
export const ARREGLO_SEMBRAR = 'npm run sembrar (en el monorepo plan-bienestar-100-dias)';
export const ARREGLO_SECRETS = 'Medplum App → Project → Secrets';
export const ARREGLO_DEFAULT_POLICY = 'npm run diagnostico-acceso -- --apply (en recepcionistas)';

/** Lo que el script lee del servidor (nombres e identificadores, nada más). */
export interface EstadoServidor {
  projectId: string;
  nombreProyecto?: string;
  /** Nombres de los `Bot` que existen en el proyecto. */
  bots: string[];
  /** Nombres de los bots que deploya `npm run deploy:bots` (`medplum.config.json`). */
  botsEsperados: string[];
  /** Las AccessPolicy del proyecto (para compararlas con las del repo). */
  policies: AccessPolicy[];
  /** `url` de los Questionnaire encontrados. */
  questionnaireUrls: string[];
  /** `url` de las PlanDefinition encontradas. */
  planDefinitionUrls: string[];
  /** Códigos (`CodeSystem/medico`) de los Practitioner encontrados. */
  practitionerCodigos: string[];
  /** Identificadores (`SCH_…`) de los Schedule encontrados. */
  agendas: string[];
  /** Nombres de los Project Secrets cargados. */
  secrets: string[];
  /** A qué AccessPolicy apunta el default patient access policy del proyecto. */
  defaultPatientPolicyId?: string;
}

const ok = (grupo: string, titulo: string, detalle?: string): Chequeo => ({ grupo, titulo, estado: 'ok', ...(detalle ? { detalle } : {}) });
const falta = (grupo: string, titulo: string, detalle: string, arreglo: string): Chequeo => ({ grupo, titulo, estado: 'falta', detalle, arreglo });
const atencion = (grupo: string, titulo: string, detalle: string, arreglo: string): Chequeo => ({ grupo, titulo, estado: 'atencion', detalle, arreglo });

function faltantes<T>(esperados: readonly T[], presentes: readonly T[]): T[] {
  const tiene = new Set(presentes);
  return esperados.filter((e) => !tiene.has(e));
}

/** Los chequeos de la puesta en marcha, en el orden en que se resuelven. */
export function evaluarPuestaEnMarcha(s: EstadoServidor): Chequeo[] {
  const out: Chequeo[] = [];

  // Proyecto.
  out.push(ok('Proyecto', `Conectado a ${s.nombreProyecto ?? '(sin nombre)'} · ${s.projectId}`));

  // Bots.
  const botsFaltan = faltantes(s.botsEsperados, s.bots);
  out.push(
    botsFaltan.length === 0
      ? ok('Bots', `${s.botsEsperados.length} bots creados`, 'Existen en el proyecto; el código deployado es el del último `npm run deploy:bots`.')
      : falta('Bots', `Faltan ${botsFaltan.length} de ${s.botsEsperados.length} bots`, botsFaltan.join(', '), ARREGLO_DEPLOY),
  );

  // Roles: cada policy del repo existe y está al día.
  for (const repo of ACCESS_POLICIES) {
    const nombre = repo.name ?? '?';
    const servidor = s.policies.find((p) => p.name === nombre);
    if (!servidor) {
      out.push(falta('Roles', nombre, 'No existe en el proyecto.', ARREGLO_SEED));
      continue;
    }
    const enServidor = new Set((servidor.resource ?? []).map(describirEntrada));
    const atrasada = (repo.resource ?? []).map(describirEntrada).filter((e) => !enServidor.has(e));
    out.push(
      atrasada.length === 0
        ? ok('Roles', nombre)
        : atencion('Roles', nombre, `Atrasada respecto del repo: le faltan ${atrasada.length} entradas (${atrasada.slice(0, 3).join('; ')}${atrasada.length > 3 ? '; …' : ''}).`, ARREGLO_SEED),
    );
  }
  const portal = s.policies.find((p) => p.name === NOMBRE_POLICY_PACIENTE);
  if (portal?.id) {
    out.push(
      s.defaultPatientPolicyId === portal.id
        ? ok('Roles', 'Default patient access policy del proyecto', `Apunta a "${NOMBRE_POLICY_PACIENTE}".`)
        : atencion(
            'Roles',
            'Default patient access policy del proyecto',
            s.defaultPatientPolicyId ? 'Apunta a otra policy: los pacientes nuevos no heredan la del portal.' : 'No está seteada: los pacientes nuevos no heredan la del portal.',
            ARREGLO_DEFAULT_POLICY,
          ),
    );
  }

  // Catálogo del seed.
  const instrumentos = INSTRUMENTOS_PB100D.map((q) => q.url).filter((u): u is string => Boolean(u));
  const instFaltan = faltantes(instrumentos, s.questionnaireUrls);
  out.push(
    instFaltan.length === 0
      ? ok('Catálogo', `${instrumentos.length} instrumentos del equipo (Questionnaire)`)
      : falta('Catálogo', `Faltan ${instFaltan.length} de ${instrumentos.length} instrumentos del equipo`, instFaltan.map((u) => u.split('/').pop()).join(', '), ARREGLO_SEED),
  );
  for (const pd of PLAN_DEFINITIONS_DEL_SEED) {
    out.push(
      s.planDefinitionUrls.includes(pd.url)
        ? ok('Catálogo', `PlanDefinition ${pd.url.split('/').pop()}`, pd.paraQue)
        : falta('Catálogo', `PlanDefinition ${pd.url.split('/').pop()}`, `No existe: ${pd.paraQue}.`, ARREGLO_SEED),
    );
  }
  const medicosFaltan = faltantes(
    MEDICOS.map((m) => m.codigo),
    s.practitionerCodigos,
  );
  out.push(
    medicosFaltan.length === 0
      ? ok('Catálogo', `${MEDICOS.length} profesionales (Practitioner)`)
      : falta('Catálogo', `Faltan ${medicosFaltan.length} de ${MEDICOS.length} profesionales`, medicosFaltan.join(', '), ARREGLO_SEED),
  );
  const agendasFaltan = faltantes(AGENDAS_DEL_SEED, s.agendas);
  out.push(
    agendasFaltan.length === 0
      ? ok('Catálogo', `${AGENDAS_DEL_SEED.length} agendas (Schedule) de consultorios y profesionales`)
      : falta('Catálogo', `Faltan ${agendasFaltan.length} de ${AGENDAS_DEL_SEED.length} agendas`, agendasFaltan.join(', '), ARREGLO_SEED),
  );

  // Recursos del monorepo del plan.
  for (const r of RECURSOS_DEL_MONOREPO) {
    const presentes = r.tipo === 'PlanDefinition' ? s.planDefinitionUrls : s.questionnaireUrls;
    out.push(
      presentes.includes(r.url)
        ? ok('Plan (monorepo)', `${r.tipo} ${r.url.split('/').pop()}`, r.paraQue)
        : falta('Plan (monorepo)', `${r.tipo} ${r.url.split('/').pop()}`, `No existe: ${r.paraQue}.`, ARREGLO_SEMBRAR),
    );
  }

  // Secrets (por nombre).
  const cargados = new Set(s.secrets);
  for (const sec of SECRETS_ESPERADOS) {
    if (cargados.has(sec.nombre)) {
      out.push(ok('Secrets', sec.nombre, sec.paraQue));
    } else if (sec.obligatorio) {
      out.push(falta('Secrets', sec.nombre, `Sin él no funciona: ${sec.paraQue}.`, ARREGLO_SECRETS));
    } else {
      out.push(atencion('Secrets', sec.nombre, `Opcional: ${sec.paraQue}.`, ARREGLO_SECRETS));
    }
  }

  return out;
}

export interface ResumenPuestaEnMarcha {
  ok: number;
  atencion: number;
  falta: number;
  /** Nada falta (puede haber atenciones). */
  listo: boolean;
  /** Los arreglos, sin repetir y en el orden en que aparecen. */
  arreglos: string[];
}

export function resumirPuestaEnMarcha(chequeos: readonly Chequeo[]): ResumenPuestaEnMarcha {
  const cuenta = (estado: EstadoChequeo): number => chequeos.filter((c) => c.estado === estado).length;
  return {
    ok: cuenta('ok'),
    atencion: cuenta('atencion'),
    falta: cuenta('falta'),
    listo: cuenta('falta') === 0,
    arreglos: [...new Set(chequeos.filter((c) => c.estado !== 'ok' && c.arreglo).map((c) => c.arreglo!))],
  };
}

/** Los chequeos agrupados, en el orden de resolución. */
export function agruparChequeos(chequeos: readonly Chequeo[]): Array<[string, Chequeo[]]> {
  const grupos = new Map<string, Chequeo[]>();
  for (const c of chequeos) {
    grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c]);
  }
  return [...grupos.entries()];
}
