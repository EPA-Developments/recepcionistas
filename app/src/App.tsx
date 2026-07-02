import { useState } from 'react';
import { useMedplumProfile } from '@medplum/react';
import { Shell, type Vista } from './components/Shell';
import { AgendaDelDia } from './pages/AgendaDelDia';
import { Solicitudes } from './pages/Solicitudes';
import { Atender } from './pages/Atender';
import { Reportes } from './pages/Reportes';
import { SignInPage } from './pages/SignInPage';

export function App(): JSX.Element {
  const profile = useMedplumProfile();
  const [vista, setVista] = useState<Vista>('agenda');
  // Paciente con el que entrar a "Atender" (p. ej. al confirmar una solicitud).
  const [atenderId, setAtenderId] = useState<string | null>(null);

  if (!profile) {
    return <SignInPage />;
  }

  const irAtender = (pacienteId: string): void => {
    setAtenderId(pacienteId);
    setVista('atender');
  };

  return (
    <Shell vista={vista} onVista={setVista}>
      {vista === 'agenda' && <AgendaDelDia />}
      {vista === 'solicitudes' && <Solicitudes onAtender={irAtender} />}
      {vista === 'atender' && <Atender pacienteInicialId={atenderId} onPacienteInicialCargado={() => setAtenderId(null)} />}
      {vista === 'reportes' && <Reportes />}
    </Shell>
  );
}
