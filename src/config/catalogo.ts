/**
 * Catálogo de servicios — Segunda Opinión Médica.
 *
 * Consultas por especialidad, definidas por el Dr. Alejandro Sergio D'Alessandro con
 * el Dr. Alejandro Barbagelata. Para el Plan Bienestar 100 Días® son las consultas
 * fuera de lo programado: con cargo y sin límite de cantidad.
 *  - DBT / Endocrino, Nutrición, Cardiología, Tisioneumonología, Neurología y Ginecología.
 *  - Cardiología con especialidad: Insuficiencia Cardíaca, Hemodinamia,
 *    Electrofisiología, Medicina Nuclear, Prevención CV y Rehabilitación CV.
 * Además, la consulta programada del Plan Bienestar (incluida en el plan; ver
 * `src/config/plan-bienestar.ts`) y el control del seguimiento GLP-1.
 *
 * Modalidad (R-21): cada consulta se ofrece presencial y por teleconsulta. Es un
 * atributo del turno, no un servicio aparte: "Teleconsulta de Cardiología" es la misma
 * consulta de Cardiología por videollamada (`nombreSegunModalidad`).
 *
 * Especialidad: SNOMED CT del value set FHIR `c80-practice-codes`. Las
 * subespecialidades cardiológicas sin código propio van con Cardiología; Nutrición no
 * tiene código en ese value set (solo texto).
 *
 * ⚠️ PRECIOS PENDIENTES. La lista de precios la arman el Dr. D'Alessandro y el Dr.
 * Barbagelata: hasta entonces las consultas quedan con `precioARS: 0` y `nota` de
 * pendiente. NO se inventan precios (principio del repo: la fuente de verdad es la
 * lista oficial). La consulta del Plan Bienestar sí va en 0: está incluida en el plan.
 */
import type { CategoriaServicio, Especialidad, Modalidad, Servicio, Split } from '../domain/types.js';

const SOM100: Split = { tipo: 'SOM_100' };

/** Nota estándar mientras no haya lista de precios. */
const PRECIO_PENDIENTE = 'Precio PENDIENTE — cargar desde la lista oficial de Segunda Opinión Médica.';

/** Código del control del programa de seguimiento GLP-1 (lo agendan las tareas del programa). */
export const CODIGO_CONTROL_GLP1 = 'CONTROL_GLP1';

/** Código de la consulta programada del Plan Bienestar 100 Días® (días 1, 50 y 100). */
export const CODIGO_CONSULTA_PB100D = 'CONSULTA_PB100D';

/** Grupos en que el portal muestra las consultas por especialidad (orden de la lista). */
export const GRUPOS_ESPECIALIDAD = [
  { codigo: 'dbt-endocrino', nombre: 'DBT / Endocrino' },
  { codigo: 'nutricion', nombre: 'Nutrición' },
  { codigo: 'cardiologia', nombre: 'Cardiología' },
  { codigo: 'cardiologia-especialidad', nombre: 'Cardiología con especialidad' },
  { codigo: 'tisioneumonologia', nombre: 'Tisioneumonología' },
  { codigo: 'neurologia', nombre: 'Neurología' },
  { codigo: 'ginecologia', nombre: 'Ginecología' },
] as const;

export type GrupoEspecialidad = (typeof GRUPOS_ESPECIALIDAD)[number]['codigo'];

const AMBAS: Modalidad[] = ['presencial', 'teleconsulta'];

/** SNOMED CT (c80-practice-codes) de las especialidades con código. */
const CARDIOLOGY = { snomed: '394579002', snomedDisplay: 'Cardiology' };

interface DefConsulta {
  codigo: string;
  nombre: string;
  categoria: CategoriaServicio;
  modalidades?: Modalidad[];
  grupo?: GrupoEspecialidad;
  especialidad?: Especialidad;
  incluidaEnPlan?: boolean;
  soloDesdeTarea?: boolean;
  nota?: string;
}

