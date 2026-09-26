/**
 * Diagnóstico de MercadoPago (Medplum Bot → API de MercadoPago).
 *
 *   npm run mercadopago:test
 *
 * El Access Token de MercadoPago NO vive en el .env: es un **Project Secret de
 * Medplum** (MERCADOPAGO_ACCESS_TOKEN) y solo lo ve el bot al ejecutarse. Por eso este
 * diagnóstico se conecta con las credenciales del .env y **ejecuta el bot
 * `som-link-mercadopago` en modo diagnóstico** en el servidor: no crea ningún link ni
 * cobra nada; revisa qué credencial hay cargada (sin mostrarla) y lee la cuenta
 * (`GET /users/me`) para ver si puede cobrar.
 *
 * Sirve para el error "MercadoPago respondió 403 … PolicyAgent /
 * PA_UNAUTHORIZED_RESULT_FROM_POLICIES": dice si es la Public Key en lugar del Access
 * Token, una credencial de otra cuenta, o una cuenta sin habilitar para cobrar.
 */
import 'dotenv/config';
import { conectarMedplum } from './conexion.js';
import type { ResultadoLinkMP } from '../bots/link-mercadopago.js';

const CREDENCIAL: Record<string, string> = {
  falta: 'no hay ninguna cargada',
  'access-token': 'Access Token de producción (formato correcto)',
  'access-token-prueba': 'Access Token de PRUEBA (TEST-)',
  'public-key': 'Public Key (NO sirve en el servidor)',
  desconocida: 'no tiene formato de Access Token',
};

async function main(): Promise<void> {
  const { medplum, baseUrl } = await conectarMedplum();
  console.log(`Conectado a ${baseUrl}. Diagnóstico de MercadoPago…`);

  const bot = await medplum.searchOne('Bot', 'name:exact=som-link-mercadopago');
  if (!bot?.id) {
    console.error('\n✗ No encontré el bot "som-link-mercadopago". Deployalo: npm run deploy:bots');
    process.exitCode = 1;
    return;
  }

  const r = (await medplum.executeBot(bot.id, { diagnosticar: true })) as ResultadoLinkMP;
  console.log(`\nCredencial en MERCADOPAGO_ACCESS_TOKEN: ${CREDENCIAL[r.credencial ?? ''] ?? r.credencial ?? '(desconocida)'}`);
  if (r.cuenta) {
    console.log(`Cuenta: ${r.cuenta.resumen}`);
  }
  if (r.ok) {
    console.log(`\n✓ ${r.mensaje}`);
    console.log('  Los links de seña salen cuando la consulta tenga precio (hoy los precios están PENDIENTES).');
  } else {
    console.error(`\n✗ ${r.mensaje ?? 'MercadoPago no está listo para cobrar.'}`);
    console.error('\n  El secret se cambia en Medplum → Project → Secrets → MERCADOPAGO_ACCESS_TOKEN (sin comillas ni "Bearer").');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Diagnóstico de MercadoPago falló:', err);
  process.exitCode = 1;
});
