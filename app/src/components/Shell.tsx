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
import { useMediaQuery } from '@mantine/hooks';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { getDisplayString } from '@medplum/core';
import type { AvisoWhatsApp } from '@som/lib/whatsapp';
import { CampanaWhatsApp } from './CampanaWhatsApp';

export type Vista = 'agenda' | 'solicitudes' | 'mensajes' | 'glp1' | 'atender' | 'reportes';

interface ShellProps {
  vista: Vista;
  onVista: (v: Vista) => void;
  /** Mensajes de pacientes sin leer (contador de la pestaña "Mensajes"). */
  mensajesSinLeer?: number;
  /** La campanita: WhatsApp de números nuevos sin leer. */
  nuevosContactos?: AvisoWhatsApp[];
  /** Abre Mensajes (en la conversación del aviso, si se indica). */
  onAbrirMensajes?: (aviso?: AvisoWhatsApp) => void;
  children: ReactNode;
}

export function Shell({
  vista,
  onVista,
  mensajesSinLeer = 0,
  nuevosContactos = [],
  onAbrirMensajes,
  children,
}: ShellProps): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const { setColorScheme } = useMantineColorScheme();
  const esquema = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const oscuro = esquema === 'dark';
  // Con las pestañas y la campanita, el subtítulo y el usuario entran recién en pantallas anchas.
  const ancha = useMediaQuery('(min-width: 100em)');
  const usuario = profile ? getDisplayString(profile) : '';

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {/* En pantallas medianas va la sigla, para que entren las pestañas y la campanita. */}
            <Title order={3} c="somAzul.7" visibleFrom="xl" style={{ whiteSpace: 'nowrap' }}>
              Segunda Opinión Médica
            </Title>
            <Title order={3} c="somAzul.7" hiddenFrom="xl" title="Segunda Opinión Médica">
              SOM
            </Title>
            {ancha && (
              <Text c="dimmed" size="sm">
                Recepción
              </Text>
            )}
          </Group>

          <SegmentedControl
            value={vista}
            onChange={(v) => onVista(v as Vista)}
            data={[
              { value: 'agenda', label: segLabel(<IconCalendarEvent size={16} />, 'Agenda') },
              { value: 'solicitudes', label: segLabel(<IconInbox size={16} />, 'Solicitudes') },
              { value: 'mensajes', label: segLabel(<IconMessages size={16} />, 'Mensajes', mensajesSinLeer, 'teal') },
              { value: 'glp1', label: segLabel(<IconVaccine size={16} />, 'GLP-1') },
              { value: 'atender', label: segLabel(<IconUserHeart size={16} />, 'Atender paciente') },
              { value: 'reportes', label: segLabel(<IconChartBar size={16} />, 'Reportes') },
            ]}
          />

          <Group gap="sm" wrap="nowrap">
            {ancha && (
              <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                {usuario}
              </Text>
            )}
            <CampanaWhatsApp
              avisos={nuevosContactos}
              sinLeer={mensajesSinLeer}
              onAbrir={(aviso) => onAbrirMensajes?.(aviso)}
              onVerTodos={() => onAbrirMensajes?.()}
            />
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
              title={usuario ? `Salir (${usuario})` : 'Salir'}
              style={{ flexShrink: 0 }}
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

function segLabel(icon: ReactNode, label: string, contador = 0, color = 'red'): ReactNode {
  return (
    <Group gap={6} wrap="nowrap" title={label}>
      {icon}
      {/* En pantallas chicas, solo el ícono (el nombre queda en el tooltip). */}
      <Text span inherit visibleFrom="lg">
        {label}
      </Text>
      {contador > 0 && (
        <Badge size="sm" color={color} circle>
          {contador > 99 ? '99+' : contador}
        </Badge>
      )}
    </Group>
  );
}
