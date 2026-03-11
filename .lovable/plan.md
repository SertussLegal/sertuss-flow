

## Plan: Mejora de Borradores — Guardado robusto, auto-eliminación 15 días, rediseño de tarjetas

Sin cambios respecto al plan aprobado previamente, excepto el mensaje informativo que pasa a ser:

> **"Borradores inactivos se eliminan tras 15 días."**

Todos los demás cambios se mantienen idénticos:

1. **`src/pages/Validacion.tsx`** — Guardado forzado al navegar internamente + reducir debounce a 15s
2. **`src/pages/Dashboard.tsx`** — Rediseño tarjetas borradores, query enriquecida con conteo de personas/inmuebles, mensaje corto actualizado
3. **`supabase/functions/cleanup-drafts/index.ts`** — Edge function para limpieza diaria
4. **DB Migration** — FK cascade en personas/inmuebles/actos → tramites + cron job diario

