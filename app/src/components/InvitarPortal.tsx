import { useState } from 'react';
import { Alert, Button, Card, CopyButton, Group, Image, Stack, Text, TextInput } from '@mantine/core';
import { IconBrandWhatsapp, IconMail, IconQrcode, IconInfoCircle, IconCopy, IconCheck } from '@tabler/icons-react';
import type { Patient } from '@medplum/fhirtypes';
import QRCode from 'qrcode';
import { invitarPaciente, mensajeError, type CanalInvitacion } from '../lib/bots';

/**
 * Invitación al portal del paciente. La inteligencia vive en el bot
 * bw-invitar-paciente (invite de Medplum); acá sólo elegimos el canal y, para QR,
 * renderizamos el link que devuelve el bot (client-side, sin mandarlo a terceros).
 */
export function InvitarPortal({ paciente }: { paciente: Patient }): JSX.Element {
  const emailExistente = paciente.telecom?.find((t) => t.system === 'email')?.value ?? '';
  const [email, setEmail] = useState(emailExistente);
  const [cargando, setCargando] = useState<CanalInvitacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function invitar(canal: CanalInvitacion): Promise<void> {
    setCargando(canal);
    setError(null);
    setOk(null);
    setQr(null);
    setLink(null);
    try {
      const r = await invitarPaciente(`Patient/${paciente.id}`, canal, email || undefined);
      if (!r.ok) {
        setError(r.mensaje ?? 'No se pudo invitar.');
        return;
      }
      if (canal === 'qr') {
        if (r.link) {
          setLink(r.link);
          setQr(await QRCode.toDataURL(r.link, { width: 220, margin: 1 }));
        } else {
          setError(r.mensaje ?? 'No se pudo generar el QR.');
        }
      } else {
        // El acceso se creó; mostramos el link siempre para poder compartirlo igual.
        if (r.link) {
          setLink(r.link);
        }
        if (r.enviado) {
          setOk(canal === 'whatsapp' ? 'Invitación enviada por WhatsApp ✓' : 'Invitación enviada por email ✓');
        } else {
          // El envío real falló (Twilio/SES): avisamos y queda el link para copiar.
          setError(r.mensaje ?? 'El acceso se creó, pero el envío no salió. Compartí el link manualmente.');
        }
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargando(null);
    }
  }

  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb="sm">
        <IconQrcode size={18} />
        <Text fw={600}>Invitar al portal</Text>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Le da acceso para ver sus turnos, plan y pagos. El email es su usuario; el link de activación se entrega por el
        canal que elijas.
      </Text>

      <TextInput
        label="Email (usuario del portal)"
        placeholder="paciente@email.com"
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        type="email"
        mb="sm"
        w={360}
      />

      <Group>
        <Button
          leftSection={<IconBrandWhatsapp size={16} />}
          color="somAzul"
          variant="light"
          loading={cargando === 'whatsapp'}
          onClick={() => void invitar('whatsapp')}
        >
          WhatsApp
        </Button>
        <Button
          leftSection={<IconMail size={16} />}
          variant="light"
          loading={cargando === 'email'}
          onClick={() => void invitar('email')}
        >
          Email
        </Button>
        <Button
          leftSection={<IconQrcode size={16} />}
          variant="light"
          color="grape"
          loading={cargando === 'qr'}
          onClick={() => void invitar('qr')}
        >
          Mostrar QR
        </Button>
      </Group>

      {error && (
        <Alert color="orange" mt="md" icon={<IconInfoCircle size={16} />}>
          {error}
        </Alert>
      )}
      {ok && (
        <Alert color="somAzul" mt="md">
          {ok}
        </Alert>
      )}

      {qr && (
        <Stack align="center" mt="md" gap="xs">
          <Image src={qr} alt="QR de activación" w={220} h={220} />
          <Text size="sm" c="dimmed">
            El paciente lo escanea para fijar su contraseña.
          </Text>
        </Stack>
      )}

      {link && (
        <Group mt="sm" gap="xs">
          <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all', flex: 1 }}>
            {link}
          </Text>
          <CopyButton value={link}>
            {({ copied, copy }) => (
              <Button
                size="xs"
                variant="subtle"
                leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                onClick={copy}
              >
                {copied ? 'Copiado' : 'Copiar link'}
              </Button>
            )}
          </CopyButton>
        </Group>
      )}
    </Card>
  );
}
