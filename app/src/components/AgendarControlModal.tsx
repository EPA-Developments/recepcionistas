import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, List, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFlask, IconInfoCircle, IconShieldX } from '@tabler/icons-react';
import type { Task } from '@medplum/fhirtypes';
import { reservarTurno, mensajeError, type ResultadoReserva } from '../lib/bots';
import { CODIGO_CONTROL_GLP1, getServicio } from '@som/config/catalogo';
import { recursosParaCategoria } from '@som/config/recursos';
import { generarSlots } from '@som/lib/slots';
import { HORARIO_SEMANAL } from '@som/config/horario';
import { etiquetaControl, fechaSugerida, fmtDia, hoyLocal, leerTareaControl } from '@som/lib/glp1-plan';
import { BadgeVentana } from './BadgesGlp1';

/**
 * Agenda un control del programa GLP-1 desde su tarea. El paciente, el servicio y
 * la ventana vienen de la tarea (los calculó el sistema); Recepción elige
 * consultorio, día y hora. El bot valida todo (R-07, R-19) y completa la tarea.
 */
export function AgendarControlModal({
  tarea,
  pacienteNombre,
  onClose,
  onAgendado,
}: {
  tarea: Task | null;
  pacienteNombre?: string;
  onClose: () => void;
  onAgendado: (tareaId: string, r: ResultadoReserva) => void;
}): JSX.Element {
  const hoy = hoyLocal();
  const datos = tarea ? leerTareaControl(tarea) : undefined;
  const ventana = datos?.ventana;
  const primerDia = ventana ? fechaSugerida(ventana, hoy) : hoy;

  const consultorios = useMemo(() => recursosParaCategoria(getServicio(CODIGO_CONTROL_GLP1).categoria), []);
  const [recursoCodigo, setRecursoCodigo] = useState<string | null>(null);
  const [fecha, setFecha] = useState(primerDia);
  const [hora, setHora] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoReserva | null>(null);
  const [reservando, setReservando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir otra tarea: arrancar en el primer día posible de su ventana.
  useEffect(() => {
    if (tarea) {
      setRecursoCodigo(consultorios.length === 1 ? consultorios[0]!.codigo : null);
      setFecha(primerDia);
      setHora(null);
      setResultado(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarea?.id]);

  // Horas del día (hoy, solo las que no pasaron; igual el bot valida R-13).
  const horas = useMemo(() => {
    const desde = new Date(`${fecha}T00:00:00-03:00`);
    const dummy = [{ codigo: '_', nombre: '_', tipo: 'CONSULTORIO' as const, capacidad: 1 }];
    return generarSlots(dummy, HORARIO_SEMANAL, { desde, dias: 1 })
      .filter((s) => Date.parse(s.inicio) > Date.now())
      .map((s) => s.inicio.slice(11, 16));
  }, [fecha]);

  async function agendar(): Promise<void> {
    const pacienteRef = tarea?.for?.reference;
    if (!tarea?.id || !pacienteRef || !recursoCodigo || !hora) {
      return;
    }
    setReservando(true);
    setError(null);
    setResultado(null);
    try {
      const r = await reservarTurno({
        pacienteRef,
        servicioCodigo: CODIGO_CONTROL_GLP1,
        recursoCodigo,
        inicio: `${fecha}T${hora}:00-03:00`,
        confirmar: true,
        tareaId: tarea.id,
      });
      setResultado(r);
      if (r.creado) {
        notifications.show({
          color: r.advertencias.length ? 'yellow' : 'somAzul',
          title: 'Control agendado',
          message: r.advertencias.length
            ? r.advertencias.map((a) => `[${a.regla}] ${a.mensaje}`).join(' ')
            : 'Queda tentativo en la agenda y se avisó al paciente por WhatsApp.',
        });
        onAgendado(tarea.id, r);
        onClose();
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setReservando(false);
    }
  }

  return (
    <Modal opened={Boolean(tarea)} onClose={onClose} title="Agendar control GLP-1" size="lg" centered>
      {datos && (
        <Stack gap="md">
          <div>
            <Text fw={600}>{pacienteNombre ?? 'Paciente'}</Text>
            <Text size="sm">{etiquetaControl(datos.semana)}</Text>
          </div>

          <Group gap="xs">
            {ventana && (
              <Badge color="gray" size="lg" variant="light">
                Ventana: {fmtDia(ventana.desde)} al {fmtDia(ventana.hasta)}
              </Badge>
            )}
            {ventana && <BadgeVentana ventana={ventana} hoy={hoy} size="lg" />}
          </Group>

          {datos.requiereLaboratorio && (
            <Alert color="somAzul" variant="light" icon={<IconFlask size={16} />}>
              Este control lleva laboratorio: recordale al paciente que traiga los resultados (el aviso por WhatsApp
              también se lo pide).
            </Alert>
          )}

          <Group grow align="flex-end">
            <Select
              label="Consultorio"
              placeholder="Elegí el consultorio"
              data={consultorios.map((r) => ({ value: r.codigo, label: r.nombre }))}
              value={recursoCodigo}
              onChange={setRecursoCodigo}
              searchable
            />
            <TextInput
              type="date"
              label="Fecha"
              value={fecha}
              min={primerDia}
              onChange={(e) => {
                setFecha(e.currentTarget.value);
                setHora(null);
              }}
            />
            <Select
              label="Hora"
              placeholder={horas.length ? 'Elegí la hora' : 'Cerrado ese día'}
              data={horas}
              value={hora}
              onChange={setHora}
              disabled={!horas.length}
              searchable
            />
          </Group>

          {error && (
            <Alert color="orange" icon={<IconInfoCircle size={16} />}>
              {error}
            </Alert>
          )}

          {resultado && !resultado.creado && (
            <Alert color="red" title="No se pudo agendar" icon={<IconShieldX size={16} />}>
              <List size="sm">
                {resultado.bloqueos.map((b, i) => (
                  <List.Item key={i}>
                    [{b.regla}] {b.mensaje}
                  </List.Item>
                ))}
              </List>
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => void agendar()} loading={reservando} disabled={!recursoCodigo || !hora}>
              Agendar control
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
