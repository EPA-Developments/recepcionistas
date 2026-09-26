import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, Group, Loader, Stack, Text, Textarea, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBrandWhatsapp,
  IconCheck,
  IconMessages,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconUser,
  IconUserHeart,
  IconUserPlus,
} from '@tabler/icons-react';
import { useMedplum, useMedplumProfile, useSubscription } from '@medplum/react';
import { createReference } from '@medplum/core';
import { COD } from '@som/fhir/identifiers';
import { cargarContactosNuevos, resolverContacto, type ContactoNuevo } from '@som/lib/contactos-whatsapp';
import { marcarLeidos, responder } from '@som/lib/mensajes';
import { esSoloNumero, esWhatsApp, formatoTelefono, haceCuanto, iniciales, ultimoDelPaciente } from '@som/lib/whatsapp';
import { textoRestante, ventana24h } from '@som/lib/auto-respuesta';
import { borradorRespuesta, mensajeError, responderWhatsApp } from '../lib/bots';
import { NuevoPacienteModal } from '../components/NuevoPacienteModal';
import { Burbuja, fecha } from '../components/Burbuja';
import classes from './WhatsApp.module.css';

/**
 * WhatsApp: los **contactos nuevos** que escribieron por WhatsApp (números que no estaban
 * en SOM), como los "Avisos" del demo. Cada tarjeta es un aviso pendiente (`Task`
 * `whatsapp-nuevo-contacto`, lo deja el bot `som-whatsapp-entrante`) con lo que escribió
 * y lo que ya se le contestó, y se atiende sin salir de acá:
 *  - **Responder**: la respuesta queda en su conversación de Mensajes y sale por
 *    WhatsApp (dentro de las 24 h; después solo plantillas aprobadas, pendientes).
 *  - **Completar ficha**: el alta con el teléfono y el nombre del perfil precargados; el
 *    aviso se resuelve solo y se abre el paciente para seguir (reservar, invitar…).
 *  - **Ver conversación**: la abre en Mensajes. **Resolver**: la saca de la lista.
 * En vivo por la suscripción de Medplum, con refresco de respaldo y al volver a la ventana.
 * Lógica: `src/lib/contactos-whatsapp.ts`; contrato: docs/whatsapp.md.
 */
const POLL_MS = 30_000;

/** Avisos nuevos o resueltos (en otra terminal, o por la ficha). */
const CRITERIO_AVISOS = `Task?code=${COD.whatsappNuevoContacto}`;
/** Mensajes nuevos o cambiados (lo que escribe el contacto, las respuestas, los ✓✓). */
const CRITERIO_MENSAJES = 'Communication?part-of:missing=false';

/** Cuántos mensajes de la conversación se ven en la tarjeta (todos, en Mensajes). */
const MENSAJES_EN_TARJETA = 4;

/** Debajo del nombre: el número (si el nombre no es el número) y el perfil, si es otro. */
function subtitulo(c: ContactoNuevo): string {
  const telefono = formatoTelefono(c.telefono);
  const partes = [
    esSoloNumero(c.nombre) ? 'Sin nombre en su perfil de WhatsApp' : telefono,
    c.perfil && c.perfil !== c.nombre ? `perfil: ${c.perfil}` : '',
  ];
  return partes.filter(Boolean).join(' · ');
}

