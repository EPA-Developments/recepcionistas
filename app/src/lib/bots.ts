import type { Invoice } from '@medplum/fhirtypes';
import { medplum } from '../medplum';

/**
 * Toda la inteligencia vive en los Bots: el front solo orquesta. Estas funciones
 * invocan los Bots de Medplum por nombre. Si el bot no está desplegado todavía,
 * lanzan un error claro (no se calcula nada en el front).
 */

export interface ItemCobroInput {
  tipo: 'servicio';
  codigo: string;
  ocupantes?: number;
  cantidad?: number;
}

/** Extrae un mensaje legible de un error de bot (que suele venir como JSON con stack). */
export function mensajeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  try {
    const o = JSON.parse(raw) as { errorMessage?: string };
    if (o && typeof o.errorMessage === 'string') {
      return o.errorMessage;
    }
  } catch {
    // no era JSON
  }
  return raw;
}

async function botIdPorNombre(nombre: string): Promise<string> {
  // `name:exact`: `name=` busca por prefijo en FHIR (un bot podría tapar a otro).
  const bot = await medplum.searchOne('Bot', `name:exact=${nombre}`);
  if (!bot?.id) {
    throw new Error(
      `El bot "${nombre}" no está desplegado todavía. Desplegá los bots (npm run deploy:bots) para activar esta función.`,
    );
  }
  return bot.id;
}

/** Llama al bot de cobro y devuelve el Invoice calculado (total en ARS, splits, TC). */
export async function calcularCobro(items: ItemCobroInput[], pacienteRef?: string): Promise<Invoice> {
  const id = await botIdPorNombre('som-calcular-cobro');
  return (await medplum.executeBot(id, { items, pacienteRef, persistir: false })) as Invoice;
}

export interface ReservaInput {
  pacienteRef: string;
  servicioCodigo: string;
  recursoCodigo: string;
  /** Inicio del turno en ISO (con offset de Argentina). */
  inicio: string;
  ocupantes?: number;
  /** Si es false, solo valida (no crea). */
  confirmar?: boolean;
  /** Tarea de Recepción que resuelve el turno (control del programa GLP-1). */
  tareaId?: string;
}

export interface IssueValidacion {
  regla: string;
  nivel: string;
  mensaje: string;
}

export interface ResultadoReserva {
  ok: boolean;
  bloqueos: IssueValidacion[];
  advertencias: IssueValidacion[];
  creado: boolean;
  appointmentId?: string;
  slotId?: string;
}

/** Llama al bot de reserva: valida y (si confirma) crea el turno + Slot ocupado. */
export async function reservarTurno(input: ReservaInput): Promise<ResultadoReserva> {
  const id = await botIdPorNombre('som-reservar-turno');
  return (await medplum.executeBot(id, input)) as ResultadoReserva;
}

/** Envía un WhatsApp (y registra Communication). Best-effort: usado para avisos puntuales. */
export async function enviarWhatsApp(input: { pacienteRef: string; template: string; body: string }): Promise<void> {
  const id = await botIdPorNombre('som-enviar-whatsapp');
  await medplum.executeBot(id, input);
}

export type EstadoTurno = 'arrived' | 'checked-in' | 'fulfilled' | 'cancelled';

/** Cambia el estado de un turno (check-in/out): el bot actualiza Appointment + Encounter + Slot. */
export async function cambiarEstadoTurno(appointmentId: string, estado: EstadoTurno): Promise<void> {
  const id = await botIdPorNombre('som-estado-turno');
  await medplum.executeBot(id, { appointmentId, estado });
}

export interface ResultadoSena {
  ok: boolean;
  mensaje?: string;
  totalARS?: number;
  senaARS?: number;
  invoiceId?: string;
  confirmados?: number;
}

/** Registra la seña (50%), confirma el turno y dispara el WhatsApp de confirmación. */
export async function pagarSena(appointmentId: string, medioPago: string): Promise<ResultadoSena> {
  const id = await botIdPorNombre('som-pagar-sena');
  return (await medplum.executeBot(id, { appointmentId, medioPago })) as ResultadoSena;
}

export interface ResultadoLinkMP {
  ok: boolean;
  mensaje?: string;
  senaARS?: number;
  url?: string;
}

/** Genera un link de MercadoPago para pagar la seña. */
export async function linkMercadoPago(appointmentId: string): Promise<ResultadoLinkMP> {
  const id = await botIdPorNombre('som-link-mercadopago');
  return (await medplum.executeBot(id, { appointmentId })) as ResultadoLinkMP;
}

