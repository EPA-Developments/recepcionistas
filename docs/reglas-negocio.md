# Reglas de negocio (motor de reglas)

Reglas R-xx vigentes: Segunda Opinión Médica agenda **consultas por especialidad**
(presenciales o por teleconsulta) y las **consultas programadas del Plan Bienestar
100 Días®**. Cada regla indica dónde está implementada.

## Agenda / turnos

| Regla | Descripción | Implementación |
|---|---|---|
| **R-07** | Capacidad por recurso: no se puede exceder la capacidad del consultorio/sala en una franja. | `validarCapacidadRecurso` |
| **R-13** | Ventana de reserva: 48 h (perfil `PUBLICO`). Solo se aplica si la reserva manda `perfil`; la reserva desde el portal (R-23) no la aplica: la agenda se publica 45 días adelante (ver pendientes). | `validarVentanaReserva` |
| **R-14** | Cancelación: < 24 h = sesión consumida (salvo fuerza mayor médica); ≥ 24 h devuelve saldo. | `evaluarCancelacion` |
| **R-19** | Controles del seguimiento GLP-1 (**provisional**): se agendan solo desde su tarea; no antes de la ventana que calcula el programa (bloqueo) y, pasada la ventana, con advertencia. Ventana: basal = 7 días previos al inicio; el resto, desde la semana calculada hasta 7 días después. Ver [`glp1.md`](glp1.md). | `validarVentanaControl`, `validarControlSinTarea`, `validarTareaAgenda` (`src/lib/glp1-plan.ts`) |
| **R-20** | Consultas del **Plan Bienestar 100 Días®** (definidas por el Dr. D'Alessandro y el Dr. Barbagelata): se agendan solo desde su tarea; el día 1 es el de la consulta inicial (al agendarla, el plan se corre a esa fecha y se recalculan las otras dos); la del día 50 y la final esperan a la inicial y van en ± 7 días (antes: bloqueo; después: advertencia). Incluidas en el plan: sin seña. Si se cancela, vuelve a quedar por agendar. Ver [`plan-bienestar.md`](plan-bienestar.md). | `validarTareaConsultaPlan`, `validarVentanaConsultaPlan`, `validarConsultaPlanSinTarea`, `planTrasAgendar` (`src/lib/plan-bienestar.ts`) |
| **R-21** | Modalidad: presencial o teleconsulta. La da el recurso (la agenda virtual es teleconsulta) o, al reservar por profesional sin consultorio, el pedido (`modalidad`, default teleconsulta); el servicio y el profesional tienen que ofrecerla; la teleconsulta exige el **consentimiento de teleconsulta** firmado (genérico, en el portal) y lleva el link de Jitsi. | `validarModalidadServicio`, `validarConsentimientoTeleconsulta` (`src/lib/teleconsulta.ts`); `som-reservar-turno`, `som-solicitar-turno` |
| **R-22** | **Agenda por profesional.** Cada turno tiene un profesional (`Practitioner` + `PractitionerRole`) con agenda propia (`Schedule`): horarios de **30 min** (`Slot`) generados desde su disponibilidad semanal, dentro del horario del centro. Cada franja de la disponibilidad puede ser de una sola modalidad (p. ej. presencial en el consultorio martes y jueves 9–12, teleconsulta el resto) y el `Slot` lleva las modalidades en que se puede reservar (extensión `modalidad`). El profesional tiene que atender esa consulta en esa modalidad y estar disponible en ese horario para esa modalidad; lo presencial exige además un consultorio (R-07). La reserva **ocupa** la franja libre del profesional (y la del consultorio) con escritura condicional (`If-Match`): si dos reservas van al mismo horario, una pierde sin pisar nada. Al cancelar, las franjas vuelven a `free` (no se borran). Un profesional sin disponibilidad cargada no es reservable. **Validada el 26/09/2026.** |
| **R-23** | **Reserva desde el portal.** La paciente reserva sola eligiendo una franja libre (`som-reservar-portal`), con las mismas reglas que Recepción, solo para sí misma y solo consultas por especialidad o la del plan con su tarea (el control GLP-1 lo agenda Recepción). Consulta del plan: **confirmada**, sin seña. Consulta con cargo: **tentativa** con la franja retenida **30 min** (`RETENCION_RESERVA_PORTAL_MIN`) y el link de MercadoPago de la seña del 50 %; al acreditarse se confirma sola (webhook); vencida sin seña, el cron `som-vencer-reservas` la cancela y libera la franja; una seña tardía no la revive (se avisa a Recepción para reintegrar). Anticipación mínima = la retención (provisional). Si no se pudo generar el link, no vence y Recepción cobra. **Decidida el 26/09/2026.** | `validarPedidoPortal`, `validarAnticipacionPortal`, `reservaVencida` (`src/lib/reserva-portal.ts`); `som-reservar-portal`, `som-vencer-reservas`, `confirmarReserva` (`src/bots/_shared.ts`) | `medicoAtiende` (`src/config/medicos.ts`), `estaDisponible`, `generarSlotsProfesional` (`src/lib/agenda-profesional.ts`), `ocuparFranjas` / `liberarFranjas` (`src/bots/_shared.ts`); `som-reservar-turno`, `som-estado-turno`, cron `som-generar-agenda` |

## Pricing / cobros

| Regla | Descripción | Implementación |
|---|---|---|
| **R-17** | Precios de lista: consultas en ARS fijo, sin conversión. Lista del 26/09/2026 (Dr. D'Alessandro): **consulta por especialidad ARS 150.000**, igual presencial y por teleconsulta y para todos los profesionales; la consulta del Plan Bienestar está incluida (0; el plan la presupuesta en 100.000, `valor-referencia-ars`); control GLP-1 PENDIENTE. La conversión USD→ARS queda lista para futuros servicios en USD. | `PRECIO_CONSULTA_ESPECIALIDAD_ARS`, `usdAArs`, `resolverTC`, `calcularCobro` |

Split de ingresos: hoy todo servicio es `SOM_100` (100% a Segunda Opinión
Médica) — `calcularSplit`. El esquema de honorarios profesionales queda
pendiente de definir.

## Reglas retiradas

Las reglas R-01..R-06, R-08..R-12, R-15 y R-16 eran de un catálogo anterior,
ajeno a SOM (terapias, combos, membresías y paquetes), y se retiraron del
dominio; la numeración se conserva para trazabilidad. Si el modelo de segunda
opinión llega a necesitar reglas equivalentes (p. ej. contraindicaciones
clínicas o paquetes de seguimiento), se definen con la lista oficial de
precios/reglas — ver [`decisiones-pendientes.md`](decisiones-pendientes.md).

## Reglas fuera del alcance del Bloque 0 (referencia)

- **R-18** — Facturación AFIP (WSFE): alícuotas a confirmar con contador. (Slice
  posterior.)
