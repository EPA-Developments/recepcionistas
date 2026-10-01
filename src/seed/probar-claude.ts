/**
 * Prueba la API de Claude con la misma clave y el mismo pedido que usan los bots.
 *
 *   npm run claude:probar                          → clave, modelos y una respuesta corta
 *   npm run claude:probar -- ruta/al/estudio.pdf   → además lee ese PDF como el bot de laboratorio
 *
 * La clave sale de ANTHROPIC_API_KEY en la terminal (o en el .env local): la misma que el
 * Project Secret de Medplum. No escribe nada en Medplum. El PDF SÍ se manda a Claude: usá
 * uno de prueba o de un paciente que firmó el consentimiento. El catálogo de analitos es el
 * del seed (no hace falta conectarse a Medplum). Ver docs/bots.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { textoRespuesta } from '../bots/_claude.js';
import { MODELO_CLAUDE_BORRADOR, MODELO_CLAUDE_LABORATORIO, MODELO_CLAUDE_SOM } from '../fhir/identifiers.js';
import { catalogoDesdeObservationDefinitions, normalizarExtraccion, pareceUnPdf, pedidoExtraccionLaboratorio } from '../lib/laboratorio.js';
import { LIMITE_BOT_SEGUNDOS, explicarErrorClaude, lineaAnalito, veredictoTiempo } from '../lib/probar-claude.js';
import { usoDeRespuesta } from '../lib/uso-ia.js';
import { buildSeed } from './builders.js';

/** Límite de la API para un pedido (el PDF va en base64 dentro del JSON). */
const MAX_PDF_BYTES = 32 * 1024 * 1024;

let fallas = 0;
const ok = (texto: string) => console.log(`  ✓ ${texto}`);
const falla = (texto: string) => {
  fallas += 1;
  console.log(`  ✗ ${texto}`);
};
const segundosDesde = (t0: number) => (Date.now() - t0) / 1000;
const errorDe = (err: unknown) =>
  explicarErrorClaude(err instanceof Anthropic.APIError ? err.status : undefined, err instanceof Error ? err.message : String(err));
const costo = (usd: number | undefined) => (usd === undefined ? '' : ` · ≈ US$ ${usd.toFixed(4)}`);

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "Falta ANTHROPIC_API_KEY. En esta terminal: export ANTHROPIC_API_KEY='sk-ant-…' (la misma del secret de Medplum; no la subas al repo).",
    );
    process.exitCode = 1;
    return;
  }
  const rutaPdf = process.argv[2];
  // Sin reintentos y con el límite del bot: el tiempo medido es el de un intento.
  const claude = new Anthropic({ apiKey, maxRetries: 0, timeout: LIMITE_BOT_SEGUNDOS * 1000 });
  console.log('Claude · prueba de la API');

  // 1) La clave y los modelos que usan los bots.
  console.log('\n1. Clave y modelos');
  const modelos = new Map<string, string[]>();
  for (const [modelo, uso] of [
    [MODELO_CLAUDE_LABORATORIO, 'laboratorio'],
    [MODELO_CLAUDE_BORRADOR, 'borrador de Mensajes'],
    [MODELO_CLAUDE_SOM, 'informe SOM'],
  ] as const) {
    modelos.set(modelo, [...(modelos.get(modelo) ?? []), uso]);
  }
  for (const [modelo, usos] of modelos) {
    try {
      const info = await claude.models.retrieve(modelo);
      ok(`${modelo} (${info.display_name}) · lo usa: ${usos.join(', ')}`);
    } catch (err) {
      falla(`${modelo}: ${errorDe(err)}`);
      if (err instanceof Anthropic.AuthenticationError) {
        console.log('\nSin una clave válida no tiene sentido seguir.');
        process.exitCode = 1;
        return;
      }
    }
  }

  // 2) Una respuesta corta: ¿contesta y cuánto tarda?
  console.log('\n2. Respuesta corta');
  try {
    const t0 = Date.now();
    const resp = await claude.messages.create({
      model: MODELO_CLAUDE_LABORATORIO,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Respondé solo: ok' }],
    });
    const uso = usoDeRespuesta(resp, MODELO_CLAUDE_LABORATORIO);
    if (resp.stop_reason === 'refusal') {
      falla(`el modelo declinó (stop_reason refusal) en ${segundosDesde(t0).toFixed(1)} s`);
    } else {
      ok(
        `respondió "${textoRespuesta(resp.content).trim().slice(0, 40)}" en ${segundosDesde(t0).toFixed(1)} s` +
          ` · ${uso.tokensEntrada} + ${uso.tokensSalida} tokens${costo(uso.costoUsd)}`,
      );
    }
  } catch (err) {
    falla(errorDe(err));
  }

  // 3) Opcional: el PDF, con el mismo pedido que el bot de laboratorio.
  if (rutaPdf) {
    console.log(`\n3. Lectura del PDF como el bot (${MODELO_CLAUDE_LABORATORIO}) · ${rutaPdf}`);
    let bytes: Buffer | undefined;
    try {
      bytes = readFileSync(rutaPdf);
    } catch (err) {
      falla(`no pude leer el archivo: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (bytes && !pareceUnPdf(bytes)) {
      falla('el archivo no es un PDF (no tiene la firma %PDF-).');
    } else if (bytes && bytes.length > MAX_PDF_BYTES) {
      falla(`pesa ${(bytes.length / 1024 / 1024).toFixed(1)} MB: la API acepta hasta 32 MB por pedido.`);
    } else if (bytes) {
      const catalogo = catalogoDesdeObservationDefinitions(buildSeed().observationDefinitions);
      const t0 = Date.now();
      try {
        const resp = await claude.beta.messages.create(pedidoExtraccionLaboratorio(bytes.toString('base64'), catalogo));
        const segundos = segundosDesde(t0);
        const uso = usoDeRespuesta(resp, MODELO_CLAUDE_LABORATORIO);
        const tiempo = veredictoTiempo(segundos);
        (tiempo.ok ? ok : falla)(`${tiempo.texto} · ${uso.tokensEntrada} + ${uso.tokensSalida} tokens${costo(uso.costoUsd)}`);
        if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') {
          falla(`lectura incompleta (stop_reason ${resp.stop_reason}): el bot lo pasaría al equipo.`);
        } else {
          const ext = normalizarExtraccion(JSON.parse(textoRespuesta(resp.content)), catalogo);
          if (!ext.esInformeDeLaboratorio || ext.analitos.length === 0) {
            falla(`Claude no encontró resultados (¿es un informe de laboratorio?): el bot lo pasaría al equipo.`);
          } else {
            ok(
              `${ext.analitos.length} valor(es)` +
                `${ext.laboratorio ? ` · ${ext.laboratorio}` : ''}${ext.fechaExtraccion ? ` · extracción ${ext.fechaExtraccion}` : ''}`,
            );
            ext.analitos.slice(0, 15).forEach((a) => console.log(`      · ${lineaAnalito(a)}`));
            if (ext.analitos.length > 15) {
              console.log(`      … y ${ext.analitos.length - 15} más`);
            }
          }
        }
      } catch (err) {
        falla(`${errorDe(err)} (después de ${segundosDesde(t0).toFixed(1)} s)`);
      }
    }
  } else {
    console.log('\n(Para medir un PDF real como el bot: npm run claude:probar -- ruta/al/estudio.pdf)');
  }

  console.log(fallas ? `\n✗ ${fallas} problema(s): el detalle está arriba.` : '\n✓ La API de Claude responde con esta clave.');
  if (fallas) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Prueba de Claude: falló:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
