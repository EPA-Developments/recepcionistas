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
 *
 * Agenda por profesional (R-22): con `medicoCodigo` (o `slotId` de una franja suya) el
 * turno ocupa las franjas libres del profesional —las que generan su disponibilidad y el
 * cron— con escritura condicional, así dos reservas simultáneas no toman la misma hora.
 * La teleconsulta no ocupa consultorio; lo presencial ocupa además el del profesional
 * (o el que se pida), con la capacidad de siempre (R-07). Sin `medicoCodigo` sigue el
 * camino por recurso de la app de Recepción.
 */
import { randomBytes } from 'node:crypto';
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Appointment, AppointmentParticipant, CarePlan, Extension, Reference, Slot, Task } from '@medplum/fhirtypes';
import type { Modalidad, Servicio } from '../domain/types.js';
import { getServicio, nombreSegunModalidad } from '../config/catalogo.js';
import { HORARIO_SEMANAL } from '../config/horario.js';
import { getMedico, medicoAtiende, type Medico } from '../config/medicos.js';
import { RECURSOS_POR_CODIGO, modalidadDeRecurso } from '../config/recursos.js';
import type { PerfilReserva } from '../config/reglas.js';
import { COD, EXT, SYSTEM } from '../fhir/identifiers.js';
import {
  estaDisponible,
  extensionesSlotProfesional,
  identificadorSlotProfesional,
  modalidadesDisponibles,
  permiteModalidad,
} from '../lib/agenda-profesional.js';
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
import {
  cargarReservasDelDia,
  enviarWhatsApp,
  liberarFranjas,
  ocuparFranjas,
  scheduleIdDeProfesional,
  scheduleIdDeRecurso,
  tieneConsentimientoTeleconsulta,
} from './_shared.js';

const SNOMED = 'http://snomed.info/sct';

export interface EntradaReserva {
  pacienteRef: string; // "Patient/123"
  servicioCodigo: string;
  /**
   * Consultorio / sala / agenda virtual. Obligatorio sin profesional; con profesional,
   * en presencial se toma su consultorio si no se manda, y en teleconsulta no hace falta.
   */
  recursoCodigo?: string;
  /** Profesional que atiende (agenda por profesional, R-22). */
  medicoCodigo?: string;
  /** Franja libre elegida (Slot de la agenda de un profesional): fija profesional e inicio. */
  slotId?: string;
  /** Inicio del turno en ISO (con offset de Argentina). Con `slotId`, el de la franja. */
  inicio?: string;
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
  /** Profesional del turno (agenda por profesional). */
  medicoCodigo?: string;
  /** Todas las franjas que ocupa (del profesional y, en presencial, del consultorio). */
  slotIds?: string[];
}

export interface ContextoReserva {
  servicio: Servicio;
  inicio: Date;
  fin: Date;
  /** Recurso físico (o agenda virtual). Puede faltar en teleconsulta con profesional. */
  recursoCodigo?: string;
  /** Profesional que atiende (R-22). */
  medico?: Pick<Medico, 'nombre' | 'servicios' | 'modalidades' | 'disponibilidad'>;
  /** ¿El horario cae en la disponibilidad del profesional? (R-22; lo calcula el handler). */
  disponible?: boolean;
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

  const recurso = ctx.recursoCodigo ? RECURSOS_POR_CODIGO.get(ctx.recursoCodigo) : undefined;
  if (ctx.recursoCodigo && !recurso) {
    partes.push({
      ok: false,
      bloqueos: [{ regla: 'R-07', nivel: 'bloqueo', mensaje: `El recurso ${ctx.recursoCodigo} no existe.` }],
      advertencias: [],
    });
  }
  if (!ctx.recursoCodigo && !ctx.medico) {
    partes.push({
      ok: false,
      bloqueos: [{ regla: 'R-07', nivel: 'bloqueo', mensaje: 'Falta dónde agendar: un consultorio o un profesional.' }],
      advertencias: [],
    });
  }

  if (ctx.recursoCodigo) {
    const nueva: ReservaRecurso = { recursoCodigo: ctx.recursoCodigo, inicio: ctx.inicio, fin: ctx.fin };
    partes.push(validarRecursos([...ctx.reservasExistentes, nueva]));
  }

