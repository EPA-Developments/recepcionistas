/**
 * Plantillas de WhatsApp (Meta) de Segunda Opinión Médica.
 *
 * WhatsApp solo deja que el negocio escriba primero —o pasadas 24 h del último mensaje del
 * paciente— con una **plantilla aprobada por Meta**; con texto libre, Twilio lo acepta pero
 * no llega (error 63016). Cada plantilla se crea en la cuenta de Twilio de SOM (Content API)
 * y se manda a aprobación con `npm run whatsapp:plantillas -- --aplicar`; aprobada, su
 * `ContentSid` (HX…) queda en el Project Secret indicado y los bots la usan solos
 * (`lib/plantillas-whatsapp.ts` → `elegirPlantilla`). Sin ese secret, el mensaje sale con la
 * genérica; sin ninguna, como texto libre (llega solo dentro de la ventana de 24 h).
 *
 * Tres familias:
 *  - **Avisos** al paciente (`avisos` = la clave `template` con que los mandan los bots):
 *    el cuerpo es, palabra por palabra, el texto que ya arma `lib/avisos.ts` /
 *    `lib/onboarding.ts`, con las partes variables como {{n}}. Así el paciente recibe el
 *    mismo texto de hoy y la plantilla se elige sola comparando el texto con el cuerpo
 *    (`variablesSegunPlantilla`). Un aviso con una nota opcional al final (videollamada,
 *    laboratorio) tiene dos plantillas: sin y con nota, porque Meta no admite una variable
 *    vacía. Un aviso sin plantilla específica (los internos a Recepción, el informe SOM)
 *    sale con la genérica `som_aviso`.
 *  - **Respuestas automáticas** (`bienvenida`, `acuse`, `fuera-de-horario`): salen dentro
 *    de la ventana que abrió el paciente, así que la plantilla no es obligatoria; con ella
 *    aprobada, igual salen con plantilla (Meta revisó el texto y una UTILITY dentro de la
 *    ventana no tiene costo). La bienvenida tiene dos: en horario y fuera de horario.
 *  - **Mensaje nuevo** (`mensaje-nuevo`): cuando Recepción responde con la ventana cerrada,
 *    el paciente recibe este aviso; su respuesta se reenvía cuando él contesta.
 *
 * Reglas de Meta que valida `problemasPlantilla`: nombre en minúsculas/números/guiones
 * bajos, el cuerpo no empieza ni termina con una variable, variables {{1}}, {{2}}… en
 * orden y nunca dos seguidas, un ejemplo por variable, hasta 1024 caracteres. Una
 * plantilla de Twilio no se edita: para cambiar un texto se crea otra con otro nombre.
 * Los textos los aprueban los médicos de SOM antes de `--aplicar`
 * (docs/decisiones-pendientes.md).
 */
import {
  TEXTO_ACUSE,
  TEXTO_BIENVENIDA,
  TEXTO_MENSAJE_NUEVO,
  textoBienvenidaFueraDeHorario,
  textoFueraDeHorario,
} from './auto-respuesta.js';
import { NOMBRE_PLAN_BIENESTAR } from './plan-bienestar.js';

export interface PlantillaWhatsApp {
  /** Clave interna. */
  clave: string;
  /** Nombre en Twilio y Meta: minúsculas, números y guiones bajos. */
  nombre: string;
  categoria: 'UTILITY';
  /** Código de idioma de Meta. */
  idioma: string;
  /** Texto con variables {{1}}, {{2}}…; no puede empezar ni terminar con una. */
  cuerpo: string;
  /** Un ejemplo por variable: Meta lo pide para aprobarla. */
  ejemplo: Record<string, string>;
  /** Project Secret con el ContentSid (HX…) una vez aprobada. */
  secret: string;
  /**
   * Con qué sale: las claves `template` de los avisos (`enviarWhatsApp`) o de las
   * respuestas automáticas que usan esta plantilla. Sin `avisos`, es la genérica.
   */
  avisos?: readonly string[];
  /**
   * Cómo se ajusta un texto para que entre en esta plantilla cuando ninguna del aviso lo
   * reconoce tal cual (p. ej. la invitación sin el nombre en el saludo). Lo que recibe el
   * paciente, y lo que queda registrado, es el texto ajustado.
   */
  adaptar?: (texto: string) => string;
}

const SOM = 'Segunda Opinión Médica';
const FECHA = 'lunes, 28/09, 10:00';
const NOTA_VIDEOLLAMADA = 'Es por videollamada: te mandamos el link antes del turno.';

