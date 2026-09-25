/**
 * Plan CKM según la Guía 2026 de la AHA/ACC/ADA/ASN — lógica pura.
 *
 * A partir del estadío (`ckm.ts`) y del riesgo PREVENT, arma lo que la guía indica
 * para ese paciente, con la fuente de cada ítem:
 *  - seguimiento: qué evaluar y cada cuánto según el estadío (Figura 3, Sección 3.1.1);
 *  - evaluaciones: estudios que la guía sugiere ahora (UACR desde el Estadío 2,
 *    pre-IC con PREVENT-HF ≥ 5 %, calcio coronario con PREVENT-ASCVD 3 % a < 10 %);
 *  - consideraciones: umbrales de riesgo que la guía asocia a decisiones
 *    terapéuticas (Tabla 8; HTA, Sección 5.5.3; ERC, mensaje clave 8);
 *  - potenciadores de riesgo CKM detectados (Tabla 9).
 *
 * Es soporte a la decisión para el médico, no una indicación: el sistema no
 * prescribe. Umbrales en `src/config/ckm.ts` (pendientes de firma médica).
 */
import { UMBRALES_PREVENT_GUIA as P } from '../config/ckm.js';
import type { EntradaCkm, ResultadoCkm } from './ckm.js';

/** Riesgos PREVENT (probabilidades 0–1) que usa el plan. */
export interface RiesgosPrevent {
  ecv10?: number;
  ascvd10?: number;
  ic10?: number;
  ascvd30?: number;
}

export interface ItemGuia {
  texto: string;
  /** Sección, tabla o figura de la guía (o guía complementaria) que lo respalda. */
  fuente: string;
}

export interface PlanCkm {
  seguimiento: ItemGuia[];
  evaluaciones: ItemGuia[];
  consideraciones: ItemGuia[];
  potenciadores: string[];
}

const GUIA = 'Guía CKM 2026';
const def = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const pct = (p: number): string => `${(p * 100).toFixed(1).replace('.', ',')} %`;

/** Nivel numérico del estadío (4a/4b → 4). */
export const nivelEstadio = (estadio: ResultadoCkm['estadio']): number =>
  ({ '0': 0, '1': 1, '2': 2, '3': 3, '4a': 4, '4b': 4 })[estadio];

