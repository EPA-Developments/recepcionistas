/**
 * Derivaciones del Plan Bienestar 100 Días® que decide el equipo médico desde el menú
 * del equipo (monorepo del plan): una `Task` por derivación con el código del ítem del
 * catálogo firmado (`E1-DER-05`), la especialidad en `performerType`, `intent: order` y
 * `status: requested`. Recepción la ve en la ficha y la agenda desde su tarea (R-20):
 * las consultas de derivación del catálogo (`DERIVACIONES_PB100D`, `soloDesdeTarea`) no
 * se reservan sueltas. Lógica pura, sin red.
 */
import type { Task } from '@medplum/fhirtypes';
import { ETIQUETA_RESPONSABLE_CATALOGO, type ResponsableCatalogo } from '../config/catalogo-pb100d.js';
import { CONSULTAS_POR_ESPECIALIDAD, DERIVACIONES_PB100D, type GrupoEspecialidad } from '../config/catalogo.js';
import { NOMBRE_PLAN_BIENESTAR } from '../config/plan-bienestar.js';
import { estadoTarea, type EstadoRecurso } from './programas.js';
import type { ResultadoValidacion } from './reglas-turno.js';

/** CodeSystem del catálogo firmado (en cualquier base) y código EPA que marca el tipo de ítem. */
const SUFIJO_CATALOGO = '/CodeSystem/catalogo-pb100d';
const TIPO_DERIVACION = 'derivacion';

/**
 * A qué grupo de especialidad del catálogo de SOM va cada responsable del catálogo
 * firmado. Los que no tienen consulta en SOM (enfermería, educador, coordinación, la
 * persona, el equipo, los firmantes) no se agendan: quedan como tarea del equipo.
 */
export const GRUPO_POR_RESPONSABLE: Partial<Record<ResponsableCatalogo, GrupoEspecialidad>> = {
  cardiologia: 'cardiologia',
  nutricion: 'nutricion',
  kinesiologia: 'kinesiologia',
  endocrinologia: 'dbt-endocrino',
  nefrologia: 'nefrologia',
  neurologia: 'neurologia',
  neumonologia: 'tisioneumonologia',
  hepatologia: 'hepatologia',
  psicologia: 'psicologia',
  'trabajo-social': 'trabajo-social',
  obstetricia: 'ginecologia',
  electrofisiologia: 'cardiologia-especialidad',
  farmacia: 'farmacia-clinica',
  'cirugia-vascular': 'cirugia-vascular',
  rehabilitacion: 'cardiologia-especialidad',
  imagen: 'cardiologia-especialidad',
  oftalmologia: 'oftalmologia',
};

export function esTareaDerivacion(t: Task): boolean {
  const codings = t.code?.coding ?? [];
  return codings.some((c) => c.system?.endsWith(SUFIJO_CATALOGO)) && codings.some((c) => c.code === TIPO_DERIVACION);
}

export interface DatosDerivacion {
  taskId?: string;
  /** Código del ítem del catálogo firmado (`E1-DER-05`). */
  codigo?: string;
  /** Especialidad, como la nombra el catálogo ("Neumonología"). */
  titulo: string;
  /** Cuándo (el texto de la derivación). */
  texto?: string;
  responsable?: ResponsableCatalogo;
  grupo?: GrupoEspecialidad;
  /** Consultas del catálogo de SOM con que se agenda (las del grupo). */
  servicios: string[];
  estado: EstadoRecurso;
  /** Quién la decidió (Practitioner/…). */
  decididaPor?: string;
  fecha?: string;
  /** El turno con que se resolvió, si ya se agendó. */
  appointmentRef?: string;
}

