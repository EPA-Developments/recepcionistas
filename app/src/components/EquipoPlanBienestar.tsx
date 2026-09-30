import { useCallback, useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Stack, Table, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconClipboardList, IconCopy, IconInfoCircle, IconPrinter, IconRefresh } from '@tabler/icons-react';
import type { Patient } from '@medplum/fhirtypes';
import { NOMBRE_PLAN_BIENESTAR } from '@som/config/plan-bienestar';
import { ETIQUETA_ESTADO_DATO, type EstadoDatoDia0 } from '@som/lib/dia0-pb100d';
import { fmtDia } from '@som/lib/programas';
import { aE164AR } from '@som/lib/whatsapp';
import { bienestarDia0, mensajeError, type ResultadoDia0Bienestar } from '../lib/bots';

const COLOR_ESTADO: Record<EstadoDatoDia0, string> = { cargado: 'somAzul', parcial: 'yellow', vencido: 'orange', falta: 'red' };

const ESTILO_IMPRESION = `@media print {
  body * { visibility: hidden; }
  #pb100d-material-recepcion, #pb100d-material-recepcion * { visibility: visible; }
  #pb100d-material-recepcion { position: absolute; left: 0; top: 0; width: 100%; }
}`;

/**
 * El equipo del Plan Bienestar 100 Días® visto desde Recepción: el día 0 (qué datos del
 * catálogo firmado faltan y quién los carga), el estado del plan clínico y el material
 * para el paciente (aviso por WhatsApp e impresión de sus pasos). Todo lo calcula el bot
 * `som-bienestar-dia0` con su identidad: Recepción ve "falta el laboratorio", nunca el
 * valor. Es la versión operativa del menú del equipo del monorepo del plan.
 */
export function EquipoPlanBienestar({ paciente }: { paciente: Patient }): JSX.Element {
  const pacienteRef = `Patient/${paciente.id}`;
  const [r, setR] = useState<ResultadoDia0Bienestar>();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [texto, setTexto] = useState<string>();

  const cargar = useCallback(async (): Promise<void> => {
    setCargando(true);
    try {
      const res = await bienestarDia0(pacienteRef);
      setR(res);
      setTexto(undefined);
      setError(res.ok ? null : (res.mensaje ?? 'No se pudo evaluar el día 0.'));
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(false);
    }
  }, [pacienteRef]);

  useEffect(() => {
    setR(undefined);
    setError(null);
    void cargar();
  }, [cargar]);

  const telefono = aE164AR(paciente.telecom?.find((t) => t.system === 'phone')?.value)?.replace(/^\+/, '');
  const mensaje = texto ?? r?.material?.textoWhatsApp ?? '';

  async function copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(mensaje);
      notifications.show({ color: 'somAzul', title: 'Copiado', message: 'El aviso quedó en el portapapeles.' });
    } catch {
      notifications.show({ color: 'orange', title: 'No se pudo copiar', message: 'Seleccioná el texto y copialo a mano.' });
    }
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <style>{ESTILO_IMPRESION}</style>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconClipboardList size={18} />
          <Text fw={600}>{NOMBRE_PLAN_BIENESTAR} · día 0 y material</Text>
        </Group>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={() => void cargar()} loading={cargando}>
          Actualizar
        </Button>
      </Group>

      {error && (
        <Alert color="orange" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}
      {!r && !error && <Loader size="sm" />}

      {r?.ok && r.dia0 && (
        <Stack gap="md">
          <Group gap="xs">
            <Badge size="lg" variant="light" color={r.dia0.completo ? 'somAzul' : 'orange'}>
              {r.dia0.completo ? 'Día 0 completo' : `${r.dia0.cargados} de ${r.dia0.total} cargados`}
            </Badge>
            <Text size="xs" c="dimmed">
              Lista del catálogo firmado para su estadío ({r.origenEstadio === 'validado' ? 'validado por el equipo médico' : 'estimado, sin validar'}). Recepción
              ve qué falta y quién lo carga, nunca los valores.
            </Text>
          </Group>

          {r.dia0.porQuien.map((g) => (
            <Stack gap={4} key={g.quien}>
              <Text size="sm" fw={600}>
                {g.etiqueta}
              </Text>
              <Table verticalSpacing={4} withRowBorders>
                <Table.Tbody>
                  {g.datos.map((d) => (
                    <Table.Tr key={d.codigo}>
                      <Table.Td>
                        <Text size="sm">{d.label}</Text>
                      </Table.Td>
                      <Table.Td w={110}>
                        <Badge size="sm" variant="light" color={COLOR_ESTADO[d.estado]}>
                          {ETIQUETA_ESTADO_DATO[d.estado]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {d.detalle ?? ''}
                          {d.fecha ? `${d.detalle ? ' · ' : ''}${fmtDia(d.fecha)}` : ''}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          ))}

          <Text size="sm">
            {r.planClinico?.activo
              ? `Plan clínico activo${r.planClinico.inicio ? ` desde el ${fmtDia(r.planClinico.inicio)}` : ''}${r.planClinico.dia !== undefined ? ` · día ${r.planClinico.dia} de 100` : ''} · pasos ${r.planClinico.pasosCompletados} de ${r.planClinico.pasosTotal}.`
              : 'Sin plan clínico: lo empieza el equipo médico o la persona desde el portal.'}
          </Text>

          {r.material && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Material para el paciente
              </Text>
              <Textarea autosize minRows={4} value={mensaje} onChange={(e) => setTexto(e.currentTarget.value)} aria-label="Aviso por WhatsApp" />
              <Group gap="xs">
                <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={() => void copiar()}>
                  Copiar
                </Button>
                {telefono && (
                  <Button
                    size="xs"
                    variant="light"
                    color="green"
                    component="a"
                    href={`https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`}
                    target="_blank"
                    rel="noreferrer"
                    leftSection={<IconBrandWhatsapp size={14} />}
                  >
                    Abrir en WhatsApp
                  </Button>
                )}
                <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => window.print()}>
                  Imprimir los pasos
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                Sin plantilla aprobada, el aviso sale desde WhatsApp Web con el texto de arriba. Sólo títulos de pasos: nada clínico.
              </Text>
              <Stack gap={4} id="pb100d-material-recepcion">
                <Text fw={700}>
                  {NOMBRE_PLAN_BIENESTAR} · {paciente.name?.[0]?.given?.join(' ')} {paciente.name?.[0]?.family}
                </Text>
                {r.material.secciones.map((s) => (
                  <div key={s.momento}>
                    <Text size="sm" fw={600}>
                      {s.titulo}
                    </Text>
                    {s.pasos.map((p, i) => (
                      <Text size="sm" key={i}>
                        {p.completado ? '☑' : '☐'} {p.titulo}
                      </Text>
                    ))}
                  </div>
                ))}
                <Anchor size="xs" href="https://app.segundaopinionmedica.org" target="_blank" rel="noreferrer">
                  El plan completo está en el portal.
                </Anchor>
              </Stack>
            </Stack>
          )}
        </Stack>
      )}
    </Card>
  );
}
