import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconLock,
  IconLockOpen,
  IconMessages,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconUserHeart,
} from '@tabler/icons-react';
import { ResourceInput, useMedplum, useMedplumProfile } from '@medplum/react';
import { createReference } from '@medplum/core';
import type { Communication, Patient } from '@medplum/fhirtypes';
import {
  cambiarEstado,
  cargarConversaciones,
  cargarMensajes,
  esDelPaciente,
  marcarLeidos,
  MOTIVOS_MENSAJE,
  nuevaConversacion,
  responder,
  textoMensaje,
  type ConversacionResumen,
  type EstadoBandeja,
} from '@som/lib/mensajes';
import { borradorRespuesta, mensajeError } from '../lib/bots';

/**
 * Mensajes: las conversaciones que abren los pacientes desde el portal ("Mensajes",
 * con motivo obligatorio). A la izquierda la bandeja (abiertas / cerradas), a la
 * derecha la conversación con el paciente y abajo la respuesta. Responder le deja al
 * paciente una Novedad en la campanita. Lógica y contrato: `src/lib/mensajes.ts`.
 */
const REFRESCO_MS = 20_000;

const fmtFecha = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});

function fecha(iso?: string): string {
  return iso ? fmtFecha.format(new Date(iso)) : '';
}

function error(titulo: string, err: unknown): void {
  notifications.show({ color: 'red', title: titulo, message: String((err as Error)?.message ?? err) });
}

function Burbuja({ m }: { m: Communication }): JSX.Element {
  const delPaciente = esDelPaciente(m);
  return (
    <Paper
      withBorder={delPaciente}
      radius="lg"
      px="md"
      py="xs"
      maw="75%"
      style={{ alignSelf: delPaciente ? 'flex-start' : 'flex-end' }}
      bg={delPaciente ? undefined : 'somAzul.0'}
    >
      <Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{textoMensaje(m) || 'Archivo adjunto'}</Text>
      <Text size="xs" c="dimmed" ta={delPaciente ? 'left' : 'right'} mt={4}>
        {delPaciente ? 'Paciente · Portal' : (m.sender?.display ?? 'Recepción')} · {fecha(m.sent)}
      </Text>
    </Paper>
  );
}

