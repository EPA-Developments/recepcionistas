/**
 * Plantillas de WhatsApp (Meta) de SOM: estado, creación y aprobación.
 *
 *   npm run whatsapp:plantillas              → solo informa (no toca nada)
 *   npm run whatsapp:plantillas -- --aplicar → crea en Twilio lo que falte, lo manda a
 *                                              aprobación de Meta y, aprobada, guarda el
 *                                              ContentSid en su Project Secret
 *
 * `--aplicar` NO es un diagnóstico: crea plantillas reales en la cuenta de Twilio de SOM y
 * las manda a Meta (queda registrado en la WABA). Las credenciales de Twilio salen de los
 * Project Secrets (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN): se usan en memoria y nunca se
 * imprimen. Idempotente: se puede correr de nuevo para ver si Meta ya aprobó.
 * Ver `config/plantillas-whatsapp.ts` y docs/whatsapp.md.
 */
import 'dotenv/config';
import type { ProjectSetting } from '@medplum/fhirtypes';
import { PLANTILLAS_WHATSAPP, type PlantillaWhatsApp } from '../config/plantillas-whatsapp.js';
import { contenidoTwilio, problemasPlantilla } from '../lib/plantillas-whatsapp.js';
import { conectarMedplum } from './conexion.js';
import { guardarSecretos, leerSecretos, valorSecreto } from './secretos.js';

const CONTENT = 'https://content.twilio.com/v1';

interface ContenidoTwilio {
  sid: string;
  friendly_name?: string;
}

interface Aprobacion {
  status?: string;
  rejection_reason?: string;
  category?: string;
}

let fallas = 0;

function mal(mensaje: string): void {
  console.error(`  ✗ ${mensaje}`);
  fallas++;
}

