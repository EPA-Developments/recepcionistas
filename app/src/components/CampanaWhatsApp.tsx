import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Divider,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconBell, IconBrandWhatsapp, IconUser } from '@tabler/icons-react';
import { esSoloNumero, formatoTelefono, haceCuanto, iniciales, type AvisoWhatsApp } from '@som/lib/whatsapp';
import classes from './CampanaWhatsApp.module.css';

/**
 * La campanita de Recepción: avisa cada WhatsApp de un **número nuevo** (un contacto que
 * no estaba en SOM) que nadie leyó todavía. Tocar un aviso abre esa conversación en
 * Mensajes (y leerla apaga el aviso). Se sacude cuando llega uno nuevo.
 */
export function CampanaWhatsApp({
  avisos,
  sinLeer,
  onAbrir,
  onVerTodos,
}: {
  avisos: AvisoWhatsApp[];
  /** Todos los mensajes de pacientes sin leer en Mensajes (no solo los de números nuevos). */
  sinLeer: number;
  onAbrir: (aviso: AvisoWhatsApp) => void;
  onVerTodos: () => void;
}): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [sacudir, setSacudir] = useState(false);
  const [permiso, setPermiso] = useState(() => (typeof Notification === 'undefined' ? 'denied' : Notification.permission));
  const previos = useRef(avisos.length);

  useEffect(() => {
    const llegaronMas = avisos.length > previos.current;
    previos.current = avisos.length;
    if (!llegaronMas) {
      return;
    }
    setSacudir(true);
    const t = window.setTimeout(() => setSacudir(false), 2800);
    return () => window.clearTimeout(t);
  }, [avisos.length]);

  const activarEscritorio = (): void => {
    if (typeof Notification !== 'undefined') {
      void Notification.requestPermission().then(setPermiso);
    }
  };

  const cantidad = avisos.length;
  const titulo =
    cantidad === 0
      ? 'Sin contactos nuevos por WhatsApp'
      : `${cantidad} ${cantidad === 1 ? 'contacto nuevo' : 'contactos nuevos'} por WhatsApp`;

  return (
    <Popover opened={abierto} onChange={setAbierto} width={360} position="bottom-end" shadow="md" withArrow>
      <Popover.Target>
        <Indicator
          label={cantidad > 99 ? '99+' : cantidad}
          size={18}
          color="green"
          offset={4}
          withBorder
          disabled={cantidad === 0}
        >
          <ActionIcon
            variant={cantidad > 0 ? 'light' : 'default'}
            color={cantidad > 0 ? 'green' : undefined}
            size="lg"
            onClick={() => setAbierto((o) => !o)}
            aria-label={titulo}
            title={titulo}
          >
            <IconBell size={18} className={sacudir ? classes.sacudir : undefined} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <Group px="md" py="sm" justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            <IconBrandWhatsapp size={20} color="#25D366" />
            <Text fw={700}>Contactos nuevos</Text>
          </Group>
          {sinLeer > 0 && (
            <Badge color="green" variant="light">
              {sinLeer} sin leer
            </Badge>
          )}
        </Group>
        <Divider />

        {cantidad === 0 ? (
          <Text size="sm" c="dimmed" p="md">
            Nada nuevo. La campanita avisa cuando un número nuevo escribe por WhatsApp.
          </Text>
        ) : (
          <ScrollArea.Autosize mah={380}>
            {avisos.map((a) => (
              <UnstyledButton
                key={a.pacienteRef}
                w="100%"
                px="md"
                py="sm"
                className={classes.item}
                onClick={() => {
                  setAbierto(false);
                  onAbrir(a);
                }}
              >
                <Group wrap="nowrap" gap="sm" align="flex-start">
                  <Avatar color="green" radius="xl" variant="filled">
                    {iniciales(a.nombre) || <IconUser size={20} />}
                  </Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text fw={700} size="sm" truncate>
                        {a.nombre}
                      </Text>
                      <Text size="xs" c="green.7" fw={600} style={{ flexShrink: 0 }}>
                        {haceCuanto(a.sent)}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {esSoloNumero(a.nombre) ? 'Número nuevo' : formatoTelefono(a.telefono)}
                    </Text>
                    <Text size="sm" lineClamp={2}>
                      {a.texto || 'Mensaje nuevo'}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </ScrollArea.Autosize>
        )}

        <Divider />
        <Group px="xs" py={6} justify="space-between" wrap="nowrap">
          <Button
            variant="subtle"
            size="compact-sm"
            color="green"
            onClick={() => {
              setAbierto(false);
              onVerTodos();
            }}
          >
            Ver Mensajes
          </Button>
          {permiso === 'default' && (
            <Button variant="subtle" size="compact-sm" color="gray" onClick={activarEscritorio}>
              Avisar también en el escritorio
            </Button>
          )}
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}
