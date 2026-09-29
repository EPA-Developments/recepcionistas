/**
 * Instrumentos del equipo del Plan Bienestar 100 Días · Questionnaire FHIR.
 *
 * GENERADO desde `@epa/careplan-menopausia` (`scripts/exportar-instrumentos-recepcion.ts`).
 * No editar a mano: cualquier cambio se hace en el monorepo y se vuelve a exportar.
 *
 * El seed los sube (upsert por `url`); la respuesta de cada uno guarda
 * `questionnaire = url|version`. El puntaje y las condiciones del catálogo que derivan
 * viven en el monorepo (`puntuarInstrumento`): Recepción sólo los publica.
 */
import type { Questionnaire } from '@medplum/fhirtypes';

/** Sufijo de la URL (bajo cualquier base aceptada) de cada instrumento, como lo reconoce el menú del equipo. */
export const INSTRUMENTOS_PB100D_SUFIJOS = {
  "stopBang": "Questionnaire/pb100d-stop-bang-v1",
  "psicologico": "Questionnaire/pb100d-phq2-gad2-pss4-v1",
  "ahcHrsn": "Questionnaire/pb100d-ahc-hrsn-v1",
  "potenciadores": "Questionnaire/pb100d-potenciadores-v1",
  "reconciliacion": "Questionnaire/pb100d-reconciliacion-medicacion-v1"
} as const;

