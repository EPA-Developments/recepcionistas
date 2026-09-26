import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useMedplum, useMedplumProfile, useSubscription } from '@medplum/react';
import { COD } from '@som/fhir/identifiers';
import { cargarAvisos, type AvisosMensajes } from '@som/lib/mensajes';
import type { AvisoWhatsApp } from '@som/lib/contactos-whatsapp';
import { Shell, type Vista } from './components/Shell';
import { AgendaDelDia } from './pages/AgendaDelDia';
import { Solicitudes } from './pages/Solicitudes';
import { Mensajes } from './pages/Mensajes';
import { WhatsApp } from './pages/WhatsApp';
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
/** Los avisos de números nuevos por WhatsApp (se crean y se resuelven). */
const CRITERIO_AVISOS = `Task?code=${COD.whatsappNuevoContacto}`;

const TITULO = 'Segunda Opinión Médica · Recepción';

export function App(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [vista, setVista] = useState<Vista>('agenda');
  // Paciente con el que entrar a "Atender" (p. ej. al confirmar una solicitud o desde Controles GLP-1).
  const [atenderId, setAtenderId] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AvisosMensajes>({ sinLeer: 0, nuevosContactos: [] });
  // Conversación a abrir en Mensajes (p. ej. "Ver conversación" de la pestaña WhatsApp).
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  // Aviso a mostrar en la pestaña WhatsApp (desde la campanita o el aviso emergente).
  const [avisoId, setAvisoId] = useState<string | null>(null);
  // Números nuevos ya avisados (la primera carga no avisa: solo lo que llega después).
  const avisados = useRef<Set<string> | null>(null);

  const abrirWhatsApp = useCallback((aviso?: AvisoWhatsApp): void => {
    if (aviso?.avisoId) {
      setAvisoId(aviso.avisoId);
    }
    setVista('whatsapp');
  }, []);

  const abrirConversacion = useCallback((id: string): void => {
    setConversacionId(id);
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
            <Button size="compact-sm" color="green" variant="light" onClick={() => abrirWhatsApp(a)}>
              Ver en WhatsApp
            </Button>
          </Stack>
        ),
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(`WhatsApp · ${a.nombre}`, { body: a.texto || 'Mensaje nuevo', tag: a.avisoId });
        n.onclick = () => {
          window.focus();
          abrirWhatsApp(a);
          n.close();
        };
      }
    },
    [abrirWhatsApp],
  );

  const revisarAvisos = useCallback((): void => {
    cargarAvisos(medplum)
      .then((a) => {
        setAvisos(a);
        if (avisados.current) {
          a.nuevosContactos.filter((x) => !avisados.current!.has(x.avisoId)).forEach(avisarContacto);
        }
        avisados.current = new Set([...(avisados.current ?? []), ...a.nuevosContactos.map((x) => x.avisoId)]);
      })
      .catch(() => undefined); // El contador no es crítico: queda el último valor.
  }, [medplum, avisarContacto]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    revisarAvisos();
    const t = window.setInterval(revisarAvisos, REFRESCO_AVISOS_MS);
    // Al volver a la ventana (el WebSocket pudo cortarse mientras estaba en segundo plano).
    window.addEventListener('focus', revisarAvisos);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', revisarAvisos);
    };
    // Al cambiar de pestaña los contadores se actualizan enseguida (p. ej. ya se leyeron).
  }, [profile, revisarAvisos, vista]);

  // En vivo: un mensaje nuevo (del portal o de WhatsApp) o un aviso nuevo o resuelto
  // actualizan los contadores y la campanita.
  useSubscription(profile ? CRITERIO_MENSAJES : undefined, revisarAvisos, {
    onError: () => undefined,
    onWebSocketClose: () => undefined,
  });
  useSubscription(profile ? CRITERIO_AVISOS : undefined, revisarAvisos, {
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
      onAbrirWhatsApp={abrirWhatsApp}
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
      {vista === 'whatsapp' && (
        <WhatsApp
          onAtender={irAtender}
          onVerConversacion={abrirConversacion}
          avisoInicial={avisoId}
          onAvisoInicialAbierto={() => setAvisoId(null)}
          onCambio={revisarAvisos}
        />
      )}
      {vista === 'glp1' && <ControlesGlp1 onAtender={irAtender} />}
      {vista === 'atender' && <Atender pacienteInicialId={atenderId} onPacienteInicialCargado={() => setAtenderId(null)} />}
      {vista === 'reportes' && <Reportes />}
    </Shell>
  );
}
