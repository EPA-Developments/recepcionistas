/**
 * Motor de reglas de agenda / validación de turnos.
 * Funciones puras: reciben datos planos y devuelven un resultado de validación.
 *
 * Reglas cubiertas:
 *  R-07 Capacidad de recursos
 *  R-13 Ventana de reserva
 *  R-14 Cancelación / reagenda
 */
import { CANCELACION, VENTANA_RESERVA_HORAS, type PerfilReserva } from '../config/reglas.js';
import { RECURSOS_POR_CODIGO } from '../config/recursos.js';

export type NivelValidacion = 'ok' | 'advertencia' | 'bloqueo';

export interface Issue {
  regla: string;
  nivel: 'advertencia' | 'bloqueo';
  mensaje: string;
}

export interface ResultadoValidacion {
  ok: boolean;
  bloqueos: Issue[];
  advertencias: Issue[];
}

function resultado(issues: Issue[]): ResultadoValidacion {
  const bloqueos = issues.filter((i) => i.nivel === 'bloqueo');
  const advertencias = issues.filter((i) => i.nivel === 'advertencia');
  return { ok: bloqueos.length === 0, bloqueos, advertencias };
}

const HORA_MS = 60 * 60 * 1000;

// --------------------------------------------------------------------------
// R-07 · Capacidad por recurso
// --------------------------------------------------------------------------

export interface ReservaRecurso {
  recursoCodigo: string;
  inicio: Date;
  fin: Date;
  etiqueta?: string;
}

/** Máximo de reservas simultáneas en un conjunto de intervalos (barrido). */
function maxConcurrentes(reservas: ReservaRecurso[]): number {
  const eventos: Array<{ t: number; delta: number }> = [];
  for (const r of reservas) {
    eventos.push({ t: r.inicio.getTime(), delta: 1 });
    eventos.push({ t: r.fin.getTime(), delta: -1 });
  }
  // Cierres antes que aperturas al mismo instante (un turno termina justo cuando otro arranca).
  eventos.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let actual = 0;
  let max = 0;
  for (const e of eventos) {
    actual += e.delta;
    if (actual > max) {
      max = actual;
    }
  }
  return max;
}

/** No se puede exceder la capacidad de un mismo recurso físico en una franja. */
export function validarCapacidadRecurso(reservas: ReservaRecurso[]): ResultadoValidacion {
  const issues: Issue[] = [];
  const porRecurso = new Map<string, ReservaRecurso[]>();
  for (const r of reservas) {
    const arr = porRecurso.get(r.recursoCodigo) ?? [];
    arr.push(r);
    porRecurso.set(r.recursoCodigo, arr);
  }
  for (const [codigo, arr] of porRecurso) {
    const capacidad = RECURSOS_POR_CODIGO.get(codigo)?.capacidad ?? 1;
    if (maxConcurrentes(arr) > capacidad) {
      issues.push({
        regla: 'R-07',
        nivel: 'bloqueo',
        mensaje: `Se excede la capacidad del recurso ${codigo} (máx ${capacidad}).`,
      });
    }
  }
  return resultado(issues);
}

/** Valida capacidad de recursos. */
export function validarRecursos(reservas: ReservaRecurso[]): ResultadoValidacion {
  return validarCapacidadRecurso(reservas);
}

// --------------------------------------------------------------------------
// R-13 · Ventana de reserva (anticipación máxima)
// --------------------------------------------------------------------------

export function validarVentanaReserva(
  perfil: PerfilReserva,
  ahora: Date,
  inicioTurno: Date,
): ResultadoValidacion {
  const anticipacionHoras = (inicioTurno.getTime() - ahora.getTime()) / HORA_MS;
  if (anticipacionHoras < 0) {
    return resultado([{ regla: 'R-13', nivel: 'bloqueo', mensaje: 'El turno está en el pasado.' }]);
  }
  const maxHoras = VENTANA_RESERVA_HORAS[perfil];
  if (anticipacionHoras > maxHoras) {
    return resultado([
      {
        regla: 'R-13',
        nivel: 'bloqueo',
        mensaje: `Excede la ventana de reserva de ${maxHoras} h para el perfil ${perfil}.`,
      },
    ]);
  }
  return resultado([]);
}

// --------------------------------------------------------------------------
// R-14 · Cancelación / reagenda
// --------------------------------------------------------------------------

export interface ResultadoCancelacion {
  /** Horas que faltan para el turno. */
  horasRestantes: number;
  /** Con menos de 24 h, la sesión se considera consumida. */
  consumeSesion: boolean;
  /** Con 24 h o más, se devuelve el saldo. */
  devuelveSaldo: boolean;
}

/**
 * Evalúa una cancelación. Con < 24 h la sesión se consume, salvo fuerza mayor
 * médica documentada (autorizable por un médico).
 */
export function evaluarCancelacion(
  ahora: Date,
  inicioTurno: Date,
  opts: { fuerzaMayorMedica?: boolean } = {},
): ResultadoCancelacion {
  const horasRestantes = (inicioTurno.getTime() - ahora.getTime()) / HORA_MS;
  const dentroDeVentana = horasRestantes >= CANCELACION.minHoras;
  const consumeSesion = !dentroDeVentana && !opts.fuerzaMayorMedica;
  return {
    horasRestantes,
    consumeSesion,
    devuelveSaldo: !consumeSesion,
  };
}

/** Combina varios resultados en uno solo. */
export function combinar(...resultados: ResultadoValidacion[]): ResultadoValidacion {
  return resultado(resultados.flatMap((r) => [...r.bloqueos, ...r.advertencias]));
}