function plantilla(
  clave: string,
  cuerpo: string,
  ejemplo: Record<string, string>,
  avisos?: readonly string[],
): PlantillaWhatsApp {
  return {
    clave,
    nombre: `som_${clave}`,
    categoria: 'UTILITY',
    idioma: 'es_AR',
    cuerpo,
    ejemplo,
    secret: `TWILIO_CONTENT_SID_${clave.toUpperCase()}`,
    ...(avisos ? { avisos } : {}),
  };
}

/**
 * La genérica: el texto fijo envuelve cualquier aviso que arma `lib/avisos.ts` (sin la
 * firma inicial ni el 💙 final, que los pone la plantilla). Es el respaldo de todos los
 * avisos que no tienen plantilla propia o cuya propia no está aprobada todavía.
 */
export const PLANTILLA_AVISO: PlantillaWhatsApp = plantilla(
  'aviso',
  SOM + ': {{1}} Si tenés dudas, respondé este mensaje. 💙',
  {
    '1': '¡tu turno quedó confirmado! Consulta de Cardiología el lunes 28/09 a las 10:00. Recibimos la seña de $75.000. ¡Te esperamos!',
  },
);

/** Avisos de turnos al paciente (`lib/avisos.ts`). */
const PLANTILLAS_TURNOS: readonly PlantillaWhatsApp[] = [
  plantilla(
    'turno_confirmado',
    SOM + ': ¡tu turno quedó confirmado! {{1}}. Recibimos la seña de ${{2}}. {{3}} 💙',
    { '1': 'Consulta de Cardiología, ' + FECHA, '2': '75.000', '3': '¡Te esperamos!' },
    ['turno-confirmado'],
  ),
  plantilla(
    'recordatorio',
    SOM + ': te recordamos tu {{1}} el {{2}}. {{3}} 💙',
    { '1': 'turno de consulta de Cardiología', '2': FECHA, '3': '¡Te esperamos!' },
    ['recordatorio-48h'],
  ),
  plantilla(
    'recordatorio_hoy',
    SOM + ': ¡tu {{1}} es hoy a las {{2}}! {{3}} 💙',
    { '1': 'turno de consulta de Cardiología', '2': '10:00', '3': 'Te esperamos en un rato.' },
    ['recordatorio-2h'],
  ),
  plantilla(
    'reserva_tentativa',
    SOM + ': reservamos tu {{1}} para el {{2}} (tentativo). Aboná la seña del 50% para confirmarlo. 💙',
    { '1': 'consulta de Cardiología', '2': FECHA },
    ['reserva-tentativa'],
  ),
  plantilla(
    'reserva_tentativa_nota',
    SOM + ': reservamos tu {{1}} para el {{2}} (tentativo). Aboná la seña del 50% para confirmarlo. {{3}} 💙',
    { '1': 'teleconsulta de Cardiología', '2': FECHA, '3': NOTA_VIDEOLLAMADA },
    ['reserva-tentativa'],
  ),
  plantilla(
    'consulta_plan_confirmada',
    SOM + ': confirmamos tu {{1}} para el {{2}}. Está incluida en tu plan. 💙',
    { '1': 'consulta del Plan Bienestar 100 Días (día 30)', '2': FECHA },
    ['consulta-plan-confirmada'],
  ),
  plantilla(
    'consulta_plan_confirmada_nota',
    SOM + ': confirmamos tu {{1}} para el {{2}}. Está incluida en tu plan. {{3}} 💙',
    { '1': 'consulta del Plan Bienestar 100 Días (día 30)', '2': FECHA, '3': NOTA_VIDEOLLAMADA },
    ['consulta-plan-confirmada'],
  ),
  plantilla(
    'reserva_portal_sena',
    SOM +
      ': reservamos tu {{1}} para el {{2}}. Te guardamos el horario hasta las {{3}}: pagá la seña de {{4}} en {{5}} y queda confirmado. 💙',
    { '1': 'consulta de Cardiología', '2': FECHA, '3': '12:30', '4': '$75.000', '5': 'https://mpago.la/abc' },
    ['reserva-portal-sena'],
  ),
  plantilla(
    'reserva_portal_sena_nota',
    SOM +
      ': reservamos tu {{1}} para el {{2}}. Te guardamos el horario hasta las {{3}}: pagá la seña de {{4}} en {{5}} y queda confirmado. {{6}} 💙',
    {
      '1': 'teleconsulta de Cardiología',
      '2': FECHA,
      '3': '12:30',
      '4': '$75.000',
      '5': 'https://mpago.la/abc',
      '6': 'Es por videollamada: te mandamos el link al confirmarse.',
    },
    ['reserva-portal-sena'],
  ),
  plantilla(
    'reserva_vencida',
    SOM + ': no recibimos la seña de tu {{1}} del {{2}} y el horario se liberó. Podés elegir otro desde el portal. 💙',
    { '1': 'consulta de Cardiología', '2': FECHA },
    ['reserva-vencida'],
  ),
];

