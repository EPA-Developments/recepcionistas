import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCalendarPlus, IconUserHeart, IconVaccine } from '@tabler/icons-react';
import { useMedplum } from '@medplum/react';
import { getDisplayString } from '@medplum/core';
import type { Patient, Task } from '@medplum/fhirtypes';
import { COD, SYSTEM } from '@som/fhir/identifiers';
import {
  diaLocal,
  estadoVentana,
  etiquetaControl,
  fmtDia,
  hoyLocal,
  leerTareaControl,
  ordenarControles,
  type EstadoVentana,
} from '@som/lib/glp1-plan';
import { AgendarControlModal } from '../components/AgendarControlModal';
import { BadgeLaboratorio, BadgeVentana } from '../components/BadgesGlp1';

/**
 * Controles del programa de seguimiento GLP-1 que Recepción tiene que agendar.
 * Cada tarea (`code=agendar-control-glp1`, `status=requested`) la generó el sistema
 * con la indicación del equipo médico: trae la semana, la ventana para agendar y si
 * lleva laboratorio (nada clínico). Recepción solo elige día y hora; la reserva
 * pasa por el bot (R-07, R-19), que además resuelve la tarea.
 */
type Filtro = 'todos' | EstadoVentana;

function pacienteIdDeTask(t: Task): string | undefined {
  const ref = t.for?.reference;
  return ref?.startsWith('Patient/') ? ref.slice('Patient/'.length) : undefined;
}

