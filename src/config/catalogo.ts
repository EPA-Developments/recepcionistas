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
 * Derivaciones del catálogo firmado del Plan Bienestar 100 Días® (estadíos CKM 0 a 4,
 * 27/09/2026): Nefrología, Hepatología, Oftalmología, Cirugía Vascular, Psicología,
 * Trabajo Social, Podología, Farmacia Clínica y Kinesiología. Se agendan desde la tarea
 * de derivación del plan (R-20). Las cuatro primeras son consultas médicas por
 * especialidad y toman el precio de lista (R-17); las cinco restantes no están en la
 * lista oficial: precio PENDIENTE (ver docs/decisiones-pendientes.md).
 *
 * Modalidad (R-21): cada consulta se ofrece presencial y por teleconsulta. Es un
 * atributo del turno, no un servicio aparte: "Teleconsulta de Cardiología" es la misma
 * consulta de Cardiología por videollamada (`nombreSegunModalidad`).
 *
 * Especialidad: SNOMED CT del value set FHIR `c80-practice-codes`. Las
 * subespecialidades cardiológicas sin código propio van con Cardiología; Nutrición no
 * tiene código en ese value set (solo texto).
 *
 * Precios (lista oficial, Dr. D'Alessandro, 26/09/2026):
 *  - Consulta por especialidad: ARS 150.000, el mismo precio presencial y por
 *    teleconsulta y para todos los profesionales (`PRECIO_CONSULTA_ESPECIALIDAD_ARS`).
 *  - Consulta del Plan Bienestar 100 Días®: incluida en el plan (la paciente no paga
 *    ni deja seña). Dentro del plan está presupuestada en ARS 100.000 cada una: queda
 *    como valor de referencia interno (`valorReferenciaARS`), nunca como cargo.
 *  - Control GLP-1: PENDIENTE (ver docs/decisiones-pendientes.md, Seguimiento GLP-1).
 * Duración: 30 minutos por consulta (misma decisión), sobre la grilla de 30.
 */
import type { CategoriaServicio, Especialidad, Modalidad, Servicio, Split } from '../domain/types.js';
import type { ResponsableCatalogo } from './catalogo-pb100d.js';

const SOM100: Split = { tipo: 'SOM_100' };

/** Nota estándar mientras no haya lista de precios. */
const PRECIO_PENDIENTE = 'Precio PENDIENTE — cargar desde la lista oficial de Segunda Opinión Médica.';

/** Precio de lista (ARS) de toda consulta por especialidad, en cualquier modalidad. */
export const PRECIO_CONSULTA_ESPECIALIDAD_ARS = 150_000;

/** Lo que el Plan Bienestar 100 Días® presupuesta por cada una de sus tres consultas (referencia interna, no se cobra). */
export const VALOR_REFERENCIA_CONSULTA_PB100D_ARS = 100_000;

/** Duración de una consulta (presencial o teleconsulta), en minutos. */
export const DURACION_CONSULTA_MIN = 30;

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
  // Derivaciones del catálogo firmado del Plan Bienestar 100 Días® (27/09/2026).
  { codigo: 'nefrologia', nombre: 'Nefrología' },
  { codigo: 'hepatologia', nombre: 'Hepatología' },
  { codigo: 'oftalmologia', nombre: 'Oftalmología' },
  { codigo: 'cirugia-vascular', nombre: 'Cirugía Vascular' },
  { codigo: 'psicologia', nombre: 'Psicología' },
  { codigo: 'trabajo-social', nombre: 'Trabajo Social' },
  { codigo: 'podologia', nombre: 'Podología' },
  { codigo: 'farmacia-clinica', nombre: 'Farmacia Clínica' },
  { codigo: 'kinesiologia', nombre: 'Kinesiología' },
] as const;

