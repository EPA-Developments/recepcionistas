import { describe, it, expect } from 'vitest';
import {
  CODIGO_CONSULTA_PB100D,
  CODIGO_CONTROL_GLP1,
  CONSULTAS_POR_ESPECIALIDAD,
  GRUPOS_ESPECIALIDAD,
  getServicio,
  nombreSegunModalidad,
  ofreceModalidad,
} from '../src/config/catalogo.js';
import { RECURSOS, modalidadDeRecurso, recursosPara, recursosParaCategoria } from '../src/config/recursos.js';
import { buildSeed } from '../src/seed/builders.js';
import { PLAN_BIENESTAR_URL, SYSTEM, urlServicio } from '../src/fhir/identifiers.js';
import { seAgendaSinTarea } from '../src/lib/glp1-plan.js';

/** Códigos SNOMED CT del value set FHIR R4 `c80-practice-codes` (verificados contra la definición oficial). */
const C80: Record<string, string> = {
  '394579002': 'Cardiology',
  '394649004': 'Nuclear medicine',
  '394583002': 'Endocrinology',
  '418112009': 'Pulmonary medicine',
  '394591006': 'Neurology',
  '394586005': 'Gynecology',
};

describe('Catálogo — consultas por especialidad (definidas por el Dr. D’Alessandro y el Dr. Barbagelata)', () => {
  it('los siete grupos del Plan Bienestar, en el orden de la lista', () => {
    expect(GRUPOS_ESPECIALIDAD.map((g) => g.nombre)).toEqual([
      'DBT / Endocrino',
      'Nutrición',
      'Cardiología',
      'Cardiología con especialidad',
      'Tisioneumonología',
      'Neurología',
      'Ginecología',
    ]);
    for (const g of GRUPOS_ESPECIALIDAD) {
      expect(CONSULTAS_POR_ESPECIALIDAD.some((s) => s.grupo === g.codigo)).toBe(true);
    }
  });

  it('Cardiología con especialidad = las seis subespecialidades cardiológicas', () => {
    expect(CONSULTAS_POR_ESPECIALIDAD.filter((s) => s.grupo === 'cardiologia-especialidad').map((s) => s.especialidad?.nombre)).toEqual([
      'Insuficiencia Cardíaca',
      'Hemodinamia',
      'Electrofisiología',
      'Medicina Nuclear',
      'Prevención Cardiovascular',
      'Rehabilitación Cardiovascular',
    ]);
  });

  it('toda consulta por especialidad se ofrece presencial y por teleconsulta, con cargo (precio PENDIENTE)', () => {
    expect(CONSULTAS_POR_ESPECIALIDAD).toHaveLength(12);
    for (const s of CONSULTAS_POR_ESPECIALIDAD) {
      expect(s.modalidades).toEqual(['presencial', 'teleconsulta']);
      expect(s.incluidaEnPlan).toBeUndefined();
      expect(s.soloDesdeTarea).toBeUndefined();
      expect(s.nota).toMatch(/PENDIENTE/);
    }
  });

  it('especialidad SNOMED CT solo con códigos del value set c80-practice-codes; Nutrición, solo texto', () => {
    for (const s of CONSULTAS_POR_ESPECIALIDAD) {
      const e = s.especialidad!;
      if (e.snomed) {
        expect(C80[e.snomed]).toBe(e.snomedDisplay);
      }
    }
    expect(getServicio('NUTRICION').especialidad).toEqual({ nombre: 'Nutrición' });
    expect(getServicio('TISIONEUMONOLOGIA').especialidad?.snomed).toBe('418112009');
    expect(getServicio('DIABETOLOGIA_ENDOCRINOLOGIA').especialidad?.snomed).toBe('394583002');
  });

  it('la consulta del Plan Bienestar está incluida en el plan y se agenda solo desde su tarea', () => {
    const pb = getServicio(CODIGO_CONSULTA_PB100D);
    expect(pb).toMatchObject({ incluidaEnPlan: true, soloDesdeTarea: true, precioARS: 0 });
    expect(pb.modalidades).toEqual(['presencial', 'teleconsulta']);
    expect(pb.nombre).toBe('Consulta del Plan Bienestar 100 Días®');
    expect(seAgendaSinTarea(CODIGO_CONSULTA_PB100D)).toBe(false);
    expect(seAgendaSinTarea(CODIGO_CONTROL_GLP1)).toBe(false);
    expect(seAgendaSinTarea('CARDIOLOGIA')).toBe(true);
  });

  it('el control GLP-1 sigue siendo solo presencial', () => {
    expect(ofreceModalidad(getServicio(CODIGO_CONTROL_GLP1), 'teleconsulta')).toBe(false);
  });

  it('nombre según la modalidad', () => {
    expect(nombreSegunModalidad(getServicio('CARDIOLOGIA'), 'teleconsulta')).toBe('Teleconsulta de Cardiología');
    expect(nombreSegunModalidad(getServicio('CARDIOLOGIA'), 'presencial')).toBe('Consulta de Cardiología');
    expect(nombreSegunModalidad(getServicio(CODIGO_CONSULTA_PB100D), 'teleconsulta')).toBe('Teleconsulta del Plan Bienestar 100 Días®');
    expect(nombreSegunModalidad(getServicio(CODIGO_CONTROL_GLP1), 'teleconsulta')).toBe('Seguimiento de tratamiento GLP-1 — Control');
  });
});

