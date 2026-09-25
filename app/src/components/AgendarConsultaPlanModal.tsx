import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, List, Modal, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle, IconShieldX } from '@tabler/icons-react';
import type { Modalidad } from '@som/domain/types';
import { CODIGO_CONSULTA_PB100D, getServicio } from '@som/config/catalogo';
import { NOMBRE_PLAN_BIENESTAR } from '@som/config/plan-bienestar';
import { recursosPara } from '@som/config/recursos';
import { HORARIO_SEMANAL } from '@som/config/horario';
import { generarSlots } from '@som/lib/slots';
import { fechaSugerida, fmtDia, hoyLocal } from '@som/lib/programas';
import type { ConsultaPlanVista } from '@som/lib/plan-bienestar';
import { reservarTurno, mensajeError, type ResultadoReserva } from '../lib/bots';
import { BadgeVentana } from './BadgesGlp1';

/**
 * Agenda una consulta del Plan Bienestar 100 Días® desde su tarea. Qué consulta es y
 * su ventana vienen de la tarea (los calculó el sistema); Recepción elige modalidad
 * (presencial o teleconsulta), dónde, día y hora. El bot valida todo (R-07, R-20,
 * R-21), confirma el turno sin seña —está incluido en el plan— y completa la tarea.
 */
export function AgendarConsultaPlanModal({
  consulta,
  pacienteRef,
  pacienteNombre,
  onClose,
  onAgendado,
}: {
  consulta: ConsultaPlanVista | null;
  pacienteRef: string;
  pacienteNombre?: string;
  onClose: () => void;
  onAgendado: (r: ResultadoReserva) => void;
}): JSX.Element {
  const hoy = hoyLocal();
  const primerDia = consulta?.ventana ? fechaSugerida(consulta.ventana, hoy) : hoy;
  const servicio = getServicio(CODIGO_CONSULTA_PB100D);

  const [modalidad, setModalidad] = useState<Modalidad>('teleconsulta');
  const recursos = useMemo(() => recursosPara(servicio, modalidad), [servicio, modalidad]);
  const [recursoCodigo, setRecursoCodigo] = useState<string | null>(null);
  const [fecha, setFecha] = useState(primerDia);
  const [hora, setHora] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoReserva | null>(null);
  const [reservando, setReservando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir otra consulta: arrancar en el primer día posible de su ventana.
  useEffect(() => {
    if (consulta) {
      setModalidad('teleconsulta');
      setFecha(primerDia);
      setHora(null);
      setResultado(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta?.taskId]);

  // Con un solo recurso posible (p. ej. la agenda de teleconsultas), queda elegido.
  useEffect(() => {
    setRecursoCodigo(recursos.length === 1 ? recursos[0]!.codigo : null);
  }, [recursos]);

  // Horas del día (hoy, solo las que no pasaron; igual el bot valida).
  const horas = useMemo(() => {
    const desde = new Date(`${fecha}T00:00:00-03:00`);
    const dummy = [{ codigo: '_', nombre: '_', tipo: 'CONSULTORIO' as const, capacidad: 1 }];
    return generarSlots(dummy, HORARIO_SEMANAL, { desde, dias: 1 })
      .filter((s) => Date.parse(s.inicio) > Date.now())
      .map((s) => s.inicio.slice(11, 16));
  }, [fecha]);

  async function agendar(): Promise<void> {
    if (!consulta?.taskId || !recursoCodigo || !hora) {
      return;
    }
    setReservando(true);
    setError(null);
    setResultado(null);
    try {
      const r = await reservarTurno({
        pacienteRef,
        servicioCodigo: CODIGO_CONSULTA_PB100D,
        recursoCodigo,
        inicio: `${fecha}T${hora}:00-03:00`,
        modalidad,
        confirmar: true,
        tareaId: consulta.taskId,
      });
      setResultado(r);
      if (r.creado) {
        notifications.show({
          color: r.advertencias.length ? 'yellow' : 'somAzul',
          title: `${consulta.titulo} agendada`,
          message: r.advertencias.length
            ? r.advertencias.map((a) => `[${a.regla}] ${a.mensaje}`).join(' ')
            : 'Confirmada (incluida en el plan, sin seña). Se avisó al paciente por WhatsApp.',
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
    <Modal opened={Boolean(consulta)} onClose={onClose} title={`Agendar consulta del ${NOMBRE_PLAN_BIENESTAR}`} size="lg" centered>
      {consulta && (
        <Stack gap="md">
          <div>
            <Text fw={600}>{pacienteNombre ?? 'Paciente'}</Text>
            <Text size="sm">
              {consulta.titulo} · día {consulta.dia} del plan · incluida (sin seña)
            </Text>
          </div>

          <Group gap="xs">
            {consulta.ventana ? (
              <>
                <Badge color="gray" size="lg" variant="light">
                  Ventana: {fmtDia(consulta.ventana.desde)} al {fmtDia(consulta.ventana.hasta)}
                </Badge>
                <BadgeVentana ventana={consulta.ventana} hoy={hoy} size="lg" />
              </>
            ) : (
              <Badge color="somAzul" size="lg" variant="light">
                Su fecha marca el día 1 del plan
              </Badge>
            )}
          </Group>

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
              label={modalidad === 'teleconsulta' ? 'Agenda' : 'Consultorio'}
              placeholder="Elegí dónde"
              data={recursos.map((r) => ({ value: r.codigo, label: r.nombre }))}
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

          {modalidad === 'teleconsulta' && (
            <Text size="xs" c="dimmed">
              El paciente tiene que haber firmado el consentimiento de teleconsulta en el portal. El link de la videollamada
              (Jitsi) le llega con la confirmación y el recordatorio.
            </Text>
          )}

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
            <Button onClick={() => void agendar()} loading={reservando} disabled={!recursoCodigo || !hora}>
              Agendar consulta
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
