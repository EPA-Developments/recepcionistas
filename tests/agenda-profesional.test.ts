import { describe, expect, it } from 'vitest';
import type { HorarioDia } from '../src/config/horario.js';
import { HORARIO_SEMANAL } from '../src/config/horario.js';
import { MEDICOS, medicoAtiende, medicosPara, medicosSeguimientoPB100D } from '../src/config/medicos.js';
import {
  estaDisponible,
  franjasDelDia,
  generarSlotsProfesional,
  generarSlotsProfesionales,
  identificadorSlotProfesional,
} from '../src/lib/agenda-profesional.js';
import { isoArgentina } from '../src/lib/slots.js';

const CENTRO: HorarioDia[] = [
  { dia: 0, abierto: false, franjas: [] },
  { dia: 1, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] },
  { dia: 2, abierto: true, franjas: [{ desde: '08:00', hasta: '13:00' }] },
  { dia: 3, abierto: false, franjas: [] },
  { dia: 4, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] },
  { dia: 5, abierto: true, franjas: [{ desde: '08:00', hasta: '22:00' }] },
  { dia: 6, abierto: true, franjas: [{ desde: '08:00', hasta: '20:00' }] },
];

const CARDIOLOGA = {
  codigo: 'MED_TEST',
  nombre: 'Dra. Prueba',
  esDirector: false,
  especialidad: { nombre: 'Cardiología' },
  servicios: ['CARDIOLOGIA', 'CONSULTA_PB100D'],
  modalidades: ['presencial', 'teleconsulta'] as ('presencial' | 'teleconsulta')[],
  disponibilidad: [
    { dia: 1, desde: '18:00', hasta: '20:00' }, // lunes
    { dia: 2, desde: '11:00', hasta: '15:00' }, // martes: el centro cierra a las 13
    { dia: 3, desde: '09:00', hasta: '12:00' }, // miércoles: el centro no abre
  ],
};