/** Lo operativo de una tarea de derivación (lo único que ve Recepción). */
export function leerTareaDerivacion(t: Task): DatosDerivacion {
  const codigo = t.code?.coding?.find((c) => c.system?.endsWith(SUFIJO_CATALOGO))?.code;
  const responsable = t.performerType?.[0]?.coding?.[0]?.code as ResponsableCatalogo | undefined;
  const grupo = responsable ? GRUPO_POR_RESPONSABLE[responsable] : undefined;
  const servicios = grupo ? CONSULTAS_POR_ESPECIALIDAD.filter((s) => s.grupo === grupo).map((s) => s.codigo) : [];
  const titulo = t.code?.text ?? (responsable ? ETIQUETA_RESPONSABLE_CATALOGO[responsable] : undefined) ?? 'Derivación';
  const appointmentRef = t.output?.find((o) => o.valueReference?.reference?.startsWith('Appointment/'))?.valueReference?.reference;
  return {
    ...(t.id ? { taskId: t.id } : {}),
    ...(codigo ? { codigo } : {}),
    titulo,
    ...(t.description ? { texto: t.description } : {}),
    ...(responsable ? { responsable } : {}),
    ...(grupo ? { grupo } : {}),
    servicios,
    estado: estadoTarea(t),
    ...(t.requester?.reference ? { decididaPor: t.requester.reference } : {}),
    ...(t.lastModified ?? t.authoredOn ? { fecha: (t.lastModified ?? t.authoredOn)!.slice(0, 10) } : {}),
    ...(appointmentRef ? { appointmentRef } : {}),
  };
}

/** Las derivaciones de la persona por agendar (las nuevas del equipo médico), la más reciente primero. */
export function derivacionesPendientes(tareas: Task[]): DatosDerivacion[] {
  return tareas
    .filter((t) => esTareaDerivacion(t) && t.intent === 'order' && estadoTarea(t) === 'pendiente')
    .map(leerTareaDerivacion)
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
}

/**
 * ¿Esta tarea de derivación se puede resolver con este turno? (R-20). Tiene que ser una
 * derivación del plan, de este paciente, pendiente, y el servicio tiene que ser una
 * consulta del grupo de la especialidad derivada.
 */
export function validarTareaDerivacion(
  t: Task,
  opts: { pacienteRef: string; servicioCodigo: string },
): { ok: true; datos: DatosDerivacion } | { ok: false; error: string } {
  if (!esTareaDerivacion(t)) {
    return { ok: false, error: 'La tarea no es una derivación del Plan Bienestar 100 Días®.' };
  }
  if (t.for?.reference !== opts.pacienteRef) {
    return { ok: false, error: 'La tarea es de otro paciente.' };
  }
  if (estadoTarea(t) !== 'pendiente') {
    return { ok: false, error: 'La tarea ya no está pendiente (ya se agendó o se descartó).' };
  }
  const datos = leerTareaDerivacion(t);
  if (!datos.grupo) {
    return { ok: false, error: `La derivación a ${datos.titulo} no tiene consulta en el catálogo de SOM: queda como tarea del equipo.` };
  }
  if (!datos.servicios.includes(opts.servicioCodigo)) {
    return { ok: false, error: `La derivación a ${datos.titulo} se agenda con una consulta de ${datos.grupo}: ${datos.servicios.join(', ')}.` };
  }
  return { ok: true, datos };
}

/**
 * R-20 · Las consultas de derivación del catálogo firmado (`DERIVACIONES_PB100D`,
 * `soloDesdeTarea`) no se reservan sueltas: se agendan desde la derivación que decidió
 * el equipo médico.
 */
export function validarDerivacionSinTarea(servicioCodigo: string): ResultadoValidacion {
  if (!DERIVACIONES_PB100D.some((s) => s.codigo === servicioCodigo)) {
    return { ok: true, bloqueos: [], advertencias: [] };
  }
  return {
    ok: false,
    bloqueos: [
      {
        regla: 'R-20',
        nivel: 'bloqueo',
        mensaje: `Esta consulta se agenda desde una derivación del ${NOMBRE_PLAN_BIENESTAR} decidida por el equipo médico (ficha del paciente → Derivaciones).`,
      },
    ],
    advertencias: [],
  };
}
