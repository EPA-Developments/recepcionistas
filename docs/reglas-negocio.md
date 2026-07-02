# Reglas de negocio (motor de reglas)

Reglas R-xx vigentes tras el retiro del catálogo de wellness spa (BioWellness):
hoy Segunda Opinión Médica agenda **consultas de segunda opinión de cardiología
y subespecialidades**. Cada regla indica dónde está implementada.

## Agenda / turnos

| Regla | Descripción | Implementación |
|---|---|---|
| **R-07** | Capacidad por recurso: no se puede exceder la capacidad del consultorio/sala en una franja. | `validarCapacidadRecurso` |
| **R-13** | Ventana de reserva: 48 h (perfil `PUBLICO`). | `validarVentanaReserva` |
| **R-14** | Cancelación: < 24 h = sesión consumida (salvo fuerza mayor médica); ≥ 24 h devuelve saldo. | `evaluarCancelacion` |

## Pricing / cobros

| Regla | Descripción | Implementación |
|---|---|---|
| **R-17** | Precios de lista: consultas en ARS fijo (sin conversión; **PENDIENTE** la lista oficial, hoy 0); la conversión USD→ARS queda lista para futuros servicios en USD. | `usdAArs`, `resolverTC`, `calcularCobro` |

Split de ingresos: hoy todo servicio es `SOM_100` (100% a Segunda Opinión
Médica) — `calcularSplit`. El esquema de honorarios profesionales queda
pendiente de definir.

## Reglas retiradas (catálogo BioWellness)

Las reglas R-01, R-02, R-03, R-04..R-06, R-08 (splits IV/TB y masajes), R-09,
R-10, R-11, R-12, R-15, R-16 existían para el catálogo de terapias de wellness
spa (HBOT, IHHT, Recovery Pro, IV Therapy, Terapias Biológicas, Masajes,
combos, membresías, paquetes, Founding Members). Ese catálogo era de
BioWellness y se retiró del dominio. Si el modelo de segunda opinión llega a
necesitar reglas equivalentes (p. ej. contraindicaciones clínicas o paquetes de
seguimiento), se definen con la lista oficial de precios/reglas — ver
[`decisiones-pendientes.md`](decisiones-pendientes.md).

## Reglas fuera del alcance del Bloque 0 (referencia)

- **R-18** — Facturación AFIP (WSFE): alícuotas a confirmar con contador. (Slice
  posterior.)
