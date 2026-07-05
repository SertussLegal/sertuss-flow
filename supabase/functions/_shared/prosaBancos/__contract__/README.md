# Contrato de Referencia — Prosa Davivienda

Fuente de Verdad estructurada derivada de los 2 ejemplos oficiales del equipo
legal, almacenados en el bucket privado `cancelaciones-plantillas/davivienda/`:

- `EJEMPLO_REFERENCIA_PROSA_NATURAL_DAVIVIENDA.docx`
- `EJEMPLO_REFERENCIA_PROSA_JURIDICA_DAVIVIENDA.docx`

## Archivos

| Archivo | Rol |
|---|---|
| `referencia_davivienda.contract.json` | Contrato tipado — Fuente de Verdad. |
| `contract.schema.json` | Meta-schema JSON Schema que valida el contrato. |

## Niveles de exigencia

| Nivel | Comportamiento en CI |
|---|---|
| `required` | Assert duro. Falla si no está presente. |
| `conditional` | Assert solo si se cumple `requiredIf`. |
| `recommended` | Warning, nunca falla. |

## Endpoints de auditoría (edge function `audit-refs-davivienda`)

| Ruta | Uso | Costo |
|---|---|---|
| `GET /hashes` | **CI** — guardia de sync. Solo lee metadata (etag+size) del bucket. Responde `304` con `If-None-Match`. | Ínfimo. |
| `GET /tree` | **Manual** — regenerar contrato. Descarga los `.docx`, extrae AST vía `mammoth`. | Alto (usar solo cuando el equipo legal actualice los ejemplos). |

## Procedimiento cuando el equipo legal actualiza un ejemplo

1. Reemplazar el `.docx` correspondiente en el bucket.
2. Llamar manualmente `GET /audit-refs-davivienda/tree` (o script equivalente).
3. Actualizar `sources.<caso>.etag`, `size`, `capturedAt` en el contrato.
4. Revisar `prosaAsserts` — ajustar si el equipo legal modificó redacción canónica.
5. PR con aprobación jurídica + squad de plataforma.
6. CI validará automáticamente que `etag` del contrato = `etag` vivo del bucket.

## Regla inmutable

- **Nunca auditar el prompt de la IA por strings.** El prompt puede
  reescribirse libremente para optimizar extracción. Lo que se blinda es
  la **forma del output** (tool schema) y la **prosa renderizada**.
- **Nunca copiar literales de los `.docx` de referencia** al código.