async function twilio<T>(auth: string, url: string, init?: { method: 'POST'; json: unknown }): Promise<T> {
  const resp = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Basic ${auth}`, ...(init ? { 'Content-Type': 'application/json' } : {}) },
    ...(init ? { body: JSON.stringify(init.json) } : {}),
  });
  const cuerpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(`Twilio respondió ${resp.status}${cuerpo.message ? `: ${String(cuerpo.message)}` : ''}`);
  }
  return cuerpo as T;
}

/** Todas las plantillas de la cuenta (paginado). */
async function listar(auth: string): Promise<ContenidoTwilio[]> {
  const todas: ContenidoTwilio[] = [];
  let url: string | undefined = `${CONTENT}/Content?PageSize=100`;
  while (url) {
    const pagina: { contents?: ContenidoTwilio[]; meta?: { next_page_url?: string | null } } = await twilio(auth, url);
    todas.push(...(pagina.contents ?? []));
    url = pagina.meta?.next_page_url ?? undefined;
  }
  return todas;
}

async function aprobacion(auth: string, sid: string): Promise<Aprobacion | undefined> {
  const r = await twilio<{ whatsapp?: Aprobacion }>(auth, `${CONTENT}/Content/${sid}/ApprovalRequests`);
  return r.whatsapp;
}

/** Qué significa cada estado de aprobación de Meta. */
function explicarEstado(estado: string | undefined): string {
  switch (estado) {
    case 'approved':
      return 'APROBADA';
    case 'pending':
    case 'received':
      return 'en revisión de Meta (suele tardar de minutos a 48 h)';
    case 'rejected':
      return 'RECHAZADA';
    case 'paused':
    case 'disabled':
      return `${estado.toUpperCase()} por Meta (calidad baja: revisar el texto)`;
    default:
      return 'sin mandar a aprobación';
  }
}

async function procesar(
  auth: string,
  existentes: ContenidoTwilio[],
  p: PlantillaWhatsApp,
  secretos: ProjectSetting[],
  guardar: (sid: string) => Promise<void>,
  aplicar: boolean,
): Promise<void> {
  const uso = p.avisos ? `sale con: ${p.avisos.join(', ')}` : 'genérica: respaldo de todos los avisos';
  console.log(`\n${p.nombre} (${p.categoria}, ${p.idioma}) · ${uso}\n  «${p.cuerpo.replace(/\n/g, '⏎ ')}»`);
  const problemas = problemasPlantilla(p);
  if (problemas.length > 0) {
    for (const x of problemas) {
      mal(x);
    }
    return;
  }

  const iguales = existentes.filter((c) => c.friendly_name === p.nombre);
  if (iguales.length > 1) {
    mal(`Hay ${iguales.length} plantillas "${p.nombre}" en Twilio (${iguales.map((c) => c.sid).join(', ')}): dejá una.`);
    return;
  }
  let sid = iguales[0]?.sid;
  if (!sid) {
    if (!aplicar) {
      console.log('  · No existe en Twilio. Con --aplicar se crea y se manda a aprobación de Meta.');
      return;
    }
    sid = (await twilio<ContenidoTwilio>(auth, `${CONTENT}/Content`, { method: 'POST', json: contenidoTwilio(p) })).sid;
    console.log(`  + Creada en Twilio: ${sid}`);
  } else {
    console.log(`  = En Twilio: ${sid}`);
  }

  let estado = await aprobacion(auth, sid);
  if (!estado?.status || estado.status === 'unsubmitted') {
    if (!aplicar) {
      console.log('  · Sin mandar a aprobación. Con --aplicar se manda a Meta.');
      return;
    }
    await twilio(auth, `${CONTENT}/Content/${sid}/ApprovalRequests/whatsapp`, {
      method: 'POST',
      json: { name: p.nombre, category: p.categoria },
    });
    console.log('  + Mandada a aprobación de Meta.');
    estado = await aprobacion(auth, sid);
  }
  console.log(`  Estado: ${explicarEstado(estado?.status)}${estado?.category ? ` · categoría ${estado.category}` : ''}`);
  if (estado?.status === 'rejected') {
    mal(
      `Meta la rechazó${estado.rejection_reason ? `: ${estado.rejection_reason}` : ''}. Corregí el texto en ` +
        'src/config/plantillas-whatsapp.ts con otro nombre (una plantilla de Twilio no se edita) y volvé a correr.',
    );
    return;
  }
  if (estado?.category && estado.category !== p.categoria) {
    console.warn(`  ⚠️  Meta la recategorizó como ${estado.category} (se cobra distinto y el paciente puede silenciarla).`);
  }
  if (estado?.status !== 'approved') {
    console.log(`  · ${p.secret} se guarda cuando esté aprobada: hasta entonces los avisos salen como texto libre.`);
    return;
  }
  if (valorSecreto(secretos, p.secret) === sid) {
    console.log(`  = ${p.secret} ya estaba: los avisos salen con esta plantilla.`);
  } else if (!aplicar) {
    console.log(`  · Con --aplicar se guarda ${p.secret} = ${sid} y los avisos pasan a salir con ella.`);
  } else {
    await guardar(sid);
    console.log(`  + ${p.secret} = ${sid}: los avisos salen con esta plantilla (llegan aunque pasen 24 h).`);
  }
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const { medplum, projectId, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl} (project ${projectId})${aplicar ? '' : ' · solo informa (sin --aplicar)'}.`);

  const secretos = await leerSecretos(medplum, projectId);
  const cuenta = valorSecreto(secretos, 'TWILIO_ACCOUNT_SID');
  const token = valorSecreto(secretos, 'TWILIO_AUTH_TOKEN');
  if (!cuenta || !token) {
    console.error('\n✗ Faltan los Project Secrets TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.');
    process.exitCode = 1;
    return;
  }
  console.log(`Cuenta de Twilio: ${cuenta.slice(0, 4)}…${cuenta.slice(-4)} (de los Project Secrets)`);
  const auth = Buffer.from(`${cuenta}:${token}`).toString('base64');
  const existentes = await listar(auth);

  for (const p of PLANTILLAS_WHATSAPP) {
    await procesar(
      auth,
      existentes,
      p,
      secretos,
      (sid) => guardarSecretos(medplum, projectId, [{ name: p.secret, valueString: sid }]),
      aplicar,
    );
  }
  if (fallas > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Plantillas de WhatsApp: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
