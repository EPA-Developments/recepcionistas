import { useEffect, useState } from 'react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { contarSinLeer } from '@som/lib/mensajes';
import { Shell, type Vista } from './components/Shell';
import { AgendaDelDia } from './pages/AgendaDelDia';
import { Solicitudes } from './pages/Solicitudes';
import { Mensajes } from './pages/Mensajes';
import { ControlesGlp1 } from './pages/ControlesGlp1';
import { Atender } from './pages/Atender';
import { Reportes } from './pages/Reportes';
import { SignInPage } from './pages/SignInPage';

/** Cada cuánto se revisa si hay mensajes nuevos de pacientes (contador de la pestaña). */
const REFRESCO_MENSAJES_MS = 60_000;

export function App(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [vista, setVista] = useState<Vista>('agenda');
  // Paciente con el que entrar a "Atender" (p. ej. al confirmar una solicitud o desde Controles GLP-1).
  const [atenderId, setAtenderId] = useState<string | null>(null);
  const [mensajesSinLeer, setMensajesSinLeer] = useState(0);

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

  if (!profile) {
    return <SignInPage />;
  }

  const irAtender = (pacienteId: string): void => {
    setAtenderId(pacienteId);
    setVista('atender');
  };

  return (
    <Shell vista={vista} onVista={setVista} mensajesSinLeer={mensajesSinLeer}>
      {vista === 'agenda' && <AgendaDelDia />}
      {vista === 'solicitudes' && <Solicitudes onAtender={irAtender} />}
      {vista === 'mensajes' && <Mensajes onAtender={irAtender} />}
      {vista === 'glp1' && <ControlesGlp1 onAtender={irAtender} />}
      {vista === 'atender' && <Atender pacienteInicialId={atenderId} onPacienteInicialCargado={() => setAtenderId(null)} />}
      {vista === 'reportes' && <Reportes />}
    </Shell>
  );
}
