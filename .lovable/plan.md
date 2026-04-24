
## Plan aprobado — listo para ejecutar en modo Build

Mismo plan presentado anteriormente, con la adición solicitada en la pestaña Consumo.

### Adición — Filtros en pestaña Consumo (`Team.tsx`)

La tabla de auditoría incluye **rango de fechas** además de los filtros previos:

- **DateRangePicker** (`<Popover>` + `<Calendar mode="range">` Shadcn con `pointer-events-auto`):
  - Botón compacto "Del DD/MMM/AAAA al DD/MMM/AAAA" (ES locale, `date-fns`).
  - Default: primer día del mes actual → hoy.
  - Validación: `from <= to`, máximo 365 días.
- **Atajos rápidos** debajo del calendario: "Hoy", "Esta semana", "Quincena actual" (1–15 / 16–fin), "Mes actual", "Mes anterior", "Últimos 90 días".
- **Filtros adicionales**: Select "Miembro" (todos / cada membership), Select "Acción" (todas / `VALIDACION_CLAUDE` / `APERTURA_EXPEDIENTE` / `LEGACY`).
- **Query** a `credit_consumption`:
  ```ts
  .gte("created_at", from.toISOString())
  .lte("created_at", endOfDay(to).toISOString())
  .eq("organization_id", profile.organization_id)
  ```
- **Resumen superior** (KPI cards): Total créditos consumidos · Total trámites únicos · Miembro con mayor consumo.
- **Botón "Exportar CSV"** del rango filtrado (cliente, sin backend) para cierres quincenales.

El resto del plan permanece idéntico:
1. AuthContext multi-membership + `switchContext` (RPC `set_active_context`).
2. `ProfileSwitcher` en headers respetando `h-12` y chip radicado `w-[180px]`.
3. Sincronía notaría (ya existe en `Validacion.tsx`); agrupación visual ya existe en `DocxPreview.tsx` líneas 830–869 — solo verificar dirty tracking cruzado.
4. Migración a `consume_credit_v2` en `Validacion.tsx` línea 1188.
5. Wrapper `src/services/credits.ts` + manejo 402/429.
6. Guard `if (!claudeResponse)` en `validar-con-claude/index.ts`.
7. `Login.tsx` — campo `full_name`.
8. Migración SQL menor: policy "Admins can update org profiles" para edición inline de nombre.

**Procedo a implementar en cuanto se active el modo Build.**
