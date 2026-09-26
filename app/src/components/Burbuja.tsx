import { Paper, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconChecks, IconClock } from '@tabler/icons-react';
import type { Attachment, Communication } from '@medplum/fhirtypes';
import { esAutomatica, esDelPaciente, textoMensaje } from '@som/lib/mensajes';
import { adjuntosDe, estadoEntregaDe, esWhatsApp, tipoAdjunto, type EstadoEntrega } from '@som/lib/whatsapp';

/**
 * Un mensaje de una conversación, como en WhatsApp: los del paciente a la izquierda y
 * los de Recepción a la derecha, con 📱 si fue por WhatsApp, los ✓✓ de entrega y 🤖 si lo
 * mandó solo el sistema. Lo usan Mensajes y la pestaña WhatsApp.
 */

const fmtFecha = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
});

export function fecha(iso?: string): string {
  return iso ? fmtFecha.format(new Date(iso)) : '';
}

/** Los ✓ de un mensaje que salió por WhatsApp. */
export function Tilde({ estado, motivo }: { estado?: EstadoEntrega; motivo?: string }): JSX.Element | null {
  switch (estado) {
    case 'en-cola':
      return <IconClock size={13} aria-label="En camino" style={{ verticalAlign: 'middle' }} />;
    case 'enviado':
      return <IconCheck size={14} aria-label="Enviado" style={{ verticalAlign: 'middle' }} />;
    case 'entregado':
      return <IconChecks size={15} aria-label="Entregado" style={{ verticalAlign: 'middle' }} />;
    case 'leido':
      return <IconChecks size={15} color="#53bdeb" aria-label="Leído" style={{ verticalAlign: 'middle' }} />;
    case 'fallido':
      return (
        <Tooltip label={motivo ?? 'WhatsApp no entregó el mensaje.'} multiline w={260} withArrow>
          <IconAlertCircle size={14} color="var(--mantine-color-red-6)" aria-label="No se entregó" style={{ verticalAlign: 'middle' }} />
        </Tooltip>
      );
    default:
      return null;
  }
}

export function Adjunto({ a }: { a: Attachment }): JSX.Element {
  const tipo = tipoAdjunto(a.contentType);
  // Sin link firmado (se está guardando o no se pudo bajar de WhatsApp): solo el nombre.
  if (!a.url?.startsWith('http')) {
    return (
      <Text size="sm" c="dimmed" mt={6}>
        📎 {a.title ?? 'Adjunto'}
      </Text>
    );
  }
  if (tipo === 'imagen') {
    return (
      <a href={a.url} target="_blank" rel="noreferrer">
        <img
          src={a.url}
          alt={a.title ?? 'Imagen adjunta'}
          style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block', marginTop: 6 }}
        />
      </a>
    );
  }
  if (tipo === 'audio') {
    return <audio controls src={a.url} style={{ display: 'block', marginTop: 6, maxWidth: '100%' }} />;
  }
  if (tipo === 'video') {
    return <video controls src={a.url} style={{ display: 'block', marginTop: 6, maxWidth: '100%', maxHeight: 260, borderRadius: 8 }} />;
  }
  return (
    <Text size="sm" mt={6}>
      <a href={a.url} target="_blank" rel="noreferrer">
        📎 {a.title ?? 'Adjunto'}
      </a>
    </Text>
  );
}

export function Burbuja({ m, compacta = false }: { m: Communication; compacta?: boolean }): JSX.Element {
  const delPaciente = esDelPaciente(m);
  const viaWhatsApp = esWhatsApp(m);
  // Lo que contestó el sistema en nombre de Recepción se muestra como tal: nadie tiene
  // que preguntarse si eso lo escribió una compañera.
  const automatico = esAutomatica(m);
  const entrega = estadoEntregaDe(m);
  const cuerpo = textoMensaje(m);
  const quien = delPaciente ? (viaWhatsApp ? '' : 'Portal · ') : automatico ? '' : m.sender?.display ? `${m.sender.display} · ` : '';
  return (
    <Paper
      p={compacta ? 'xs' : 'sm'}
      radius="md"
      withBorder={delPaciente}
      bg={delPaciente ? undefined : 'var(--mantine-primary-color-light)'}
      maw={compacta ? '85%' : '80%'}
      style={{ alignSelf: delPaciente ? 'flex-start' : 'flex-end' }}
    >
      {cuerpo && (
        <Text size="sm" style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
          {cuerpo}
        </Text>
      )}
      {adjuntosDe(m).map((a, i) => (
        <Adjunto key={`${m.id}-adj-${i}`} a={a} />
      ))}
      <Text size="xs" c="dimmed" ta="right" mt={4}>
        {automatico ? '🤖 Automática · ' : ''}
        {quien}
        {viaWhatsApp ? '📱 WhatsApp · ' : ''}
        {fecha(m.sent)} {!delPaciente && viaWhatsApp && <Tilde estado={entrega} motivo={m.statusReason?.text} />}
      </Text>
      {!delPaciente && entrega === 'fallido' && m.statusReason?.text && (
        <Text size="xs" c="red" ta="right">
          {m.statusReason.text}
        </Text>
      )}
    </Paper>
  );
}
