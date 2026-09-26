import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useMedplum, useMedplumProfile, useSubscription } from '@medplum/react';
import { cargarAvisos, type AvisosMensajes } from '@som/lib/mensajes';
import type { AvisoWhatsApp } from '@som/lib/whatsapp';
import { Shell, type Vista } from './components/Shell';
import { AgendaDelDia } from './pages/AgendaDelDia';
import { Solicitudes } from './pages/Solicitudes';
import { Mensajes } from './pages/Mensajes';
import { ControlesGlp1 } from './pages/ControlesGlp1';
import { Atender } from './pages/Atender';
import { Reportes } from './pages/Reportes';
import { SignInPage } from './pages/SignInPage';

/**
 * Respaldo del aviso en vivo: cada cuánto se revisan el contador de Mensajes y la
 * campanita si la suscripción de Medplum (WebSocket) no está disponible.
 */
const REFRESCO_AVISOS_MS = 30_000;

/** Cualquier mensaje nuevo o cambiado de una conversación (del portal o de WhatsApp). */
const CRITERIO_MENSAJES = 'Communication?part-of:missing=false';

const TITULO = 'Segunda Opinión Médica · Recepción';

const clave = (a: AvisoWhatsApp): string => `${a.pacienteRef}|${a.sent}`;

export function App(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [vista, setVista] = useState<Vista>('agenda');
  // Paciente con el que entrar a "Atender" (p. ej. al confirmar una solicitud o desde Controles GLP-1).
  const [atenderId, setAtenderId] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisosMensajes>({ sinLeer: 0, nuevosContactos: [] });
  // Conversación a abrir en Mensajes (desde la campanita o un aviso).
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  // Números nuevos ya avisados (la primera carga no avisa: solo lo que llega después).
  const avisados = useRef<Set<string> | null>(null);

  const abrirMensajes = useCallback((aviso?: AvisoWhatsApp): void => {
    if (aviso?.conversacionId) {
      setConversacionId(aviso.conversacionId);
    }
    setVista('mensajes');
  }, []);

  /** Aviso emergente (y del escritorio si la pestaña está oculta) por cada número nuevo. */
  const avisarContacto = useCallback(
    (a: AvisoWhatsApp): void => {
      notifications.show({
        color: 'green',
        icon: <IconBrandWhatsapp size={18} />,
        title: `WhatsApp · contacto nuevo: ${a.nombre}`,
        autoClose: 12_000,
        message: (
          <Stack gap={6} align="flex-start">
            <Text size="sm" lineClamp={3}>
              {a.texto || 'Mensaje nuevo'}
            </Text>
            <Button size="compact-sm" color="green" variant="light" onClick={() => abrirMensajes(a)}>
              Abrir la conversación
            </Button>
          </Stack>
        ),
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(`WhatsApp · ${a.nombre}`, { body: a.texto || 'Mensaje nuevo', tag: a.pacienteRef });
        n.onclick = () => {
          window.focus();
          abrirMensajes(a);
          n.close();
        };
      }
    },
    [abrirMensajes],
  );

  const revisarAvisos = useCallback((): void => {
    cargarAvisos(medplum)
      .then((a) => {
        setAvisos(a);
        if (avisados.current) {
          a.nuevosContactos.filter((x) => !avisados.current!.has(clave(x))).forEach(avisarContacto);
        }
        avisados.current = new Set([...(avisados.current ?? []), ...a.nuevosContactos.map(clave)]);
      })
      .catch(() => undefined); // El contador no es crítico: queda el último valor.
  }, [medplum, avisarContacto]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    revisarAvisos();
    const t = window.setInterval(revisarAvisos, REFRESCO_AVISOS_MS);
    return () => window.clearInterval(t);
    // Al salir de Mensajes el contador se actualiza enseguida (ya se leyeron).
  }, [profile, revisarAvisos, vista]);

  // En vivo: cualquier mensaje nuevo (del portal o de WhatsApp) actualiza el contador y la campanita.
  useSubscription(profile ? CRITERIO_MENSAJES : undefined, revisarAvisos, {
    onError: () => undefined,
    onWebSocketClose: () => undefined,
  });

  // El título de la pestaña del navegador muestra los mensajes sin leer.
  useEffect(() => {
    document.title = avisos.sinLeer > 0 ? `(${avisos.sinLeer}) ${TITULO}` : TITULO;
  }, [avisos.sinLeer]);

  if (!profile) {
    return <SignInPage />;
  }

  const irAtender = (pacienteId: string): void => {
    setAtenderId(pacienteId);
    setVista('atender');
  };

  return (
    <Shell
      vista={vista}
      onVista={setVista}
      mensajesSinLeer={avisos.sinLeer}
      nuevosContactos={avisos.nuevosContactos}
      onAbrirMensajes={abrirMensajes}
    >
      {vista === 'agenda' && <AgendaDelDia />}
      {vista === 'solicitudes' && <Solicitudes onAtender={irAtender} />}
      {vista === 'mensajes' && (
        <Mensajes
          onAtender={irAtender}
          conversacionInicial={conversacionId}
          onConversacionInicialAbierta={() => setConversacionId(null)}
          onLeidos={revisarAvisos}
        />
      )}
      {vista === 'glp1' && <ControlesGlp1 onAtender={irAtender} />}
      {vista === 'atender' && <Atender pacienteInicialId={atenderId} onPacienteInicialCargado={() => setAtenderId(null)} />}
      {vista === 'reportes' && <Reportes />}
    </Shell>
  );
}
