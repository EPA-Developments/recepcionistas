import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { IconCalendarPlus, IconInfoCircle, IconStethoscope } from '@tabler/icons-react';
import { getDisplayString } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { medplum } from '../medplum';
import { mensajeError } from '../lib/bots';
import { NOMBRE_PLAN_BIENESTAR } from '@som/config/plan-bienestar';
import { GRUPOS_ESPECIALIDAD } from '@som/config/catalogo';
import { derivacionesPendientes, type DatosDerivacion } from '@som/lib/derivaciones-pb100d';
import { fmtDia } from '@som/lib/programas';
import { AgendarDerivacionModal } from './AgendarDerivacionModal';

/**
 * Derivaciones del Plan Bienestar 100 Días® que decidió el equipo médico (menú del
 * equipo) y Recepción tiene que agendar: una tarea por derivación, con la especialidad.
 * Se agendan desde acá (R-20): las consultas de derivación no se reservan sueltas.
 */
export function DerivacionesPlan({ paciente }: { paciente: Patient }): JSX.Element | null {
  const pacienteRef = `Patient/${paciente.id}`;
  const [pendientes, setPendientes] = useState<DatosDerivacion[]>();
  const [error, setError] = useState<string | null>(null);
  const [agendando, setAgendando] = useState<DatosDerivacion | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const tareas = await medplum.searchResources('Task', { patient: pacienteRef, status: 'requested', _count: 100 });
      setPendientes(derivacionesPendientes(tareas));
      setError(null);
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [pacienteRef]);

  useEffect(() => {
    setPendientes(undefined);
    void cargar();
  }, [cargar]);

  if (!error && pendientes?.length === 0) {
    return null;
  }
  const nombreGrupo = (codigo: string | undefined): string => GRUPOS_ESPECIALIDAD.find((g) => g.codigo === codigo)?.nombre ?? '';

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconStethoscope size={18} />
        <Text fw={600}>Derivaciones del {NOMBRE_PLAN_BIENESTAR}</Text>
      </Group>
      {error && (
        <Alert color="orange" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}
      {!pendientes && !error && <Loader size="sm" />}
      {pendientes && pendientes.length > 0 && (
        <Stack gap="xs">
          {pendientes.map((d) => (
            <Group key={d.taskId ?? d.codigo} justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6}>
                  <Text size="sm" fw={500}>
                    {d.titulo}
                  </Text>
                  {d.grupo ? (
                    <Badge size="sm" variant="light" color="somAzul">
                      {nombreGrupo(d.grupo)}
                    </Badge>
                  ) : (
                    <Badge size="sm" variant="light" color="gray">
                      Sin consulta en SOM: tarea del equipo
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {d.texto ?? ''}
                  {d.fecha ? `${d.texto ? ' · ' : ''}decidida el ${fmtDia(d.fecha)}` : ''}
                </Text>
              </div>
              <Button
                size="xs"
                leftSection={<IconCalendarPlus size={15} />}
                onClick={() => setAgendando(d)}
                disabled={!d.grupo || !d.taskId}
                style={{ flexShrink: 0 }}
              >
                Agendar
              </Button>
            </Group>
          ))}
        </Stack>
      )}
      <AgendarDerivacionModal
        derivacion={agendando}
        pacienteRef={pacienteRef}
        pacienteNombre={getDisplayString(paciente)}
        onClose={() => setAgendando(null)}
        onAgendado={() => void cargar()}
      />
    </Card>
  );
}
