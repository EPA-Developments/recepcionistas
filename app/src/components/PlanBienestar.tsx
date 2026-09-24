import { useState } from 'react';
import { Alert, Button, Card, Group, Text } from '@mantine/core';
import { IconHeartbeat, IconInfoCircle } from '@tabler/icons-react';
import type { Patient } from '@medplum/fhirtypes';
import { inscribirBienestar, mensajeError, type ResultadoInscripcionBienestar } from '../lib/bots';

/**
 * Plan Bienestar · 100 días. Recepción solo inscribe: el bot crea el plan (con sus
 * fechas) y el paciente sigue su progreso en el portal. Idempotente: si ya estaba
 * inscripto, el bot devuelve el período vigente.
 */
export function PlanBienestar({ paciente }: { paciente: Patient }): JSX.Element {
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoInscripcionBienestar | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inscribir(): Promise<void> {
    setCargando(true);
    setError(null);
    try {
      const r = await inscribirBienestar(`Patient/${paciente.id}`);
      if (r.ok) {
        setResultado(r);
      } else {
        setError(r.mensaje ?? 'No se pudo inscribir.');
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(false);
    }
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconHeartbeat size={18} />
        <Text fw={600}>Plan Bienestar · 100 días</Text>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        El paciente sigue su progreso (día a día, hitos y racha) en el portal.
      </Text>
      <Button variant="light" color="somAzul" loading={cargando} onClick={() => void inscribir()}>
        Inscribir en el Plan Bienestar
      </Button>
      {resultado && (
        <Alert color="somAzul" mt="md">
          {resultado.creado ? 'Inscripto ✓' : (resultado.mensaje ?? 'Ya estaba inscripto.')} Del {resultado.inicio} al{' '}
          {resultado.fin}.
        </Alert>
      )}
      {error && (
        <Alert color="orange" mt="md" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}
    </Card>
  );
}