describe('Agenda por profesional — franjas y horarios libres', () => {
  it('las franjas del día son la intersección de la disponibilidad con el horario del centro', () => {
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 1)).toEqual([{ desde: '18:00', hasta: '20:00' }]);
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 2)).toEqual([{ desde: '11:00', hasta: '13:00' }]);
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 3)).toEqual([]); // el centro no abre
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 4)).toEqual([]); // no atiende
  });

  it('genera horarios de 30 min dentro de sus franjas, con offset de Argentina', () => {
    // Desde el lunes 28/09/2026, 7 días.
    const slots = generarSlotsProfesional(CARDIOLOGA, CENTRO, { desde: new Date('2026-09-28T12:00:00Z'), dias: 7 });
    expect(slots.map((s) => s.inicio)).toEqual([
      '2026-09-28T18:00:00-03:00',
      '2026-09-28T18:30:00-03:00',
      '2026-09-28T19:00:00-03:00',
      '2026-09-28T19:30:00-03:00',
      '2026-09-29T11:00:00-03:00',
      '2026-09-29T11:30:00-03:00',
      '2026-09-29T12:00:00-03:00',
      '2026-09-29T12:30:00-03:00',
    ]);
    expect(slots[0]).toMatchObject({ medicoCodigo: 'MED_TEST', fin: '2026-09-28T18:30:00-03:00', estado: 'free' });
    expect(generarSlotsProfesionales([CARDIOLOGA, { ...CARDIOLOGA, codigo: 'MED_2' }], CENTRO, { desde: new Date('2026-09-28T12:00:00Z'), dias: 1 })).toHaveLength(8);
  });

  it('un profesional sin disponibilidad no genera horarios', () => {
    expect(generarSlotsProfesional({ codigo: 'X', disponibilidad: [] }, CENTRO, { desde: new Date(), dias: 30 })).toEqual([]);
  });

  it('estaDisponible: el intervalo entero dentro de una franja, en hora de Argentina', () => {
    const lunes = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00-03:00`);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('18:00'), lunes('18:30'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('19:30'), lunes('20:00'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('19:45'), lunes('20:15'))).toBe(false); // se pasa del cierre
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('17:30'), lunes('18:00'))).toBe(false);
    // Martes 12:30–13:00 entra (el centro cierra a las 13); 13:00 no.
    expect(estaDisponible(CARDIOLOGA, CENTRO, new Date('2026-09-29T12:30:00-03:00'), new Date('2026-09-29T13:00:00-03:00'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, new Date('2026-09-29T13:00:00-03:00'), new Date('2026-09-29T13:30:00-03:00'))).toBe(false);
    // Miércoles: atiende pero el centro no abre.
    expect(estaDisponible(CARDIOLOGA, CENTRO, new Date('2026-09-30T09:00:00-03:00'), new Date('2026-09-30T09:30:00-03:00'))).toBe(false);
  });

  it('el identifier de la franja es determinista y usa el mismo formato que el seed', () => {
    // Sin `|` en el valor: el identifier viaja dentro de un token `sistema|valor`.
    expect(identificadorSlotProfesional('MED_TEST', '2026-09-28T18:00:00-03:00')).toBe('MED_TEST@2026-09-28T18:00:00-03:00');
    expect(isoArgentina(new Date('2026-09-28T21:00:00Z'))).toBe('2026-09-28T18:00:00-03:00');
    expect(isoArgentina(new Date('2026-09-28T18:00:00-03:00'))).toBe('2026-09-28T18:00:00-03:00');
  });

  it('medicoAtiende y medicosPara filtran por consulta y modalidad', () => {
    expect(medicoAtiende(CARDIOLOGA, 'CARDIOLOGIA', 'teleconsulta')).toBe(true);
    expect(medicoAtiende(CARDIOLOGA, 'NEUROLOGIA', 'teleconsulta')).toBe(false);
    expect(medicoAtiende({ ...CARDIOLOGA, modalidades: ['presencial'] }, 'CARDIOLOGIA', 'teleconsulta')).toBe(false);
    for (const m of medicosPara('CONSULTA_PB100D', 'teleconsulta')) {
      expect(m.seguimientoPB100D).toBe(true);
    }
  });
});

describe('Profesionales cargados (lista del 26/09/2026)', () => {
  it('los tres que atienden el Plan Bienestar, con especialidad, matrícula y sin DNI', () => {
    expect(MEDICOS.map((m) => m.codigo)).toEqual(['MED_BARBAGELATA', 'MED_GOLD', 'MED_DALESSANDRO']);
    expect(medicosSeguimientoPB100D().map((m) => m.nombre)).toEqual([
      'Dr. Alejandro Barbagelata',
      'Dra. Mariana Andrea Gold',
      "Dr. Alejandro Sergio D'Alessandro",
    ]);
    expect(MEDICOS.map((m) => m.especialidad.nombre)).toEqual(['Cardiología', 'Clínica Médica', 'Cardiología']);
    for (const m of MEDICOS) {
      expect(m.matricula).toBeTruthy();
      expect(m.servicios).toContain('CONSULTA_PB100D');
      expect(m.modalidades).toEqual(['presencial', 'teleconsulta']);
      // Nada de DNI ni códigos del sistema anterior en el código.
      expect(JSON.stringify(m)).not.toMatch(/\b\d{8}\b/);
    }
  });

  it('disponibilidad cargada el 26/09/2026: horarios de 30 min de cada uno en la semana del 28/09', () => {
    const desde = new Date('2026-09-28T12:00:00Z'); // lunes
    const de = (codigo: string) => generarSlotsProfesional(MEDICOS.find((m) => m.codigo === codigo)!, HORARIO_SEMANAL, { desde, dias: 7 });
    // Dr. Barbagelata: martes y jueves 14–18 → 8 + 8.
    const barbagelata = de('MED_BARBAGELATA');
    expect(barbagelata).toHaveLength(16);
    expect(barbagelata[0]?.inicio).toBe('2026-09-29T14:00:00-03:00');
    expect(barbagelata.at(-1)?.fin).toBe('2026-10-01T18:00:00-03:00');
    // Dr. D'Alessandro: lunes, miércoles y viernes 16–20 → 3 × 8.
    const dalessandro = de('MED_DALESSANDRO');
    expect(dalessandro).toHaveLength(24);
    expect(dalessandro[0]?.inicio).toBe('2026-09-28T16:00:00-03:00');
    expect(dalessandro.at(-1)?.fin).toBe('2026-10-02T20:00:00-03:00');
    // Dra. Gold: miércoles y viernes 08–12 → 8 + 8.
    const gold = de('MED_GOLD');
    expect(gold).toHaveLength(16);
    expect(gold[0]?.inicio).toBe('2026-09-30T08:00:00-03:00');
    expect(generarSlotsProfesionales(MEDICOS, HORARIO_SEMANAL, { desde, dias: 7 })).toHaveLength(56);
  });

  it('consultorio: el Dr. Barbagelata atiende en el Consultorio 1; los otros dos siguen provisorios (sin consultorio)', () => {
    const barbagelata = MEDICOS.find((m) => m.codigo === 'MED_BARBAGELATA')!;
    expect(barbagelata.consultorioCodigo).toBe('R_CONSULTORIO_1');
    expect(barbagelata.provisional).toBeFalsy();
    expect(MEDICOS.filter((m) => m.provisional).map((m) => m.codigo)).toEqual(['MED_GOLD', 'MED_DALESSANDRO']);
    for (const m of MEDICOS.filter((m) => m.provisional)) {
      expect(m.consultorioCodigo).toBeUndefined();
    }
  });
});
