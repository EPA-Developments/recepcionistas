/**
 * Bot · Reservar turno.
 *
 * Valida un turno propuesto (R-07 capacidad, R-13 ventana, R-21 modalidad y
 * consentimiento de teleconsulta) y, si está OK, crea el Appointment + un Slot ocupado
 * (para que la agenda lo refleje). Toda la decisión vive acá; el front solo manda la
 * propuesta.
 *
 * Modalidad (R-21): la da el recurso — la agenda virtual es teleconsulta, el resto es
 * presencial. En teleconsulta el turno lleva el link de la videollamada (Jitsi de SOM,
 * Project Secret `JITSI_BASE_URL`) y exige el consentimiento de teleconsulta firmado.
 *
 * Programas: con `tareaId`, el turno resuelve una tarea de Recepción:
 *  - control GLP-1 (R-19): valida la ventana del control;
 *  - consulta del Plan Bienestar 100 Días® (R-20): valida su ventana y, si es la
 *    inicial, corre el plan a esa fecha (día 1) y recalcula las otras dos. Está incluida
 *    en el plan: el turno queda confirmado, sin seña.
 * El control GLP-1 y la consulta del plan sin su tarea se bloquean. Una consulta por
 * especialidad (con cargo) de un paciente con el plan activo queda ligada al plan.
 */
import { randomBytes } from 'node:crypto';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, AppointmentParticipant, CarePlan, Extension, Reference, Slot, Task } from '@medplum/fhirtypes';
import type { Modalidad, Servicio } from '../domain/types.js';
import { getServicio, nombreSegunModalidad } from '../config/catalogo.js';
import { RECURSOS_POR_CODIGO, modalidadDeRecurso } from '../config/recursos.js';
import type { PerfilReserva } from '../config/reglas.js';
import { COD, EXT, SYSTEM } from '../fhir/identifiers.js';
import { avisoReserva } from '../lib/avisos.js';
import { validarControlSinTarea, validarTareaAgenda, validarVentanaControl } from '../lib/glp1-plan.js';
import {
  dentroDelPlan,
  esTareaConsultaPlan,
  leerTareaConsultaPlan,
  planTrasAgendar,
  sumarConsultaExtra,
  tareasARecalcular,
  tituloConsultaPlan,
  construirTareasPlanBienestar,
  calendarioPlanBienestar,
  validarConsultaPlanSinTarea,
  validarTareaConsultaPlan,
  validarVentanaConsultaPlan,
  type DatosConsultaPlan,
} from '../lib/plan-bienestar.js';
import { diaLocal, estadoTarea, type Ventana } from '../lib/programas.js';
import { combinar, validarRecursos, validarVentanaReserva, type ReservaRecurso, type ResultadoValidacion } from '../lib/reglas-turno.js';
import {
  extensionModalidad,
  nombreSalaJitsi,
  urlTeleconsulta,
  validarConsentimientoTeleconsulta,
  validarModalidadServicio,
} from '../lib/teleconsulta.js';
import { cargarReservasDelDia, enviarWhatsApp, scheduleIdDeRecurso, tieneConsentimientoTeleconsulta } from './_shared.js';

const SNOMED = 'http://snomed.info/sct';

export interface EntradaReserva {
  pacienteRef: string; // "Patient/123"
  servicioCodigo: string;
  recursoCodigo: string;
  /** Inicio del turno en ISO (con offset de Argentina). */
  inicio: string;
  /** Modalidad que se quiere (R-21). Si se manda, tiene que coincidir con la del recurso. */
  modalidad?: Modalidad;
  ocupantes?: number;
  /** Perfil para la ventana de reserva (R-13). Si se omite, no se limita. */
  perfil?: PerfilReserva;
  /** Si es false, solo valida (no crea). Default true. */
  confirmar?: boolean;
  /** Tarea de Recepción que este turno resuelve (control GLP-1 o consulta del Plan Bienestar). */
  tareaId?: string;
}

export interface ResultadoReserva extends ResultadoValidacion {
  creado: boolean;
  appointmentId?: string;
  slotId?: string;
  modalidad?: Modalidad;
  /** Link de la videollamada (teleconsulta). */
  teleconsultaUrl?: string;
  /** Incluida en el Plan Bienestar: el turno queda confirmado, sin seña. */
  incluida?: boolean;
}

