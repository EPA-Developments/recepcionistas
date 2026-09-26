/**
 * MercadoPago (seña por Checkout Pro) — lógica pura, sin red.
 *
 *  - Reconoce qué credencial se cargó en el Project Secret `MERCADOPAGO_ACCESS_TOKEN`:
 *    el bot necesita el **Access Token** (`APP_USR-{app}-{fecha}-{hash}-{usuario}`); la
 *    **Public Key** (`APP_USR-` + UUID) es para el navegador y MercadoPago la rechaza
 *    en el servidor.
 *  - Arma la preferencia de la seña (nunca por $0: MercadoPago no cobra montos nulos).
 *  - Traduce los errores de MercadoPago a qué hacer, en especial el 403
 *    `PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (su capa de autorización, "PolicyAgent"):
 *    la credencial no está autorizada para crear links de pago.
 *  - Lee la cuenta (`GET /users/me`) para decir si está habilitada para cobrar.
 */

export type TipoCredencialMP = 'falta' | 'access-token' | 'access-token-prueba' | 'public-key' | 'desconocida';

/** Access Token: `APP_USR-{app}-{fecha}-{hash}-{usuario}` (o `TEST-…` en pruebas). */
const RE_ACCESS_TOKEN = /^(APP_USR|TEST)-\d+-\d+-[0-9a-f]+-\d+$/i;
/** Public Key: `APP_USR-` + UUID (o `TEST-` + UUID). Es para el front, no para el servidor. */
const RE_PUBLIC_KEY = /^(APP_USR|TEST)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El token tal como se usa en `Authorization`: sin espacios ni un "Bearer " pegado de más. */
export function limpiarTokenMP(token: string | undefined): string {
  return (token ?? '').trim().replace(/^Bearer\s+/i, '').trim();
}

export function tipoCredencialMP(token: string | undefined): TipoCredencialMP {
  const t = limpiarTokenMP(token);
  if (!t) {
    return 'falta';
  }
  if (RE_PUBLIC_KEY.test(t)) {
    return 'public-key';
  }
  if (RE_ACCESS_TOKEN.test(t)) {
    return /^TEST-/i.test(t) ? 'access-token-prueba' : 'access-token';
  }
  return 'desconocida';
}

const DONDE_ESTA =
  'se copia de MercadoPago → Tus integraciones → la aplicación de SOM → Credenciales de producción → Access Token; ' +
  'empieza con APP_USR- y tiene varios bloques de números';

/** Si la credencial cargada no sirve para el servidor, qué hacer (sin llamar a MercadoPago). */
export function problemaCredencialMP(tipo: TipoCredencialMP): string | undefined {
  switch (tipo) {
    case 'falta':
      return 'MercadoPago no está configurado: falta el Project Secret MERCADOPAGO_ACCESS_TOKEN en Medplum.';
    case 'public-key':
      return (
        'MERCADOPAGO_ACCESS_TOKEN tiene la Public Key, no el Access Token: la Public Key es para el navegador y ' +
        `MercadoPago la rechaza en el servidor. Reemplazala en Medplum (Project → Secrets) por el Access Token, que ${DONDE_ESTA}.`
      );
    case 'desconocida':
      return (
        'MERCADOPAGO_ACCESS_TOKEN no tiene formato de Access Token de MercadoPago (¿Client Secret, Client ID o un ' +
        `texto cortado?). Cargá el Access Token, que ${DONDE_ESTA}.`
      );
    default:
      return undefined;
  }
}

/**
 * ¿Hay que frenar antes de llamar a MercadoPago? Solo si falta o es la Public Key
 * (seguro que no sirve). Un formato desconocido se prueba igual: si MercadoPago cambia
 * el formato de sus tokens, no se bloquea uno válido.
 */
export function bloqueaCredencialMP(tipo: TipoCredencialMP): boolean {
  return tipo === 'falta' || tipo === 'public-key';
}

// ───────────────────────────── preferencia de la seña ─────────────────────────────

export interface DatosPreferenciaSena {
  appointmentId: string;
  /** Texto del turno (p. ej. "Consulta de Cardiología"). */
  descripcion: string;
  senaARS: number;
  /** A dónde vuelve el paciente después de pagar. */
  appUrl: string;
  /** Webhook de pagos (opcional). */
  notificationUrl?: string;
}

