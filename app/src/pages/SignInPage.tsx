import { Center, Paper, Stack, Title, Text } from '@mantine/core';
import { SignInForm } from '@medplum/react';

/**
 * Login de la app de recepción.
 *
 * Además del email/contraseña de Medplum, permite **ingresar con Google**
 * (cuentas de Gmail / Google Workspace): el botón aparece cuando está
 * configurado `GOOGLE_CLIENT_ID` (env de Vite, ver `app/.env.example`).
 *
 * Requisitos del lado de Google/Medplum para que funcione end-to-end:
 *  1. Un OAuth Client ID (tipo Web) en Google Cloud Console con el dominio de
 *     la app (p. ej. https://recepcion.segundaopinionmedica.org) en
 *     "Authorized JavaScript origins".
 *  2. El mismo Client ID configurado en el proyecto Medplum (Project Settings →
 *     Google Client ID), para que el servidor acepte el token de Google.
 *  3. El usuario debe existir en Medplum con ese mismo email (el login con
 *     Google autentica, no crea usuarios nuevos).
 */
export function SignInPage(): JSX.Element {
  const googleClientId = import.meta.env.GOOGLE_CLIENT_ID;

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
          <SignInForm onSuccess={() => undefined} googleClientId={googleClientId}>
            <Text ta="center" size="sm" c="dimmed">
              Ingresá con tu cuenta{googleClientId ? ' o con Google' : ''}
            </Text>
          </SignInForm>
        </Stack>
      </Paper>
    </Center>
  );
}