export function ControlesGlp1({ onAtender }: { onAtender: (pacienteId: string) => void }): JSX.Element {
  const medplum = useMedplum();
  const [controles, setControles] = useState<Task[]>();
  const [esperando, setEsperando] = useState<Task[]>([]);
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [agendando, setAgendando] = useState<Task | null>(null);
  const hoy = hoyLocal();

  useEffect(() => {
    let vivo = true;
    Promise.all([
      medplum.searchResources('Task', {
        code: `${SYSTEM.taskTipo}|${COD.agendarControlGlp1}`,
        status: 'requested',
        _count: 200,
      }),
      medplum.searchResources('Task', {
        code: `${SYSTEM.taskTipo}|${COD.indicacionGlp1}`,
        status: 'requested',
        _count: 100,
      }),
    ])
      .then(async ([ts, indicaciones]) => {
        if (!vivo) {
          return;
        }
        setControles(ordenarControles(ts));
        setEsperando(indicaciones);
        const ids = [...new Set([...ts, ...indicaciones].map(pacienteIdDeTask).filter((x): x is string => Boolean(x)))];
        if (ids.length > 0) {
          const pacientes = await medplum
            .searchResources('Patient', { _id: ids.join(','), _count: ids.length })
            .catch(() => [] as Patient[]);
          if (!vivo) {
            return;
          }
          const m = new Map<string, string>();
          for (const p of pacientes) {
            if (p.id) {
              m.set(p.id, getDisplayString(p));
            }
          }
          setNombres(m);
        }
      })
      .catch((err) => notifications.show({ color: 'red', title: 'Error', message: String(err?.message ?? err) }));
    return () => {
      vivo = false;
    };
  }, [medplum]);

  const estadoDe = (t: Task): EstadoVentana | undefined => {
    const v = leerTareaControl(t).ventana;
    return v ? estadoVentana(v, hoy) : undefined;
  };

  const cuenta = useMemo(() => {
    const c: Record<EstadoVentana, number> = { abierta: 0, vencida: 0, proxima: 0 };
    for (const t of controles ?? []) {
      const e = estadoDe(t);
      if (e) {
        c[e]++;
      }
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controles, hoy]);

  if (controles === undefined) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  const nombreDe = (t: Task): string => {
    const pid = pacienteIdDeTask(t);
    return (pid && nombres.get(pid)) || 'Paciente';
  };
  const visibles = filtro === 'todos' ? controles : controles.filter((t) => estadoDe(t) === filtro);

  return (
    <Stack gap="md" maw={820} mx="auto">
      <Group gap="xs">
        <IconVaccine size={22} />
        <Title order={2}>Controles GLP-1</Title>
        <Badge variant="light" color="somAzul">
          {controles.length} por agendar
        </Badge>
        {cuenta.vencida > 0 && (
          <Badge variant="light" color="red">
            {cuenta.vencida} {cuenta.vencida === 1 ? 'vencido' : 'vencidos'}
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        Las semanas y ventanas las calcula el sistema con el esquema que indicó el equipo médico. Agendá dentro de la
        ventana: antes no se puede y después queda con advertencia.
      </Text>

      <SegmentedControl
        value={filtro}
        onChange={(v) => setFiltro(v as Filtro)}
        data={[
          { value: 'todos', label: `Todos (${controles.length})` },
          { value: 'abierta', label: `En ventana (${cuenta.abierta})` },
          { value: 'vencida', label: `Vencidos (${cuenta.vencida})` },
          { value: 'proxima', label: `Próximos (${cuenta.proxima})` },
        ]}
      />

      {visibles.length === 0 ? (
        <Text c="dimmed">
          {controles.length === 0
            ? 'No hay controles por agendar. Cuando el equipo médico cargue la indicación de un paciente inscripto, sus controles aparecen acá.'
            : 'No hay controles con este filtro.'}
        </Text>
      ) : (
        visibles.map((t) => {
          const pid = pacienteIdDeTask(t);
          const datos = leerTareaControl(t);
          return (
            <Card key={t.id} withBorder radius="md" p="md">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <div style={{ minWidth: 0 }}>
                  <Text fw={600}>{nombreDe(t)}</Text>
                  <Text size="sm">{etiquetaControl(datos.semana)}</Text>
                  {datos.ventana && (
                    <Text size="xs" c="dimmed">
                      Agendar entre el {fmtDia(datos.ventana.desde)} y el {fmtDia(datos.ventana.hasta)}
                    </Text>
                  )}
                  <Group gap={6} mt={6}>
                    {datos.ventana && <BadgeVentana ventana={datos.ventana} hoy={hoy} />}
                    {datos.requiereLaboratorio && <BadgeLaboratorio />}
                  </Group>
                </div>
                <Group gap="xs" wrap="nowrap">
                  <Button size="xs" leftSection={<IconCalendarPlus size={15} />} onClick={() => setAgendando(t)}>
                    Agendar
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="gray"
                    leftSection={<IconUserHeart size={15} />}
                    disabled={!pid}
                    onClick={() => pid && onAtender(pid)}
                  >
                    Ficha
                  </Button>
                </Group>
              </Group>
            </Card>
          );
        })
      )}

      {esperando.length > 0 && (
        <Card withBorder radius="md" p="md" bg="var(--mantine-color-default-hover)">
          <Text fw={600} mb={4}>
            Esperando indicación del equipo médico ({esperando.length})
          </Text>
          <Text size="xs" c="dimmed" mb="xs">
            Inscriptos al seguimiento. Cuando el médico cargue el esquema, el sistema arma sus controles.
          </Text>
          <Stack gap={4}>
            {esperando.map((t) => {
              const pid = pacienteIdDeTask(t);
              return (
                <Group key={t.id} justify="space-between" wrap="nowrap">
                  <Text size="sm">
                    {nombreDe(t)}
                    {t.authoredOn ? (
                      <Text span size="xs" c="dimmed">
                        {' '}
                        · inscripto el {fmtDia(diaLocal(t.authoredOn))}
                      </Text>
                    ) : null}
                  </Text>
                  <Button size="compact-xs" variant="subtle" disabled={!pid} onClick={() => pid && onAtender(pid)}>
                    Ficha
                  </Button>
                </Group>
              );
            })}
          </Stack>
        </Card>
      )}

      <AgendarControlModal
        tarea={agendando}
        pacienteNombre={agendando ? nombreDe(agendando) : undefined}
        onClose={() => setAgendando(null)}
        onAgendado={(tareaId) => setControles((prev) => prev?.filter((x) => x.id !== tareaId))}
      />
    </Stack>
  );
}
