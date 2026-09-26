import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconAntennaBars5,
  IconArrowLeft,
  IconBattery3,
  IconBrandWhatsapp,
  IconCheck,
  IconChecks,
  IconClock,
  IconDownload,
  IconFileText,
  IconMicrophone,
  IconPaperclip,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconSend,
  IconUser,
  IconUserHeart,
  IconUserPlus,
  IconVideo,
  IconWifi,
} from '@tabler/icons-react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { createReference } from '@medplum/core';
import type { Attachment, Communication } from '@medplum/fhirtypes';
import {
  adjuntosDe,
  cierreVentana,
  diaDeMensaje,
  esEntrante,
  esReservado,
  esSeguroParaVer,
  esSoloNumero,
  estadoVisible,
  etiquetaAdjunto,
  etiquetaDia,
  fechaCorta,
  formatoTelefono,
  horaMensaje,
  iniciales,
  MAX_TEXTO_WHATSAPP,
  ordenarMensajes,
  PLANTILLA_RESPUESTA,
  plantillaDe,
  TEXTO_RESERVADO,
  textoDe,
  tipoAdjunto,
  ultimoEntrante,
  ventanaWhatsApp,
  vistaPrevia,
  type ChatWhatsApp,
  type EstadoVisible,
  type TipoAdjunto,
} from '@som/lib/whatsapp';
import { cargarChat, cargarChats, marcarLeidos } from '@som/lib/whatsapp-chat';
import { adjuntoWhatsApp, mensajeError, responderWhatsApp } from '../lib/bots';
import { NuevoPacienteModal } from '../components/NuevoPacienteModal';
import classes from './WhatsApp.module.css';

/**
 * WhatsApp de Recepción: se ve como en el teléfono. La lista de chats (uno por
 * paciente, con los no leídos y los contactos nuevos), la conversación con sus ✓✓ y el
 * campo para responder. Al lado, el contacto: su ficha, si falta completarla y hasta
 * cuándo WhatsApp deja responder (ventana de 24 h, la decide el bot).
 * Lógica: `src/lib/whatsapp.ts` · datos: `src/lib/whatsapp-chat.ts` · docs/whatsapp.md.
 */
const REFRESCO_CHATS_MS = 15_000;
const REFRESCO_CHAT_MS = 5_000;

type Filtro = 'todos' | 'no-leidos' | 'nuevos';

function cx(...nombres: Array<string | false | undefined>): string {
  return nombres.filter(Boolean).join(' ');
}