/** Avisos del Plan Bienestar 100 Días® (`lib/avisos.ts` → `avisoConsultaPlan`). */
const PLANTILLAS_PLAN: readonly PlantillaWhatsApp[] = [
  plantilla(
    'plan_consulta_apertura',
    SOM +
      ': ya podés agendar tu {{1}} del ' +
      NOMBRE_PLAN_BIENESTAR +
      ' ({{2}}). Está incluida en tu plan y puede ser presencial o por videollamada. Pedila desde el portal o respondé este mensaje. 💙',
    { '1': 'consulta del día 30', '2': 'entre el 25 de octubre y el 5 de noviembre' },
    ['plan-bienestar-apertura'],
  ),
  plantilla(
    'plan_consulta_pendiente',
    SOM +
      ': todavía no agendaste tu {{1}} del ' +
      NOMBRE_PLAN_BIENESTAR +
      ': se hace {{2}}. Está incluida en tu plan y puede ser presencial o por videollamada. Pedila desde el portal o respondé este mensaje. 💙',
    { '1': 'consulta del día 30', '2': 'entre el 25 de octubre y el 5 de noviembre' },
    ['plan-bienestar-mitad'],
  ),
];

/** Cuerpo de la invitación al portal (`lib/onboarding.ts` → `mensajeInvitacion`), desde el saludo. */
const INVITACION =
  ' Te damos la bienvenida a Segunda Opinión Médica 💙\n\n' +
  'Activá tu acceso al portal para ver tus turnos, tu plan, tus pagos y tus estudios. ' +
  'Entrá a este link y elegí tu contraseña:\n\n{{LINK}}\n\n' +
  'Después vas a poder ingresar siempre desde:\n{{PORTAL}}\n\n' +
  '📲 Te recomendamos "Añadir a pantalla de inicio" para abrirlo como una app:\n' +
  '• iPhone (Safari): tocá Compartir → "Añadir a pantalla de inicio".\n' +
  '• Android (Chrome): tocá el menú ⋮ → "Añadir a pantalla de inicio".\n\n' +
  'Si no solicitaste esto, podés ignorar este mensaje.';

const EJEMPLO_LINK = 'https://app.segundaopinionmedica.org/setpassword/abc123/def456';
const EJEMPLO_PORTAL = 'https://app.segundaopinionmedica.org';

/**
 * La invitación al portal es el aviso que más necesita plantilla: un paciente nuevo nunca
 * escribió al WhatsApp de SOM, así que sin plantilla la invitación no llega nunca.
 *
 * Sale sin el nombre en el saludo: la versión con el nombre (`som_invitacion_portal`,
 * «¡Hola {{1}}!…») la rechazó Meta el 28/09/2026 sin decir por qué, así que esta la
 * reemplaza para todos (`adaptar` saca el nombre del saludo). El mail y el QR siguen con
 * el nombre.
 */
const PLANTILLAS_INVITACION: readonly PlantillaWhatsApp[] = [
  {
    ...plantilla(
      'invitacion_portal_sin_nombre',
      '¡Hola!' + INVITACION.replace('{{LINK}}', '{{1}}').replace('{{PORTAL}}', '{{2}}'),
      { '1': EJEMPLO_LINK, '2': EJEMPLO_PORTAL },
      ['invitacion-portal'],
    ),
    adaptar: (texto) => texto.replace(/^(\s*)¡Hola [^!\n]+!/u, '$1¡Hola!'),
  },
];

/** Respuestas automáticas y el aviso de mensaje nuevo (`config/auto-respuesta.ts`). */
const PLANTILLAS_MENSAJES: readonly PlantillaWhatsApp[] = [
  plantilla('bienvenida', TEXTO_BIENVENIDA, {}, ['bienvenida']),
  plantilla(
    'bienvenida_fuera_de_horario',
    textoBienvenidaFueraDeHorario('{{1}}'),
    { '1': 'lunes a viernes de 8 a 22 y sábados de 8 a 20' },
    ['bienvenida'],
  ),
  plantilla('acuse', TEXTO_ACUSE, {}, ['acuse']),
  plantilla(
    'fuera_de_horario',
    textoFueraDeHorario('{{1}}'),
    { '1': 'lunes a viernes de 8 a 22 y sábados de 8 a 20' },
    ['fuera-de-horario'],
  ),
  plantilla('mensaje_nuevo', TEXTO_MENSAJE_NUEVO, {}, ['mensaje-nuevo']),
];

export const PLANTILLAS_WHATSAPP: readonly PlantillaWhatsApp[] = [
  PLANTILLA_AVISO,
  ...PLANTILLAS_TURNOS,
  ...PLANTILLAS_PLAN,
  ...PLANTILLAS_INVITACION,
  ...PLANTILLAS_MENSAJES,
];