  if (ctx.perfil) {
    partes.push(validarVentanaReserva(ctx.perfil, ctx.ahora, ctx.inicio));
  }

  // Modalidad (R-21): la da el recurso; sin recurso (teleconsulta con profesional), la pedida.
  const modalidad: Modalidad = recurso ? modalidadDeRecurso(recurso) : (ctx.modalidad ?? 'teleconsulta');
  if (recurso && ctx.modalidad && ctx.modalidad !== modalidad) {
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
  if (!recurso && ctx.medico && modalidad === 'presencial') {
    partes.push({
      ok: false,
      bloqueos: [{ regla: 'R-22', nivel: 'bloqueo', mensaje: 'La consulta presencial necesita un consultorio.' }],
      advertencias: [],
    });
  }
  if (recurso || ctx.medico) {
    // R-21: el servicio tiene que ofrecer la modalidad y la teleconsulta exige el consentimiento.
    partes.push(validarModalidadServicio(ctx.servicio, modalidad));
    partes.push(validarConsentimientoTeleconsulta(modalidad, ctx.consentimientoTeleconsulta === true));
  }

  // R-22: el profesional atiende esa consulta en esa modalidad y en ese horario.
  if (ctx.medico) {
    if (!medicoAtiende(ctx.medico, ctx.servicio.codigo, modalidad)) {
      partes.push({
        ok: false,
        bloqueos: [
          {
            regla: 'R-22',
            nivel: 'bloqueo',
            mensaje: `${ctx.medico.nombre} no atiende ${nombreSegunModalidad(ctx.servicio, modalidad).toLowerCase()}.`,
          },
        ],
        advertencias: [],
      });
    }
    if (ctx.disponible === false) {
      partes.push({
        ok: false,
        bloqueos: [{ regla: 'R-22', nivel: 'bloqueo', mensaje: `${ctx.medico.nombre} no atiende ${modalidad} en ese horario.` }],
        advertencias: [],
      });
    }
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
  const ahora = new Date();

  // Agenda por profesional (R-22): por franja elegida o por profesional + inicio.
  let franjaElegida: Slot | undefined;
  let medicoCodigo = e.medicoCodigo;
  if (e.slotId) {
    franjaElegida = await medplum.readResource('Slot', e.slotId).catch(() => undefined);
    if (!franjaElegida?.start) {
      return bloqueo('R-22', 'Ese horario ya no existe. Elegí otro.');
    }
    if (franjaElegida.status !== 'free') {
      return bloqueo('R-22', 'Ese horario ya está ocupado. Elegí otro.');
    }
    const dueno = franjaElegida.extension?.find((x) => x.url === EXT.profesional)?.valueString;
    if (!dueno || (medicoCodigo && medicoCodigo !== dueno)) {
      return bloqueo('R-22', 'Ese horario no es de la agenda del profesional elegido.');
    }
    medicoCodigo = dueno;
  }
  const medico = medicoCodigo ? getMedico(medicoCodigo) : undefined;
  if (medicoCodigo && !medico) {
    return bloqueo('R-22', 'El profesional no existe.');
  }
  const inicioISO = franjaElegida?.start ?? e.inicio;
  if (!inicioISO) {
    return bloqueo('R-13', 'Falta el horario del turno.');
  }
  const inicio = new Date(inicioISO);
  const fin = new Date(inicio.getTime() + servicio.duracionMin * 60_000);

  // Modalidad (R-21): la del recurso; con profesional y sin recurso, la pedida (teleconsulta
  // por defecto). En presencial con profesional, el consultorio es el suyo si no se manda.
  let recursoCodigo = e.recursoCodigo;
  if (medico && !recursoCodigo && e.modalidad === 'presencial') {
    recursoCodigo = medico.consultorioCodigo;
  }
  const recurso = recursoCodigo ? RECURSOS_POR_CODIGO.get(recursoCodigo) : undefined;
  const modalidad: Modalidad = recurso ? modalidadDeRecurso(recurso) : medico ? (e.modalidad ?? 'teleconsulta') : 'presencial';
  // ¿El horario cae en la disponibilidad del profesional, en esa modalidad? Una franja
  // libre suya lo garantiza si admite la modalidad (las anteriores a R-22, sin marca, admiten todas).
  const disponible = medico
    ? franjaElegida
      ? permiteModalidad(franjaElegida, modalidad)
      : estaDisponible(medico, HORARIO_SEMANAL, inicio, fin, modalidad)
    : undefined;

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
    recursoCodigo,
    medico,
    disponible,
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

  const advertencias = [...resultado.advertencias];

  // Ocupar las franjas: primero las del profesional (su agenda), después las del
  // consultorio (presencial). Si alguna ya está tomada, se libera lo ocupado y se avisa.
  const slots: Slot[] = [];
  if (medico) {
    const scheduleProfesional = await scheduleIdDeProfesional(medplum, medico.codigo);
    if (!scheduleProfesional) {
      return bloqueo('R-22', `${medico.nombre} todavía no tiene agenda cargada (Schedule).`);
    }
    const r = await ocuparFranjas(medplum, {
      scheduleId: scheduleProfesional,
      inicio,
      fin,
      identificador: (iso) => ({ system: SYSTEM.medico, value: identificadorSlotProfesional(medico.codigo, iso) }),
      // Si hay que materializar la franja, con las modalidades de su disponibilidad en ese horario.
      extension: extensionesSlotProfesional(medico.codigo, modalidadesDisponibles(medico, HORARIO_SEMANAL, inicio, fin)),
    });
    if (!r.ok) {
      return bloqueo('R-22', `${medico.nombre} ya tiene ese horario ocupado. Elegí otro.`);
    }
    slots.push(...r.slots);
  }
  if (recursoCodigo) {
    const scheduleId = await scheduleIdDeRecurso(medplum, recursoCodigo);
    if (!scheduleId) {
      await liberarFranjas(medplum, slots.map((s) => ({ reference: `Slot/${s.id}` })));
      return bloqueo('R-07', `El recurso ${recursoCodigo} no tiene agenda (Schedule).`);
    }
    const codigo = recursoCodigo;
    const r = await ocuparFranjas(medplum, {
      scheduleId,
      inicio,
      fin,
      identificador: (iso) => ({ system: SYSTEM.recursoCodigo, value: `${codigo}|${iso}` }),
      extension: [{ url: EXT.recursoFisico, valueString: codigo }],
    });
    if (!r.ok) {
      await liberarFranjas(medplum, slots.map((s) => ({ reference: `Slot/${s.id}` })));
      return bloqueo('R-07', `${recurso?.nombre ?? recursoCodigo} ya está ocupado en ese horario.`);
    }
    slots.push(...r.slots);
  }

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

  const participant: AppointmentParticipant[] = [{ actor: { reference: e.pacienteRef }, status: 'accepted' }];
  // El profesional que atiende, como participante (la videollamada le da el rol por esto).
  const codigoProfesional = medico?.codigo ?? servicio.practitionerCodigo;
  if (codigoProfesional) {
    const pract = await medplum.searchOne('Practitioner', `identifier=${SYSTEM.medico}|${codigoProfesional}`);
    if (pract?.id) {
      participant.push({
        actor: { reference: `Practitioner/${pract.id}`, display: pract.name?.[0]?.text ?? medico?.nombre },
        status: 'accepted',
      });
    } else {
      advertencias.push({
        regla: 'R-22',
        nivel: 'advertencia',
        mensaje: `El profesional ${medico?.nombre ?? codigoProfesional} no está cargado en Medplum (falta el seed): el turno queda sin profesional.`,
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
    ...(recursoCodigo ? [{ url: EXT.recursoFisico, valueString: recursoCodigo }] : []),
    ...(medico ? [{ url: EXT.profesional, valueString: medico.codigo }] : []),
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
    slot: slots.map((s) => ({ reference: `Slot/${s.id}` })),
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
    slotId: slots[0]?.id,
    slotIds: slots.map((s) => s.id!),
    modalidad,
    ...(teleconsultaUrl ? { teleconsultaUrl } : {}),
    incluida,
    ...(medico ? { medicoCodigo: medico.codigo } : {}),
  };
}