export function WhatsApp({
  onAtender,
  onVerConversacion,
  avisoInicial,
  onAvisoInicialAbierto,
  onCambio,
}: {
  onAtender: (pacienteId: string) => void;
  /** Abre la conversación en Mensajes. */
  onVerConversacion: (conversacionId: string) => void;
  /** Aviso a mostrar (p. ej. desde la campanita): se lleva a la vista y se marca. */
  avisoInicial?: string | null;
  onAvisoInicialAbierto?: () => void;
  /** Se resolvió un aviso o se leyeron mensajes: refrescar la campanita y los contadores. */
  onCambio?: () => void;
}): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [contactos, setContactos] = useState<ContactoNuevo[]>();
  const [respondiendo, setRespondiendo] = useState<string>();
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  // El borrador tal como lo sugirió "Sugerir" (se compara con lo que sale: `borrador-usado`).
  const [sugeridos, setSugeridos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string>();
  const [sugiriendo, setSugiriendo] = useState<string>();
  const [resolviendo, setResolviendo] = useState<string>();
  const [altaDe, setAltaDe] = useState<ContactoNuevo>();
  const [resaltado, setResaltado] = useState<string>();
  const [ahora, setAhora] = useState(() => new Date());
  // Cada recarga lleva un número: una respuesta vieja no pisa a una más nueva.
  const carga = useRef(0);

  const cargar = useCallback((): void => {
    const n = ++carga.current;
    cargarContactosNuevos(medplum)
      .then((cs) => n === carga.current && setContactos(cs))
      .catch((err) =>
        notifications.show({ color: 'red', title: 'No se pudieron cargar los WhatsApp', message: mensajeError(err) }),
      );
  }, [medplum]);

  useEffect(() => {
    cargar();
    const t = window.setInterval(cargar, POLL_MS);
    const reloj = window.setInterval(() => setAhora(new Date()), 60_000);
    const alVolver = (): void => cargar();
    window.addEventListener('focus', alVolver);
    return () => {
      window.clearInterval(t);
      window.clearInterval(reloj);
      window.removeEventListener('focus', alVolver);
    };
  }, [cargar]);

  useSubscription(CRITERIO_AVISOS, cargar, { onError: () => undefined, onWebSocketClose: () => undefined });
  useSubscription(CRITERIO_MENSAJES, cargar, { onError: () => undefined, onWebSocketClose: () => undefined });

  // El aviso que pidió la campanita: se lleva a la vista y se marca unos segundos.
  useEffect(() => {
    if (!avisoInicial || !contactos) {
      return;
    }
    onAvisoInicialAbierto?.();
    if (!contactos.some((c) => c.aviso.id === avisoInicial)) {
      notifications.show({ color: 'gray', message: 'Ese contacto ya lo resolvió alguien (o ya tiene ficha).' });
      return;
    }
    setResaltado(avisoInicial);
    window.requestAnimationFrame(() =>
      document.getElementById(`aviso-${avisoInicial}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  }, [avisoInicial, contactos]);

  useEffect(() => {
    if (!resaltado) {
      return;
    }
    const t = window.setTimeout(() => setResaltado(undefined), 4000);
    return () => window.clearTimeout(t);
  }, [resaltado]);

  const autor = profile ? createReference(profile) : undefined;

  const sacar = (avisoId: string): void => {
    setContactos((prev) => prev?.filter((x) => x.aviso.id !== avisoId));
    onCambio?.();
  };

  async function resolver(c: ContactoNuevo): Promise<void> {
    setResolviendo(c.aviso.id);
    try {
      await resolverContacto(medplum, c.aviso.id, 'resuelto', autor);
      sacar(c.aviso.id);
    } catch (err) {
      notifications.show({ color: 'red', title: 'No se pudo resolver', message: mensajeError(err) });
    } finally {
      setResolviendo(undefined);
    }
  }

  /**
   * Responde en su conversación de Mensajes y el bot la manda por WhatsApp. Si no salió,
   * se avisa: creer que le contestaste cuando nunca le llegó es lo peor que puede pasar.
   */
  async function enviar(c: ContactoNuevo): Promise<void> {
    const id = c.aviso.id;
    const texto = (borradores[id] ?? '').trim();
    if (!texto || !c.conversacion || !autor) {
      return;
    }
    setEnviando(id);
    try {
      const { mensaje } = await responder(medplum, autor, c.conversacion, texto, c.mensajes, sugeridos[id]);
      // Si le respondió, lo leyó: en Mensajes no queda como pendiente.
      await marcarLeidos(medplum, c.mensajes).catch(() => 0);
      setBorradores((prev) => ({ ...prev, [id]: '' }));
      setSugeridos((prev) => {
        const { [id]: _usado, ...resto } = prev;
        return resto;
      });
      setRespondiendo(undefined);
      const r = mensaje.id
        ? await responderWhatsApp(mensaje.id).catch((err: unknown) => ({ ok: false, enviado: false, motivo: mensajeError(err) }))
        : { ok: false, enviado: false, motivo: 'El mensaje no quedó guardado.' };
      if (r.enviado) {
        notifications.show({
          color: 'teal',
          title: 'Respuesta enviada',
          message: `Salió por WhatsApp a ${formatoTelefono(c.telefono) || c.nombre}.`,
        });
      } else if (r.ok) {
        notifications.show({ color: 'gray', title: 'Quedó en la conversación', message: 'Escribió por el portal: la ve ahí.' });
      } else {
        notifications.show({
          color: 'orange',
          title: 'Quedó en la conversación, pero NO salió por WhatsApp',
          message: r.motivo ?? 'Probá de nuevo desde Mensajes o llamalo.',
        });
      }
      onCambio?.();
      cargar();
    } catch (err) {
      notifications.show({ color: 'red', title: 'No se pudo enviar', message: mensajeError(err) });
    } finally {
      setEnviando(undefined);
    }
  }

  /** Pide el borrador y lo deja en el campo de respuesta. NO envía: la recepcionista decide. */
  async function sugerir(c: ContactoNuevo): Promise<void> {
    const id = c.aviso.id;
    if (!c.conversacion?.id) {
      return;
    }
    setSugiriendo(id);
    try {
      const r = await borradorRespuesta(c.conversacion.id);
      if (r.borrador) {
        const borrador = r.borrador;
        setBorradores((prev) => ({ ...prev, [id]: borrador }));
        setSugeridos((prev) => ({ ...prev, [id]: borrador }));
      } else {
        notifications.show({
          color: 'blue',
          title: 'Mejor contestalo vos',
          message: r.motivo ?? 'El asistente no sugirió una respuesta para este mensaje.',
        });
      }
    } catch (err) {
      notifications.show({ color: 'orange', title: 'No pude sugerir', message: mensajeError(err) });
    } finally {
      setSugiriendo(undefined);
    }
  }

  /**
   * Con la ficha completa el aviso ya cumplió: el bot de alta lo resuelve si completó este
   * contacto; si esos datos eran de otra ficha, se resuelve acá. Como en el demo, se abre
   * el paciente para seguir (reservar, invitar al portal…).
   */
  async function fichaCompletada(c: ContactoNuevo, pacienteId: string): Promise<void> {
    await resolverContacto(medplum, c.aviso.id, 'ficha-completada', autor).catch(() => undefined);
    sacar(c.aviso.id);
    const otraFicha = Boolean(c.pacienteRef) && c.pacienteRef !== `Patient/${pacienteId}`;
    notifications.show(
      otraFicha
        ? {
            color: 'orange',
            title: 'Ya tenía ficha',
            message:
              'Con esos datos ya había un paciente: sus próximos WhatsApp entran a esa ficha. Esta conversación queda con el contacto de WhatsApp.',
          }
        : { color: 'teal', title: 'Ficha completada', message: 'Su conversación queda con los datos del paciente.' },
    );
    onAtender(pacienteId);
  }

  if (contactos === undefined) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  return (
    <Stack gap="md" maw={820} mx="auto">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <IconBrandWhatsapp size={24} color="#25D366" />
          <Title order={2}>WhatsApp</Title>
          <Badge variant="light" color={contactos.length > 0 ? 'red' : 'teal'}>
            {contactos.length} {contactos.length === 1 ? 'pendiente' : 'pendientes'}
          </Badge>
        </Group>
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={cargar}>
          Actualizar
        </Button>
      </Group>

      {contactos.length === 0 ? (
        <Text c="dimmed">
          Nada pendiente. Acá aparecen los WhatsApp de números nuevos (personas que todavía no están en SOM): respondeles,
          completales la ficha o marcalos resueltos.
        </Text>
      ) : (
        contactos.map((c) => {
          const id = c.aviso.id;
          const ultimo = ultimoDelPaciente(c.mensajes);
          const ventana = ventana24h(ultimo && esWhatsApp(ultimo) ? ultimo.sent : undefined, ahora);
          const pacienteId = c.pacienteRef?.slice('Patient/'.length);
          const borrador = borradores[id] ?? '';
          return (
            <Card
              key={id}
              id={`aviso-${id}`}
              withBorder
              radius="md"
              p="md"
              className={resaltado === id ? classes.resaltada : undefined}
            >
              <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
                <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                  <Avatar color="green" radius="xl" variant="filled">
                    {esSoloNumero(c.nombre) ? <IconUser size={20} /> : iniciales(c.nombre)}
                  </Avatar>
                  <div style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text fw={600}>{c.nombre}</Text>
                      {c.demo && (
                        <Tooltip
                          label="Dato de demostración: no es real. Se borra solo a las 48 h (o con npm run datos-demo -- --limpiar)."
                          multiline
                          w={280}
                          withArrow
                        >
                          <Badge size="sm" variant="filled" color="gray">
                            DEMO
                          </Badge>
                        </Tooltip>
                      )}
                      <Badge size="sm" variant="light" color="green" leftSection={<IconBrandWhatsapp size={12} />}>
                        WhatsApp
                      </Badge>
                      {c.sinFicha && (
                        <Badge size="sm" variant="outline" color="orange">
                          Sin ficha
                        </Badge>
                      )}
                      <Badge size="sm" variant="light" color={c.sinResponder ? 'red' : 'teal'}>
                        {c.sinResponder ? 'Sin responder' : 'Respondido'}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {subtitulo(c)}
                    </Text>
                  </div>
                </Group>
                <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
                  <Text size="xs" c="dimmed" title={`Escribió el ${fecha(c.llego)}`}>
                    {fecha(c.llego)} · {haceCuanto(c.llego, ahora)}
                  </Text>
                  <Badge
                    size="sm"
                    variant="light"
                    color={!ventana.abierta ? 'gray' : ventana.porCerrar ? 'orange' : 'teal'}
                    title={
                      ventana.abierta
                        ? 'WhatsApp permite texto libre durante 24 h desde su último mensaje.'
                        : 'Pasaron más de 24 h desde su último mensaje: WhatsApp solo acepta plantillas aprobadas.'
                    }
                  >
                    {ventana.abierta ? `Ventana · ${textoRestante(ventana.restanteMin)}` : 'Ventana cerrada'}
                  </Badge>
                </Stack>
              </Group>

              {c.mensajes.length > 0 ? (
                <Stack gap={6} mt="sm" className={classes.chat}>
                  {c.mensajes.length > MENSAJES_EN_TARJETA && (
                    <Text size="xs" c="dimmed" ta="center">
                      {c.mensajes.length - MENSAJES_EN_TARJETA} mensajes anteriores: en «Ver conversación»
                    </Text>
                  )}
                  {c.mensajes.slice(-MENSAJES_EN_TARJETA).map((m) => (
                    <Burbuja key={m.id} m={m} compacta />
                  ))}
                </Stack>
              ) : (
                c.texto && (
                  <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-line' }}>
                    “{c.texto}”
                  </Text>
                )
              )}

              <Group justify="space-between" mt="sm" gap="xs">
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant={respondiendo === id ? 'filled' : 'light'}
                    color="green"
                    leftSection={<IconBrandWhatsapp size={15} />}
                    disabled={!c.conversacion}
                    onClick={() => setRespondiendo(respondiendo === id ? undefined : id)}
                  >
                    Responder
                  </Button>
                  {c.sinFicha ? (
                    <Button size="xs" variant="light" leftSection={<IconUserPlus size={15} />} onClick={() => setAltaDe(c)}>
                      Completar ficha
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconUserHeart size={15} />}
                      disabled={!pacienteId}
                      onClick={() => pacienteId && onAtender(pacienteId)}
                    >
                      Ver paciente
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="light"
                    color="gray"
                    leftSection={<IconMessages size={15} />}
                    disabled={!c.conversacion?.id}
                    onClick={() => c.conversacion?.id && onVerConversacion(c.conversacion.id)}
                  >
                    Ver conversación
                  </Button>
                </Group>
                <Button
                  size="xs"
                  variant="light"
                  color="gray"
                  leftSection={<IconCheck size={15} />}
                  loading={resolviendo === id}
                  onClick={() => void resolver(c)}
                  title="Ya se atendió: sale de la lista (queda quién y cuándo)."
                >
                  Resolver
                </Button>
              </Group>

              {respondiendo === id && (
                <Stack gap="xs" mt="sm">
                  <Textarea
                    autosize
                    minRows={2}
                    maxRows={8}
                    placeholder="Escribí la respuesta que le llega por WhatsApp…"
                    aria-label={`Respuesta a ${c.nombre}`}
                    disabled={!ventana.abierta}
                    value={borrador}
                    onChange={(e) => {
                      // El valor se lee ACÁ y no adentro del updater: React lo corre
                      // después, cuando `currentTarget` ya es null (y un error en el
                      // render deja la app en blanco).
                      const texto = e.currentTarget.value;
                      setBorradores((prev) => ({ ...prev, [id]: texto }));
                    }}
                  />
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Text size="xs" c={ventana.abierta ? 'dimmed' : 'orange'}>
                      {ventana.abierta
                        ? '📱 Sale por WhatsApp y queda en su conversación de Mensajes.'
                        : `⚠️ Pasaron más de 24 h desde su último WhatsApp: WhatsApp solo acepta plantillas aprobadas (pendientes). Llamalo${c.telefono ? ` al ${formatoTelefono(c.telefono)}` : ''} o esperá a que vuelva a escribir.`}
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconSparkles size={15} />}
                        loading={sugiriendo === id}
                        disabled={!ventana.abierta}
                        onClick={() => void sugerir(c)}
                        title="Escribe un borrador con el contexto. Lo revisás y lo enviás vos."
                      >
                        Sugerir
                      </Button>
                      <Button
                        size="xs"
                        leftSection={<IconSend size={15} />}
                        loading={enviando === id}
                        disabled={!ventana.abierta || !borrador.trim()}
                        onClick={() => void enviar(c)}
                      >
                        Enviar
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              )}
            </Card>
          );
        })
      )}

      <Alert variant="light" color="gray">
        Todas las conversaciones (de WhatsApp y del portal) siguen en <b>Mensajes</b>. Acá queda cada número nuevo hasta
        que alguien lo resuelve; al completarle la ficha, el aviso se resuelve solo.
      </Alert>

      <NuevoPacienteModal
        abierto={Boolean(altaDe)}
        inicial={
          altaDe
            ? { nombre: altaDe.perfil && !esSoloNumero(altaDe.perfil) ? altaDe.perfil : '', telefono: altaDe.telefono ?? '' }
            : undefined
        }
        onCerrar={() => setAltaDe(undefined)}
        onCreado={(pacienteId) => {
          if (altaDe) {
            void fichaCompletada(altaDe, pacienteId);
          }
        }}
      />
    </Stack>
  );
}
