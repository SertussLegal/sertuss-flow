

## Plan: Cambiar Monetización a "Apertura de Expediente"

### Resumen

Migrar de cobro por generación de Word (1 crédito en `handleConfirmGenerate`) a cobro de **2 créditos al crear el trámite** ("Nuevo Trámite"). Una vez desbloqueado, OCR y generación de Word son ilimitados para ese expediente.

### 1. Migration — Agregar `is_unlocked` a `tramites`

```sql
ALTER TABLE public.tramites ADD COLUMN is_unlocked boolean NOT NULL DEFAULT false;
```

### 2. RPC — `unlock_expediente`

Función atómica que:
- Verifica `credit_balance >= 2` para la organización
- Descuenta 2 créditos
- Registra en `activity_logs` con acción `APERTURA_EXPEDIENTE`
- Retorna `true` o `false`

```sql
CREATE OR REPLACE FUNCTION public.unlock_expediente(org_id uuid, p_tramite_id uuid)
RETURNS boolean ...
```

### 3. Dashboard — Cobro al crear trámite

En el botón "Nuevo Trámite":
- Antes de navegar a `/tramite/nuevo`, llamar `unlock_expediente` via RPC
- Crear el trámite con `is_unlocked = true` y navegar a `/tramite/{id}`
- Cambiar validación de `credits === 0` a `credits < 2`
- Mostrar "Necesitas al menos 2 créditos" en lugar del mensaje actual

### 4. Validacion.tsx — Eliminar cobro en generación de Word

- Remover la llamada a `consume_credit` en `handleConfirmGenerate`
- Remover la validación de créditos en la generación (ya se cobró al abrir)
- En auto-save de nuevos borradores: crear con `is_unlocked = true` (ya se cobró)

### 5. Flujo revisado

```text
Dashboard → "Nuevo Trámite" → RPC unlock_expediente (2 créditos)
  → Crea tramite con is_unlocked=true → Navega a /tramite/{id}
  → OCR ilimitado (scan-document no cobra)
  → Generar Word sin cobro adicional
```

### 6. scan-document — Sin cambios

La Edge Function actualmente NO consume créditos internamente. No requiere modificación.

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| Migration SQL | `is_unlocked` column + `unlock_expediente` RPC |
| `src/pages/Dashboard.tsx` | Cobro de 2 créditos al crear, validación `credits < 2` |
| `src/pages/Validacion.tsx` | Remover `consume_credit` de generación Word, auto-save con `is_unlocked` |

