import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACCESS_POLICIES } from '../src/fhir/access-policies.js';
import { controlarFirmaTwilio, firmaTwilio, variantesUrl } from '../src/lib/firma-twilio.js';
import {
  modoUrlWebhook,
  ocultarClaveUrl,
  problemasUrlPublica,
  problemasUrlWebhookTwilio,
  urlDirectaWebhookTwilio,
  urlPublicaWebhook,
  versionPasaEncabezados,
  WEBHOOK_MERCADOPAGO,
  WEBHOOK_TWILIO,
  WEBHOOKS,
} from '../src/lib/webhooks.js';

const BASE = 'https://api.medplum.com.ar/';
const PUBLICA = 'https://api.medplum.com.ar/webhooks/som/twilio-whatsapp';

describe('Webhooks · definición', () => {
  it('Cada webhook tiene su ruta pública, su ClientApplication y una policy del seed', () => {
    expect(WEBHOOKS.map((w) => w.ruta)).toEqual(['/webhooks/som/twilio-whatsapp', '/webhooks/som/mercadopago']);
    expect(new Set(WEBHOOKS.map((w) => w.cliente)).size).toBe(WEBHOOKS.length);
    const policies = ACCESS_POLICIES.map((p) => p.name);
    for (const w of WEBHOOKS) {
      expect(policies).toContain(w.policy);
      // La policy solo deja ejecutar su bot: nada más.
      const policy = ACCESS_POLICIES.find((p) => p.name === w.policy);
      expect(policy?.resource).toEqual([{ resourceType: 'Bot', readonly: true, criteria: `Bot?name=${w.bot}` }]);
    }
  });

  it('La plantilla de nginx tiene un bloque por webhook, con sus placeholders y sin claves', () => {
    const conf = readFileSync('deploy/nginx-webhooks-som.conf', 'utf8');
    for (const w of WEBHOOKS) {
      const bloque = conf.slice(conf.indexOf(`location = ${w.ruta} {`));
      expect(bloque, w.ruta).toMatch(new RegExp(`^location = ${w.ruta} \\{[^}]*/fhir/R4/Bot/${w.nginx.botId}/\\$\\{simbolo_pesos\\}execute`));
      expect(bloque.slice(0, bloque.indexOf('\n}'))).toContain(`"Basic ${w.nginx.basic}"`);
    }
    // Solo placeholders: ningún Basic real (base64) commiteado.
    expect(conf).not.toMatch(/Basic [A-Za-z0-9+/]{20,}={0,2}"/);
  });

  it('URL pública: el host del API + la ruta de nginx, sin credenciales', () => {
    expect(urlPublicaWebhook(BASE, WEBHOOK_TWILIO.ruta)).toBe(PUBLICA);
    expect(urlPublicaWebhook('https://api.medplum.com.ar', WEBHOOK_MERCADOPAGO.ruta)).toBe(
      'https://api.medplum.com.ar/webhooks/som/mercadopago',
    );
    expect(modoUrlWebhook(PUBLICA)).toBe('publica');
    expect(modoUrlWebhook('https://id:clave@api.medplum.com.ar/x')).toBe('directa');
    expect(modoUrlWebhook('no es url')).toBeUndefined();
  });

  it('Medplum le pasa los encabezados al bot desde la 4.2', () => {
    expect(versionPasaEncabezados('5.1.42-abc1234')).toBe(true);
    expect(versionPasaEncabezados('4.2.0')).toBe(true);
    expect(versionPasaEncabezados('4.1.9')).toBe(false);
    expect(versionPasaEncabezados('3.3.0')).toBe(false);
    expect(versionPasaEncabezados(undefined)).toBe(false);
  });
});

describe('Webhooks · qué está mal en la URL', () => {
  const esperado = { baseUrl: BASE, botId: 'bot-1', clientId: 'cli-1' };
  const directa = urlDirectaWebhookTwilio({ ...esperado, clientSecret: 's3cr3t' });

  it('La URL pública correcta no tiene problemas', () => {
    expect(problemasUrlWebhookTwilio(PUBLICA, esperado)).toEqual([]);
    expect(problemasUrlPublica('https://api.medplum.com.ar/webhooks/som/mercadopago', { baseUrl: BASE, ruta: WEBHOOK_MERCADOPAGO.ruta })).toEqual([]);
  });

  it('URL pública: otra ruta, otro host, http o con credenciales', () => {
    const ruta = WEBHOOK_MERCADOPAGO.ruta;
    expect(problemasUrlPublica(undefined, { baseUrl: BASE, ruta })).toEqual(['falta']);
    expect(problemasUrlPublica('https://api.medplum.com.ar/webhooks/mercadopago', { baseUrl: BASE, ruta })).toEqual([
      'la ruta tiene que ser /webhooks/som/mercadopago',
    ]);
    expect(problemasUrlPublica('http://otro.com/webhooks/som/mercadopago', { baseUrl: BASE, ruta })).toEqual([
      'tiene que ser https',
      'apunta a otro.com, no a api.medplum.com.ar',
    ]);
    expect(problemasUrlPublica('https://a:b@api.medplum.com.ar/webhooks/som/mercadopago', { baseUrl: BASE, ruta })).toEqual([
      expect.stringMatching(/lleva credenciales/),
    ]);
  });

  it('Sin URL => falta (el webhook rechaza todo)', () => {
    expect(problemasUrlWebhookTwilio(undefined, esperado)).toEqual([expect.stringMatching(/^falta/)]);
  });

  it('URL directa (temporal): arma el $execute con las credenciales y el prompt de basic auth', () => {
    expect(directa).toBe('https://cli-1:s3cr3t@api.medplum.com.ar/fhir/R4/Bot/bot-1/$execute?_medplum-prompt-basic-auth=1');
    expect(problemasUrlWebhookTwilio(directa, esperado)).toEqual([]);
  });

  it('URL directa: detecta cada error típico, sin mostrar la clave', () => {
    const casos: Array<[string, RegExp]> = [
      [directa.replace('https:', 'http:'), /https/],
      [directa.replace('api.medplum.com.ar', 'api.medplum.com'), /apunta a api\.medplum\.com,/],
      [directa.replace('cli-1', 'otro'), /no son las de "Webhook Twilio"/],
      [directa.replace('bot-1', 'bot-2'), /Bot\/bot-1\/\$execute/],
      [directa.replace('?_medplum-prompt-basic-auth=1', ''), /_medplum-prompt-basic-auth=1/],
    ];
    for (const [url, problema] of casos) {
      const problemas = problemasUrlWebhookTwilio(url, esperado);
      expect(problemas, url).toEqual([expect.stringMatching(problema)]);
      expect(problemas.join(' ')).not.toContain('s3cr3t');
    }
  });

  it('Para mostrarla, tapa la clave; una URL ilegible no se muestra', () => {
    expect(ocultarClaveUrl(directa)).toBe('https://cli-1:***@api.medplum.com.ar/fhir/R4/Bot/bot-1/$execute?_medplum-prompt-basic-auth=1');
    expect(ocultarClaveUrl(PUBLICA)).toBe(PUBLICA);
    expect(ocultarClaveUrl('cli:s3cr3t sin esquema')).toBe('(URL inválida)');
  });
});

describe('Firma de Twilio (X-Twilio-Signature)', () => {
  const TOKEN = 'tok';
  const params = { AccountSid: 'AC123', MessageSid: 'SM1', Body: 'Hola', From: 'whatsapp:+5491122334455' };
  const firma = firmaTwilio(TOKEN, PUBLICA, params);
  const control = (extra: Partial<Parameters<typeof controlarFirmaTwilio>[0]> = {}) =>
    controlarFirmaTwilio({ urlWebhook: PUBLICA, authToken: TOKEN, headers: { 'x-twilio-signature': firma }, input: params, ...extra });

  it('Coincide con el ejemplo oficial del SDK de Twilio', () => {
    const oficial = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
    expect(firmaTwilio('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', oficial)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });

  it('URL pública bien firmada => entra (también si Medplum lo pasó como texto)', () => {
    expect(control()).toEqual({ ok: true });
    expect(control({ input: new URLSearchParams(params).toString() })).toEqual({ ok: true });
    expect(control({ headers: { 'X-Twilio-Signature': [firma] } })).toEqual({ ok: true });
  });

  it('Twilio pudo firmar la URL con el puerto por defecto', () => {
    expect(variantesUrl(PUBLICA)).toEqual([PUBLICA, 'https://api.medplum.com.ar:443/webhooks/som/twilio-whatsapp']);
    expect(variantesUrl('https://h.com:443/x')).toEqual(['https://h.com:443/x', 'https://h.com/x']);
    expect(variantesUrl('https://h.com:8443/x')).toEqual(['https://h.com:8443/x']);
    const conPuerto = firmaTwilio(TOKEN, 'https://api.medplum.com.ar:443/webhooks/som/twilio-whatsapp', params);
    expect(control({ headers: { 'x-twilio-signature': conPuerto } })).toEqual({ ok: true });
  });

  it('Falla cerrado: sin firma, firma de otro, parámetros tocados o sin encabezados (Medplum < 4.2)', () => {
    expect(control({ headers: {} })).toMatchObject({ ok: false, motivo: expect.stringMatching(/no trae la firma/) });
    expect(control({ headers: { 'x-twilio-signature': firmaTwilio('otro-token', PUBLICA, params) } })).toMatchObject({
      ok: false,
      motivo: expect.stringMatching(/no coincide/),
    });
    expect(control({ input: { ...params, Body: 'Otro texto' } })).toMatchObject({ ok: false });
    expect(control({ headers: undefined })).toMatchObject({ ok: false, motivo: expect.stringMatching(/4\.2/) });
    expect(control({ authToken: undefined })).toMatchObject({ ok: false, motivo: expect.stringMatching(/TWILIO_AUTH_TOKEN/) });
    expect(control({ urlWebhook: undefined })).toMatchObject({ ok: false, motivo: expect.stringMatching(/TWILIO_WEBHOOK_URL/) });
  });

  it('URL directa (temporal): la autenticación ya la hizo Medplum, no exige firma', () => {
    expect(control({ urlWebhook: 'https://id:clave@api.medplum.com.ar/fhir/R4/Bot/b/$execute', headers: undefined })).toEqual({ ok: true });
  });

  it('Los motivos nunca muestran el token ni la firma', () => {
    const r = control({ headers: { 'x-twilio-signature': 'firma-falsa' } });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain('firma-falsa');
  });
});