/** Los 5 instrumentos, versión 1.0. */
export const INSTRUMENTOS_PB100D: readonly Questionnaire[] = [
  {
    "resourceType": "Questionnaire",
    "url": "https://epa-bienestar.ar/fhir/Questionnaire/pb100d-stop-bang-v1",
    "version": "1.0",
    "name": "PB100DStopBang",
    "title": "STOP-Bang (apnea obstructiva del sueño)",
    "status": "active",
    "subjectType": [
      "Patient"
    ],
    "description": "Ocho preguntas de sí o no. 0 a 2: riesgo bajo; 3 a 4: intermedio; 5 o más: alto. Con 3 o más se registra la sospecha de apnea. Fuente: Chung F et al., Anesthesiology 2008 y Br J Anaesth 2012; Guía CKM 2026, Sección 7.3 (COR 2a, LOE C-LD).",
    "item": [
      {
        "linkId": "sb-s",
        "text": "¿Ronca fuerte (más fuerte que hablando, o tan fuerte que se escucha a través de una puerta cerrada)?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-t",
        "text": "¿Se siente cansado/a, fatigado/a o con sueño durante el día con frecuencia?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-o",
        "text": "¿Alguien observó que deja de respirar mientras duerme?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-p",
        "text": "¿Tiene o recibe tratamiento por presión arterial alta?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-b",
        "text": "¿Su índice de masa corporal es mayor de 35 kg/m²?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-a",
        "text": "¿Tiene más de 50 años?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-n",
        "text": "¿La circunferencia de su cuello es mayor de 40 cm?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      },
      {
        "linkId": "sb-g",
        "text": "¿Es de sexo masculino?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      }
    ]
  },
  {
    "resourceType": "Questionnaire",
    "url": "https://epa-bienestar.ar/fhir/Questionnaire/pb100d-phq2-gad2-pss4-v1",
    "version": "1.0",
    "name": "PB100DPhq2Gad2Pss4",
    "title": "PHQ-2, GAD-2 y PSS-4 (estrés y salud psicológica)",
    "status": "active",
    "subjectType": [
      "Patient"
    ],
    "description": "PHQ-2 y GAD-2: 0 a 6 cada uno, positivo con 3 o más. PSS-4: 0 a 16, a mayor puntaje más estrés percibido (sin punto de corte validado; se informa). Fuente: Kroenke K et al., Med Care 2003 (PHQ-2) y Ann Intern Med 2007 (GAD-2); Cohen S, 1988 (PSS-4); Guía CKM 2026, Sección 5.1 y Tabla 9.",
    "item": [
      {
        "linkId": "phq",
        "text": "En las últimas 2 semanas, ¿con qué frecuencia le molestó alguno de estos problemas?",
        "type": "group",
        "item": [
          {
            "linkId": "phq-1",
            "text": "Poco interés o placer en hacer cosas",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f1",
                  "display": "Varios días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f2",
                  "display": "Más de la mitad de los días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f3",
                  "display": "Casi todos los días"
                }
              }
            ]
          },
          {
            "linkId": "phq-2",
            "text": "Sentirse decaído/a, deprimido/a o sin esperanzas",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f1",
                  "display": "Varios días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f2",
                  "display": "Más de la mitad de los días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f3",
                  "display": "Casi todos los días"
                }
              }
            ]
          }
        ]
      },
      {
        "linkId": "gad",
        "text": "En las últimas 2 semanas, ¿con qué frecuencia le molestó alguno de estos problemas?",
        "type": "group",
        "item": [
          {
            "linkId": "gad-1",
            "text": "Sentirse nervioso/a, ansioso/a o al límite",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f1",
                  "display": "Varios días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f2",
                  "display": "Más de la mitad de los días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f3",
                  "display": "Casi todos los días"
                }
              }
            ]
          },
          {
            "linkId": "gad-2",
            "text": "No poder dejar de preocuparse o controlar la preocupación",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f1",
                  "display": "Varios días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f2",
                  "display": "Más de la mitad de los días"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "f3",
                  "display": "Casi todos los días"
                }
              }
            ]
          }
        ]
      },
      {
        "linkId": "pss",
        "text": "En el último mes, ¿con qué frecuencia…",
        "type": "group",
        "item": [
          {
            "linkId": "pss-1",
            "text": "…sintió que no podía controlar las cosas importantes de su vida?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p1",
                  "display": "Casi nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p2",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p3",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p4",
                  "display": "Muy a menudo"
                }
              }
            ]
          },
          {
            "linkId": "pss-2",
            "text": "…se sintió seguro/a de su capacidad para manejar sus problemas personales?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p1",
                  "display": "Casi nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p2",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p3",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p4",
                  "display": "Muy a menudo"
                }
              }
            ]
          },
          {
            "linkId": "pss-3",
            "text": "…sintió que las cosas le iban bien?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p1",
                  "display": "Casi nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p2",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p3",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p4",
                  "display": "Muy a menudo"
                }
              }
            ]
          },
          {
            "linkId": "pss-4",
            "text": "…sintió que las dificultades se acumulaban tanto que no podía superarlas?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p0",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p1",
                  "display": "Casi nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p2",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p3",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "p4",
                  "display": "Muy a menudo"
                }
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "resourceType": "Questionnaire",
    "url": "https://epa-bienestar.ar/fhir/Questionnaire/pb100d-ahc-hrsn-v1",
    "version": "1.0",
    "name": "PB100DAhcHrsn",
    "title": "AHC-HRSN (necesidades sociales relacionadas con la salud)",
    "status": "active",
    "subjectType": [
      "Patient"
    ],
    "description": "Preguntas centrales: vivienda, alimentación, transporte, servicios y seguridad. Cualquier dominio positivo registra necesidades sociales (seguridad: suma de 11 o más). Fuente: CMS Accountable Health Communities HRSN Screening Tool (preguntas centrales); Guía CKM 2026, Sección 3.2 (COR 1).",
    "item": [
      {
        "linkId": "vivienda",
        "text": "Vivienda",
        "type": "group",
        "item": [
          {
            "linkId": "vivienda-1",
            "text": "¿Cuál es su situación de vivienda hoy?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "estable",
                  "display": "Tengo un lugar fijo donde vivir"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "riesgo",
                  "display": "Tengo dónde vivir hoy, pero me preocupa perderlo"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "sin-lugar",
                  "display": "No tengo un lugar fijo donde vivir"
                }
              }
            ]
          },
          {
            "linkId": "vivienda-2",
            "text": "Piense en el lugar donde vive. ¿Tiene problemas con alguno de los siguientes?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "plagas",
                  "display": "Plagas (cucarachas, ratones)"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "moho",
                  "display": "Moho o humedad"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "plomo",
                  "display": "Pintura o cañerías con plomo"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "calefaccion",
                  "display": "Sin calefacción"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "horno",
                  "display": "Horno o cocina que no funciona"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "humo",
                  "display": "Detectores de humo que faltan o no funcionan"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "agua",
                  "display": "Sin agua corriente"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "ninguno",
                  "display": "Ninguno"
                }
              }
            ],
            "repeats": true
          }
        ]
      },
      {
        "linkId": "comida",
        "text": "Alimentación (últimos 12 meses)",
        "type": "group",
        "item": [
          {
            "linkId": "comida-1",
            "text": "Le preocupó que la comida se acabara antes de tener dinero para comprar más.",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "nunca",
                  "display": "Nunca fue cierto"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "a-veces",
                  "display": "A veces fue cierto"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "frecuente",
                  "display": "Con frecuencia fue cierto"
                }
              }
            ]
          },
          {
            "linkId": "comida-2",
            "text": "La comida que compró no alcanzó y no tuvo dinero para comprar más.",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "nunca",
                  "display": "Nunca fue cierto"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "a-veces",
                  "display": "A veces fue cierto"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "frecuente",
                  "display": "Con frecuencia fue cierto"
                }
              }
            ]
          }
        ]
      },
      {
        "linkId": "otros",
        "text": "Transporte y servicios (últimos 12 meses)",
        "type": "group",
        "item": [
          {
            "linkId": "transporte",
            "text": "¿La falta de transporte confiable le impidió ir a consultas médicas, al trabajo o conseguir lo necesario para la vida diaria?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "si",
                  "display": "Sí"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "no",
                  "display": "No"
                }
              }
            ]
          },
          {
            "linkId": "servicios",
            "text": "¿La compañía de electricidad, gas o agua amenazó con cortarle el servicio?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "si",
                  "display": "Sí"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "no",
                  "display": "No"
                }
              }
            ]
          }
        ]
      },
      {
        "linkId": "seguridad",
        "text": "Seguridad: ¿con qué frecuencia alguien, incluida su familia y sus amistades…",
        "type": "group",
        "item": [
          {
            "linkId": "seguridad-1",
            "text": "…la o lo daña físicamente?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s1",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s2",
                  "display": "Rara vez"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s3",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s4",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s5",
                  "display": "Con mucha frecuencia"
                }
              }
            ]
          },
          {
            "linkId": "seguridad-2",
            "text": "…la o lo insulta o le habla mal?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s1",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s2",
                  "display": "Rara vez"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s3",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s4",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s5",
                  "display": "Con mucha frecuencia"
                }
              }
            ]
          },
          {
            "linkId": "seguridad-3",
            "text": "…la o lo amenaza con hacerle daño?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s1",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s2",
                  "display": "Rara vez"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s3",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s4",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s5",
                  "display": "Con mucha frecuencia"
                }
              }
            ]
          },
          {
            "linkId": "seguridad-4",
            "text": "…le grita o la o lo maldice?",
            "type": "choice",
            "answerOption": [
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s1",
                  "display": "Nunca"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s2",
                  "display": "Rara vez"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s3",
                  "display": "A veces"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s4",
                  "display": "Con bastante frecuencia"
                }
              },
              {
                "valueCoding": {
                  "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
                  "code": "s5",
                  "display": "Con mucha frecuencia"
                }
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "resourceType": "Questionnaire",
    "url": "https://epa-bienestar.ar/fhir/Questionnaire/pb100d-potenciadores-v1",
    "version": "1.0",
    "name": "PB100DPotenciadores",
    "title": "Potenciadores de riesgo (Tabla 9, Guía CKM 2026)",
    "status": "active",
    "subjectType": [
      "Patient"
    ],
    "description": "Marcar los que tenga la persona. Cualquiera registra la condición «potenciadores»; algunos activan además su condición específica (apnea, menopausia precoz, diabetes gestacional, resultado adverso del embarazo, índice tobillo-brazo bajo, ERC). Fuente: Guía CKM 2026, Tabla 9 (COR 2a).",
    "item": [
      {
        "linkId": "pot",
        "text": "Potenciadores presentes",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "inflamatoria",
              "display": "Enfermedad inflamatoria crónica o autoinmune (artritis reumatoide, psoriasis, lupus, enfermedad inflamatoria intestinal)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "vih",
              "display": "VIH"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "apnea",
              "display": "Apnea obstructiva del sueño"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "depresion",
              "display": "Depresión o ansiedad"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "masld",
              "display": "Hígado graso (MASLD)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "erc",
              "display": "Enfermedad renal crónica"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "sudasiatica",
              "display": "Ascendencia sudasiática"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "familiar",
              "display": "Historia familiar de enfermedad cardiovascular prematura (varón antes de los 55, mujer antes de los 65)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "menopausia-precoz",
              "display": "Menopausia precoz (antes de los 40)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "apo",
              "display": "Resultado adverso del embarazo (preeclampsia, parto prematuro)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "dmg",
              "display": "Diabetes gestacional"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "pcr",
              "display": "PCR ultrasensible ≥ 2 mg/L"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "lpa",
              "display": "Lp(a) ≥ 125 nmol/L"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "apob",
              "display": "ApoB ≥ 130 mg/dL"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "itb",
              "display": "Índice tobillo-brazo < 0,9"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "ninguno",
              "display": "Ninguno"
            }
          }
        ],
        "repeats": true
      }
    ]
  },
  {
    "resourceType": "Questionnaire",
    "url": "https://epa-bienestar.ar/fhir/Questionnaire/pb100d-reconciliacion-medicacion-v1",
    "version": "1.0",
    "name": "PB100DReconciliacionMedicacion",
    "title": "Reconciliación de medicación y suplementos (Tabla 12)",
    "status": "active",
    "subjectType": [
      "Patient"
    ],
    "description": "Las clases que toma hoy (activan sus condiciones del catálogo), la cantidad total de fármacos (5 o más: polifarmacia) y el automonitoreo de glucemia. Fuente: Guía CKM 2026, Tabla 12.",
    "item": [
      {
        "linkId": "clases",
        "text": "Clases de medicación que toma hoy",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "glp1",
              "display": "Agonista del receptor GLP-1"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "sglt2i",
              "display": "Inhibidor SGLT2"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "rasi",
              "display": "IECA, ARA2 o ARNI"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "mra",
              "display": "Antagonista mineralocorticoide (espironolactona, eplerenona, finerenona)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "estatina",
              "display": "Estatina u otro hipolipemiante"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "antitrombotico",
              "display": "Antiagregante o anticoagulante"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "antihipertensivo",
              "display": "Otro antihipertensivo"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "obesidad",
              "display": "Fármaco para la obesidad (no GLP-1)"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "insulina",
              "display": "Insulina o sulfonilurea"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "ninguna",
              "display": "No toma medicación"
            }
          }
        ],
        "repeats": true
      },
      {
        "linkId": "cantidad",
        "text": "Cantidad total de fármacos que toma (incluidos los de venta libre y los suplementos)",
        "type": "integer"
      },
      {
        "linkId": "automonitoreo",
        "text": "¿Usa glucómetro o sensor para medirse la glucemia?",
        "type": "choice",
        "answerOption": [
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "si",
              "display": "Sí"
            }
          },
          {
            "valueCoding": {
              "system": "https://epa-bienestar.ar/fhir/CodeSystem/pb100d-instrumentos",
              "code": "no",
              "display": "No"
            }
          }
        ]
      }
    ]
  }
];
