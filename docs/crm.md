# CRM — embudo de captación desde redes sociales

Embudo de Segunda Opinión Médica: **lead** (redes sociales, web, referidos) →
**segmento** → **campaña** (email / WhatsApp) → solicitud de segunda opinión o
turno. La lógica es pura (`src/lib/crm.ts`, testeada en `tests/crm.test.ts`); los
bots solo orquestan.

| Bot | Qué hace | Cómo se invoca |
|---|---|---|
| `som-recomputar-segmentos` | Recalcula los miembros (`member[]`) de cada segmento según sus criterios. | `cronTimer` (sin input: todos los segmentos, p. ej. `0 6 * * *`) o `executeBot` con un `Group` (solo ese). |
| `som-enviar-campana` | Envía una campaña a los miembros de un segmento y deja una `Communication` por destinatario. | `executeBot` con `{ groupId, canal, asunto?, cuerpo, campaniaId, from? }`. |

## Datos del lead (Patient)

| Extensión | Qué guarda | Quién la carga |
|---|---|---|
| `origen-lead` | Fuente del lead: red social / `utm_source` (`instagram`, `facebook`, `tiktok`, `google`, …), en minúsculas. | `som-alta-paciente` (campo `origenLead`; guarda el **primer** origen, no lo pisa). El portal debería guardarlo desde el `utm_source` del link de la publicidad al registrarse. |
| `perfil-interes` | Perfil de interés comercial. | Por definir (portal / recepción). |
| `ciclo-vida-cliente` | Etapa del embudo (también vale como `meta.tag` del CodeSystem `ciclo-vida-cliente`). | Por definir. |

Namespace: `https://segundaopinionmedica.org/fhir/...` (`EXT` / `SYSTEM` en
`src/fhir/identifiers.ts`).

## Segmentos (Group)

Un segmento es un `Group` con identifier `SYSTEM.segmento` (sin ese identifier el
bot no lo toca). Cada `characteristic` es un criterio y el paciente debe cumplir
**todos**; `exclude: true` lo niega. El tipo va en `characteristic.code` con el
CodeSystem `rasgo-segmento`:

| `rasgo-segmento` | Compara | Valor |
|---|---|---|
| `origen-lead` | extensión `origen-lead` | `valueCodeableConcept.coding[0].code` |
| `perfil-interes` | extensión `perfil-interes` | ídem |
| `ciclo-vida` | extensión / tag `ciclo-vida-cliente` | ídem |
| `biomarcador` | último valor de la Observation LOINC (coding LOINC en `code`) | `valueQuantity` con `comparator` y `value` |

Ejemplo — leads de Instagram que todavía no son pacientes:

```json
{
  "resourceType": "Group",
  "type": "person",
  "actual": true,
  "name": "Leads Instagram",
  "identifier": [{ "system": "https://segundaopinionmedica.org/fhir/Identifier/segmento", "value": "leads-instagram" }],
  "characteristic": [
    {
      "code": { "coding": [{ "system": "https://segundaopinionmedica.org/fhir/CodeSystem/rasgo-segmento", "code": "origen-lead" }] },
      "valueCodeableConcept": { "coding": [{ "code": "instagram" }] },
      "exclude": false
    },
    {
      "code": { "coding": [{ "system": "https://segundaopinionmedica.org/fhir/CodeSystem/rasgo-segmento", "code": "ciclo-vida" }] },
      "valueCodeableConcept": { "coding": [{ "code": "paciente" }] },
      "exclude": true
    }
  ]
}
```

Si un segmento tiene un criterio que no se puede interpretar (rasgo desconocido o
incompleto), el bot **no lo recalcula** y lo informa en `errores`: ignorar un
criterio ampliaría el segmento y la campaña le llegaría a quien no corresponde.

## Campañas

- **Email:** sale por SES (`medplum.sendEmail`); el bot necesita membership
  **admin** (igual que `som-invitar-paciente`).
- **WhatsApp:** la `Communication` queda en `preparation` (`pendientes` en el
  resultado). Con la WABA de EPA Bienestar IA, los mensajes de marketing solo salen
  como **plantilla aprobada por Meta**: falta el envío por plantilla (Twilio
  Content, `ContentSid`).
- **Idempotente:** cada `Communication` lleva el identifier de la campaña
  (`SYSTEM.campania` + `campaniaId`). Si el paciente ya la tiene enviada o encolada,
  no se repite, así que reintentar es seguro (los fallidos sí se reintentan).

## ⚠️ Antes de usarlo con pacientes reales

- **Consentimiento:** las campañas de marketing necesitan consentimiento (Ley
  25.326; los datos de salud son sensibles) y WhatsApp exige *opt-in* para
  mensajes de marketing. Hoy el bot no filtra por consentimiento: hay que definir
  cómo se registra (p. ej. `Consent` de marketing desde el portal) y filtrar.
- **Criterios clínicos:** segmentar por biomarcadores usa datos de salud; usarlo
  para marketing requiere ese consentimiento explícito.
- **Captura del origen:** definir las fuentes (`utm_source`) de las campañas en
  redes y que el portal las guarde en `origen-lead` al registrar al paciente.