export interface ContextoReserva {
  servicio: Servicio;
  inicio: Date;
  fin: Date;
  recursoCodigo: string;
  /** Turnos ya ocupados (de hoy), de todos los recursos, para capacidad. */
  reservasExistentes: ReservaRecurso[];
  perfil?: PerfilReserva;
  ahora: Date;
  /** Ventana del control que se agenda (programa GLP-1, R-19). */
  ventanaControl?: Ventana;
  /** Consulta del Plan Bienestar que se agenda (R-20). */
  consultaPlan?: Pick<DatosConsultaPlan, 'titulo' | 'ventana'>;
  /** Modalidad pedida (R-21); si falta, la del recurso. */
  modalidad?: Modalidad;
  /** ¿El paciente firmó el consentimiento de teleconsulta? (R-21). */
  consentimientoTeleconsulta?: boolean;
}

/** Validación pura de una reserva (sin FHIR). Reúne las reglas aplicables. */
export function validarReserva(ctx: ContextoReserva): ResultadoValidacion {
  const partes: ResultadoValidacion[] = [];

  // No se puede reservar en el pasado.
  if (ctx.inicio.getTime() <= ctx.ahora.getTime()) {
    partes.push({
      ok: false,
      bloqueos: [{ regla: 'R-13', nivel: 'bloqueo', mensaje: 'El turno está en el pasado.' }],
      advertencias: [],
    });
  }

  const recurso = RECURSOS_POR_CODIGO.get(ctx.recursoCodigo);
  if (!recurso) {
    partes.push({
      ok: false,
      bloqueos: [{ regla: 'R-07', nivel: 'bloqueo', mensaje: `El recurso ${ctx.recursoCodigo} no existe.` }],
      advertencias: [],
    });
  }

  const nueva: ReservaRecurso = { recursoCodigo: ctx.recursoCodigo, inicio: ctx.inicio, fin: ctx.fin };
  partes.push(validarRecursos([...ctx.reservasExistentes, nueva]));

  if (ctx.perfil) {
    partes.push(validarVentanaReserva(ctx.perfil, ctx.ahora, ctx.inicio));
  }

  // R-21: la modalidad la da el recurso; el servicio tiene que ofrecerla y la
  // teleconsulta exige el consentimiento firmado.
  if (recurso) {
    const modalidad = modalidadDeRecurso(recurso);
    if (ctx.modalidad && ctx.modalidad !== modalidad) {
      partes.push({
        ok: false,
        bloqueos: [
          {
            regla: 'R-21',
            nivel: 'bloqueo',
            mensaje:
              ctx.modalidad === 'teleconsulta'
                ? 'La teleconsulta se agenda en la agenda de teleconsultas, no en un consultorio.'
                : `${recurso.nombre} es para teleconsultas: elegí un consultorio.`,
          },
        ],
        advertencias: [],
      });
    }
    partes.push(validarModalidadServicio(ctx.servicio, modalidad));
    partes.push(validarConsentimientoTeleconsulta(modalidad, ctx.consentimientoTeleconsulta === true));
  }

  // R-19: el control GLP-1 va atado a su tarea (y a la ventana que calculó el programa).
  partes.push(
    ctx.ventanaControl ? validarVentanaControl(ctx.inicio, ctx.ventanaControl) : validarControlSinTarea(ctx.servicio.codigo),
  );
  // R-20: la consulta del Plan Bienestar va atada a su tarea (y a su ventana).
  partes.push(
    ctx.consultaPlan ? validarVentanaConsultaPlan(ctx.inicio, ctx.consultaPlan) : validarConsultaPlanSinTarea(ctx.servicio.codigo),
  );

  return combinar(...partes);
}

function bloqueo(regla: string, mensaje: string): ResultadoReserva {
  return { ok: false, bloqueos: [{ regla, nivel: 'bloqueo', mensaje }], advertencias: [], creado: false };
}

/** Plan Bienestar activo del paciente (para ligarle una consulta extra). */
async function planBienestarActivo(medplum: MedplumClient, pacienteRef: string): Promise<CarePlan | undefined> {
  return medplum.searchOne('CarePlan', {
    subject: pacienteRef,
    status: 'active',
    category: `${SYSTEM.planCuidado}|${COD.planBienestar100}`,
  });
}

