import { Box, Group, ScrollArea, Text, Tooltip } from '@mantine/core';
import type { TimelineData, TurnoTimeline } from '../lib/timeline';
import { colorEstado, labelEstado } from '../lib/estados';

const COL_W = 46; // ancho de cada franja de 30 min
const ROW_H = 54;
const NAME_W = 200;
const HEADER_H = 26;

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function Timeline({
  data,
  onReservar,
  onTurno,
}: {
  data: TimelineData;
  onReservar?: (recursoCodigo: string, horaMin: number) => void;
  onTurno?: (turno: TurnoTimeline) => void;
}): JSX.Element {
  if (!data.abierto) {
    return (
      <Text c="dimmed" mt="md">
        El centro está cerrado hoy.
      </Text>
    );
  }

  const cols: number[] = [];
  for (let m = data.aperturaMin; m < data.cierreMin; m += 30) {
    cols.push(m);
  }
  const trackW = cols.length * COL_W;
  const x = (min: number): number => ((min - data.aperturaMin) / 30) * COL_W;

  const turnosPorSala = new Map<string, TurnoTimeline[]>();
  for (const t of data.turnos) {
    const arr = turnosPorSala.get(t.recursoCodigo) ?? [];
    arr.push(t);
    turnosPorSala.set(t.recursoCodigo, arr);
  }

  const lineas = `repeating-linear-gradient(to right, var(--mantine-color-default-border) 0 1px, transparent 1px ${COL_W}px)`;
  const ahoraVisible = data.ahoraMin >= data.aperturaMin && data.ahoraMin <= data.cierreMin;

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <style>{`.som-slot:hover{background:var(--mantine-color-somAzul-light);}`}</style>
      <Box style={{ minWidth: NAME_W + trackW }}>
        {/* Encabezado de horas */}
        <Group gap={0} wrap="nowrap">
          <Box w={NAME_W} style={{ flexShrink: 0 }} />
          <Box style={{ position: 'relative', width: trackW, height: HEADER_H }}>
            {cols.map((m, i) =>
              m % 60 === 0 ? (
                <Text key={i} size="xs" c="dimmed" style={{ position: 'absolute', left: i * COL_W, top: 4 }}>
                  {fmt(m)}
                </Text>
              ) : null,
            )}
          </Box>
        </Group>

        {/* Filas de salas */}
        {data.salas.map((sala) => (
          <Group key={sala.codigo} gap={0} wrap="nowrap" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Box w={NAME_W} p="xs" style={{ flexShrink: 0 }}>
              <Text size="sm" fw={500} lineClamp={2}>
                {sala.nombre}
              </Text>
            </Box>

            <Box style={{ position: 'relative', width: trackW, height: ROW_H, backgroundImage: lineas }}>
              {/* Franjas libres clickeables para reservar */}
              {onReservar &&
                cols.map((m, i) => {
                  const ocupado = (turnosPorSala.get(sala.codigo) ?? []).some(
                    (t) => m >= t.inicioMin && m < t.finMin,
                  );
                  if (ocupado) {
                    return null;
                  }
                  return (
                    <Box
                      key={`slot-${i}`}
                      className="som-slot"
                      title={`Reservar ${fmt(m)} · ${sala.nombre}`}
                      onClick={() => onReservar(sala.codigo, m)}
                      style={{ position: 'absolute', left: i * COL_W, top: 0, width: COL_W, height: ROW_H, cursor: 'pointer' }}
                    />
                  );
                })}

              {(turnosPorSala.get(sala.codigo) ?? []).map((t, i) => (
                <Tooltip
                  key={i}
                  label={`${t.paciente || 'Paciente'} · ${t.servicio} · ${fmt(t.inicioMin)}–${fmt(t.finMin)} · ${labelEstado(t.estado)}`}
                  withArrow
                >
                  <Box
                    onClick={() => onTurno?.(t)}
                    style={{
                      position: 'absolute',
                      left: x(t.inicioMin) + 1,
                      width: Math.max(((t.finMin - t.inicioMin) / 30) * COL_W - 2, COL_W - 2),
                      top: 4,
                      height: ROW_H - 8,
                      background: `var(--mantine-color-${colorEstado(t.estado)}-6)`,
                      color: 'white',
                      borderRadius: 6,
                      padding: '3px 6px',
                      overflow: 'hidden',
                      cursor: onTurno ? 'pointer' : 'default',
                    }}
                  >
                    <Text size="xs" c="white" fw={700} lineClamp={1}>
                      {t.servicio}
                    </Text>
                    <Text size="xs" c="white" lineClamp={1}>
                      {t.paciente || `${fmt(t.inicioMin)}–${fmt(t.finMin)}`}
                    </Text>
                  </Box>
                </Tooltip>
              ))}

              {ahoraVisible && (
                <Box
                  style={{
                    position: 'absolute',
                    left: x(data.ahoraMin),
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: 'var(--mantine-color-blue-6)',
                  }}
                />
              )}
            </Box>
          </Group>
        ))}
      </Box>
    </ScrollArea>
  );
}