export function planCkm(
  ckm: ResultadoCkm,
  e: EntradaCkm,
  riesgos: RiesgosPrevent,
  potenciadores: string[] = [],
  faltantesPrevent: string[] = [],
): PlanCkm {
  const nivel = nivelEstadio(ckm.estadio);
  const prediabetes = ckm.criterios.some((c) => c.startsWith('prediabetes'));
  const diabetes = ckm.criterios.some((c) => c.startsWith('diabetes'));
  const erc = ckm.riesgoKdigo !== undefined && ckm.riesgoKdigo !== 'bajo';
  const ercAvanzada = ckm.riesgoKdigo === 'muy-alto';
  const prevAplica = nivel < 4 && (!def(e.edad) || (e.edad >= 30 && e.edad <= 79));

  // ───────── Seguimiento (Figura 3) ─────────
  const seguimiento: ItemGuia[] = [
    { texto: 'IMC y circunferencia de cintura: anual.', fuente: `${GUIA}, Figura 3` },
    { texto: 'Presión arterial: al menos anual (idealmente en cada consulta).', fuente: `${GUIA}, Figura 3` },
  ];
  if (nivel === 0) {
    seguimiento.push({ texto: 'Lípidos, glucemia y eGFR: al menos cada 5 años.', fuente: `${GUIA}, Figura 3` });
  } else if (nivel === 1) {
    seguimiento.push({ texto: 'Lípidos, glucemia y eGFR: cada 2–3 años.', fuente: `${GUIA}, Figura 3` });
    if (prediabetes) {
      seguimiento.push({ texto: 'Con prediabetes: evaluar diabetes (glucemia o HbA1c) cada año.', fuente: `${GUIA}, Sección 3.1.1` });
    }
  } else {
    seguimiento.push({
      texto: `Lípidos, ${diabetes ? 'HbA1c' : 'glucemia'}, eGFR y albuminuria (UACR): al menos anual.`,
      fuente: `${GUIA}, Figura 3`,
    });
  }
  if (ercAvanzada) {
    seguimiento.push({ texto: 'ERC de muy alto riesgo: eGFR y UACR cada 3–6 meses.', fuente: `${GUIA}, Sección 3.1.1 (KDIGO)` });
  }
  seguimiento.push(
    prevAplica
      ? { texto: 'Recalcular PREVENT (10 y 30 años) con cada evaluación de factores de riesgo.', fuente: `${GUIA}, Sección 4.1` }
      : {
          texto:
            nivel >= 4
              ? 'PREVENT no se usa con ECV clínica (Estadío 4).'
              : 'PREVENT se valida para 30–79 años: no aplica a esta edad.',
          fuente: `${GUIA}, Figura 4`,
        },
  );

  // ───────── Evaluaciones sugeridas ─────────
  const evaluaciones: ItemGuia[] = [];
  if (ckm.faltantes.includes('circunferencia de cintura')) {
    evaluaciones.push({ texto: 'Medir la circunferencia de cintura además del IMC.', fuente: `${GUIA}, Sección 3.1` });
  }
  if (nivel >= 2 && !def(e.uacr)) {
    evaluaciones.push({ texto: 'Solicitar albuminuria (UACR) junto con el eGFR.', fuente: `${GUIA}, Sección 3.1` });
  }
  if (prevAplica && faltantesPrevent.length > 0 && !def(riesgos.ecv10)) {
    evaluaciones.push({
      texto: `Completar los datos para calcular PREVENT (${faltantesPrevent.join('; ')}).`,
      fuente: `${GUIA}, Sección 4.1`,
    });
  }
  const preIcSinEvaluar = ckm.subclinicaSinEvaluar.some((s) => s.startsWith('pre-IC'));
  if (nivel < 3 && def(riesgos.ic10) && riesgos.ic10 >= P.ic10aEvaluarPreIc && preIcSinEvaluar) {
    evaluaciones.push({
      texto:
        `PREVENT-HF a 10 años ${pct(riesgos.ic10)} (≥ 5 %): evaluar pre-IC con NT-proBNP o BNP ` +
        '(troponina us en obesidad) y coordinar cuidados; el ecocardiograma refina el riesgo.',
      fuente: `${GUIA}, Tabla 8 y Figura 12`,
    });
  }
  const sinAterosclerosis = ckm.subclinicaSinEvaluar.some((s) => s.startsWith('aterosclerosis'));
  if (
    nivel < 3 &&
    def(riesgos.ascvd10) &&
    riesgos.ascvd10 >= P.ascvd10aEvaluarSubclinica.desde &&
    riesgos.ascvd10 < P.ascvd10aEvaluarSubclinica.hasta &&
    sinAterosclerosis
  ) {
    evaluaciones.push({
      texto:
        `PREVENT-ASCVD a 10 años ${pct(riesgos.ascvd10)} (3 % a < 10 %): si hay incertidumbre sobre iniciar o ` +
        'intensificar el tratamiento, considerar calcio coronario.',
      fuente: `${GUIA}, Tabla 8 (guía de dislipidemia 2026)`,
    });
  }

  // ───────── Consideraciones (umbrales de la guía para decisiones del médico) ─────────
  const consideraciones: ItemGuia[] = [];
  if (prevAplica && def(riesgos.ecv10) && riesgos.ecv10 >= P.ecv10aPriorizar && diabetes) {
    consideraciones.push({
      texto: `PREVENT-CVD a 10 años ${pct(riesgos.ecv10)} (≥ 7,5 %) con DM2: la guía prioriza SGLT2i o terapia basada en GLP-1 con beneficio probado.`,
      fuente: `${GUIA}, Tabla 8 y Sección 5.5.1`,
    });
  }
  const pas = e.pas;
  const pad = e.pad;
  const pa140 = (def(pas) && pas >= 140) || (def(pad) && pad >= 90);
  const pa130 = (def(pas) && pas >= 130) || (def(pad) && pad >= 80);
  if (pa130) {
    const indicacionConPa130 =
      diabetes || erc || nivel >= 4 || (def(riesgos.ecv10) && riesgos.ecv10 >= P.ecv10aPriorizar);
    if (e.tratamientoHta) {
      consideraciones.push({
        texto: `PA ${pas ?? '—'}/${pad ?? '—'} mmHg en tratamiento: la meta de la guía es < 130/80 mmHg.`,
        fuente: `${GUIA}, Sección 5.5.3 (guía de HTA 2025)`,
      });
    } else if (pa140 || indicacionConPa130) {
      consideraciones.push({
        texto:
          `PA ${pas ?? '—'}/${pad ?? '—'} mmHg: la guía de HTA 2025 indica tratamiento farmacológico además del estilo de vida ` +
          `(${pa140 ? 'PA ≥ 140/90' : 'PA ≥ 130/80 con diabetes, ERC, ECV clínica o PREVENT-CVD ≥ 7,5 %'}); meta < 130/80 mmHg.`,
        fuente: `${GUIA}, Tabla 8 y Sección 5.5.3`,
      });
    }
  }
  if (prevAplica && def(riesgos.ascvd10)) {
    if (riesgos.ascvd10 >= P.ascvd10aIniciarHipolipemiante) {
      consideraciones.push({
        texto: `PREVENT-ASCVD a 10 años ${pct(riesgos.ascvd10)} (≥ 5 %): la guía de dislipidemia 2026 recomienda iniciar tratamiento hipolipemiante.`,
        fuente: `${GUIA}, Tabla 8`,
      });
    } else if (riesgos.ascvd10 >= P.ascvd10aConsiderarHipolipemiante) {
      consideraciones.push({
        texto:
          `PREVENT-ASCVD a 10 años ${pct(riesgos.ascvd10)} (3 % a < 5 %): considerar tratamiento hipolipemiante tras evaluar ` +
          'potenciadores de riesgo, el riesgo a 30 años o el calcio coronario.',
        fuente: `${GUIA}, Tabla 8`,
      });
    } else if (def(riesgos.ascvd30) && riesgos.ascvd30 >= P.ascvd30aConsiderarHipolipemiante) {
      consideraciones.push({
        texto: `PREVENT-ASCVD a 30 años ${pct(riesgos.ascvd30)} (≥ 10 %): considerar tratamiento hipolipemiante.`,
        fuente: `${GUIA}, Tabla 8`,
      });
    }
  }
  if (erc && (diabetes || (def(e.uacr) && e.uacr >= 30))) {
    consideraciones.push({
      texto: 'ERC con DM2 o con albuminuria: la guía indica RASi y SGLT2i como primera línea para protección renal y cardiovascular.',
      fuente: `${GUIA}, mensaje clave 8 y Sección 5.5.4`,
    });
  }

  return { seguimiento, evaluaciones, consideraciones, potenciadores };
}

/** Resumen legible del plan (para el prompt, la nota y el informe de respaldo). */
export function resumenPlanCkm(plan: PlanCkm): string {
  const bloque = (titulo: string, items: ItemGuia[]): string[] =>
    items.length ? [`${titulo}:`, ...items.map((i) => `- ${i.texto} [${i.fuente}]`)] : [];
  return [
    ...bloque('Seguimiento según la guía', plan.seguimiento),
    ...bloque('Evaluaciones que sugiere la guía', plan.evaluaciones),
    ...bloque('Umbrales de la guía para decisiones del médico', plan.consideraciones),
    ...(plan.potenciadores.length ? [`Potenciadores de riesgo CKM (Tabla 9): ${plan.potenciadores.join('; ')}.`] : []),
  ].join('\n');
}