/** Grupos de las derivaciones del Plan Bienestar 100 Días®: se agendan desde su tarea. */
export const GRUPOS_DERIVACION_PB100D: readonly GrupoEspecialidad[] = [
  'nefrologia',
  'hepatologia',
  'oftalmologia',
  'cirugia-vascular',
  'psicologia',
  'trabajo-social',
  'podologia',
  'farmacia-clinica',
  'kinesiologia',
];

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
  /** Precio en ARS. Por defecto, el de consulta por especialidad. */
  precioARS?: number;
  valorReferenciaARS?: number;
  /** Por defecto, `DURACION_CONSULTA_MIN`. */
  duracionMin?: number;
  nota?: string;
}

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
  // Derivaciones del catálogo firmado del Plan Bienestar 100 Días® (27/09/2026). Se
  // agendan desde la tarea de derivación (R-20). Las consultas médicas por especialidad
  // toman el precio de lista (R-17).
  {
    codigo: 'NEFROLOGIA',
    nombre: 'Consulta de Nefrología',
    categoria: 'NEFROLOGIA',
    grupo: 'nefrologia',
    soloDesdeTarea: true,
    especialidad: { snomed: '394589003', snomedDisplay: 'Nephrology', nombre: 'Nefrología' },
  },
  {
    codigo: 'HEPATOLOGIA',
    nombre: 'Consulta de Hepatología',
    categoria: 'HEPATOLOGIA',
    grupo: 'hepatologia',
    soloDesdeTarea: true,
    especialidad: { snomed: '408472002', snomedDisplay: 'Hepatology', nombre: 'Hepatología' },
  },
  {
    codigo: 'OFTALMOLOGIA',
    nombre: 'Consulta de Oftalmología',
    categoria: 'OFTALMOLOGIA',
    grupo: 'oftalmologia',
    soloDesdeTarea: true,
    especialidad: { snomed: '394594003', snomedDisplay: 'Ophthalmology', nombre: 'Oftalmología' },
  },
  {
    codigo: 'CIRUGIA_VASCULAR',
    nombre: 'Consulta de Cirugía Vascular',
    categoria: 'CIRUGIA_VASCULAR',
    grupo: 'cirugia-vascular',
    soloDesdeTarea: true,
    // Código c80-practice-codes a confirmar en el navegador oficial de SNOMED CT: solo texto.
    especialidad: { nombre: 'Cirugía Vascular' },
  },
  // Profesiones fuera de la lista oficial de precios: precio PENDIENTE.
  {
    codigo: 'PSICOLOGIA',
    nombre: 'Consulta de Psicología',
    categoria: 'PSICOLOGIA',
    grupo: 'psicologia',
    soloDesdeTarea: true,
    precioARS: 0,
    especialidad: { nombre: 'Psicología' },
    nota: PRECIO_PENDIENTE,
  },
  {
    codigo: 'TRABAJO_SOCIAL',
    nombre: 'Consulta de Trabajo Social',
    categoria: 'TRABAJO_SOCIAL',
    grupo: 'trabajo-social',
    soloDesdeTarea: true,
    precioARS: 0,
    especialidad: { nombre: 'Trabajo Social' },
    nota: PRECIO_PENDIENTE,
  },
  {
    codigo: 'PODOLOGIA',
    nombre: 'Consulta de Podología',
    categoria: 'PODOLOGIA',
    grupo: 'podologia',
    soloDesdeTarea: true,
    precioARS: 0,
    especialidad: { nombre: 'Podología' },
    nota: PRECIO_PENDIENTE,
  },
  {
    codigo: 'FARMACIA_CLINICA',
    nombre: 'Consulta de Farmacia Clínica',
    categoria: 'FARMACIA_CLINICA',
    grupo: 'farmacia-clinica',
    soloDesdeTarea: true,
    precioARS: 0,
    especialidad: { nombre: 'Farmacia Clínica' },
    nota: PRECIO_PENDIENTE,
  },
  {
    codigo: 'KINESIOLOGIA',
    nombre: 'Consulta de Kinesiología',
    categoria: 'KINESIOLOGIA',
    grupo: 'kinesiologia',
    soloDesdeTarea: true,
    precioARS: 0,
    especialidad: { nombre: 'Kinesiología' },
    nota: PRECIO_PENDIENTE,
  },
  // Plan Bienestar 100 Días®: las tres consultas programadas (días 1, 50 y 100).
  {
    codigo: CODIGO_CONSULTA_PB100D,
    nombre: 'Consulta del Plan Bienestar 100 Días®',
    categoria: 'PLAN_BIENESTAR',
    incluidaEnPlan: true,
    soloDesdeTarea: true,
    precioARS: 0,
    valorReferenciaARS: VALOR_REFERENCIA_CONSULTA_PB100D_ARS,
    nota: 'Incluida en el Plan Bienestar 100 Días®: sin cargo ni seña.',
  },
  // Seguimiento GLP-1 (ver docs/glp1.md): en consultorio, desde su tarea (R-19).
  // Precio y duración PENDIENTES (decisión "Seguimiento GLP-1"): 45 min provisional.
  {
    codigo: CODIGO_CONTROL_GLP1,
    nombre: 'Seguimiento de tratamiento GLP-1 — Control',
    categoria: 'SEGUIMIENTO_GLP1',
    modalidades: ['presencial'],
    soloDesdeTarea: true,
    precioARS: 0,
    duracionMin: 45,
    nota: PRECIO_PENDIENTE,
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
  duracionMin: c.duracionMin ?? DURACION_CONSULTA_MIN,
  precioUSD: 0,
  precioARS: c.precioARS ?? PRECIO_CONSULTA_ESPECIALIDAD_ARS, // en ARS fijo, sin conversión (R-17)
  ...(c.valorReferenciaARS != null ? { valorReferenciaARS: c.valorReferenciaARS } : {}),
  reglaPricing: 'POR_SESION',
  split: SOM100,
  ...(c.nota ? { nota: c.nota } : {}),
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

/** Consultas de la lista oficial: las que el portal ofrece sin tarea previa. */
export const CONSULTAS_LISTA_OFICIAL: Servicio[] = CONSULTAS_POR_ESPECIALIDAD.filter((s) => !s.soloDesdeTarea);

/** Derivaciones del Plan Bienestar 100 Días®: sólo desde la tarea de derivación del plan. */
export const DERIVACIONES_PB100D: Servicio[] = CONSULTAS_POR_ESPECIALIDAD.filter((s) => s.soloDesdeTarea);

/**
 * Consulta del catálogo que atiende cada derivación del catálogo firmado del plan
 * (`responsable` de `src/config/catalogo-pb100d.ts`). Los responsables sin consulta
 * propia (equipo, enfermería, educador, coordinación, imagen, la persona) no se agendan
 * como consulta y quedan fuera. Obstetricia se atiende en Ginecología (tocoginecología).
 */
export const SERVICIO_POR_RESPONSABLE_PB100D: Partial<Record<ResponsableCatalogo, string>> = {
  cardiologia: 'CARDIOLOGIA',
  electrofisiologia: 'ELECTROFISIOLOGIA',
  rehabilitacion: 'REHABILITACION_CV',
  endocrinologia: 'DIABETOLOGIA_ENDOCRINOLOGIA',
  nutricion: 'NUTRICION',
  neumonologia: 'TISIONEUMONOLOGIA',
  neurologia: 'NEUROLOGIA',
  obstetricia: 'GINECOLOGIA',
  nefrologia: 'NEFROLOGIA',
  hepatologia: 'HEPATOLOGIA',
  oftalmologia: 'OFTALMOLOGIA',
  'cirugia-vascular': 'CIRUGIA_VASCULAR',
  psicologia: 'PSICOLOGIA',
  'trabajo-social': 'TRABAJO_SOCIAL',
  farmacia: 'FARMACIA_CLINICA',
  kinesiologia: 'KINESIOLOGIA',
};

/** Consulta del catálogo para una derivación del plan, si la especialidad tiene consulta propia. */
export function servicioDeDerivacion(responsable: ResponsableCatalogo): Servicio | undefined {
  const codigo = SERVICIO_POR_RESPONSABLE_PB100D[responsable];
  return codigo ? SERVICIOS_POR_CODIGO.get(codigo) : undefined;
}

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
