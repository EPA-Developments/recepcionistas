import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { contarSinLeer } from '@som/lib/mensajes';
import { cargarAvisos, type AvisosWhatsApp } from '@som/lib/whatsapp-chat';
import type { AvisoWhatsApp } from '@som/lib/whatsapp';
import { Shell, type Vista } from './components/Shell';
import { AgendaDelDia } from './pages/AgendaDelDia';
import { Solicitudes } from './pages/Solicitudes';
import { Mensajes } from './pages/Mensajes';
import { WhatsApp } from './pages/WhatsApp';
import { ControlesGlp1 } from './pages/ControlesGlp1';
import { Atender } from './pages/Atender';
import { Reportes } from './pages/Reportes';
import { SignInPage } from './pages/SignInPage';

/** Cada cuánto se revisa si hay mensajes nuevos de pacientes (contador de la pestaña). */
const REFRESCO_MENSAJES_MS = 60_000;
/** Cada cuánto se revisa el WhatsApp (contador de la pestaña y campanita de contactos nuevos). */
const REFRESCO_WHATSAPP_MS = 15_000;

const TITULO = 'Segunda Opinión Médica · Recepción';

const clave = (a: AvisoWhatsApp): string => `${a.pacienteRef}|${a.sent}`;

export function App(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [vista, setVista] = useState<Vista>('agenda');
  // Paciente con el que entrar a "Atender" (p. ej. al confirmar una solicitud o desde Controles GLP-1).
  const [atenderId, setAtenderId] = useState<string | null>(null);
  const [mensajesSinLeer, setMensajesSinLeer] = useState(0);
  const [whatsapp, setWhatsapp] = useState<AvisosWhatsApp>({ sinLeer: 0, nuevosContactos: [] });
  // Chat de WhatsApp a abrir (desde la campanita o un aviso).
  const [chatWhatsApp, setChatWhatsApp] = useState<string | null>(null);
  // Contactos nuevos ya avisados (la primera carga no avisa: solo lo que llega después).
  const avisados = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!profile) {
      return;
    }
    const revisar = (): void => {
      contarSinLeer(medplum)
        .then(setMensajesSinLeer)
        .catch(() => undefined); // El contador no es crítico: queda el último valor.
    };
    revisar();
    const t = window.setInterval(revisar, REFRESCO_MENSAJES_MS);
    return () => window.clearInterval(t);
    // Al salir de Mensajes el contador se actualiza enseguida (ya se leyeron).
  }, [medplum, profile, vista]);

  const abrirWhatsApp = useCallback((pacienteRef?: string): void => {
    if (pacienteRef) {
      setChatWhatsApp(pacienteRef);
    }
    setVista('whatsapp');
  }, []);

  /** Toast (y aviso del escritorio si la pestaña está oculta) por cada contacto nuevo. */
  const avisarContacto = useCallback(
    (a: AvisoWhatsApp): void => {
      notifications.show({
        color: 'green',
        icon: <IconBrandWhatsapp size={18} />,
        title: `WhatsApp · nuevo contacto: ${a.nombre}`,
        autoClose: 12_000,
        message: (
          <Stack gap={6} align="flex-start">
            <Text size="sm" lineClamp={3}>
              {a.texto || 'Mensaje nuevo'}
            </Text>
            <Button size="compact-sm" color="green" variant="light" onClick={() => abrirWhatsApp(a.pacienteRef)}>
              Abrir el chat
            </Button>
          </Stack>
        ),
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(`WhatsApp · ${a.nombre}`, { body: a.texto || 'Mensaje nuevo', tag: a.pacienteRef });
        n.onclick = () => {
          window.focus();
          abrirWhatsApp(a.pacienteRef);
          n.close();
        };
      }
    },
    [abrirWhatsApp],
  );

  const revisarWhatsApp = useCallback((): void => {
    cargarAvisos(medplum)
      .then((a) => {
        setWhatsapp(a);
        if (avisados.current) {
          a.nuevosContactos.filter((x) => !avisados.current!.has(clave(x))).forEach(avisarContacto);
        }
        avisados.current = new Set([...(avisados.current ?? []), ...a.nuevosContactos.map(clave)]);
      })
      .catch(() => undefined); // La campanita no es crítica: queda el último valor.
  }, [medplum, avisarContacto]);

  useEffect(() => {
    if (!profile) {
      return;
    }
    revisarWhatsApp();
    const t = window.setInterval(revisarWhatsApp, REFRESCO_WHATSAPP_MS);
    return () => window.clearInterval(t);
  }, [profile, revisarWhatsApp]);

  // El título de la pestaña del navegador muestra los WhatsApp sin leer.
  useEffect(() => {
    document.title = whatsapp.sinLeer > 0 ? `(${whatsapp.sinLeer}) ${TITULO}` : TITULO;
  }, [whatsapp.sinLeer]);

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
      mensajesSinLeer={mensajesSinLeer}
      whatsapp={whatsapp}
      onAbrirWhatsApp={abrirWhatsApp}
    >
      {vista === 'agenda' && <AgendaDelDia />}
      {vista === 'solicitudes' && <Solicitudes onAtender={irAtender} />}
      {vista === 'mensajes' && <Mensajes onAtender={irAtender} />}
      {vista === 'whatsapp' && (
        <WhatsApp
          chatInicial={chatWhatsApp}
          onChatInicialAbierto={() => setChatWhatsApp(null)}
          onAtender={irAtender}
          onLeidos={revisarWhatsApp}
        />
      )}
      {vista === 'glp1' && <ControlesGlp1 onAtender={irAtender} />}
      {vista === 'atender' && <Atender pacienteInicialId={atenderId} onPacienteInicialCargado={() => setAtenderId(null)} />}
      {vista === 'reportes' && <Reportes />}
    </Shell>
  );
}