/** Duración provisional de 45 min (a confirmar con la operación, también en teleconsulta). */
const CONSULTAS: DefConsulta[] = [
  // Cardiología
  {
    codigo: 'CARDIOLOGIA',
    nombre: 'Consulta de Cardiología',
    categoria: 'CARDIOLOGIA',
    grupo: 'cardiologia',
    especialidad: { ...CARDIOLOGY, nombre: 'Cardiología' },
  },
  // Cardiología con especialidad
  {
    codigo: 'INSUFICIENCIA_CARDIACA',
    nombre: 'Consulta de Insuficiencia Cardíaca',
    categoria: 'INSUFICIENCIA_CARDIACA',
    grupo: 'cardiologia-especialidad',
    especialidad: { ...CARDIOLOGY, nombre: 'Insuficiencia Cardíaca' },
  },
  {
    codigo: 'HEMODINAMIA',
    nombre: 'Consulta de Hemodinamia',
    categoria: 'HEMODINAMIA',
    grupo: 'cardiologia-especialidad',
    especialidad: { ...CARDIOLOGY, nombre: 'Hemodinamia' },
  },
  {
    codigo: 'ELECTROFISIOLOGIA',
    nombre: 'Consulta de Electrofisiología',
    categoria: 'ELECTROFISIOLOGIA',
    grupo: 'cardiologia-especialidad',
    especialidad: { ...CARDIOLOGY, nombre: 'Electrofisiología' },
  },
  {
    codigo: 'MEDICINA_NUCLEAR',
    nombre: 'Consulta de Medicina Nuclear',
    categoria: 'MEDICINA_NUCLEAR',
    grupo: 'cardiologia-especialidad',
    especialidad: { snomed: '394649004', snomedDisplay: 'Nuclear medicine', nombre: 'Medicina Nuclear' },
  },
  {
    codigo: 'PREVENCION_CV',
    nombre: 'Consulta de Prevención Cardiovascular',
    categoria: 'PREVENCION_CV',
    grupo: 'cardiologia-especialidad',
    especialidad: { ...CARDIOLOGY, nombre: 'Prevención Cardiovascular' },
  },
  {
    codigo: 'REHABILITACION_CV',
    nombre: 'Consulta de Rehabilitación Cardiovascular',
    categoria: 'REHABILITACION_CV',
    grupo: 'cardiologia-especialidad',
    especialidad: { ...CARDIOLOGY, nombre: 'Rehabilitación Cardiovascular' },
  },
  // Otras especialidades
  {
    codigo: 'DIABETOLOGIA_ENDOCRINOLOGIA',
    nombre: 'Consulta de Diabetología y Endocrinología',
    categoria: 'DIABETOLOGIA_ENDOCRINOLOGIA',
    grupo: 'dbt-endocrino',
    especialidad: { snomed: '394583002', snomedDisplay: 'Endocrinology', nombre: 'Diabetología y Endocrinología' },
  },
  {
    codigo: 'NUTRICION',
    nombre: 'Consulta de Nutrición',
    categoria: 'NUTRICION',
    grupo: 'nutricion',
    especialidad: { nombre: 'Nutrición' },
  },
  {
    codigo: 'TISIONEUMONOLOGIA',
    nombre: 'Consulta de Tisioneumonología',
    categoria: 'TISIONEUMONOLOGIA',
    grupo: 'tisioneumonologia',
    especialidad: { snomed: '418112009', snomedDisplay: 'Pulmonary medicine', nombre: 'Tisioneumonología' },
  },
  {
    codigo: 'NEUROLOGIA',
    nombre: 'Consulta de Neurología',
    categoria: 'NEUROLOGIA',
    grupo: 'neurologia',
    especialidad: { snomed: '394591006', snomedDisplay: 'Neurology', nombre: 'Neurología' },
  },
  {
    codigo: 'GINECOLOGIA',
    nombre: 'Consulta de Ginecología',
    categoria: 'GINECOLOGIA',
    grupo: 'ginecologia',
    especialidad: { snomed: '394586005', snomedDisplay: 'Gynecology', nombre: 'Ginecología' },
  },
  // Plan Bienestar 100 Días®: las tres consultas programadas (días 1, 50 y 100).
  {
    codigo: CODIGO_CONSULTA_PB100D,
    nombre: 'Consulta del Plan Bienestar 100 Días®',
    categoria: 'PLAN_BIENESTAR',
    incluidaEnPlan: true,
    soloDesdeTarea: true,
    nota: 'Incluida en el Plan Bienestar 100 Días®: sin cargo ni seña.',
  },
  // Seguimiento GLP-1 (ver docs/glp1.md): en consultorio, desde su tarea (R-19).
  {
    codigo: CODIGO_CONTROL_GLP1,
    nombre: 'Seguimiento de tratamiento GLP-1 — Control',
    categoria: 'SEGUIMIENTO_GLP1',
    modalidades: ['presencial'],
    soloDesdeTarea: true,
  },
];

export const SERVICIOS: Servicio[] = CONSULTAS.map((c) => ({
  codigo: c.codigo,
  nombre: c.nombre,
  categoria: c.categoria,
  modalidades: c.modalidades ?? AMBAS,
  ...(c.especialidad ? { especialidad: c.especialidad } : {}),
  ...(c.grupo ? { grupo: c.grupo } : {}),
  ...(c.incluidaEnPlan ? { incluidaEnPlan: true } : {}),
  ...(c.soloDesdeTarea ? { soloDesdeTarea: true } : {}),
  duracionMin: 45, // provisional — confirmar con la operación
  precioUSD: 0,
  precioARS: 0, // PENDIENTE (o incluida en el plan) — se cobra en ARS cuando haya lista de precios
  reglaPricing: 'POR_SESION',
  split: SOM100,
  nota: c.nota ?? PRECIO_PENDIENTE,
}));

/** Índice por código para lookups O(1). */
export const SERVICIOS_POR_CODIGO: ReadonlyMap<string, Servicio> = new Map(
  SERVICIOS.map((s) => [s.codigo, s]),
);

export function getServicio(codigo: string): Servicio {
  const s = SERVICIOS_POR_CODIGO.get(codigo);
  if (!s) {
    throw new Error(`Servicio desconocido: ${codigo}`);
  }
  return s;
}

/** Consultas por especialidad (las que tienen grupo), en el orden del catálogo. */
export const CONSULTAS_POR_ESPECIALIDAD: Servicio[] = SERVICIOS.filter((s) => s.grupo);

/** ¿El servicio se ofrece en esa modalidad? (R-21). */
export function ofreceModalidad(s: Pick<Servicio, 'modalidades'>, modalidad: Modalidad): boolean {
  return s.modalidades.includes(modalidad);
}

/**
 * Nombre visible según la modalidad: "Consulta de Cardiología" por teleconsulta es
 * "Teleconsulta de Cardiología". Los servicios que no empiezan con "Consulta" no cambian.
 */
export function nombreSegunModalidad(s: Pick<Servicio, 'nombre'>, modalidad: Modalidad): string {
  return modalidad === 'teleconsulta' ? s.nombre.replace(/^Consulta\b/, 'Teleconsulta') : s.nombre;
}
