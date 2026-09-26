import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  FileButton,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBrandWhatsapp,
  IconLock,
  IconLockOpen,
  IconMessages,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconUserHeart,
  IconUserPlus,
} from '@tabler/icons-react';
import { ResourceInput, useMedplum, useMedplumProfile, useSubscription } from '@medplum/react';
import { createReference } from '@medplum/core';
import type { Attachment, Communication, Patient } from '@medplum/fhirtypes';
import {
  cambiarEstado,
  cargarConversaciones,
  cargarMensajes,
  esDelPaciente,
  marcarLeidos,
  MOTIVOS_MENSAJE,
  nuevaConversacion,
  responder,
  vistaPreviaMensaje,
  type ConversacionResumen,
  type EstadoBandeja,
} from '@som/lib/mensajes';
import {
  esSinFicha,
  esSoloNumero,
  esWhatsApp,
  formatoTelefono,
  MAX_ADJUNTO_RECEPCION_BYTES,
  telefonoDe,
} from '@som/lib/whatsapp';
import { textoRestante, ventana24h } from '@som/lib/auto-respuesta';
import { borradorRespuesta, mensajeError, responderWhatsApp } from '../lib/bots';
import { NuevoPacienteModal } from '../components/NuevoPacienteModal';
import { Burbuja, fecha } from '../components/Burbuja';
import { resolverAvisosDelPaciente } from '@som/lib/contactos-whatsapp';

/**
 * Mensajes: la bandeja de las conversaciones con los pacientes, estilo WhatsApp. Cada
 * conversación junta lo que el paciente escribe desde el portal y por **WhatsApp** (es
 * un canal de la misma conversación). A la izquierda la lista (último mensaje, hora y no
 * leídos); a la derecha la conversación y la respuesta.
 *
 *  - La respuesta queda en el portal y **sale también por WhatsApp** si el último mensaje
 *    del paciente llegó por ahí y la ventana de 24 h sigue abierta (lo decide el bot
 *    `som-whatsapp-responder`); la burbuja muestra 📱 y los ✓✓, o avisa si no salió.
 *  - 📎 adjuntos (PDF, fotos) de hasta 15 MB; las fotos se ven en la burbuja.
 *  - 🤖 las respuestas automáticas (acuse, fuera de horario) se ven como tales.
 *  - En vivo por la suscripción de Medplum, con refresco de respaldo.
 * Lógica y contrato: `src/lib/mensajes.ts`, `src/lib/whatsapp.ts`, docs/whatsapp.md.
 */
const REFRESCO_MS = 20_000;

/** Mensajes nuevos o cambiados (✓✓, leídos) de cualquier conversación. */
const CRITERIO_MENSAJES = 'Communication?part-of:missing=false';

function error(titulo: string, err: unknown): void {
  notifications.show({ color: 'red', title: titulo, message: mensajeError(err) });
}

