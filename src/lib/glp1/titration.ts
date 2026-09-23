// Esquema de titulación de un GLP-1 — contrato INTERINO.
//
// `monitoring.ts` usa `Indication`, `TitrationSchedule` y `weeksToTherapeuticDose`
// del `titration.ts` original, que todavía no está en este repo. Mientras tanto el
// esquema lo carga el médico escalón por escalón (dosis y semanas) y marca en cuál
// se alcanza la dosis terapéutica: el sistema no propone dosis ni esquemas (no se
// inventan reglas clínicas). Al integrar el original, reemplazar este archivo.

/** `dm2`: esquema de diabetes tipo 2 · `weight`: esquema de control de peso. */
export type Indication = 'dm2' | 'weight';

export interface TitrationStep {
  /** Dosis del escalón, tal como la indica el médico (p. ej. "0,25 mg semanal"). */
  dose: string;
  /** Semanas que dura el escalón antes de pasar al siguiente. */
  weeks: number;
  /** Escalón en el que se alcanza la dosis terapéutica. */
  therapeutic?: boolean;
}

export interface TitrationSchedule {
  indication: Indication;
  molecule: string;
  steps: TitrationStep[];
}

/** Semanas desde el inicio hasta llegar a la dosis terapéutica (suma de los escalones previos). */
export function weeksToTherapeuticDose(schedule: TitrationSchedule): number {
  const i = schedule.steps.findIndex((s) => s.therapeutic);
  if (i < 0) {
    throw new Error('El esquema de titulación no marca la dosis terapéutica.');
  }
  return schedule.steps.slice(0, i).reduce((semanas, s) => semanas + s.weeks, 0);
}