/** La seña se cobra por MercadoPago solo si el monto es positivo. */
export function problemaMontoSena(senaARS: number): string | undefined {
  if (Number.isFinite(senaARS) && senaARS > 0) {
    return undefined;
  }
  return (
    'La seña de este turno es $0 porque el precio de la consulta está PENDIENTE (falta la lista de precios de SOM). ' +
    'MercadoPago no genera links por $0: cuando estén los precios, el link sale solo. Mientras tanto, confirmá el ' +
    'turno registrando la seña a mano.'
  );
}

/** Cuerpo de `POST /checkout/preferences` para la seña de un turno. */
export function armarPreferenciaSena(d: DatosPreferenciaSena): Record<string, unknown> {
  return {
    items: [{ title: `Seña 50% · ${d.descripcion}`, quantity: 1, unit_price: d.senaARS, currency_id: 'ARS' }],
    external_reference: d.appointmentId,
    metadata: { appointmentId: d.appointmentId },
    back_urls: { success: d.appUrl, pending: d.appUrl, failure: d.appUrl },
    auto_return: 'approved',
    ...(d.notificationUrl ? { notification_url: d.notificationUrl } : {}),
  };
}

// ───────────────────────────── errores de MercadoPago ─────────────────────────────

interface CuerpoErrorMP {
  message?: string;
  error?: string;
  code?: string;
  blocked_by?: string;
  cause?: Array<{ code?: string | number; description?: string }> | unknown;
}

function leerCuerpo(texto: string): CuerpoErrorMP {
  try {
    const o = JSON.parse(texto) as unknown;
    return o && typeof o === 'object' ? (o as CuerpoErrorMP) : {};
  } catch {
    return {};
  }
}

