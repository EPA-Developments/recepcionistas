import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCalendarPlus, IconHeartbeat, IconInfoCircle } from '@tabler/icons-react';
import { getDisplayString } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { medplum } from '../medplum';
import { inscribirBienestar, mensajeError } from '../lib/bots';
import { COD, SYSTEM } from '@som/fhir/identifiers';
import { NOMBRE_PLAN_BIENESTAR } from '@som/config/plan-bienestar';
import { fmtDia, hoyLocal } from '@som/lib/programas';
import { resumenPlanBienestar, type ConsultaPlanVista, type ResumenPlanBienestar } from '@som/lib/plan-bienestar';
import { AgendarConsultaPlanModal } from './AgendarConsultaPlanModal';
import { BadgeVentana } from './BadgesGlp1';

const ESTADO: Record<ConsultaPlanVista['estado'], { label: string; color: string }> = {
  pendiente: { label: 'Por agendar', color: 'yellow' },
  cerrado: { label: 'Agendada', color: 'somAzul' },
  cancelado: { label: 'Cancelada', color: 'gray' },
};

/**
 * Plan Bienestar 100 Días® en la ficha del paciente. Recepción inscribe (el bot arma el
 * plan que el paciente sigue en el portal) y agenda las tres consultas programadas,
 * incluidas en el plan: la inicial (marca el día 1), la del día 50 y la final. Recepción
 * ve solo lo operativo (las tareas del plan), nunca el plan clínico.
 */
export function PlanBienestar({ paciente }: { paciente: Patient }): JSX.Element {
  const pacienteRef = `Patient/${paciente.id}`;
  const [resumen, setResumen] = useState<ResumenPlanBienestar>();
  const [error, setError] = useState<string | null>(null);
  const [inscribiendo, setInscribiendo] = useState(false);
  const [agendando, setAgendando] = useState<ConsultaPlanVista | null>(null);
  const hoy = hoyLocal();

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const tareas = await medplum.searchResources('Task', {
        patient: pacienteRef,
        code: `${SYSTEM.taskTipo}|${COD.agendarConsultaPb100d}`,
        _count: 50,
      });
      setResumen(resumenPlanBienestar(tareas));
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
      const r = await inscribirBienestar(pacienteRef);
      notifications.show({
        color: r.ok ? 'somAzul' : 'red',
        title: r.ok ? NOMBRE_PLAN_BIENESTAR : 'No se pudo inscribir',
        message: r.ok
          ? `${r.creado ? 'Inscripto' : (r.mensaje ?? 'Ya estaba inscripto')}. Del ${r.inicio} al ${r.fin}: agendá la consulta inicial, que marca el día 1.`
          : (r.mensaje ?? ''),
      });
      await cargar();
    } catch (e) {
      notifications.show({ color: 'red', title: 'No se pudo inscribir', message: mensajeError(e) });
    } finally {
      setInscribiendo(false);
    }
  }

  const inicialPendiente = resumen?.consultas.some((c) => c.clave === 'inicial' && c.estado === 'pendiente') ?? false;

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconHeartbeat size={18} />
        <Text fw={600}>{NOMBRE_PLAN_BIENESTAR}</Text>
      </Group>

      {error && (
        <Alert color="orange" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}

      {!resumen && !error && <Loader size="sm" />}

      {resumen?.estado === 'sin-plan' && (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Incluye tres consultas (inicial, día 50 y final), presenciales o por teleconsulta. Las consultas por
            especialidad, fuera de lo programado, tienen cargo. El paciente sigue su progreso en el portal.
          </Text>
          <Button variant="light" color="somAzul" loading={inscribiendo} onClick={() => void inscribir()} style={{ flexShrink: 0 }}>
            Inscribir
          </Button>
        </Group>
      )}

      {resumen && resumen.estado !== 'sin-plan' && (
        <Stack gap="xs">
          {resumen.consultas.map((c) => {
            const bloqueada = c.clave !== 'inicial' && inicialPendiente;
            return (
              <Group key={c.clave} justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Group gap={6}>
                    <Text size="sm" fw={500}>
                      {c.titulo}
                    </Text>
                    <Badge size="sm" variant="light" color={ESTADO[c.estado].color}>
                      {ESTADO[c.estado].label}
                    </Badge>
                  </Group>
                  <Group gap={6}>
                    {c.ventana ? (
                      <>
                        <Text size="xs" c="dimmed">
                          {fmtDia(c.ventana.desde)} al {fmtDia(c.ventana.hasta)}
                        </Text>
                        {c.estado === 'pendiente' && <BadgeVentana ventana={c.ventana} hoy={hoy} />}
                      </>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Marca el día 1 del plan
                      </Text>
                    )}
                  </Group>
                </div>
                {c.estado === 'pendiente' && (
                  <Button
                    size="xs"
                    leftSection={<IconCalendarPlus size={15} />}
                    onClick={() => setAgendando(c)}
                    disabled={bloqueada}
                    title={bloqueada ? 'Primero la consulta inicial: marca el día 1 del plan' : undefined}
                    style={{ flexShrink: 0 }}
                  >
                    Agendar
                  </Button>
                )}
              </Group>
            );
          })}
        </Stack>
      )}

      <AgendarConsultaPlanModal
        consulta={agendando}
        pacienteRef={pacienteRef}
        pacienteNombre={getDisplayString(paciente)}
        onClose={() => setAgendando(null)}
        onAgendado={() => void cargar()}
      />
    </Card>
  );
}
