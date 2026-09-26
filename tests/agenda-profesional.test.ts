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
  modalidadesDisponibles,
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
    { dia: 1, desde: '18:00', hasta: '20:00' }, // lunes (las dos modalidades)
    { dia: 2, desde: '11:00', hasta: '15:00' }, // martes: el centro cierra a las 13
    { dia: 3, desde: '09:00', hasta: '12:00' }, // miércoles: el centro no abre
    { dia: 4, desde: '09:00', hasta: '12:00', modalidad: 'presencial' as const }, // jueves: solo presencial
  ],
};
const AMBAS = ['presencial', 'teleconsulta'];

describe('Agenda por profesional — franjas y horarios libres', () => {
  it('las franjas del día son la intersección de la disponibilidad con el horario del centro, con sus modalidades', () => {
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 1)).toEqual([{ desde: '18:00', hasta: '20:00', modalidades: AMBAS }]);
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 2)).toEqual([{ desde: '11:00', hasta: '13:00', modalidades: AMBAS }]);
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 3)).toEqual([]); // el centro no abre
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 4)).toEqual([{ desde: '09:00', hasta: '12:00', modalidades: ['presencial'] }]);
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 4, 'teleconsulta')).toEqual([]); // el jueves no hace teleconsulta
    expect(franjasDelDia(CARDIOLOGA, CENTRO, 5)).toEqual([]); // no atiende
  });

  it('genera horarios de 30 min dentro de sus franjas, con offset de Argentina y sus modalidades', () => {
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
      '2026-10-01T09:00:00-03:00',
      '2026-10-01T09:30:00-03:00',
      '2026-10-01T10:00:00-03:00',
      '2026-10-01T10:30:00-03:00',
      '2026-10-01T11:00:00-03:00',
      '2026-10-01T11:30:00-03:00',
    ]);
    expect(slots[0]).toMatchObject({ medicoCodigo: 'MED_TEST', fin: '2026-09-28T18:30:00-03:00', estado: 'free', modalidades: AMBAS });
    expect(slots.at(-1)).toMatchObject({ inicio: '2026-10-01T11:30:00-03:00', modalidades: ['presencial'] });
    expect(generarSlotsProfesionales([CARDIOLOGA, { ...CARDIOLOGA, codigo: 'MED_2' }], CENTRO, { desde: new Date('2026-09-28T12:00:00Z'), dias: 1 })).toHaveLength(8);
  });

  it('dos franjas superpuestas dan un solo horario con la unión de sus modalidades', () => {
    const m = {
      codigo: 'M',
      modalidades: AMBAS as ('presencial' | 'teleconsulta')[],
      disponibilidad: [
        { dia: 1, desde: '09:00', hasta: '12:00', modalidad: 'presencial' as const },
        { dia: 1, desde: '10:00', hasta: '13:00', modalidad: 'teleconsulta' as const },
      ],
    };
    const slots = generarSlotsProfesional(m, CENTRO, { desde: new Date('2026-09-28T12:00:00Z'), dias: 1 });
    expect(slots).toHaveLength(8); // 09:00 … 12:30
    expect(slots.find((s) => s.inicio === '2026-09-28T09:00:00-03:00')?.modalidades).toEqual(['presencial']);
    expect(slots.find((s) => s.inicio === '2026-09-28T10:00:00-03:00')?.modalidades).toEqual(AMBAS);
    expect(slots.find((s) => s.inicio === '2026-09-28T12:30:00-03:00')?.modalidades).toEqual(['teleconsulta']);
    expect(modalidadesDisponibles(m, CENTRO, new Date('2026-09-28T09:00:00-03:00'), new Date('2026-09-28T09:30:00-03:00'))).toEqual(['presencial']);
    expect(modalidadesDisponibles(m, CENTRO, new Date('2026-09-28T11:00:00-03:00'), new Date('2026-09-28T11:30:00-03:00'))).toEqual(AMBAS);
  });

  it('un profesional sin disponibilidad no genera horarios', () => {
    expect(generarSlotsProfesional({ codigo: 'X', modalidades: [], disponibilidad: [] }, CENTRO, { desde: new Date(), dias: 30 })).toEqual([]);
  });

  it('estaDisponible: el intervalo entero dentro de una franja, en hora de Argentina y en la modalidad pedida', () => {
    const lunes = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00-03:00`);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('18:00'), lunes('18:30'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('18:00'), lunes('18:30'), 'teleconsulta')).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('19:30'), lunes('20:00'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('19:45'), lunes('20:15'))).toBe(false); // se pasa del cierre
    expect(estaDisponible(CARDIOLOGA, CENTRO, lunes('17:30'), lunes('18:00'))).toBe(false);
    // Martes 12:30–13:00 entra (el centro cierra a las 13); 13:00 no.
    expect(estaDisponible(CARDIOLOGA, CENTRO, new Date('2026-09-29T12:30:00-03:00'), new Date('2026-09-29T13:00:00-03:00'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, new Date('2026-09-29T13:00:00-03:00'), new Date('2026-09-29T13:30:00-03:00'))).toBe(false);
    // Miércoles: atiende pero el centro no abre.
    expect(estaDisponible(CARDIOLOGA, CENTRO, new Date('2026-09-30T09:00:00-03:00'), new Date('2026-09-30T09:30:00-03:00'))).toBe(false);
    // Jueves 09–12 es solo presencial.
    const jueves = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00-03:00`);
    expect(estaDisponible(CARDIOLOGA, CENTRO, jueves('09:00'), jueves('09:30'))).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, jueves('09:00'), jueves('09:30'), 'presencial')).toBe(true);
    expect(estaDisponible(CARDIOLOGA, CENTRO, jueves('09:00'), jueves('09:30'), 'teleconsulta')).toBe(false);
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

  it('disponibilidad cargada el 26/09/2026: horarios de 30 min de cada uno en la semana del 28/09, con su modalidad', () => {
    const desde = new Date('2026-09-28T12:00:00Z'); // lunes
    const de = (codigo: string) => generarSlotsProfesional(MEDICOS.find((m) => m.codigo === codigo)!, HORARIO_SEMANAL, { desde, dias: 7 });
    // Dr. Barbagelata: martes y jueves 14–18 (las dos modalidades) → 8 + 8.
    const barbagelata = de('MED_BARBAGELATA');
    expect(barbagelata).toHaveLength(16);
    expect(barbagelata[0]).toMatchObject({ inicio: '2026-09-29T14:00:00-03:00', modalidades: AMBAS });
    expect(barbagelata.at(-1)?.fin).toBe('2026-10-01T18:00:00-03:00');
    // Dr. D'Alessandro: teleconsulta lunes, miércoles y viernes 16–20 (3 × 8) + presencial martes y jueves 9–12 (2 × 6).
    const dalessandro = de('MED_DALESSANDRO');
    expect(dalessandro).toHaveLength(36);
    expect(dalessandro[0]).toMatchObject({ inicio: '2026-09-28T16:00:00-03:00', modalidades: ['teleconsulta'] });
    expect(dalessandro.find((s) => s.inicio === '2026-09-29T09:00:00-03:00')?.modalidades).toEqual(['presencial']);
    expect(dalessandro.at(-1)?.fin).toBe('2026-10-02T20:00:00-03:00');
    // Dra. Gold: presencial martes y jueves 9–12 (2 × 6) + teleconsulta miércoles y viernes 08–12 (2 × 8).
    const gold = de('MED_GOLD');
    expect(gold).toHaveLength(28);
    expect(gold[0]).toMatchObject({ inicio: '2026-09-29T09:00:00-03:00', modalidades: ['presencial'] });
    expect(gold.find((s) => s.inicio === '2026-09-30T08:00:00-03:00')?.modalidades).toEqual(['teleconsulta']);
    expect(generarSlotsProfesionales(MEDICOS, HORARIO_SEMANAL, { desde, dias: 7 })).toHaveLength(80);
  });

  it('consultorios: Barbagelata y Gold en el Consultorio 1, D\'Alessandro en el 2; nadie queda provisorio', () => {
    const consultorio = (codigo: string) => MEDICOS.find((m) => m.codigo === codigo)?.consultorioCodigo;
    expect(consultorio('MED_BARBAGELATA')).toBe('R_CONSULTORIO_1');
    expect(consultorio('MED_GOLD')).toBe('R_CONSULTORIO_1');
    expect(consultorio('MED_DALESSANDRO')).toBe('R_CONSULTORIO_2');
    expect(MEDICOS.filter((m) => m.provisional)).toEqual([]);
    for (const m of MEDICOS) {
      // Cada franja de una sola modalidad es de una que el profesional atiende; lo presencial tiene consultorio.
      for (const d of m.disponibilidad) {
        if (d.modalidad) {
          expect(m.modalidades).toContain(d.modalidad);
        }
      }
      expect(m.consultorioCodigo).toBeTruthy();
    }
  });

  it('Gold y D\'Alessandro no se pisan en su consultorio: los dos hacen presencial martes y jueves 9–12, pero en consultorios distintos', () => {
    const gold = MEDICOS.find((m) => m.codigo === 'MED_GOLD')!;
    const dalessandro = MEDICOS.find((m) => m.codigo === 'MED_DALESSANDRO')!;
    const martes9 = [new Date('2026-09-29T09:00:00-03:00'), new Date('2026-09-29T09:30:00-03:00')] as const;
    expect(estaDisponible(gold, HORARIO_SEMANAL, ...martes9, 'presencial')).toBe(true);
    expect(estaDisponible(dalessandro, HORARIO_SEMANAL, ...martes9, 'presencial')).toBe(true);
    expect(gold.consultorioCodigo).not.toBe(dalessandro.consultorioCodigo);
  });
});
