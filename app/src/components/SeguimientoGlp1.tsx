import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCalendarPlus, IconInfoCircle, IconVaccine } from '@tabler/icons-react';
import { getDisplayString } from '@medplum/core';
import type { Patient, Task } from '@medplum/fhirtypes';
import { medplum } from '../medplum';
import { inscribirGlp1, mensajeError } from '../lib/bots';
import { COD, SYSTEM } from '@som/fhir/identifiers';
import { etiquetaControl, fmtDia, hoyLocal, leerTareaControl, resumenSeguimiento, type ResumenSeguimiento } from '@som/lib/glp1-plan';
import { AgendarControlModal } from './AgendarControlModal';
import { BadgeLaboratorio, BadgeVentana } from './BadgesGlp1';

/**
 * Seguimiento de tratamiento GLP-1 en la ficha del paciente. Recepción ve solo lo
 * operativo (las tareas del programa: qué control agendar y cuándo), nunca el plan
 * clínico. Si el paciente no está en seguimiento, lo inscribe: el bot deja la
 * indicación al equipo médico, que carga el esquema; el sistema arma los controles.
 */
export function SeguimientoGlp1({ paciente }: { paciente: Patient }): JSX.Element {
  const pacienteRef = `Patient/${paciente.id}`;
  const [resumen, setResumen] = useState<ResumenSeguimiento>();
  const [error, setError] = useState<string | null>(null);
  const [inscribiendo, setInscribiendo] = useState(false);
  const [agendando, setAgendando] = useState<Task | null>(null);
  const hoy = hoyLocal();

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const tareas = await medplum.searchResources('Task', {
        patient: pacienteRef,
        code: [COD.agendarControlGlp1, COD.indicacionGlp1].map((c) => `${SYSTEM.taskTipo}|${c}`).join(','),
        _count: 100,
      });
      setResumen(resumenSeguimiento(tareas));
      setError(null);
    } catch (e) {
      setError(mensajeError(e));
    }
  }, [pacienteRef]);

  useEffect(() => {
    setResumen(undefined);
    void cargar();
  }, [cargar]);

  async function inscribir(): Promise<void> {
    setInscribiendo(true);
    try {
      const r = await inscribirGlp1(pacienteRef);
      notifications.show({
        color: r.ok ? 'somAzul' : 'red',
        title: r.ok ? 'Seguimiento GLP-1' : 'No se pudo inscribir',
        message:
          r.mensaje ??
          (r.creado ? 'Inscripto. El equipo médico tiene que cargar la indicación para armar los controles.' : ''),
      });
      await cargar();
    } catch (e) {
      notifications.show({ color: 'red', title: 'No se pudo inscribir', message: mensajeError(e) });
    } finally {
      setInscribiendo(false);
    }
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconVaccine size={18} />
        <Text fw={600}>Seguimiento de tratamiento GLP-1</Text>
        {resumen && resumen.agendados > 0 && (
          <Badge variant="light" color="gray">
            {resumen.agendados} agendados
          </Badge>
        )}
      </Group>

      {error && (
        <Alert color="orange" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}

      {!resumen && !error && <Loader size="sm" />}

      {resumen?.estado === 'sin-seguimiento' && (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            No está en seguimiento. Si el médico indicó un tratamiento con GLP-1, inscribilo: el equipo médico carga el
            esquema y el sistema arma los controles.
          </Text>
          <Button variant="light" loading={inscribiendo} onClick={() => void inscribir()} style={{ flexShrink: 0 }}>
            Inscribir
          </Button>
        </Group>
      )}

      {resumen?.estado === 'esperando-indicacion' && (
        <Group gap="xs">
          <Badge color="yellow" variant="light">
            Esperando indicación del equipo médico
          </Badge>
          <Text size="sm" c="dimmed">
            Cuando el médico cargue el esquema, los controles aparecen acá para agendar.
          </Text>
        </Group>
      )}

      {resumen?.estado === 'al-dia' && (
        <Text size="sm" c="dimmed">
          Todos los controles del programa están agendados.
        </Text>
      )}

      {resumen?.estado === 'por-agendar' && (
        <Stack gap="xs">
          {resumen.pendientes.map((t) => {
            const datos = leerTareaControl(t);
            return (
              <Group key={t.id} justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500}>
                    {etiquetaControl(datos.semana)}
                  </Text>
                  <Group gap={6}>
                    {datos.ventana && (
                      <Text size="xs" c="dimmed">
                        {fmtDia(datos.ventana.desde)} al {fmtDia(datos.ventana.hasta)}
                      </Text>
                    )}
                    {datos.ventana && <BadgeVentana ventana={datos.ventana} hoy={hoy} />}
                    {datos.requiereLaboratorio && <BadgeLaboratorio />}
                  </Group>
                </div>
                <Button
                  size="xs"
                  leftSection={<IconCalendarPlus size={15} />}
                  onClick={() => setAgendando(t)}
                  style={{ flexShrink: 0 }}
                >
                  Agendar
                </Button>
              </Group>
            );
          })}
        </Stack>
      )}

      <AgendarControlModal
        tarea={agendando}
        pacienteNombre={getDisplayString(paciente)}
        onClose={() => setAgendando(null)}
        onAgendado={() => void cargar()}
      />
    </Card>
  );
}
