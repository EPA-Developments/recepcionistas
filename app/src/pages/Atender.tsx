import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  NumberFormatter,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconSearch,
  IconShieldCheck,
  IconShieldX,
  IconCash,
  IconCalendarPlus,
  IconInfoCircle,
  IconUserPlus,
} from '@tabler/icons-react';
import type { Patient, Invoice } from '@medplum/fhirtypes';
import { getDisplayString } from '@medplum/core';
import { medplum } from '../medplum';
import { calcularCobro, reservarTurno, mensajeError, type ResultadoReserva } from '../lib/bots';
import { InvitarPortal } from '../components/InvitarPortal';
import { NuevoPacienteModal } from '../components/NuevoPacienteModal';
import { SeguimientoGlp1 } from '../components/SeguimientoGlp1';
import { SERVICIOS } from '@som/config/catalogo';
import { recursosParaCategoria } from '@som/config/recursos';
import { generarSlots } from '@som/lib/slots';
import { HORARIO_SEMANAL } from '@som/config/horario';
import { seAgendaSinTarea } from '@som/lib/glp1-plan';

/** Lo que se reserva libre (el control GLP-1 se agenda desde su tarea, R-19). */
const SERVICIOS_RESERVA = SERVICIOS.filter((s) => seAgendaSinTarea(s.codigo));

export function Atender({
  pacienteInicialId,
  onPacienteInicialCargado,
}: {
  /** Si viene, se abre directo la ficha de ese paciente (p. ej. desde Solicitudes). */
  pacienteInicialId?: string | null;
  onPacienteInicialCargado?: () => void;
} = {}): JSX.Element {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Patient[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [seleccionado, setSeleccionado] = useState<Patient | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);

  useEffect(() => {
    if (!pacienteInicialId) {
      return;
    }
    let cancelado = false;
    medplum
      .readResource('Patient', pacienteInicialId)
      .then((p) => {
        if (!cancelado) {
          setSeleccionado(p);
          onPacienteInicialCargado?.();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteInicialId]);

  async function buscar(): Promise<void> {
    if (!query.trim()) {
      return;
    }
    setBuscando(true);
    setSeleccionado(null);
    try {
      const esDni = /^\d+$/.test(query.trim());
      const params = esDni ? { identifier: query.trim() } : { name: query.trim() };
      setResultados(await medplum.searchResources('Patient', { ...params, _count: 10 }));
    } finally {
      setBuscando(false);
    }
  }

  async function abrirReciénCreado(patientId: string): Promise<void> {
    const p = await medplum.readResource('Patient', patientId);
    setResultados(null);
    setSeleccionado(p);
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={2}>Atender paciente</Title>
        <Button variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => setAltaAbierta(true)}>
          Nuevo paciente
        </Button>
      </Group>

      <NuevoPacienteModal
        abierto={altaAbierta}
        onCerrar={() => setAltaAbierta(false)}
        onCreado={(id) => void abrirReciénCreado(id)}
      />

      <Group align="flex-end">
        <TextInput
          label="Buscar por nombre o DNI"
          placeholder="Ej.: Pérez o 30123456"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void buscar()}
          w={360}
          size="md"
        />
        <Button leftSection={<IconSearch size={16} />} onClick={() => void buscar()} loading={buscando}>
          Buscar
        </Button>
      </Group>

      {!seleccionado && resultados && resultados.length === 0 && (
        <Alert color="yellow" icon={<IconInfoCircle size={16} />}>
          No se encontraron pacientes. (En el entorno de prueba puede que aún no haya pacientes cargados.)
        </Alert>
      )}

      {!seleccionado &&
        resultados &&
        resultados.length > 0 &&
        resultados.map((p) => (
          <Card key={p.id} withBorder padding="md" radius="md" onClick={() => setSeleccionado(p)} style={{ cursor: 'pointer' }}>
            <Group justify="space-between">
              <Text fw={600}>{getDisplayString(p)}</Text>
              <Badge variant="light">{p.birthDate ?? 'sin fecha'}</Badge>
            </Group>
          </Card>
        ))}

      {seleccionado && <FichaPaciente paciente={seleccionado} onVolver={() => setSeleccionado(null)} />}
    </Stack>
  );
}

function FichaPaciente({ paciente, onVolver }: { paciente: Patient; onVolver: () => void }): JSX.Element {
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>{getDisplayString(paciente)}</Title>
        <Button variant="subtle" onClick={onVolver}>
          ← Volver a la búsqueda
        </Button>
      </Group>
      <BannerSeguridad pacienteId={paciente.id!} />
      <InvitarPortal paciente={paciente} />
      <PanelReserva paciente={paciente} />
      <SeguimientoGlp1 paciente={paciente} />
      <PanelCobro paciente={paciente} />
    </Stack>
  );
}

/** Banner de seguridad: señal binaria verde/rojo. La recepción NO ve el detalle clínico. */
function BannerSeguridad({ pacienteId }: { pacienteId: string }): JSX.Element {
  const [estado, setEstado] = useState<'cargando' | 'verde' | 'rojo'>('cargando');

  useEffect(() => {
    let activo = true;
    medplum
      .searchResources('Flag', { subject: `Patient/${pacienteId}`, status: 'active', _count: 1 })
      .then((flags) => activo && setEstado(flags.length > 0 ? 'rojo' : 'verde'))
      .catch(() => activo && setEstado('verde'));
    return () => {
      activo = false;
    };
  }, [pacienteId]);

  if (estado === 'cargando') {
    return <Loader size="sm" />;
  }
  if (estado === 'rojo') {
    return (
      <Alert color="red" icon={<IconShieldX size={20} />} title="Atención: señal de seguridad activa" variant="filled">
        Consultar con el equipo médico antes de continuar.
      </Alert>
    );
  }
  return (
    <Alert color="somAzul" icon={<IconShieldCheck size={20} />} title="Sin novedades" variant="filled">
      Paciente apto para atención.
    </Alert>
  );
}