/** "recordatorio-48h" → "Recordatorio 48h". */
function humanizar(plantilla: string): string {
  const t = plantilla.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function tamanio(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function coincide(c: ChatWhatsApp, busqueda: string): boolean {
  const q = busqueda.trim();
  if (!q) {
    return true;
  }
  const digitos = q.replace(/\D/g, '');
  return (
    sinAcentos(c.nombre).includes(sinAcentos(q)) ||
    (digitos.length >= 3 && (c.telefono ?? '').replace(/\D/g, '').includes(digitos))
  );
}

const COLORES = ['teal', 'blue', 'grape', 'orange', 'pink', 'cyan', 'indigo', 'lime'];

function colorDe(clave: string): string {
  let h = 0;
  for (const ch of clave) {
    h = (h * 31 + ch.charCodeAt(0)) | 0;
  }
  return COLORES[Math.abs(h) % COLORES.length]!;
}

function AvatarContacto({ nombre, clave, size = 46 }: { nombre: string; clave: string; size?: number }): JSX.Element {
  const ini = iniciales(nombre);
  return (
    <Avatar size={size} radius="xl" color={colorDe(clave)} variant="filled">
      {ini || <IconUser size={size * 0.5} />}
    </Avatar>
  );
}

function Tilde({ estado, motivo }: { estado: EstadoVisible; motivo?: string }): JSX.Element {
  switch (estado) {
    case 'en-cola':
      return <IconClock size={13} className={classes.tilde} aria-label="En camino" />;
    case 'enviado':
      return <IconCheck size={15} className={classes.tilde} aria-label="Enviado" />;
    case 'entregado':
      return <IconChecks size={16} className={classes.tilde} aria-label="Entregado" />;
    case 'leido':
      return <IconChecks size={16} className={classes.tildeLeido} aria-label="Leído" />;
    case 'fallido':
      return (
        <Tooltip label={motivo ?? 'WhatsApp no entregó el mensaje.'} multiline w={260} withArrow>
          <IconAlertCircle size={15} className={classes.tildeError} aria-label="No se entregó" />
        </Tooltip>
      );
    default:
      return (
        <Tooltip
          label={motivo ?? 'No salió: faltan los secrets de Twilio en Medplum (ver docs/whatsapp.md).'}
          multiline
          w={260}
          withArrow
        >
          <IconClock size={13} className={classes.tildeError} aria-label="No enviado" />
        </Tooltip>
      );
  }
}

function IconoAdjunto({ tipo }: { tipo: TipoAdjunto }): JSX.Element {
  const props = { size: 26, stroke: 1.5 };
  switch (tipo) {
    case 'imagen':
      return <IconPhoto {...props} />;
    case 'audio':
      return <IconMicrophone {...props} />;
    case 'video':
      return <IconVideo {...props} />;
    case 'documento':
      return <IconFileText {...props} />;
    case 'contacto':
      return <IconUser {...props} />;
    default:
      return <IconPaperclip {...props} />;
  }
}

/**
 * Foto, audio o documento del mensaje. Se trae recién al tocar "Ver" (lo entrega el bot
 * som-whatsapp-adjunto): Recepción no tiene acceso general a los archivos (Binary).
 */
function Adjunto({ m, a, indice }: { m: Communication; a: Attachment; indice: number }): JSX.Element {
  const [url, setUrl] = useState<string>();
  const [cargando, setCargando] = useState(false);
  const [zoom, setZoom] = useState(false);
  const tipo = tipoAdjunto(a.contentType);
  const seguro = esSeguroParaVer(a.contentType);

  useEffect(
    () => () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );

  const ver = async (): Promise<void> => {
    if (!m.id) {
      return;
    }
    setCargando(true);
    try {
      const r = await adjuntoWhatsApp(m.id, indice);
      if (!r.ok || !r.data) {
        notifications.show({ color: 'orange', title: 'No se pudo abrir el adjunto', message: r.motivo ?? 'Probá de nuevo.' });
        return;
      }
      const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      // Lo que no es seguro abrir (HTML, SVG, …) se descarga como archivo, nunca se renderiza.
      const blob = new Blob([bytes], { type: seguro ? r.contentType : 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      if (!seguro) {
        const enlace = document.createElement('a');
        enlace.href = blobUrl;
        enlace.download = a.title ?? 'adjunto-whatsapp';
        enlace.click();
      } else if (tipo === 'documento') {
        window.open(blobUrl, '_blank', 'noopener');
      }
      setUrl(blobUrl);
    } catch (err) {
      notifications.show({ color: 'red', title: 'No se pudo abrir el adjunto', message: mensajeError(err) });
    } finally {
      setCargando(false);
    }
  };

  if (url && seguro && tipo === 'imagen') {
    return (
      <>
        <img src={url} className={classes.imagen} alt={a.title ?? 'Foto'} onClick={() => setZoom(true)} />
        <Modal opened={zoom} onClose={() => setZoom(false)} size="auto" centered withCloseButton={false} padding={0}>
          <img src={url} alt={a.title ?? 'Foto'} style={{ display: 'block', maxWidth: '90vw', maxHeight: '85vh' }} />
        </Modal>
      </>
    );
  }
  if (url && seguro && tipo === 'audio') {
    return <audio controls src={url} style={{ width: 250, maxWidth: '100%', marginBottom: 4 }} />;
  }
  if (url && seguro && tipo === 'video') {
    return <video controls src={url} style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 6, marginBottom: 4 }} />;
  }

  const disponible = Boolean(a.url && m.id);
  return (
    <div className={classes.adjunto}>
      <IconoAdjunto tipo={tipo} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" truncate>
          {etiquetaAdjunto(a)}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {[a.title, a.size ? tamanio(a.size) : ''].filter(Boolean).join(' · ')}
        </Text>
      </div>
      {!disponible ? (
        <Text size="xs" c="dimmed">
          No disponible
        </Text>
      ) : url ? (
        <Button size="compact-xs" variant="subtle" component="a" href={url} target="_blank" rel="noopener" download={seguro ? undefined : a.title}>
          Abrir
        </Button>
      ) : (
        <Tooltip label={seguro ? 'Ver' : 'Descargar'} withArrow>
          <ActionIcon variant="light" color="teal" radius="xl" loading={cargando} onClick={ver} aria-label="Ver el adjunto">
            <IconDownload size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
}

function Burbuja({ m, colita, separado }: { m: Communication; colita: boolean; separado: boolean }): JSX.Element {
  const entrante = esEntrante(m);
  const reservado = esReservado(m);
  const plantilla = plantillaDe(m);
  const automatico = !entrante && Boolean(plantilla) && plantilla !== PLANTILLA_RESPUESTA;
  const texto = reservado ? TEXTO_RESERVADO : textoDe(m);
  return (
    <div
      className={cx(
        classes.burbuja,
        entrante ? classes.entrante : classes.saliente,
        colita && classes.colita,
        separado && classes.separado,
      )}
    >
      {automatico && <div className={classes.automatico}>Automático · {humanizar(plantilla!)}</div>}
      {!entrante && !automatico && m.sender?.display && <div className={classes.automatico}>{m.sender.display}</div>}
      {!reservado && adjuntosDe(m).map((a, i) => <Adjunto key={i} m={m} a={a} indice={i} />)}
      {texto && <span className={cx(classes.textoBurbuja, reservado && classes.reservado)}>{texto}</span>}
      <span className={classes.pie}>
        {horaMensaje(m.sent)}
        {!entrante && <Tilde estado={estadoVisible(m)} motivo={m.statusReason?.text} />}
      </span>
    </div>
  );
}

function BarraDeEstado({ ahora }: { ahora: Date }): JSX.Element {
  return (
    <div className={classes.estado}>
      <span>{horaMensaje(ahora.toISOString())}</span>
      <span className={classes.isla} />
      <Group gap={4} wrap="nowrap">
        <IconAntennaBars5 size={15} />
        <IconWifi size={15} />
        <IconBattery3 size={18} />
      </Group>
    </div>
  );
}

export function WhatsApp({
  chatInicial,
  onChatInicialAbierto,
  onAtender,
  onLeidos,
}: {
  /** "Patient/<id>" del chat a abrir (p. ej. desde la campanita). */
  chatInicial?: string | null;
  onChatInicialAbierto?: () => void;
  onAtender: (pacienteId: string) => void;
  /** Se leyeron mensajes: refrescar la campanita y el contador de la pestaña. */
  onLeidos?: () => void;
}): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [chats, setChats] = useState<ChatWhatsApp[]>();
  const [elegido, setElegido] = useState<string>();
  const [mensajes, setMensajes] = useState<Communication[]>();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());
  const elegidoRef = useRef<string>();
  const fondo = useRef<HTMLDivElement>(null);

  const chat = chats?.find((c) => c.pacienteRef === elegido);
  const pacienteId = elegido?.slice('Patient/'.length);

  const cargarLista = useCallback((): void => {
    cargarChats(medplum)
      .then(setChats)
      .catch((err) => notifications.show({ color: 'red', title: 'No se pudieron cargar los chats', message: mensajeError(err) }));
  }, [medplum]);

  const cargarConversacion = useCallback(
    async (ref: string, silencioso: boolean): Promise<void> => {
      try {
        const ms = await cargarChat(medplum, ref);
        if (elegidoRef.current !== ref) {
          return; // Mientras cargaba se eligió otro chat.
        }
        setMensajes(ms);
        // Leer = tener el chat abierto y a la vista (si la pestaña está oculta, la campanita sigue avisando).
        if (document.visibilityState === 'visible' && (await marcarLeidos(medplum, ms)) > 0) {
          setChats((cs) => cs?.map((c) => (c.pacienteRef === ref ? { ...c, sinLeer: 0 } : c)));
          onLeidos?.();
        }
      } catch (err) {
        if (!silencioso) {
          notifications.show({ color: 'red', title: 'No se pudo abrir el chat', message: mensajeError(err) });
        }
      }
    },
    [medplum, onLeidos],
  );

  useEffect(() => {
    cargarLista();
    const t = window.setInterval(cargarLista, REFRESCO_CHATS_MS);
    const reloj = window.setInterval(() => setAhora(new Date()), 30_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(reloj);
    };
  }, [cargarLista]);

  // Abrir el chat que pidió la campanita.
  useEffect(() => {
    if (chatInicial) {
      setElegido(chatInicial);
      onChatInicialAbierto?.();
    }
  }, [chatInicial]);

  useEffect(() => {
    elegidoRef.current = elegido;
    setMensajes(undefined);
    setTexto('');
    if (!elegido) {
      return;
    }
    if (!chats?.some((c) => c.pacienteRef === elegido)) {
      cargarLista(); // Un chat recién llegado (p. ej. desde la campanita).
    }
    void cargarConversacion(elegido, false);
    const t = window.setInterval(() => void cargarConversacion(elegido, true), REFRESCO_CHAT_MS);
    return () => window.clearInterval(t);
  }, [elegido]);

  useEffect(() => {
    const el = fondo.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [mensajes?.length, elegido]);

  const visibles = useMemo(
    () =>
      (chats ?? [])
        .filter((c) => filtro === 'todos' || (filtro === 'no-leidos' ? c.sinLeer > 0 : c.nuevoContacto))
        .filter((c) => coincide(c, busqueda)),
    [chats, filtro, busqueda],
  );
  const noLeidos = (chats ?? []).filter((c) => c.sinLeer > 0).length;
  const nuevos = (chats ?? []).filter((c) => c.nuevoContacto).length;

  const ultimo = ultimoEntrante(mensajes ?? []);
  const ventana = ventanaWhatsApp(ultimo?.sent, ahora);
  const puedeEnviar = Boolean(elegido && mensajes && ventana.abierta && texto.trim() && !enviando);

  const enviar = async (): Promise<void> => {
    const limpio = texto.trim();
    if (!elegido || !limpio || enviando) {
      return;
    }
    setEnviando(true);
    try {
      const r = await responderWhatsApp(elegido, limpio, profile ? createReference(profile) : undefined);
      if (r.mensaje) {
        // Queda en el chat aunque no haya salido (con el motivo en el ícono).
        setMensajes((ms) => ordenarMensajes([...(ms ?? []), r.mensaje!]));
        setTexto('');
        cargarLista();
      }
      if (!r.ok) {
        notifications.show({ color: 'orange', title: 'El mensaje no salió', message: r.motivo ?? 'Probá de nuevo.' });
      }
    } catch (err) {
      notifications.show({ color: 'red', title: 'No se pudo enviar', message: mensajeError(err) });
    } finally {
      setEnviando(false);
    }
  };

  const alTipear = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter envía (como WhatsApp Web); Shift+Enter, nueva línea.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  const cierra = ventana.cierra ? new Date(ventana.cierra) : undefined;
  const horasRestantes = cierra ? Math.max(0, Math.floor((cierra.getTime() - ahora.getTime()) / 3_600_000)) : 0;

  const pantallaLista = (
    <>
      <div className={classes.encabezado}>
        <div className={classes.encabezadoTitulo}>WhatsApp</div>
        <Tooltip label="Actualizar" withArrow>
          <ActionIcon variant="transparent" className={classes.botonEncabezado} onClick={cargarLista} aria-label="Actualizar los chats">
            <IconRefresh size={20} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className={classes.busqueda}>
        <TextInput
          radius="xl"
          size="sm"
          leftSection={<IconSearch size={16} />}
          placeholder="Buscar un nombre o número"
          value={busqueda}
          onChange={(e) => setBusqueda(e.currentTarget.value)}
          classNames={{ input: classes.campoBusqueda }}
          aria-label="Buscar chat"
        />
      </div>
      <div className={classes.chips}>
        {(
          [
            ['todos', 'Todos'],
            ['no-leidos', `No leídos${noLeidos ? ` ${noLeidos}` : ''}`],
            ['nuevos', `Contactos nuevos${nuevos ? ` ${nuevos}` : ''}`],
          ] as Array<[Filtro, string]>
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            className={cx(classes.chip, filtro === valor && classes.chipActivo)}
            onClick={() => setFiltro(valor)}
          >
            {etiqueta}
          </button>
        ))}
      </div>
      <div className={classes.lista}>
        {chats === undefined ? (
          <Group justify="center" py="xl">
            <Loader color="teal" />
          </Group>
        ) : visibles.length === 0 ? (
          <div className={classes.vacio}>
            {chats.length === 0
              ? 'Todavía no hay chats. Cuando un paciente escriba al WhatsApp de SOM, aparece acá (y suena la campanita si es un contacto nuevo).'
              : 'No hay chats con ese filtro.'}
          </div>
        ) : (
          visibles.map((c) => (
            <button
              key={c.pacienteRef}
              type="button"
              className={cx(classes.itemChat, c.pacienteRef === elegido && classes.itemChatActivo)}
              onClick={() => setElegido(c.pacienteRef)}
            >
              <AvatarContacto nombre={c.nombre} clave={c.pacienteRef} />
              <div className={classes.itemCuerpo}>
                <div className={classes.itemFila}>
                  <span className={classes.itemNombre} style={{ fontWeight: c.sinLeer ? 700 : 500 }}>
                    {c.nombre}
                  </span>
                  <span className={cx(classes.itemHora, c.sinLeer > 0 && classes.itemHoraNoLeido)}>
                    {fechaCorta(c.actividad, ahora)}
                  </span>
                </div>
                <div className={classes.itemFila}>
                  <span className={classes.itemVista}>
                    {!esEntrante(c.ultimo) && <Tilde estado={estadoVisible(c.ultimo)} motivo={c.ultimo.statusReason?.text} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{vistaPrevia(c.ultimo)}</span>
                  </span>
                  <Group gap={4} wrap="nowrap">
                    {c.nuevoContacto && <span className={classes.etiquetaNuevo}>Nuevo</span>}
                    {c.sinLeer > 0 && <span className={classes.contador}>{c.sinLeer}</span>}
                  </Group>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  );

  const nombreChat = chat?.nombre ?? 'Cargando…';
  const pantallaChat = (
    <>
      <div className={classes.encabezado} style={{ paddingLeft: 4 }}>
        <ActionIcon
          variant="transparent"
          className={classes.botonEncabezado}
          onClick={() => setElegido(undefined)}
          aria-label="Volver a los chats"
        >
          <IconArrowLeft size={22} />
        </ActionIcon>
        <AvatarContacto nombre={nombreChat} clave={elegido ?? ''} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} truncate c="inherit">
            {nombreChat}
          </Text>
          <Text size="xs" truncate c="inherit" style={{ opacity: 0.85 }}>
            {chat && esSoloNumero(chat.nombre) ? 'Contacto nuevo' : formatoTelefono(chat?.telefono) || 'WhatsApp'}
          </Text>
        </div>
        {pacienteId && (
          <Tooltip label="Abrir la ficha en Atender" withArrow>
            <ActionIcon
              variant="transparent"
              className={classes.botonEncabezado}
              onClick={() => onAtender(pacienteId)}
              aria-label="Abrir la ficha en Atender"
            >
              <IconUserHeart size={21} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>

      <div className={classes.fondoChat} ref={fondo}>
        <div className={classes.aviso}>
          🔒 WhatsApp de Segunda Opinión Médica. Cada mensaje queda registrado en la ficha del paciente.
        </div>
        {mensajes === undefined ? (
          <Group justify="center" py="xl">
            <Loader color="teal" />
          </Group>
        ) : (
          mensajes.map((m, i) => {
            const previo = mensajes[i - 1];
            const nuevoDia = !previo || diaDeMensaje(previo.sent) !== diaDeMensaje(m.sent);
            const mismaTanda = Boolean(previo) && !nuevoDia && esEntrante(previo!) === esEntrante(m);
            return (
              <Fragment key={m.id ?? i}>
                {nuevoDia && m.sent && <div className={classes.dia}>{etiquetaDia(m.sent, ahora)}</div>}
                <Burbuja m={m} colita={!mismaTanda} separado={!mismaTanda && !nuevoDia} />
              </Fragment>
            );
          })
        )}
      </div>

      {mensajes && (
        <div className={cx(classes.ventana, !ventana.abierta && classes.ventanaCerrada)}>
          {ventana.abierta
            ? `Podés responder hasta ${cierreVentana(ventana.cierra, ahora)}${horasRestantes >= 1 ? ` (quedan ${horasRestantes} h)` : ' (queda menos de 1 h)'}.`
            : ultimo
              ? 'Pasaron más de 24 h desde el último mensaje del paciente: WhatsApp solo permite plantillas aprobadas (pendientes). Esperá a que vuelva a escribir.'
              : 'El paciente todavía no escribió por WhatsApp: solo se le puede escribir primero con una plantilla aprobada (pendientes).'}
        </div>
      )}
      <div className={classes.compositor}>
        <Textarea
          className={classes.entrada}
          classNames={{ input: classes.entradaCampo }}
          placeholder={ventana.abierta ? 'Escribí un mensaje' : 'No se puede responder por ahora'}
          autosize
          minRows={1}
          maxRows={5}
          maxLength={MAX_TEXTO_WHATSAPP}
          value={texto}
          disabled={!ventana.abierta || !mensajes}
          onChange={(e) => setTexto(e.currentTarget.value)}
          onKeyDown={alTipear}
          aria-label="Mensaje de WhatsApp"
        />
        <ActionIcon
          size={44}
          radius="xl"
          className={classes.enviar}
          disabled={!puedeEnviar}
          loading={enviando}
          onClick={() => void enviar()}
          aria-label="Enviar"
        >
          <IconSend size={20} />
        </ActionIcon>
      </div>
    </>
  );

  return (
    <Stack gap="md" maw={1280} mx="auto">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <IconBrandWhatsapp size={26} color="#25D366" />
          <Title order={2}>WhatsApp</Title>
          {noLeidos > 0 && (
            <Badge color="green" variant="light">
              {noLeidos} {noLeidos === 1 ? 'chat sin leer' : 'chats sin leer'}
            </Badge>
          )}
        </Group>
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={cargarLista}>
          Actualizar
        </Button>
      </Group>

      <Grid gutter="xl" align="flex-start">
        <Grid.Col span={{ base: 12, md: 6, lg: 5 }}>
          <div className={classes.telefono}>
            <div className={classes.pantalla}>
              <BarraDeEstado ahora={ahora} />
              {elegido ? pantallaChat : pantallaLista}
            </div>
          </div>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6, lg: 7 }}>
          <Card withBorder radius="md" p="lg">
            {elegido ? (
              <Stack gap="sm">
                <Group wrap="nowrap">
                  <AvatarContacto nombre={nombreChat} clave={elegido} size={56} />
                  <div style={{ minWidth: 0 }}>
                    <Title order={3}>{nombreChat}</Title>
                    <Text c="dimmed">
                      {chat && esSoloNumero(chat.nombre)
                        ? 'Escribió sin nombre de perfil'
                        : formatoTelefono(chat?.telefono) || 'Sin número'}
                    </Text>
                  </div>
                </Group>
                <Group gap="xs">
                  {chat?.sinFicha ? (
                    <Badge color="orange" variant="light">
                      Contacto nuevo · sin ficha
                    </Badge>
                  ) : (
                    <Badge color="teal" variant="light">
                      Paciente
                    </Badge>
                  )}
                  {chat?.nuevoContacto && <Badge color="green">Esperando la primera respuesta</Badge>}
                  {mensajes && (
                    <Badge color={ventana.abierta ? 'green' : 'gray'} variant="outline">
                      {ventana.abierta ? `Se puede responder hasta ${cierreVentana(ventana.cierra, ahora)}` : 'Ventana de 24 h cerrada'}
                    </Badge>
                  )}
                </Group>
                <Group gap="sm" mt="xs">
                  {chat?.sinFicha && (
                    <Button leftSection={<IconUserPlus size={16} />} onClick={() => setAltaAbierta(true)}>
                      Completar ficha
                    </Button>
                  )}
                  {pacienteId && (
                    <Button variant="light" leftSection={<IconUserHeart size={16} />} onClick={() => onAtender(pacienteId)}>
                      Abrir en Atender
                    </Button>
                  )}
                </Group>
                {chat?.sinFicha && (
                  <Text size="sm" c="dimmed">
                    Escribió por primera vez: quedó como contacto nuevo (lead del CRM, origen WhatsApp) con el nombre de su
                    perfil de WhatsApp, si tiene. «Completar ficha» carga su nombre real, DNI y email en el mismo paciente
                    (lo encuentra por el número, no lo duplica).
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  WhatsApp deja responder texto libre solo dentro de las 24 h del último mensaje del paciente. Pasado ese
                  plazo, solo plantillas aprobadas por Meta (pendientes de cargar).
                </Text>
              </Stack>
            ) : (
              <Stack gap="xs">
                <Title order={4}>El WhatsApp de Recepción</Title>
                <Text size="sm">
                  Elegí un chat para leerlo y responder. Los mensajes llegan solos (Twilio → Medplum) y la{' '}
                  <b>campanita</b> de arriba avisa cuando alguien escribe para iniciar una conversación.
                </Text>
                <Text size="sm" c="dimmed">
                  ✓ enviado · ✓✓ entregado · <span style={{ color: '#53bdeb' }}>✓✓</span> leído por el paciente. Los
                  recordatorios y confirmaciones automáticos también aparecen en cada chat (marcados «Automático»); los
                  avisos con información clínica se ven como 🔒, sin el contenido.
                </Text>
              </Stack>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <NuevoPacienteModal
        abierto={altaAbierta}
        onCerrar={() => setAltaAbierta(false)}
        inicial={{
          nombre: chat && !esSoloNumero(chat.nombre) ? chat.nombre : '',
          telefono: chat?.telefono ?? '',
        }}
        onCreado={() => {
          notifications.show({ color: 'teal', title: 'Ficha completada', message: 'El chat queda con los datos del paciente.' });
          cargarLista();
        }}
      />
    </Stack>
  );
}
