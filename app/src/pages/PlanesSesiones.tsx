import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Center, Group, Loader, Progress, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconRefresh, IconInfoCircle, IconLicense, IconUserHeart } from '@tabler/icons-react';
import { cargarPanelPlanes, type FilaPlan, type NivelUrgencia, type PanelPlanes } from '../lib/panelPlanes';

const REFRESCO_MS = 60_000;

const COLOR_NIVEL: Record<NivelUrgencia, string> = {
  critico: 'red',
  pronto: 'orange',
  tranquilo: 'gray',
  sinAccion: 'somAzul',
};

function plural(n: number, sing: string, plur: string): string {
  return `${n} ${n === 1 ? sing : plur}`;
}

function textoUrgencia(f: FilaPlan): string {
  if (f.libres <= 0) {
    return 'Todo agendado';
  }
  const porAgendar = `${plural(f.libres, 'sesión', 'sesiones')} por agendar`;
  if (f.tipo === 'paquete') {
    if (f.vencido) {
      return `Vencido · ${porAgendar} se perdieron`;
    }
    return `Vence en ${plural(f.diasRestantes, 'día', 'días')} · ${porAgendar}`;
  }
  return `El mes cierra en ${plural(f.diasRestantes, 'día', 'días')} · ${porAgendar}`;
}

export function PlanesSesiones({ onAtender }: { onAtender: (pacienteId: string) => void }): JSX.Element {
  const [data, setData] = useState<PanelPlanes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'riesgo'>('todos');

  const refrescar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setData(await cargarPanelPlanes());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los planes.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void refrescar();
    const id = setInterval(() => void refrescar(), REFRESCO_MS);
    return () => clearInterval(id);
  }, [refrescar]);

  const filas = data
    ? filtro === 'riesgo'
      ? data.filas.filter((f) => f.nivel === 'critico' || f.nivel === 'pronto')
      : data.filas
    : [];

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={0}>
          <Title order={2}>Planes y sesiones</Title>
          {data && (
            <Text c="dimmed">
              {plural(data.totalClientes, 'cliente con plan activo', 'clientes con plan activo')}
              {data.enRiesgo > 0 && ` · ${data.enRiesgo} con sesiones por perder`}
            </Text>
          )}
        </Stack>
        <Group gap="sm">
          <SegmentedControl
            value={filtro}
            onChange={(v) => setFiltro(v as 'todos' | 'riesgo')}
            data={[
              { value: 'todos', label: 'Todos' },
              { value: 'riesgo', label: 'En riesgo' },
            ]}
          />
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void refrescar()} loading={cargando}>
            Actualizar
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" icon={<IconInfoCircle size={16} />} title="No se pudo cargar">
          {error}
        </Alert>
      )}

      {data === null && !error && (
        <Center mih={240}>
          <Loader />
        </Center>
      )}

      {data && filas.length === 0 && (
        <Text c="dimmed" mt="md">
          {filtro === 'riesgo'
            ? 'No hay clientes con sesiones en riesgo de perderse. 🎉'
            : 'No hay clientes con planes activos.'}
        </Text>
      )}

      {filas.map((f) => (
        <FilaPlanCard key={f.coverageId} fila={f} onAtender={() => onAtender(f.pacienteId)} />
      ))}
    </Stack>
  );
}

function FilaPlanCard({ fila, onAtender }: { fila: FilaPlan; onAtender: () => void }): JSX.Element {
  const color = COLOR_NIVEL[fila.nivel];
  const total = Math.max(fila.total, 1);
  const pct = (n: number): number => (n / total) * 100;

  return (
    <Card withBorder radius="md" padding="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <IconLicense size={18} style={{ flexShrink: 0 }} color="var(--mantine-color-dimmed)" />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={600} lineClamp={1}>
              {fila.pacienteNombre}
            </Text>
            <Text size="sm" c="dimmed" lineClamp={1}>
              {fila.planNombre}
            </Text>
          </Stack>
          <Badge variant="light" color="gray" tt="lowercase" style={{ flexShrink: 0 }}>
            {fila.tipo}
          </Badge>
        </Group>
        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Badge color={color} variant={fila.nivel === 'critico' ? 'filled' : 'light'}>
            {textoUrgencia(fila)}
          </Badge>
          <Button size="xs" variant="light" leftSection={<IconUserHeart size={14} />} onClick={onAtender}>
            Atender
          </Button>
        </Group>
      </Group>

      <Progress.Root size="lg" radius="sm">
        <Progress.Section value={pct(fila.realizadas)} color="gray.5" />
        <Progress.Section value={pct(fila.proximas)} color="indigo.5" />
        {fila.libres > 0 && <Progress.Section value={pct(fila.libres)} color={color} />}
      </Progress.Root>

      <Group gap="lg" mt={6}>
        <Leyenda color="gray.5" label={`${fila.realizadas} realizadas`} />
        <Leyenda color="indigo.5" label={`${fila.proximas} agendadas`} />
        <Leyenda color={`${color}.6`} label={`${fila.libres} libres`} />
        <Text size="xs" c="dimmed" ml="auto">
          {fila.total} en total
        </Text>
      </Group>
    </Card>
  );
}

function Leyenda({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <Group gap={6} wrap="nowrap">
      <div style={{ width: 10, height: 10, borderRadius: 2, background: `var(--mantine-color-${color.replace('.', '-')})` }} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