export function Mensajes({ onAtender }: { onAtender: (pacienteId: string) => void }): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [estado, setEstado] = useState<EstadoBandeja>('abiertas');
  const [lista, setLista] = useState<ConversacionResumen[]>();
  const [elegidaId, setElegidaId] = useState<string>();
  const [mensajes, setMensajes] = useState<Communication[]>();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  // El borrador tal como lo sugirió "Sugerir": al enviar se compara con lo que sale, así
  // se mide cuántos se mandan sin editar (el dato para decidir si automatizar más).
  const [borradorSugerido, setBorradorSugerido] = useState<string>();
  const [sugiriendo, setSugiriendo] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const fondo = useRef<HTMLDivElement>(null);

  const elegida = lista?.find((c) => c.topic.id === elegidaId);

  const cargarLista = useCallback((): void => {
    cargarConversaciones(medplum, estado)
      .then(setLista)
      .catch((err) => error('No se pudieron cargar los mensajes', err));
  }, [medplum, estado]);

  const cargarConversacion = useCallback(
    (c: ConversacionResumen | undefined): void => {
      if (!c) {
        return;
      }
      cargarMensajes(medplum, c.topic)
        .then(async (ms) => {
          setMensajes(ms);
          // Abrirla = leer lo que escribió el paciente.
          if ((await marcarLeidos(medplum, ms)) > 0) {
            setLista((l) => l?.map((x) => (x.topic.id === c.topic.id ? { ...x, sinLeer: 0 } : x)));
          }
        })
        .catch((err) => error('No se pudo abrir la conversación', err));
    },
    [medplum],
  );

  useEffect(() => {
    setLista(undefined);
    setElegidaId(undefined);
    cargarLista();
  }, [cargarLista]);

  // Refresco automático de la bandeja y de la conversación abierta.
  useEffect(() => {
    const t = window.setInterval(() => {
      cargarLista();
      cargarConversacion(elegida);
    }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [cargarLista, cargarConversacion, elegida]);

  useEffect(() => {
    setMensajes(undefined);
    // Al cambiar de conversación no puede quedar tipeada la respuesta de la anterior.
    setTexto('');
    setBorradorSugerido(undefined);
    cargarConversacion(lista?.find((c) => c.topic.id === elegidaId));
    // Solo al cambiar de conversación (el refresco periódico va aparte).
  }, [elegidaId]);

  useEffect(() => {
    const el = fondo.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [mensajes?.length]);

  const enviar = async (): Promise<void> => {
    if (!elegida || !profile || !texto.trim()) {
      return;
    }
    setEnviando(true);
    try {
      const { mensaje } = await responder(
        medplum,
        createReference(profile),
        elegida.topic,
        texto,
        mensajes ?? [],
        borradorSugerido,
      );
      setMensajes((ms) => [...(ms ?? []), mensaje]);
      setTexto('');
      setBorradorSugerido(undefined);
      cargarLista();
    } catch (err) {
      error('No se pudo enviar', err);
    } finally {
      setEnviando(false);
    }
  };

  /** Pide el borrador y lo deja en el campo de respuesta. NO envía: la recepcionista decide. */
  const sugerir = async (): Promise<void> => {
    if (!elegida?.topic.id) {
      return;
    }
    setSugiriendo(true);
    try {
      const r = await borradorRespuesta(elegida.topic.id);
      if (r.borrador) {
        setTexto(r.borrador);
        setBorradorSugerido(r.borrador);
      } else {
        setBorradorSugerido(undefined);
        notifications.show({
          color: 'blue',
          title: 'Mejor contestalo vos',
          message: r.motivo ?? 'El asistente no sugirió una respuesta para este mensaje.',
        });
      }
    } catch (err) {
      notifications.show({ color: 'orange', title: 'No pude sugerir', message: mensajeError(err) });
    } finally {
      setSugiriendo(false);
    }
  };

  const alternarEstado = async (): Promise<void> => {
    if (!elegida) {
      return;
    }
    setCambiando(true);
    try {
      await cambiarEstado(medplum, elegida.topic, estado === 'abiertas' ? 'cerradas' : 'abiertas');
      setElegidaId(undefined);
      cargarLista();
    } catch (err) {
      error('No se pudo actualizar la conversación', err);
    } finally {
      setCambiando(false);
    }
  };

  const pacienteId = elegida?.pacienteRef?.slice('Patient/'.length);

  return (
    <Stack gap="md" maw={1280} mx="auto">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <IconMessages size={24} />
          <Title order={2}>Mensajes</Title>
          {lista && estado === 'abiertas' && (
            <Badge variant="light" color="teal">
              {lista.length} {lista.length === 1 ? 'abierta' : 'abiertas'}
            </Badge>
          )}
        </Group>
        <Group gap="sm">
          <SegmentedControl
            value={estado}
            onChange={(v) => setEstado(v as EstadoBandeja)}
            data={[
              { value: 'abiertas', label: 'Abiertas' },
              { value: 'cerradas', label: 'Cerradas' },
            ]}
          />
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={cargarLista}>
            Actualizar
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setNuevaAbierta(true)}>
            Nueva conversación
          </Button>
        </Group>
      </Group>

      <Grid gutter="md">
        {/* Bandeja */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder radius="md" p={0}>
            <ScrollArea h="calc(100vh - 210px)">
              {lista === undefined ? (
                <Group justify="center" py="xl">
                  <Loader />
                </Group>
              ) : lista.length === 0 ? (
                <Text c="dimmed" p="md">
                  {estado === 'abiertas'
                    ? 'No hay conversaciones abiertas. Cuando un paciente escriba desde el portal, aparece acá.'
                    : 'No hay conversaciones cerradas.'}
                </Text>
              ) : (
                lista.map((c) => (
                  <UnstyledButton
                    key={c.topic.id}
                    w="100%"
                    p="md"
                    onClick={() => setElegidaId(c.topic.id)}
                    style={{
                      borderBottom: '1px solid var(--mantine-color-default-border)',
                      backgroundColor: c.topic.id === elegidaId ? 'var(--mantine-color-default-hover)' : undefined,
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text fw={c.sinLeer ? 800 : 600} truncate>
                        {c.paciente}
                      </Text>
                      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                        {fecha(c.actividad)}
                      </Text>
                    </Group>
                    <Text size="xs" fw={700} tt="uppercase" c="somAzul.7">
                      {c.motivo.titulo}
                    </Text>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {c.ultimo ? textoMensaje(c.ultimo) : ''}
                      </Text>
                      {c.sinLeer > 0 && (
                        <Badge color="red" circle style={{ flexShrink: 0 }}>
                          {c.sinLeer}
                        </Badge>
                      )}
                    </Group>
                  </UnstyledButton>
                ))
              )}
            </ScrollArea>
          </Card>
        </Grid.Col>

        {/* Conversación */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card
            withBorder
            radius="md"
            p={0}
            h="calc(100vh - 210px)"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {!elegida ? (
              <Stack align="center" justify="center" h="100%" gap="xs">
                <IconMessages size={40} color="var(--mantine-color-dimmed)" />
                <Text c="dimmed">Elegí una conversación de la izquierda.</Text>
              </Stack>
            ) : (
              <>
                <Group
                  justify="space-between"
                  p="md"
                  wrap="nowrap"
                  style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Title order={3}>{elegida.paciente}</Title>
                    <Text size="sm" fw={600} tt="uppercase" c="dimmed">
                      {elegida.motivo.titulo}
                    </Text>
                  </div>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      variant="light"
                      leftSection={<IconUserHeart size={16} />}
                      disabled={!pacienteId}
                      onClick={() => pacienteId && onAtender(pacienteId)}
                    >
                      Ver paciente
                    </Button>
                    <Button
                      variant="default"
                      leftSection={estado === 'abiertas' ? <IconLock size={16} /> : <IconLockOpen size={16} />}
                      loading={cambiando}
                      onClick={alternarEstado}
                    >
                      {estado === 'abiertas' ? 'Cerrar conversación' : 'Reabrir'}
                    </Button>
                  </Group>
                </Group>

                <Box
                  ref={fondo}
                  p="md"
                  style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {mensajes === undefined ? (
                    <Group justify="center" py="xl">
                      <Loader />
                    </Group>
                  ) : (
                    mensajes.map((m) => <Burbuja key={m.id} m={m} />)
                  )}
                </Box>

                <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                  {estado === 'cerradas' ? (
                    <Text c="dimmed" size="sm">
                      Conversación cerrada: el paciente no puede escribir en ella. Reabrila para responder.
                    </Text>
                  ) : (
                    <Group align="flex-end" wrap="nowrap">
                      <Textarea
                        style={{ flex: 1 }}
                        placeholder="Escribí tu respuesta…"
                        aria-label="Tu respuesta"
                        autosize
                        minRows={1}
                        maxRows={6}
                        value={texto}
                        onChange={(e) => setTexto(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          // Enter envía; Shift+Enter hace un salto de línea.
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void enviar();
                          }
                        }}
                      />
                      <Button
                        variant="light"
                        leftSection={<IconSparkles size={16} />}
                        loading={sugiriendo}
                        onClick={sugerir}
                        title="Escribe un borrador con el contexto del paciente. Lo revisás y lo enviás vos."
                      >
                        Sugerir
                      </Button>
                      <Button
                        leftSection={<IconSend size={16} />}
                        loading={enviando}
                        disabled={!texto.trim()}
                        onClick={enviar}
                      >
                        Enviar
                      </Button>
                    </Group>
                  )}
                </Box>
              </>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <NuevaConversacion
        abierta={nuevaAbierta}
        onCerrar={() => setNuevaAbierta(false)}
        onCreada={(id) => {
          setNuevaAbierta(false);
          setEstado('abiertas');
          cargarLista();
          setElegidaId(id);
        }}
      />
    </Stack>
  );
}

/** Recepción le escribe primero a un paciente: paciente + motivo + mensaje. */
function NuevaConversacion({
  abierta,
  onCerrar,
  onCreada,
}: {
  abierta: boolean;
  onCerrar: () => void;
  onCreada: (conversacionId: string) => void;
}): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [paciente, setPaciente] = useState<Patient>();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [creando, setCreando] = useState(false);

  const crear = async (): Promise<void> => {
    if (!paciente?.id || !profile || !motivo || !texto.trim()) {
      return;
    }
    setCreando(true);
    try {
      const topic = await nuevaConversacion(medplum, createReference(profile), `Patient/${paciente.id}`, motivo, texto);
      setPaciente(undefined);
      setMotivo(null);
      setTexto('');
      onCreada(topic.id as string);
    } catch (err) {
      error('No se pudo crear la conversación', err);
    } finally {
      setCreando(false);
    }
  };

  return (
    <Modal opened={abierta} onClose={onCerrar} title="Nueva conversación" radius="md">
      <Stack gap="sm">
        <ResourceInput<Patient> resourceType="Patient" name="paciente" label="Paciente" onChange={setPaciente} />
        <Select
          label="Motivo"
          placeholder="Elegí el motivo"
          data={Object.entries(MOTIVOS_MENSAJE).map(([value, label]) => ({ value, label }))}
          value={motivo}
          onChange={setMotivo}
        />
        <Textarea
          label="Mensaje"
          autosize
          minRows={3}
          value={texto}
          onChange={(e) => setTexto(e.currentTarget.value)}
          required
        />
        <Text size="xs" c="dimmed">
          El paciente lo ve en "Mensajes" del portal y le llega un aviso a la campanita.
        </Text>
        <Button loading={creando} disabled={!paciente || !motivo || !texto.trim()} onClick={crear}>
          Enviar
        </Button>
      </Stack>
    </Modal>
  );
}