export function Mensajes({
  onAtender,
  conversacionInicial,
  onConversacionInicialAbierta,
  onLeidos,
}: {
  onAtender: (pacienteId: string) => void;
  /** Id de la conversación a abrir (p. ej. "Ver conversación" de la pestaña WhatsApp). */
  conversacionInicial?: string | null;
  onConversacionInicialAbierta?: () => void;
  /** Se leyeron mensajes o se resolvió un aviso: refrescar los contadores y la campanita. */
  onLeidos?: () => void;
}): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [estado, setEstado] = useState<EstadoBandeja>('abiertas');
  const [lista, setLista] = useState<ConversacionResumen[]>();
  const [elegidaId, setElegidaId] = useState<string>();
  const [mensajes, setMensajes] = useState<Communication[]>();
  const [paciente, setPaciente] = useState<Patient>();
  const [texto, setTexto] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  // El borrador tal como lo sugirió "Sugerir": al enviar se compara con lo que sale, así
  // se mide cuántos se mandan sin editar (el dato para decidir si automatizar más).
  const [borradorSugerido, setBorradorSugerido] = useState<string>();
  const [sugiriendo, setSugiriendo] = useState(false);
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());
  const viewportRef = useRef<HTMLDivElement>(null);
  const elegidaRef = useRef<string>();
  // Cada recarga de la lista lleva un número: una respuesta vieja no pisa a una más nueva.
  const cargaLista = useRef(0);

  const elegida = lista?.find((c) => c.topic.id === elegidaId);
  const pacienteId = elegida?.pacienteRef?.slice('Patient/'.length);
  const totalSinLeer = lista?.reduce((acc, c) => acc + c.sinLeer, 0) ?? 0;

  // Ventana de 24 h de WhatsApp: desde el último mensaje DEL PACIENTE por WhatsApp se puede
  // escribir libre; después solo salen plantillas aprobadas. A la vista, para no escribir
  // algo que WhatsApp va a rechazar.
  const ultimoDelPaciente = [...(mensajes ?? [])].reverse().find(esDelPaciente);
  const canalWhatsApp = Boolean(ultimoDelPaciente && esWhatsApp(ultimoDelPaciente));
  const ventana = ventana24h(canalWhatsApp ? ultimoDelPaciente?.sent : undefined, ahora);
  const telefono = canalWhatsApp && ultimoDelPaciente ? telefonoDe(ultimoDelPaciente) : undefined;

  const cargarLista = useCallback((): void => {
    const n = ++cargaLista.current;
    cargarConversaciones(medplum, estado)
      .then((l) => n === cargaLista.current && setLista(l))
      .catch((err) => error('No se pudieron cargar los mensajes', err));
  }, [medplum, estado]);

  const cargarConversacion = useCallback(
    (id: string | undefined, silencioso = false): void => {
      const c = lista?.find((x) => x.topic.id === id);
      if (!c) {
        return;
      }
      cargarMensajes(medplum, c.topic)
        .then(async (ms) => {
          if (elegidaRef.current !== id) {
            return; // Mientras cargaba se eligió otra conversación.
          }
          setMensajes(ms);
          // Abrirla = leer lo que escribió el paciente.
          if (document.visibilityState === 'visible' && (await marcarLeidos(medplum, ms)) > 0) {
            setLista((l) => l?.map((x) => (x.topic.id === id ? { ...x, sinLeer: 0, nuevoContacto: false } : x)));
            cargarLista(); // Relee: lo que estaba en camino ya no vale.
            onLeidos?.();
          }
        })
        .catch((err) => !silencioso && error('No se pudo abrir la conversación', err));
    },
    [medplum, lista, onLeidos, cargarLista],
  );

  const refrescarTodo = useCallback((): void => {
    cargarLista();
    cargarConversacion(elegidaRef.current, true);
  }, [cargarLista, cargarConversacion]);

  // Carga inicial + refresco de RESPALDO (el camino principal es el aviso en vivo).
  useEffect(() => {
    setLista(undefined);
    cargarLista();
  }, [cargarLista]);

  useEffect(() => {
    const t = window.setInterval(refrescarTodo, REFRESCO_MS);
    const reloj = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(reloj);
    };
  }, [refrescarTodo]);

  // En vivo: cualquier mensaje nuevo (del portal, de WhatsApp o de otra terminal de
  // Recepción) y los ✓✓ refrescan la bandeja y la conversación abierta al instante.
  useSubscription(CRITERIO_MENSAJES, refrescarTodo, {
    onError: () => undefined,
    onWebSocketClose: () => undefined,
  });

  // Abrir la conversación que se pidió desde afuera (puede ser recién llegada: se relee la lista).
  useEffect(() => {
    if (conversacionInicial) {
      setEstado('abiertas');
      setElegidaId(conversacionInicial);
      cargarLista();
      onConversacionInicialAbierta?.();
    }
  }, [conversacionInicial]);

  // Al cambiar de conversación no puede quedar tipeada la respuesta de la anterior (se
  // mandaría al paciente equivocado).
  useEffect(() => {
    elegidaRef.current = elegidaId;
    setMensajes(undefined);
    setPaciente(undefined);
    setTexto('');
    setArchivos([]);
    setBorradorSugerido(undefined);
  }, [elegidaId]);

  // Sus mensajes, apenas la conversación está en la lista (el refresco va aparte).
  const topicElegido = elegida?.topic.id;
  useEffect(() => {
    if (topicElegido) {
      cargarConversacion(topicElegido);
    }
  }, [topicElegido]);

  // La ficha del paciente (para "Completar ficha" de un contacto nuevo por WhatsApp).
  useEffect(() => {
    if (!pacienteId) {
      return;
    }
    medplum
      .readResource('Patient', pacienteId)
      .then((p) => elegidaRef.current === elegidaId && setPaciente(p))
      .catch(() => undefined);
  }, [medplum, pacienteId, elegidaId]);

  // Autoscroll al fondo cuando llegan mensajes.
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight });
  }, [mensajes?.length, elegidaId]);

  /**
   * Después de guardar la respuesta: el bot decide si sale también por WhatsApp. Si no
   * salió cuando tenía que salir, se avisa — creer que contestaste cuando el mensaje
   * nunca llegó al celular es lo peor que puede pasar en una bandeja.
   */
  const salirPorWhatsApp = async (mensaje: Communication): Promise<void> => {
    if (!mensaje.id) {
      return;
    }
    try {
      const r = await responderWhatsApp(mensaje.id);
      if (r.mensaje) {
        setMensajes((prev) => prev?.map((m) => (m.id === r.mensaje!.id ? r.mensaje! : m)));
      }
      if (!r.ok) {
        notifications.show({
          color: 'orange',
          title: 'Quedó en la conversación, pero NO salió por WhatsApp',
          message: r.motivo ?? 'Probá de nuevo o avisale por otro canal.',
        });
      }
    } catch (err) {
      notifications.show({
        color: 'orange',
        title: 'Quedó en la conversación, pero NO salió por WhatsApp',
        message: mensajeError(err),
      });
    }
  };

  const enviar = async (): Promise<void> => {
    if (!elegida || !profile || (!texto.trim() && archivos.length === 0)) {
      return;
    }
    setEnviando(true);
    try {
      // Adjuntos: cada archivo sube como Binary (en el compartimento del paciente); el
      // servidor firma el link en cada lectura (Recepción y el portal lo ven sin vencer).
      const adjuntos: Attachment[] = [];
      for (const f of archivos) {
        const binary = await medplum.createBinary({
          data: f,
          contentType: f.type || 'application/octet-stream',
          filename: f.name,
          ...(elegida.pacienteRef ? { securityContext: { reference: elegida.pacienteRef } } : {}),
        });
        adjuntos.push({ contentType: f.type || 'application/octet-stream', url: `Binary/${binary.id}`, title: f.name, size: f.size });
      }
      const { mensaje } = await responder(
        medplum,
        createReference(profile),
        elegida.topic,
        texto,
        mensajes ?? [],
        borradorSugerido,
        adjuntos,
      );
      setMensajes((prev) => [...(prev ?? []), mensaje]);
      setTexto('');
      setArchivos([]);
      setBorradorSugerido(undefined);
      // El envío por WhatsApp sigue en segundo plano: su resultado marca la burbuja o avisa.
      void salirPorWhatsApp(mensaje);
      refrescarTodo();
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

  const nombreProvisorio = elegida && esSoloNumero(elegida.paciente);

  return (
    <Stack gap="md" maw={1280} mx="auto" h="calc(100dvh - 64px - 2 * var(--mantine-spacing-md))">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <IconMessages size={24} />
          <Title order={2}>Mensajes</Title>
          {lista && (
            <Badge variant="light" color="teal">
              {lista.length} {estado === 'abiertas' ? (lista.length === 1 ? 'abierta' : 'abiertas') : lista.length === 1 ? 'cerrada' : 'cerradas'}
            </Badge>
          )}
          {totalSinLeer > 0 && (
            <Badge color="teal" variant="filled">
              {totalSinLeer} sin leer
            </Badge>
          )}
        </Group>
        <Group gap="sm">
          <SegmentedControl
            value={estado}
            onChange={(v) => {
              setEstado(v as EstadoBandeja);
              setElegidaId(undefined);
            }}
            data={[
              { value: 'abiertas', label: 'Abiertas' },
              { value: 'cerradas', label: 'Cerradas' },
            ]}
          />
          <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={refrescarTodo}>
            Actualizar
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setNuevaAbierta(true)}>
            Nueva conversación
          </Button>
        </Group>
      </Group>

      <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
        {/* Lista de conversaciones, estilo WhatsApp */}
        <Card withBorder radius="md" p={0} w={360} style={{ overflow: 'hidden', flexShrink: 0 }}>
          <ScrollArea h="100%">
            {lista === undefined ? (
              <Group justify="center" py="xl">
                <Loader size="sm" />
              </Group>
            ) : lista.length === 0 ? (
              <Text c="dimmed" p="md" size="sm">
                {estado === 'abiertas'
                  ? 'No hay conversaciones abiertas. Cuando un paciente escriba desde el portal o por WhatsApp, aparece acá.'
                  : 'No hay conversaciones cerradas.'}
              </Text>
            ) : (
              lista.map((c) => (
                <Box
                  key={c.topic.id}
                  p="sm"
                  onClick={() => setElegidaId(c.topic.id)}
                  bg={c.topic.id === elegidaId ? 'var(--mantine-color-default-hover)' : undefined}
                  style={{ cursor: 'pointer', borderBottom: '1px solid var(--mantine-color-default-border)' }}
                >
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      {c.porWhatsApp && <IconBrandWhatsapp size={15} color="#25D366" style={{ flexShrink: 0 }} />}
                      <Text fw={c.sinLeer > 0 ? 700 : 600} size="sm" truncate>
                        {c.paciente}
                      </Text>
                    </Group>
                    <Text
                      size="xs"
                      c={c.sinLeer > 0 ? 'teal' : 'dimmed'}
                      fw={c.sinLeer > 0 ? 700 : undefined}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {fecha(c.actividad)}
                    </Text>
                  </Group>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="sm" c={c.sinLeer > 0 ? undefined : 'dimmed'} fw={c.sinLeer > 0 ? 600 : undefined} truncate>
                      {vistaPreviaMensaje(c.ultimo) || c.motivo.titulo}
                    </Text>
                    <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                      {c.nuevoContacto && (
                        <Badge size="xs" color="green" variant="outline">
                          Nuevo
                        </Badge>
                      )}
                      {c.sinLeer > 0 && (
                        <Badge color="teal" variant="filled" size="md" circle>
                          {c.sinLeer > 9 ? '9+' : c.sinLeer}
                        </Badge>
                      )}
                    </Group>
                  </Group>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600} truncate>
                    {c.motivo.titulo}
                  </Text>
                </Box>
              ))
            )}
          </ScrollArea>
        </Card>

        {/* Conversación */}
        <Card withBorder radius="md" p={0} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {!elegida ? (
            <Stack align="center" justify="center" style={{ flex: 1 }} gap="xs">
              <IconMessages size={40} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed">Elegí una conversación de la lista.</Text>
            </Stack>
          ) : (
            <>
              <Group
                justify="space-between"
                p="sm"
                wrap="nowrap"
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
              >
                <div style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text fw={700} truncate>
                      {elegida.paciente}
                    </Text>
                    {canalWhatsApp && (
                      <Badge
                        size="sm"
                        variant="light"
                        color={!ventana.abierta ? 'gray' : ventana.porCerrar ? 'orange' : 'teal'}
                        leftSection={<IconBrandWhatsapp size={12} />}
                        title={
                          ventana.abierta
                            ? 'WhatsApp permite texto libre durante 24 h desde el último mensaje del paciente.'
                            : 'Pasaron más de 24 h desde el último mensaje del paciente: WhatsApp solo acepta plantillas aprobadas.'
                        }
                      >
                        {ventana.abierta ? `Ventana WhatsApp · ${textoRestante(ventana.restanteMin)}` : 'Ventana cerrada'}
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    {elegida.motivo.titulo}
                    {telefono && !nombreProvisorio ? ` · ${formatoTelefono(telefono)}` : ''}
                  </Text>
                </div>
                <Group gap="xs" wrap="nowrap">
                  {paciente && esSinFicha(paciente) && (
                    <Button size="xs" leftSection={<IconUserPlus size={15} />} onClick={() => setAltaAbierta(true)}>
                      Completar ficha
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconUserHeart size={15} />}
                    disabled={!pacienteId}
                    onClick={() => pacienteId && onAtender(pacienteId)}
                  >
                    Ver paciente
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="gray"
                    leftSection={estado === 'abiertas' ? <IconLock size={15} /> : <IconLockOpen size={15} />}
                    loading={cambiando}
                    onClick={alternarEstado}
                  >
                    {estado === 'abiertas' ? 'Cerrar conversación' : 'Reabrir'}
                  </Button>
                </Group>
              </Group>

              <ScrollArea style={{ flex: 1 }} viewportRef={viewportRef} p="md">
                {mensajes === undefined ? (
                  <Group justify="center" py="xl">
                    <Loader size="sm" />
                  </Group>
                ) : (
                  <Stack gap="xs">
                    {mensajes.map((m) => (
                      <Burbuja key={m.id} m={m} />
                    ))}
                  </Stack>
                )}
              </ScrollArea>

              <Box style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                {estado === 'cerradas' ? (
                  <Text c="dimmed" size="sm" p="sm">
                    Conversación cerrada: el paciente no puede escribir en ella. Reabrila para responder.
                  </Text>
                ) : (
                  <>
                    {mensajes && canalWhatsApp && (
                      <Text size="xs" c={ventana.abierta ? 'dimmed' : 'orange'} px="sm" pt="xs">
                        {ventana.abierta
                          ? '📱 El paciente escribió por WhatsApp: la respuesta sale también por WhatsApp.'
                          : '⚠️ Pasaron más de 24 h desde el último WhatsApp del paciente: lo que escribas queda en la conversación y lo ve en el portal, pero no sale por WhatsApp.'}
                      </Text>
                    )}
                    {archivos.length > 0 && (
                      <Group gap={6} px="sm" pt="xs">
                        {archivos.map((f, i) => (
                          <Badge
                            key={`${f.name}-${i}`}
                            variant="light"
                            style={{ cursor: 'pointer', textTransform: 'none' }}
                            title="Quitar adjunto"
                            onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))}
                          >
                            📎 {f.name} ✕
                          </Badge>
                        ))}
                      </Group>
                    )}
                    <Group p="sm" gap="xs" wrap="nowrap" align="flex-end">
                      <FileButton
                        multiple
                        onChange={(fs) => {
                          if (fs.some((f) => f.size > MAX_ADJUNTO_RECEPCION_BYTES)) {
                            notifications.show({
                              color: 'red',
                              title: 'Archivo muy grande',
                              message: 'WhatsApp acepta hasta 15 MB por archivo.',
                            });
                          }
                          setArchivos((prev) => [...prev, ...fs.filter((f) => f.size <= MAX_ADJUNTO_RECEPCION_BYTES)]);
                        }}
                      >
                        {(props) => (
                          <ActionIcon {...props} variant="default" size="lg" title="Adjuntar archivo (PDF, imagen…)">
                            <IconPaperclip size={18} />
                          </ActionIcon>
                        )}
                      </FileButton>
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
                        disabled={!texto.trim() && archivos.length === 0}
                        onClick={enviar}
                      >
                        Enviar
                      </Button>
                    </Group>
                  </>
                )}
              </Box>
            </>
          )}
        </Card>
      </Group>

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

      <NuevoPacienteModal
        abierto={altaAbierta}
        onCerrar={() => setAltaAbierta(false)}
        inicial={{
          nombre: elegida && !nombreProvisorio ? elegida.paciente : '',
          telefono: telefono ?? paciente?.telecom?.find((t) => t.system === 'phone')?.value ?? '',
        }}
        onCreado={() => {
          notifications.show({ color: 'teal', title: 'Ficha completada', message: 'La conversación queda con los datos del paciente.' });
          // El aviso de la pestaña WhatsApp ya cumplió: lo resuelve el bot de alta si completó
          // este contacto; si esos datos eran de otra ficha, se resuelve acá.
          if (elegida?.pacienteRef) {
            void resolverAvisosDelPaciente(medplum, elegida.pacienteRef, 'ficha-completada', profile ? createReference(profile) : undefined)
              .catch(() => 0)
              .then(() => onLeidos?.());
          }
          setPaciente(undefined);
          cargarLista();
        }}
      />
    </Stack>
  );
}

/** Recepción le escribe primero a un paciente: paciente + motivo + mensaje (queda en el portal). */
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
          El paciente lo ve en "Mensajes" del portal y le llega un aviso a la campanita. Para escribirle primero por
          WhatsApp hacen falta las plantillas aprobadas por Meta (pendientes).
        </Text>
        <Button loading={creando} disabled={!paciente || !motivo || !texto.trim()} onClick={crear}>
          Enviar
        </Button>
      </Stack>
    </Modal>
  );
}
