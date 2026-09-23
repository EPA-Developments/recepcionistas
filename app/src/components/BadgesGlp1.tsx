import { Badge, type MantineSize } from '@mantine/core';
import { IconFlask } from '@tabler/icons-react';
import { estadoVentana, fmtDia, type Ventana } from '@som/lib/glp1-plan';

/** Dónde está hoy respecto de la ventana del control (la calcula el sistema). */
export function BadgeVentana({ ventana, hoy, size = 'sm' }: { ventana: Ventana; hoy: string; size?: MantineSize }): JSX.Element {
  const estado = estadoVentana(ventana, hoy);
  if (estado === 'vencida') {
    return (
      <Badge color="red" variant="light" size={size}>
        Vencido
      </Badge>
    );
  }
  if (estado === 'proxima') {
    return (
      <Badge color="gray" variant="light" size={size}>
        Desde el {fmtDia(ventana.desde)}
      </Badge>
    );
  }
  return (
    <Badge color="green" variant="light" size={size}>
      En ventana
    </Badge>
  );
}

/** El control lleva laboratorio: el paciente tiene que traer los resultados. */
export function BadgeLaboratorio({ size = 'sm' }: { size?: MantineSize }): JSX.Element {
  return (
    <Badge color="somAzul" variant="light" size={size} leftSection={<IconFlask size={12} />}>
      Traer laboratorio
    </Badge>
  );
}
