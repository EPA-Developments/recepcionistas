import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Button, Group, List, Modal, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle, IconShieldX } from '@tabler/icons-react';
import type { Modalidad } from '@som/domain/types';
import { getServicio, nombreSegunModalidad, ofreceModalidad } from '@som/config/catalogo';
import { NOMBRE_PLAN_BIENESTAR } from '@som/config/plan-bienestar';
import { recursosPara } from '@som/config/recursos';
import { HORARIO_SEMANAL } from '@som/config/horario';
import { generarSlots } from '@som/lib/slots';
import { hoyLocal } from '@som/lib/programas';
import type { DatosDerivacion } from '@som/lib/derivaciones-pb100d';
import { reservarTurno, mensajeError, type ResultadoReserva } from '../lib/bots';

/**
 * Agenda una derivación del Plan Bienestar 100 Días® desde su tarea (R-20): la
 * especialidad la decidió el equipo médico; Recepción elige la consulta del grupo,
 * modalidad, dónde, día y hora. El bot valida, crea el turno (con cargo: tentativo hasta
 * la seña, salvo que la consulta esté incluida) y completa la tarea.
 */
export function AgendarDerivacionModal({
  derivacion,
  pacienteRef,
  pacienteNombre,
  onClose,
  onAgendado,
}: {
  derivacion: DatosDerivacion | null;
  pacienteRef: string;
  pacienteNombre?: string;
  onClose: () => void;
  onAgendado: (r: ResultadoReserva) => void;
}): JSX.Element {
  const hoy = hoyLocal();
  const [modalidad, setModalidad] = useState<Modalidad>('teleconsulta');
  const servicios = useMemo(
    () => (derivacion?.servicios ?? []).map((c) => getServicio(c)).filter((s) => ofreceModalidad(s, modalidad)),
    [derivacion, modalidad],
  );
  const [servicioCodigo, setServicioCodigo] = useState<string | null>(null);
  const servicio = servicioCodigo ? servicios.find((s) => s.codigo === servicioCodigo) : undefined;
  const recursos = useMemo(() => (servicio ? recursosPara(servicio, modalidad) : []), [servicio, modalidad]);
  const [recursoCodigo, setRecursoCodigo] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [hora, setHora] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoReserva | null>(null);
  const [reservando, setReservando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (derivacion) {
      setModalidad('teleconsulta');
      setFecha(hoy);
      setHora(null);
      setResultado(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivacion?.taskId]);

  // Con una sola consulta posible en el grupo, queda elegida.
  useEffect(() => {
    setServicioCodigo(servicios.length === 1 ? servicios[0]!.codigo : null);
  }, [servicios]);

  useEffect(() => {
    setRecursoCodigo(recursos.length === 1 ? recursos[0]!.codigo : null);
  }, [recursos]);

  const horas = useMemo(() => {
    const desde = new Date(`${fecha}T00:00:00-03:00`);
    const dummy = [{ codigo: '_', nombre: '_', tipo: 'CONSULTORIO' as const, capacidad: 1 }];
    return generarSlots(dummy, HORARIO_SEMANAL, { desde, dias: 1 })
      .filter((s) => Date.parse(s.inicio) > Date.now())
      .map((s) => s.inicio.slice(11, 16));
  }, [fecha]);

  async function agendar(): Promise<void> {
    if (!derivacion?.taskId || !servicioCodigo || !recursoCodigo || !hora) {
      return;
    }
    setReservando(true);
    setError(null);
    setResultado(null);
    try {
      const r = await reservarTurno({
        pacienteRef,
        servicioCodigo,
        recursoCodigo,
        inicio: `${fecha}T${hora}:00-03:00`,
        modalidad,
        confirmar: true,
        tareaId: derivacion.taskId,
      });
      setResultado(r);
      if (r.creado) {
        notifications.show({
          color: r.advertencias.length ? 'yellow' : 'somAzul',
          title: `Derivación a ${derivacion.titulo} agendada`,
          message: r.advertencias.length
            ? r.advertencias.map((a) => `[${a.regla}] ${a.mensaje}`).join(' ')
            : r.incluida
              ? 'Confirmada (incluida en el plan). Se avisó al paciente por WhatsApp.'
              : 'Tentativa hasta cobrar la seña del 50 %. Se avisó al paciente por WhatsApp.',
        });
        onAgendado(r);
        onClose();
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setReservando(false);
    }
  }

  return (
    <Modal opened={Boolean(derivacion)} onClose={onClose} title={`Agendar derivación del ${NOMBRE_PLAN_BIENESTAR}`} size="lg" centered>
      {derivacion && (
        <Stack gap="md">
          <div>
            <Text fw={600}>{pacienteNombre ?? 'Paciente'}</Text>
            <Text size="sm">
              Derivación a {derivacion.titulo}
              {derivacion.codigo ? ` (${derivacion.codigo})` : ''}: la decidió el equipo médico.
            </Text>
            {derivacion.texto && (
              <Text size="xs" c="dimmed">
                {derivacion.texto}
              </Text>
            )}
          </div>

          <SegmentedControl
            value={modalidad}
            onChange={(v) => {
              setModalidad(v as Modalidad);
              setResultado(null);
            }}
            data={[
              { value: 'teleconsulta', label: 'Teleconsulta' },
              { value: 'presencial', label: 'Presencial' },
            ]}
          />

          <Group grow align="flex-end">
            <Select
              label="Consulta"
              placeholder={servicios.length ? 'Elegí la consulta' : 'Sin consulta en esta modalidad'}
              data={servicios.map((s) => ({ value: s.codigo, label: nombreSegunModalidad(s, modalidad) }))}
              value={servicioCodigo}
              onChange={setServicioCodigo}
              disabled={!servicios.length}
              searchable
            />
            <Select
              label={modalidad === 'teleconsulta' ? 'Agenda' : 'Consultorio'}
              placeholder={servicio ? 'Elegí dónde' : 'Primero la consulta'}
              data={recursos.map((r) => ({ value: r.codigo, label: r.nombre }))}
              value={recursoCodigo}
              onChange={setRecursoCodigo}
              disabled={!servicio}
              searchable
            />
          </Group>
          <Group grow align="flex-end">
            <TextInput
              type="date"
              label="Fecha"
              value={fecha}
              min={hoy}
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

          <Text size="xs" c="dimmed">
            Con cargo (precio de lista de la consulta): queda tentativa hasta cobrar la seña del 50 %. En teleconsulta, el paciente tiene que
            haber firmado el consentimiento en el portal.
          </Text>

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
          {resultado?.teleconsultaUrl && (
            <Text size="sm">
              Videollamada:{' '}
              <Anchor href={resultado.teleconsultaUrl} target="_blank" rel="noreferrer">
                {resultado.teleconsultaUrl}
              </Anchor>
            </Text>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => void agendar()} loading={reservando} disabled={!servicioCodigo || !recursoCodigo || !hora}>
              Agendar derivación
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
