

## Plan: Cobro al Generar Documento (Desbloqueo Reactivo)

### Resumen

Crear trámites y usar OCR es gratuito. El cobro de 2 créditos ocurre **solo** al generar el documento Word por primera vez. Una vez desbloqueado (`is_unlocked = true`), las regeneraciones son gratuitas.

### 1. Dashboard — Creación gratuita

**Archivo:** `src/pages/Dashboard.tsx`

- Eliminar la llamada a `unlock_expediente` de `handleNewTramite`. Solo crear el trámite y navegar.
- Eliminar `refreshProfile()` post-creación (no hay cobro).
- Eliminar validación `credits < 2` del botón y el mensaje de advertencia.
- Cambiar texto del botón: "Nuevo Trámite (2 créditos)" → "Nuevo Trámite".
- Eliminar `credits` de la desestructuración de `useAuth` (ya no se usa en Dashboard).

### 2. Validacion.tsx — ensureUnlocked en generación + badge de créditos

**Archivo:** `src/pages/Validacion.tsx`

- Agregar estado `isUnlocked` inicializado desde `loadTramite` (`t.is_unlocked`).
- Importar `user` y `credits` desde `useAuth`.
- Crear función `ensureUnlocked()`:
  - Si `isUnlocked` es `true`, retorna `true` directamente.
  - Si no, llama a `unlock_expediente` RPC con `p_org_id`, `p_tramite_id`, `p_user_id`.
  - Si exitoso: `setIsUnlocked(true)`, `refreshCredits()`, toast de confirmación.
  - Si falla: toast destructivo "Necesitas al menos 2 créditos", retorna `false`.
- Envolver `handleConfirmGenerate`: llamar `ensureUnlocked()` al inicio, abortar si retorna `false`.
- Agregar badge de créditos en el header junto al sync indicator.

### 3. InmuebleForm — OCR gratuito

**Archivo:** `src/components/tramites/InmuebleForm.tsx`

- Eliminar la llamada a `consume_credit` y `restore_credit` de `handleScanDocument`.
- Eliminar la validación `credits === 0` del botón de escaneo.
- Eliminar `credits` y `refreshCredits` de `useAuth`.
- Los botones de escaneo solo se deshabilitan si ya hay un escaneo en progreso (`scanning !== null`).

### Flujo final

```text
Dashboard → "Nuevo Trámite" (GRATIS) → /tramite/{id}
  → Llenar datos manualmente (sin costo)
  → Escanear documentos OCR (sin costo, ilimitado)
  → "Previsualizar" → "Generar Word":
    → ensureUnlocked() → RPC unlock_expediente (2 créditos, primera vez)
    → Toast: "Trámite activado (2 créditos). Generación ilimitada."
  → Regeneraciones posteriores: directas (is_unlocked = true)
```

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/Dashboard.tsx` | Eliminar unlock, eliminar checks de créditos, simplificar botón |
| `src/pages/Validacion.tsx` | `isUnlocked` state, `ensureUnlocked()`, badge créditos en header |
| `src/components/tramites/InmuebleForm.tsx` | Eliminar consume/restore credit, OCR libre |