/** ¿Es el rechazo de la capa de autorización de MercadoPago (credencial sin permiso)? */
export function esRechazoDePoliticas(status: number, texto: string): boolean {
  const c = leerCuerpo(texto);
  return status === 403 && (c.blocked_by === 'PolicyAgent' || c.code === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES');
}

/** Error de MercadoPago en pocas palabras (sin el JSON crudo): "403 PolicyAgent", "401: invalid token". */
export function resumenErrorMP(status: number, texto: string): string {
  if (esRechazoDePoliticas(status, texto)) {
    return `${status} PolicyAgent`;
  }
  const c = leerCuerpo(texto);
  const detalle = c.message ?? c.error;
  return detalle ? `${status}: ${detalle}` : String(status);
}

/**
 * Qué significa un error de MercadoPago y qué hacer. `tipo` es la credencial cargada
 * (para afinar el consejo); `accion`, lo que se intentó. No incluye el token.
 */
export function explicarErrorMP(
  status: number,
  texto: string,
  tipo: TipoCredencialMP,
  accion = 'crear links de pago',
): string {
  const c = leerCuerpo(texto);
  const detalle = c.message ?? c.error ?? texto.slice(0, 200);
  if (status === 401) {
    return `MercadoPago rechazó la credencial (401: ${detalle}): el Access Token es inválido, venció o fue renovado. Cargá el vigente, que ${DONDE_ESTA}.`;
  }
  if (esRechazoDePoliticas(status, texto)) {
    const prueba =
      tipo === 'access-token-prueba'
        ? ' Además, la credencial cargada es de PRUEBA (TEST-): para cobrar señas reales va el Access Token de producción; para probar, MercadoPago recomienda las credenciales de un usuario de prueba vendedor.'
        : '';
    return (
      `MercadoPago bloqueó el pedido (403 PolicyAgent): la credencial cargada no está autorizada para ${accion}. ` +
      'Revisá, en este orden: 1) que MERCADOPAGO_ACCESS_TOKEN sea el Access Token de producción de la cuenta de SOM, ' +
      `que ${DONDE_ESTA}; 2) que las credenciales de producción de esa aplicación estén activadas; 3) que la cuenta ` +
      `esté habilitada para cobrar (identidad validada y términos aceptados).${prueba}`
    );
  }
  if (status === 403) {
    return `MercadoPago negó el acceso (403: ${detalle}). Revisá que el Access Token sea el de producción de la cuenta de SOM.`;
  }
  if (status >= 400 && status < 500) {
    return `MercadoPago rechazó el pedido (${status}: ${detalle}).`;
  }
  return `MercadoPago no respondió bien (${status}: ${detalle}). Probá de nuevo en unos minutos.`;
}

// ───────────────────────────── la cuenta (GET /users/me) ─────────────────────────────

/** Lo que importa de `GET /users/me` para cobrar (todos los campos opcionales). */
export interface CuentaMP {
  id?: number | string;
  nickname?: string;
  site_id?: string;
  tags?: string[];
  status?: {
    site_status?: string;
    mercadopago_tc_accepted?: boolean;
    required_action?: string;
    confirmed_email?: boolean;
    sell?: { allow?: boolean; codes?: string[] };
  };
}

export interface DiagnosticoCuentaMP {
  /** "cuenta 123456 (NICK), Argentina". */
  resumen: string;
  /** Lo que impide cobrar, en lenguaje llano (vacío = la cuenta no muestra problemas). */
  problemas: string[];
}

/** Revisa si la cuenta de la credencial puede cobrar la seña en pesos. */
export function diagnosticarCuentaMP(c: CuentaMP): DiagnosticoCuentaMP {
  const problemas: string[] = [];
  if (c.site_id && c.site_id !== 'MLA') {
    problemas.push(`la cuenta es de otro país (site ${c.site_id}): la seña se cobra en pesos argentinos, hace falta una cuenta de Argentina (MLA).`);
  }
  if (c.tags?.includes('test_user')) {
    problemas.push('es un usuario de PRUEBA: sirve para probar en el sandbox, no para cobrar de verdad.');
  }
  if (c.status?.site_status && c.status.site_status !== 'active') {
    problemas.push(`la cuenta no está activa (estado: ${c.status.site_status}).`);
  }
  if (c.status?.mercadopago_tc_accepted === false) {
    problemas.push('la cuenta no aceptó los términos y condiciones de MercadoPago.');
  }
  if (c.status?.confirmed_email === false) {
    problemas.push('la cuenta no confirmó su email.');
  }
  if (c.status?.required_action) {
    problemas.push(`MercadoPago pide completar una acción en la cuenta: ${c.status.required_action}.`);
  }
  if (c.status?.sell?.allow === false) {
    const codigos = c.status.sell.codes?.length ? ` (${c.status.sell.codes.join(', ')})` : '';
    problemas.push(`la cuenta no está habilitada para vender/cobrar${codigos}.`);
  }
  const quien = [c.id ? `cuenta ${c.id}` : 'cuenta', c.nickname ? `(${c.nickname})` : ''].filter(Boolean).join(' ');
  const pais = c.site_id === 'MLA' ? ', Argentina' : c.site_id ? `, site ${c.site_id}` : '';
  return { resumen: `${quien}${pais}`, problemas };
}

/** Texto final para Recepción: el error de MercadoPago más lo que se vio en la cuenta. */
export function mensajeConCuenta(base: string, cuenta: DiagnosticoCuentaMP | { error: string } | undefined): string {
  if (!cuenta) {
    return base;
  }
  if ('error' in cuenta) {
    return `${base} Con esta credencial MercadoPago tampoco deja leer la cuenta (${cuenta.error}): casi seguro no es el Access Token de la cuenta de SOM.`;
  }
  return cuenta.problemas.length
    ? `${base} En la ${cuenta.resumen}: ${cuenta.problemas.join(' ')}`
    : `${base} La ${cuenta.resumen} no muestra bloqueos: revisá que las credenciales de producción de la aplicación estén activadas.`;
}

/**
 * Estado de la credencial para Recepción, tras leer la cuenta: si funciona, de qué
 * cuenta es; si no, por qué. Se usa en el diagnóstico y cuando la seña es $0 (así se ve
 * si la credencial ya anda aunque falten los precios).
 */
export function resumenCredencial(cuenta: DiagnosticoCuentaMP | { error: string }, tipo: TipoCredencialMP): string {
  if ('error' in cuenta) {
    return (
      `La credencial de MercadoPago no funciona: MercadoPago no deja leer la cuenta (${cuenta.error}). ` +
      `Casi seguro no es el Access Token de la cuenta de SOM, que ${DONDE_ESTA}.`
    );
  }
  if (cuenta.problemas.length) {
    return `La credencial de MercadoPago es de la ${cuenta.resumen}, pero: ${cuenta.problemas.join(' ')}`;
  }
  const prueba =
    tipo === 'access-token-prueba' ? ' Es una credencial de PRUEBA (TEST-): para cobrar de verdad va la de producción.' : '';
  return `La credencial de MercadoPago funciona (${cuenta.resumen}).${prueba}`;
}
