import { useState } from 'react';
import { Center, Paper, Stack, Title, Text } from '@mantine/core';
import { SignInForm, useMedplumProfile } from '@medplum/react';
import { Shell, type Vista } from './components/Shell';
import { AgendaDelDia } from './pages/AgendaDelDia';
import { Solicitudes } from './pages/Solicitudes';
import { PlanesSesiones } from './pages/PlanesSesiones';
import { Atender } from './pages/Atender';
import { Reportes } from './pages/Reportes';

export function App(): JSX.Element {
  const profile = useMedplumProfile();
  const [vista, setVista] = useState<Vista>('agenda');
  // Paciente con el que entrar a "Atender" (p. ej. al tocar "Atender" en el panel de planes).
  const [atenderId, setAtenderId] = useState<string | null>(null);

  if (!profile) {
    return <Login />;
  }

  const irAtender = (pacienteId: string): void => {
    setAtenderId(pacienteId);
    setVista('atender');
  };

  return (
    <Shell vista={vista} onVista={setVista}>
      {vista === 'agenda' && <AgendaDelDia />}
      {vista === 'solicitudes' && <Solicitudes onAtender={irAtender} />}
      {vista === 'planes' && <PlanesSesiones onAtender={irAtender} />}
      {vista === 'atender' && <Atender pacienteInicialId={atenderId} onPacienteInicialCargado={() => setAtenderId(null)} />}
      {vista === 'reportes' && <Reportes />}
    </Shell>
  );
}

function Login(): JSX.Element {
  return (
    <Center mih="100vh" bg="gray.0">
      <Paper withBorder shadow="md" p="xl" radius="lg" w={420}>
        <Stack gap="md">
          <Stack gap={2} align="center">
            <Title order={2} c="somAzul.7">
              Segunda Opinión Médica
            </Title>
            <Text c="dimmed" size="sm">
              Recepción · San Isidro
            </Text>
          </Stack>
          <SignInForm onSuccess={() => undefined}>
            <Text ta="center" size="sm" c="dimmed">
              Ingresá con tu cuenta
            </Text>
          </SignInForm>
        </Stack>
      </Paper>
    </Center>
  );
}