export interface AltaPacienteInput {
  nombre?: string;
  firstName?: string;
  lastName?: string;
  dni?: string;
  email?: string;
  telefono?: string;
  tipoCliente?: string;
  /** Origen del lead para el CRM (red social / utm_source). */
  origenLead?: string;
}

export interface ResultadoAltaPaciente {
  ok: boolean;
  mensaje?: string;
  patientId?: string;
  creado?: boolean;
}

/** Da de alta (o actualiza, sin duplicar) el paciente. No le da acceso al portal. */
export async function altaPaciente(input: AltaPacienteInput): Promise<ResultadoAltaPaciente> {
  const id = await botIdPorNombre('som-alta-paciente');
  return (await medplum.executeBot(id, input)) as ResultadoAltaPaciente;
}

export type CanalInvitacion = 'whatsapp' | 'email' | 'qr';

export interface ResultadoInvitarPaciente {
  ok: boolean;
  mensaje?: string;
  canal?: CanalInvitacion;
  membershipId?: string;
  link?: string;
  enviado?: boolean;
}

/** Origen del paciente invitado: Recepción o derivación de un colega (Patient Journey del portal). */
export type OrigenPaciente = 'reception' | 'referral';

/** Invita al paciente al portal por el canal elegido (WhatsApp / email / QR). */
export async function invitarPaciente(
  pacienteRef: string,
  canal: CanalInvitacion,
  email?: string,
  origen?: OrigenPaciente,
): Promise<ResultadoInvitarPaciente> {
  const id = await botIdPorNombre('som-invitar-paciente');
  return (await medplum.executeBot(id, { pacienteRef, canal, email, origen })) as ResultadoInvitarPaciente;
}

export interface ResultadoInscripcionGlp1 {
  ok: boolean;
  mensaje?: string;
  /** `indicacion-pendiente`: el equipo médico tiene que cargar la indicación. `activo`: el programa ya está armado. */
  estado?: 'indicacion-pendiente' | 'activo';
  /** true si se dejó ahora la tarea de indicación al equipo médico. */
  creado?: boolean;
  taskId?: string;
  controlesPorAgendar?: number;
}

/**
 * Inscribe al paciente en el seguimiento GLP-1: deja la indicación pendiente al
 * equipo médico (sin duplicar). El calendario de controles lo arma el sistema
 * cuando el médico carga el esquema; Recepción solo agenda.
 */
export async function inscribirGlp1(pacienteRef: string): Promise<ResultadoInscripcionGlp1> {
  const id = await botIdPorNombre('som-glp1-inscribir');
  return (await medplum.executeBot(id, { pacienteRef })) as ResultadoInscripcionGlp1;
}

export interface ResultadoInscripcionBienestar {
  ok: boolean;
  mensaje?: string;
  /** true si se inscribió ahora; false si ya estaba inscripto. */
  creado?: boolean;
  carePlanId?: string;
  /** Día 1 y fin del plan (AAAA-MM-DD), calculados por el bot. */
  inicio?: string;
  fin?: string;
}

/**
 * Inscribe al paciente en el Plan Bienestar de 100 días (idempotente). El bot arma
 * el plan que ve el paciente en el portal; Recepción no calcula fechas.
 */
export async function inscribirBienestar(pacienteRef: string): Promise<ResultadoInscripcionBienestar> {
  const id = await botIdPorNombre('som-bienestar-inscribir');
  return (await medplum.executeBot(id, { pacienteRef })) as ResultadoInscripcionBienestar;
}

export interface ResultadoBorradorBot {
  /** Texto sugerido para responder. Ausente si conviene que lo escriba una persona. */
  borrador?: string;
  /** Por qué no hay borrador (tema clínico, nada pendiente, API caída…). */
  motivo?: string;
}

/**
 * Pide el borrador de la próxima respuesta de una conversación de Mensajes
 * (som-borrador-respuesta). Solo SUGIERE: el texto cae en el campo de respuesta y la
 * recepcionista decide si lo manda, lo corrige o lo descarta.
 */
export async function borradorRespuesta(hiloId: string): Promise<ResultadoBorradorBot> {
  const id = await botIdPorNombre('som-borrador-respuesta');
  return (await medplum.executeBot(id, { hiloId })) as ResultadoBorradorBot;
}
