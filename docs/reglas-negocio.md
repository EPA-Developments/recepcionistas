# Reglas de negocio (motor de reglas)

Reglas R-xx vigentes: Segunda Opinión Médica agenda **consultas por especialidad**
(presenciales o por teleconsulta) y las **consultas programadas del Plan Bienestar
100 Días®**. Cada regla indica dónde está implementada.

## Agenda / turnos

| Regla | Descripción | Implementación |
|---|---|---|
| **R-07** | Capacidad por recurso: no se puede exceder la capacidad del consultorio/sala en una franja. | `validarCapacidadRecurso` |
| **R-13** | Ventana de reserva: 48 h (perfil `PUBLICO`). | `validarVentanaReserva` |
| **R-14** | Cancelación: < 24 h = sesión consumida (salvo fuerza mayor médica); ≥ 24 h devuelve saldo. | `evaluarCancelacion` |
| **R-19** | Controles del seguimiento GLP-1 (**provisional**): se agendan solo desde su tarea; no antes de la ventana que calcula el programa (bloqueo) y, pasada la ventana, con advertencia. Ventana: basal = 7 días previos al inicio; el resto, desde la semana calculada hasta 7 días después. Ver [`glp1.md`](glp1.md). | `validarVentanaControl`, `validarControlSinTarea`, `validarTareaAgenda` (`src/lib/glp1-plan.ts`) |
| **R-20** | Consultas del **Plan Bienestar 100 Días®** (definidas por el Dr. D'Alessandro y el Dr. Barbagelata): se agendan solo desde su tarea; el día 1 es el de la consulta inicial (al agendarla, el plan se corre a esa fecha y se recalculan las otras dos); la del día 50 y la final esperan a la inicial y van en ± 7 días (antes: bloqueo; después: advertencia). Incluidas en el plan: sin seña. Si se cancela, vuelve a quedar por agendar. Ver [`plan-bienestar.md`](plan-bienestar.md). | `validarTareaConsultaPlan`, `validarVentanaConsultaPlan`, `validarConsultaPlanSinTarea`, `planTrasAgendar` (`src/lib/plan-bienestar.ts`) |
| **R-21** | Modalidad: presencial o teleconsulta. La da el recurso (la agenda virtual es teleconsulta); el servicio tiene que ofrecerla; la teleconsulta exige el **consentimiento de teleconsulta** firmado (genérico, en el portal) y lleva el link de Jitsi. | `validarModalidadServicio`, `validarConsentimientoTeleconsulta` (`src/lib/teleconsulta.ts`); `som-reservar-turno`, `som-solicitar-turno` |

## Pricing / cobros

| Regla | Descripción | Implementación |
|---|---|---|
| **R-17** | Precios de lista: consultas en ARS fijo (sin conversión; **PENDIENTE** la lista oficial, hoy 0); la conversión USD→ARS queda lista para futuros servicios en USD. | `usdAArs`, `resolverTC`, `calcularCobro` |

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
