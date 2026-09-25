import type { ReactNode } from 'react';
import {
  AppShell,
  Badge,
  Group,
  Title,
  SegmentedControl,
  Button,
  Text,
  ActionIcon,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import {
  IconCalendarEvent,
  IconUserHeart,
  IconChartBar,
  IconLogout,
  IconSun,
  IconMoon,
  IconInbox,
  IconMessages,
  IconVaccine,
} from '@tabler/icons-react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { getDisplayString } from '@medplum/core';

export type Vista = 'agenda' | 'solicitudes' | 'mensajes' | 'glp1' | 'atender' | 'reportes';

interface ShellProps {
  vista: Vista;
  onVista: (v: Vista) => void;
  /** Mensajes de pacientes sin leer (contador de la pestaña "Mensajes"). */
  mensajesSinLeer?: number;
  children: ReactNode;
}

export function Shell({ vista, onVista, mensajesSinLeer = 0, children }: ShellProps): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { setColorScheme } = useMantineColorScheme();
  const esquema = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const oscuro = esquema === 'dark';

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Title order={3} c="somAzul.7">
              Segunda Opinión Médica
            </Title>
            {/* Subtítulo y usuario se ocultan en pantallas chicas para que entren las pestañas. */}
            <Text c="dimmed" size="sm" visibleFrom="lg">
              Recepción
            </Text>
          </Group>

          <SegmentedControl
            value={vista}
            onChange={(v) => onVista(v as Vista)}
            data={[
              { value: 'agenda', label: segLabel(<IconCalendarEvent size={16} />, 'Agenda') },
              { value: 'solicitudes', label: segLabel(<IconInbox size={16} />, 'Solicitudes') },
              { value: 'mensajes', label: segLabel(<IconMessages size={16} />, 'Mensajes', mensajesSinLeer) },
              { value: 'glp1', label: segLabel(<IconVaccine size={16} />, 'GLP-1') },
              { value: 'atender', label: segLabel(<IconUserHeart size={16} />, 'Atender paciente') },
              { value: 'reportes', label: segLabel(<IconChartBar size={16} />, 'Reportes') },
            ]}
          />

          <Group gap="sm" wrap="nowrap">
            <Text size="sm" visibleFrom="lg">
              {profile ? getDisplayString(profile) : ''}
            </Text>
            <ActionIcon
              variant="default"
              size="lg"
              onClick={() => setColorScheme(oscuro ? 'light' : 'dark')}
              aria-label={oscuro ? 'Activar modo claro' : 'Activar modo oscuro'}
              title={oscuro ? 'Modo claro' : 'Modo oscuro'}
            >
              {oscuro ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
            <Button
              variant="light"
              color="gray"
              leftSection={<IconLogout size={16} />}
              onClick={() => medplum.signOut().then(() => window.location.reload())}
            >
              Salir
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

function segLabel(icon: ReactNode, label: string, contador = 0): ReactNode {
  return (
    <Group gap={6} wrap="nowrap">
      {icon}
      <span>{label}</span>
      {contador > 0 && (
        <Badge size="sm" color="red" circle>
          {contador > 99 ? '99+' : contador}
        </Badge>
      )}
    </Group>
  );
}
