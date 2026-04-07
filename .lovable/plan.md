

## Plan: Ocultar bloque completo de notaría cuando no hay notarías configuradas

### Problema exacto

En `DocumentUploadStep.tsx` líneas 576-617, el bloque de notaría siempre se renderiza. El condicional `notariasList.length > 0 && !showNewNotaria` (línea 581) solo controla qué se muestra **dentro** del bloque. Cuando la lista está vacía, cae al `else` (línea 602) y muestra el formulario inline de "Nueva notaría" — exactamente lo que se ve en la captura del usuario.

### Cambio único

**`src/components/tramites/DocumentUploadStep.tsx`** — Línea 576 y 617:

Envolver todo el bloque en `{notariasList.length > 0 && ( ... )}`:

```
Antes (línea 576):
  <div className="rounded-lg border bg-card p-4 space-y-3">

Después:
  {notariasList.length > 0 && (
    <div className="rounded-lg border bg-card p-4 space-y-3">

Antes (línea 617):
  </div>

Después:
  </div>
  )}
```

### Verificación de impacto

- **`selectedNotariaId`**: ya se inicializa como `""` — si el bloque no se renderiza, sigue siendo `""`, lo cual es correcto (nullable FK en DB)
- **`handleContinue`**: ya verifica `if (selectedNotariaId)` antes de asociar la notaría al trámite — sin notarías, simplemente no se asocia ninguna
- **`newNotaria`**: no se usa si el bloque no se renderiza — sin side effects
- **OCR**: completamente independiente del selector (flujo `scan-document` → `metadata.extracted_documento`)
- **`process-expediente`**: ya maneja `notariaStyleId` como null con fallback a `maybeSingle()` de la org

### Resumen

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocumentUploadStep.tsx` | Envolver líneas 576-617 en `{notariasList.length > 0 && (...)}` |

1 archivo. 2 líneas añadidas. Sin migraciones DB. Sin riesgo de regresión.