describe('Recursos por modalidad (R-21)', () => {
  it('la teleconsulta va a la agenda virtual; lo presencial, a consultorio o sala', () => {
    expect(recursosPara(getServicio('NEUROLOGIA'), 'teleconsulta').map((r) => r.codigo)).toEqual(['R_TELEMEDICINA']);
    expect(recursosPara(getServicio('NEUROLOGIA'), 'presencial').map((r) => r.codigo)).toEqual(['R_CONSULTORIO_1', 'R_CONSULTORIO_2']);
    expect(recursosPara(getServicio(CODIGO_CONTROL_GLP1), 'teleconsulta')).toEqual([]);
    expect(recursosParaCategoria('CARDIOLOGIA').some((r) => r.tipo === 'VIRTUAL')).toBe(false);
  });

  it('la modalidad sale del recurso', () => {
    const virtual = RECURSOS.find((r) => r.codigo === 'R_TELEMEDICINA')!;
    expect(modalidadDeRecurso(virtual)).toBe('teleconsulta');
    expect(modalidadDeRecurso(RECURSOS.find((r) => r.codigo === 'R_CONSULTORIO_1')!)).toBe('presencial');
  });
});

describe('Seed — catálogo FHIR para el portal (data-driven)', () => {
  const seed = buildSeed();
  const ad = (codigo: string) => seed.activityDefinitions.find((a) => a.url === urlServicio(codigo))!;
  const modalidades = (codigo: string) =>
    (ad(codigo).useContext ?? [])
      .filter((u) => u.code.code === 'workflow')
      .map((u) => u.valueCodeableConcept?.coding?.[0]?.code);

  it('cada modalidad es un useContext `workflow` con v3-ActCode AMB / VR (buscable con `context`)', () => {
    expect(modalidades('GINECOLOGIA')).toEqual(['AMB', 'VR']);
    expect(modalidades(CODIGO_CONTROL_GLP1)).toEqual(['AMB']);
    const vr = ad('GINECOLOGIA').useContext!.find((u) => u.valueCodeableConcept?.coding?.[0]?.code === 'VR')!;
    expect(vr.valueCodeableConcept?.coding?.[0]?.system).toBe('http://terminology.hl7.org/CodeSystem/v3-ActCode');
  });

  it('topic: especialidad SNOMED CT y grupo del portal', () => {
    const topic = ad('INSUFICIENCIA_CARDIACA').topic!;
    expect(topic[0]).toMatchObject({ coding: [{ system: 'http://snomed.info/sct', code: '394579002' }], text: 'Insuficiencia Cardíaca' });
    expect(topic[1]?.coding?.[0]).toMatchObject({ system: SYSTEM.grupoEspecialidad, code: 'cardiologia-especialidad' });
  });

  it('la consulta del plan lleva el programa en useContext', () => {
    const programa = ad(CODIGO_CONSULTA_PB100D).useContext!.find((u) => u.code.code === 'program');
    expect(programa?.valueCodeableConcept?.coding?.[0]).toMatchObject({ system: SYSTEM.planCuidado, code: 'plan-bienestar-100' });
  });

  it('PlanDefinition del Plan Bienestar: tres consultas, desfasajes ±7 días y la marca registrada', () => {
    const pd = seed.planDefinitions.find((p) => p.url === PLAN_BIENESTAR_URL)!;
    expect(pd.title).toBe('Plan Bienestar 100 Días®');
    expect(pd.copyright).toMatch(/marca registrada del Dr\. Alejandro Sergio D'Alessandro/);
    expect(pd.action?.map((a) => a.id)).toEqual(['inicial', 'mitad', 'final']);
    expect(pd.action?.every((a) => a.definitionCanonical === urlServicio(CODIGO_CONSULTA_PB100D))).toBe(true);
    const rango = (id: string) => pd.action?.find((a) => a.id === id)?.relatedAction?.[0]?.offsetRange;
    expect([rango('mitad')?.low?.value, rango('mitad')?.high?.value]).toEqual([42, 56]);
    expect([rango('final')?.low?.value, rango('final')?.high?.value]).toEqual([92, 106]);
    expect(pd.action?.[0]?.relatedAction).toBeUndefined();
  });

  it('el portal puede leer el catálogo (ActivityDefinition de solo lectura en su policy)', () => {
    const paciente = seed.accessPolicies.find((p) => p.name === 'Paciente SOM — Portal')!;
    expect(paciente.resource?.find((r) => r.resourceType === 'ActivityDefinition')).toEqual({
      resourceType: 'ActivityDefinition',
      readonly: true,
    });
  });
});
