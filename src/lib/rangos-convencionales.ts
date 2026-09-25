/**
 * Salud convencional: quita de una ObservationDefinition los rangos de medicina
 * funcional (`qualifiedInterval` con `tipo-rango = funcional`). Lógica pura; la usa
 * `npm run biomarcadores:convencional` sobre las definiciones que ya están en el
 * servidor y que este repositorio no administra.
 */
import type { ObservationDefinition } from '@medplum/fhirtypes';
import { SYSTEM } from '../fhir/identifiers.js';

const esFuncional = (iv: NonNullable<ObservationDefinition['qualifiedInterval']>[number]): boolean =>
  Boolean(iv.context?.coding?.some((c) => c.system === SYSTEM.tipoRango && c.code === 'funcional'));

export interface ResultadoLimpiezaRangos {
  definicion: ObservationDefinition;
  /** Cantidad de rangos funcionales quitados. */
  quitados: number;
  /** true si no le queda ningún rango (el portal no mostrará referencia). */
  sinRangos: boolean;
}

export function quitarRangosFuncionales(od: ObservationDefinition): ResultadoLimpiezaRangos {
  const intervalos = od.qualifiedInterval ?? [];
  const convencionales = intervalos.filter((iv) => !esFuncional(iv));
  const quitados = intervalos.length - convencionales.length;
  const definicion: ObservationDefinition = { ...od };
  if (convencionales.length > 0) {
    definicion.qualifiedInterval = convencionales;
  } else {
    delete definicion.qualifiedInterval;
  }
  return { definicion, quitados, sinRangos: convencionales.length === 0 };
}