/** Reserva de turno: el front arma la propuesta y el bot valida + crea. */
function PanelReserva({ paciente }: { paciente: Patient }): JSX.Element {
  const hoy = new Date().toISOString().slice(0, 10);
  const [servicioCodigo, setServicioCodigo] = useState<string | null>(null);
  const [recursoCodigo, setRecursoCodigo] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [hora, setHora] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoReserva | null>(null);
  const [reservando, setReservando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const servicio = servicioCodigo ? SERVICIOS.find((s) => s.codigo === servicioCodigo) : undefined;
  const salas = servicio ? recursosParaCategoria(servicio.categoria) : [];

  const horas = useMemo(() => {
    const desde = new Date(`${fecha}T00:00:00-03:00`);
    const dummy = [{ codigo: '_', nombre: '_', tipo: 'CONSULTORIO' as const, capacidad: 1 }];
    return generarSlots(dummy, HORARIO_SEMANAL, { desde, dias: 1 }).map((s) => s.inicio.slice(11, 16));
  }, [fecha]);

  function limpiar(): void {
    setResultado(null);
    setError(null);
  }

  async function reservar(): Promise<void> {
    if (!servicioCodigo || !recursoCodigo || !hora) {
      return;
    }
    setReservando(true);
    limpiar();
    const inicio = `${fecha}T${hora}:00-03:00`;
    const pacienteRef = `Patient/${paciente.id}`;
    try {
      const r = await reservarTurno({
        pacienteRef,
        servicioCodigo,
        recursoCodigo,
        inicio,
        confirmar: true,
      });
      setResultado(r);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setReservando(false);
    }
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconCalendarPlus size={18} />
        <Text fw={600}>Reservar turno</Text>
      </Group>

      <Stack gap="sm">
        <Group grow align="flex-end">
          <Select
            label="Servicio"
            placeholder="Elegí qué reservar"
            data={SERVICIOS_RESERVA.map((s) => ({ value: s.codigo, label: s.nombre }))}
            value={servicioCodigo}
            onChange={(v) => {
              setServicioCodigo(v);
              setRecursoCodigo(null);
              limpiar();
            }}
            searchable
          />
          <Select
            label="Consultorio / sala"
            placeholder={servicio ? 'Elegí el consultorio' : 'Primero el servicio'}
            data={salas.map((r) => ({ value: r.codigo, label: r.nombre }))}
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
          <Select label="Hora" placeholder={horas.length ? 'Elegí la hora' : 'Cerrado ese día'} data={horas} value={hora} onChange={setHora} disabled={!horas.length} searchable />
        </Group>

        <Group>
          <Button onClick={() => void reservar()} loading={reservando} disabled={!servicioCodigo || !recursoCodigo || !hora}>
            Reservar turno
          </Button>
        </Group>

        {error && (
          <Alert color="orange" icon={<IconInfoCircle size={16} />}>
            {error}
          </Alert>
        )}

        {resultado?.creado && (
          <Alert color="somAzul" title="Turno reservado ✓">
            El consultorio queda ocupado en la agenda. Tentativo hasta cobrar la seña del 50%.
          </Alert>
        )}
        {resultado && !resultado.creado && (
          <Alert color="red" title="No se pudo reservar" icon={<IconShieldX size={16} />}>
            <List size="sm">
              {resultado.bloqueos.map((b, i) => (
                <List.Item key={i}>
                  [{b.regla}] {b.mensaje}
                </List.Item>
              ))}
            </List>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

/** Cobro: el front no calcula nada; le pide el monto al bot calcular-cobro. */
function PanelCobro({ paciente }: { paciente: Patient }): JSX.Element {
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function calcular(): Promise<void> {
    if (!seleccion) {
      return;
    }
    setCalculando(true);
    setError(null);
    setInvoice(null);
    try {
      const inv = await calcularCobro([{ tipo: 'servicio', codigo: seleccion }], `Patient/${paciente.id}`);
      setInvoice(inv);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCalculando(false);
    }
  }

  const totalARS = invoice?.totalGross?.value;

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconCash size={18} />
        <Text fw={600}>Cobro</Text>
      </Group>
      <Group align="flex-end">
        <Select
          label="Servicio"
          placeholder="Elegí qué cobrar"
          data={SERVICIOS.map((s) => ({ value: s.codigo, label: s.nombre }))}
          value={seleccion}
          onChange={setSeleccion}
          searchable
          w={360}
        />
        <Button onClick={() => void calcular()} loading={calculando} disabled={!seleccion}>
          Calcular cobro
        </Button>
      </Group>

      {error && (
        <Alert color="orange" mt="md" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}

      {totalARS !== undefined && (
        <Alert color="somAzul" mt="md" title="Total a cobrar">
          <Text size="xl" fw={700}>
            <NumberFormatter prefix="$ " value={totalARS} thousandSeparator="." decimalSeparator="," />
          </Text>
          <Text size="sm" c="dimmed">
            Calculado por el bot (incluye conversión USD→ARS al TC vigente). La recepción solo elige el medio de pago.
          </Text>
        </Alert>
      )}
    </Card>
  );
}
