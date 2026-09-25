import { describe, it, expect } from 'vitest';
import { avisoConsultaPlanDue, enHorarioDeAvisos, mitadDeVentana, recordatorioDue, VENTANA_MAX_MS } from '../src/lib/recordatorios.js';

const AHORA = new Date('2026-06-22T10:00:00-03:00');
const enHoras = (h: number): Date => new Date(AHORA.getTime() + h * 3_600_000);

describe('recordatorioDue (48h / 2h)', () => {
  it('falta 1 h => recordatorio de 2 h', () => {
    expect(recordatorioDue(enHoras(1), AHORA)).toBe('2h');
  });

  it('exactamente 2 h => recordatorio de 2 h', () => {
    expect(recordatorioDue(enHoras(2), AHORA)).toBe('2h');
  });

  it('falta 3 h => recordatorio de 48 h', () => {
    expect(recordatorioDue(enHoras(3), AHORA)).toBe('48h');
  });

  it('falta 30 h => recordatorio de 48 h', () => {
    expect(recordatorioDue(enHoras(30), AHORA)).toBe('48h');
  });

  it('exactamente 48 h => recordatorio de 48 h', () => {
    expect(recordatorioDue(enHoras(48), AHORA)).toBe('48h');
  });

  it('falta 49 h => todavía nada', () => {
    expect(recordatorioDue(enHoras(49), AHORA)).toBeUndefined();
  });

  it('turno en el pasado => nada', () => {
    expect(recordatorioDue(enHoras(-1), AHORA)).toBeUndefined();
  });

  it('VENTANA_MAX_MS es 48 h', () => {
    expect(VENTANA_MAX_MS).toBe(48 * 3_600_000);
  });
});

describe('Avisos del Plan Bienestar (R-20)', () => {
  const ventana = { desde: '2026-11-10', hasta: '2026-11-24' };

  it('la mitad de la ventana es la fecha objetivo de la consulta', () => {
    expect(mitadDeVentana(ventana)).toBe('2026-11-17');
  });

  it('apertura hasta la fecha objetivo, mitad desde ahí; fuera de la ventana, nada', () => {
    expect(avisoConsultaPlanDue(ventana, '2026-11-09')).toBeUndefined();
    expect(avisoConsultaPlanDue(ventana, '2026-11-10')).toBe('apertura');
    expect(avisoConsultaPlanDue(ventana, '2026-11-16')).toBe('apertura');
    expect(avisoConsultaPlanDue(ventana, '2026-11-17')).toBe('mitad');
    expect(avisoConsultaPlanDue(ventana, '2026-11-24')).toBe('mitad');
    expect(avisoConsultaPlanDue(ventana, '2026-11-25')).toBeUndefined();
  });

  it('solo de día (hora de Argentina)', () => {
    expect(enHorarioDeAvisos(new Date('2026-11-10T12:00:00Z'))).toBe(true); // 09:00
    expect(enHorarioDeAvisos(new Date('2026-11-10T11:59:00Z'))).toBe(false); // 08:59
    expect(enHorarioDeAvisos(new Date('2026-11-10T22:59:00Z'))).toBe(true); // 19:59
    expect(enHorarioDeAvisos(new Date('2026-11-10T23:00:00Z'))).toBe(false); // 20:00
  });
});