export async function handler(
  medplum: MedplumClient,
  event: BotEvent<EntradaReserva>,
): Promise<ResultadoReserva> {
  const e = event.input;
  const servicio = getServicio(e.servicioCodigo);
  const inicio = new Date(e.inicio);
  const fin = new Date(inicio.getTime() + servicio.duracionMin * 60_000);
  const ahora = new Date();
  const recurso = RECURSOS_POR_CODIGO.get(e.recursoCodigo);
  const modalidad: Modalidad = recurso ? modalidadDeRecurso(recurso) : 'presencial';

  // Tarea de un programa: tiene que ser de este paciente y estar pendiente.
  let tarea: Task | undefined;
  let ventanaControl: Ventana | undefined;
  let traerLaboratorio = false;
  let consultaPlan: DatosConsultaPlan | undefined;
  if (e.tareaId) {
    tarea = await medplum.readResource('Task', e.tareaId).catch(() => undefined);
    if (!tarea) {
      return bloqueo('R-19', 'La tarea no existe.');
    }
    if (esTareaConsultaPlan(tarea)) {
      const datos = leerTareaConsultaPlan(tarea);
      let inicialAgendada = datos.clave === 'inicial';
      if (!inicialAgendada && datos.carePlanRef) {
        const hermanas = await medplum.searchResources('Task', {
          'based-on': datos.carePlanRef,
          code: `${SYSTEM.taskTipo}|${COD.agendarConsultaPb100d}`,
        });
        inicialAgendada = hermanas.some((t) => leerTareaConsultaPlan(t).clave === 'inicial' && estadoTarea(t) === 'cerrado');
      }
      const check = validarTareaConsultaPlan(tarea, { pacienteRef: e.pacienteRef, servicioCodigo: e.servicioCodigo, inicialAgendada });
      if (!check.ok) {
        return bloqueo('R-20', check.error);
      }
      consultaPlan = check.datos;
    } else {
      const check = validarTareaAgenda(tarea, { pacienteRef: e.pacienteRef, servicioCodigo: e.servicioCodigo });
      if (!check.ok) {
        return bloqueo('R-19', check.error);
      }
      ventanaControl = check.ventana;
      traerLaboratorio = check.requiereLaboratorio;
    }
  }

  // Teleconsulta: consentimiento firmado (R-21).
  const consentimientoTeleconsulta =
    modalidad === 'teleconsulta' ? await tieneConsentimientoTeleconsulta(medplum, e.pacienteRef) : false;

  // Turnos ocupados de hoy (todos los recursos) para capacidad.
  const reservasExistentes = await cargarReservasDelDia(medplum, inicio);

  const resultado = validarReserva({
    servicio,
    inicio,
    fin,
    recursoCodigo: e.recursoCodigo,
    reservasExistentes,
    perfil: e.perfil,
    ahora,
    ventanaControl,
    consultaPlan,
    modalidad: e.modalidad,
    consentimientoTeleconsulta,
  });

  if (!resultado.ok || e.confirmar === false) {
    return { ...resultado, creado: false, modalidad };
  }

  // Crear Slot ocupado + Appointment.
  const scheduleId = await scheduleIdDeRecurso(medplum, e.recursoCodigo);
  if (!scheduleId) {
    return {
      ok: false,
      bloqueos: [{ regla: 'R-07', nivel: 'bloqueo', mensaje: `El recurso ${e.recursoCodigo} no tiene agenda (Schedule).` }],
      advertencias: resultado.advertencias,
      creado: false,
      modalidad,
    };
  }

  const advertencias = [...resultado.advertencias];

  // Teleconsulta: una sala nueva del Jitsi de SOM por turno.
  let teleconsultaUrl: string | undefined;
  if (modalidad === 'teleconsulta') {
    teleconsultaUrl = urlTeleconsulta(event.secrets['JITSI_BASE_URL']?.valueString, nombreSalaJitsi(randomBytes(16).toString('hex')));
    if (!teleconsultaUrl) {
      advertencias.push({
        regla: 'R-21',
        nivel: 'advertencia',
        mensaje: 'Falta el Project Secret JITSI_BASE_URL (https): el turno queda sin link de videollamada.',
      });
    }
  }

  const slot: Slot = await medplum.createResource<Slot>({
    resourceType: 'Slot',
    status: 'busy',
    schedule: { reference: `Schedule/${scheduleId}` },
    start: inicio.toISOString(),
    end: fin.toISOString(),
    extension: [{ url: EXT.recursoFisico, valueString: e.recursoCodigo }],
  });

  const participant: AppointmentParticipant[] = [{ actor: { reference: e.pacienteRef }, status: 'accepted' }];
  // Consultas con médico asignado: sumar al profesional como participante.
  if (servicio.practitionerCodigo) {
    const pract = await medplum.searchOne('Practitioner', `identifier=${SYSTEM.medico}|${servicio.practitionerCodigo}`);
    if (pract?.id) {
      participant.push({
        actor: { reference: `Practitioner/${pract.id}`, display: pract.name?.[0]?.text },
        status: 'accepted',
      });
    }
  }

  // Consulta extra (con cargo) de un paciente con el Plan Bienestar activo: se liga al plan.
  const dia = diaLocal(inicio);
  let planExtra: CarePlan | undefined;
  if (!servicio.incluidaEnPlan && servicio.grupo) {
    const plan = await planBienestarActivo(medplum, e.pacienteRef).catch(() => undefined);
    planExtra = plan && dentroDelPlan(plan, dia) ? plan : undefined;
  }

  const incluida = servicio.incluidaEnPlan === true;
  const descripcion = consultaPlan?.titulo
    ? nombreSegunModalidad({ nombre: tituloConsultaPlan(consultaPlan.titulo) }, modalidad)
    : nombreSegunModalidad(servicio, modalidad);
  const supportingInformation: Reference[] = [
    ...(consultaPlan && tarea?.id ? [{ reference: `Task/${tarea.id}` }] : []),
    ...(consultaPlan?.carePlanRef ? [{ reference: consultaPlan.carePlanRef }] : []),
    ...(planExtra?.id ? [{ reference: `CarePlan/${planExtra.id}` }] : []),
  ];
  const extension: Extension[] = [
    { url: EXT.recursoFisico, valueString: e.recursoCodigo },
    { url: EXT.ocupantes, valueInteger: e.ocupantes ?? 1 },
    { url: EXT.itemTipo, valueCode: 'servicio' },
    { url: EXT.itemCodigo, valueString: e.servicioCodigo },
    extensionModalidad(modalidad),
    ...(teleconsultaUrl ? [{ url: EXT.teleconsultaUrl, valueUrl: teleconsultaUrl }] : []),
  ];

  // Incluida en el plan: confirmada sin seña. El resto, TENTATIVO hasta cobrar la seña
  // del 50% (pasa a 'booked' al pagar).
  const appointment: Appointment = await medplum.createResource<Appointment>({
    resourceType: 'Appointment',
    status: incluida ? 'booked' : 'pending',
    description: descripcion,
    serviceType: [{ coding: [{ system: SYSTEM.servicioCodigo, code: servicio.codigo, display: servicio.nombre }], text: servicio.nombre }],
    ...(servicio.especialidad?.snomed
      ? {
          specialty: [
            {
              coding: [{ system: SNOMED, code: servicio.especialidad.snomed, display: servicio.especialidad.snomedDisplay }],
              text: servicio.especialidad.nombre,
            },
          ],
        }
      : {}),
    start: inicio.toISOString(),
    end: fin.toISOString(),
    slot: [{ reference: `Slot/${slot.id}` }],
    participant,
    ...(supportingInformation.length ? { supportingInformation } : {}),
    extension,
  });

  // La tarea de Recepción queda resuelta con este turno.
  if (tarea) {
    await medplum.updateResource<Task>({
      ...tarea,
      status: 'completed',
      lastModified: new Date().toISOString(),
      output: [{ type: { text: 'turno' }, valueReference: { reference: `Appointment/${appointment.id}` } }],
    });
  }

  // Plan Bienestar: la consulta queda agendada en el plan; la inicial fija el día 1 (R-20).
  // El turno ya está creado: si el plan no se puede actualizar, se avisa sin fallar.
  if (consultaPlan?.clave && consultaPlan.carePlanRef && tarea) {
    try {
      const carePlanId = consultaPlan.carePlanRef.split('/')[1]!;
      const plan = await medplum.readResource('CarePlan', carePlanId);
      const actualizado = await medplum.updateResource<CarePlan>(planTrasAgendar(plan, consultaPlan.clave, dia));
      if (consultaPlan.clave === 'inicial' && actualizado.period?.start !== plan.period?.start) {
        const deseadas = construirTareasPlanBienestar(e.pacienteRef, carePlanId, calendarioPlanBienestar(dia), new Date().toISOString());
        const existentes = await medplum.searchResources('Task', {
          'based-on': consultaPlan.carePlanRef,
          code: `${SYSTEM.taskTipo}|${COD.agendarConsultaPb100d}`,
        });
        for (const t of tareasARecalcular(existentes, deseadas)) {
          await medplum.updateResource<Task>(t);
        }
      }
    } catch {
      advertencias.push({
        regla: 'R-20',
        nivel: 'advertencia',
        mensaje: 'El turno quedó agendado, pero no se pudo actualizar el plan del paciente: avisá al equipo.',
      });
    }
  }
  if (planExtra?.id && appointment.id) {
    await medplum.updateResource<CarePlan>(sumarConsultaExtra(planExtra, appointment.id, descripcion)).catch(() => undefined);
  }

  await enviarWhatsApp(medplum, event.secrets, {
    template: incluida ? 'consulta-plan-confirmada' : 'reserva-tentativa',
    pacienteRef: e.pacienteRef,
    body: avisoReserva({ nombre: descripcion, inicio, modalidad, incluida, teleconsultaUrl, traerLaboratorio }),
  });

  return {
    ...resultado,
    advertencias,
    creado: true,
    appointmentId: appointment.id,
    slotId: slot.id,
    modalidad,
    ...(teleconsultaUrl ? { teleconsultaUrl } : {}),
    incluida,
  };
}
