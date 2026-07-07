# Ajuste presentación COP — Fase 2 (solo diseño)

Cambio pequeño y aislado. No toca arquitectura, no rompe nada existente. Solo agrega una columna informativa y ajusta cómo se muestra el costo en el panel Admin.

---

## 1. DDL — ALTER TABLE sobre `regla_propuesta_run` existente

La tabla ya existe (creada en sesión anterior). Se agrega **una** columna nueva, sin tocar el resto.

```sql
-- Migración: add_costo_cop_a_regla_propuesta_run

-- TRM de referencia fija, documentada como aproximada.
-- No consultamos API externa: es dato informativo, no contable.
-- Fuente de verdad para facturación sigue siendo costo_estimado_usd.
ALTER TABLE public.regla_propuesta_run
  ADD COLUMN IF NOT EXISTS costo_estimado_cop numeric(12, 2)
    GENERATED ALWAYS AS (ROUND(costo_estimado_usd * 3900, 2)) STORED;

COMMENT ON COLUMN public.regla_propuesta_run.costo_estimado_cop IS
  'Costo estimado en COP calculado con TRM fija de referencia (3900 COP/USD). No es tiempo real, no reemplaza facturación. Fuente de verdad: costo_estimado_usd.';
```

**Justificación de columna GENERATED STORED (no calculada en JS):**
- Consistencia: cualquier consulta (UI, reportes, exports) ve el mismo valor sin duplicar la constante.
- Reversibilidad: si mañana subimos la TRM a 4100, cambiamos la fórmula en una sola migración y no rehacemos frontend.
- Costo cero: se calcula al INSERT/UPDATE de `costo_estimado_usd`, no en cada SELECT.

**Alternativa considerada y descartada:** calcular en el frontend con una constante en `src/lib/currency.ts`. Rechazada porque duplica la TRM en dos capas y cualquier reporte SQL directo no tendría el valor.

**Sobre cambiar la TRM en el futuro:** requiere un nuevo `ALTER TABLE` que redefina la columna generada. Documentado como aceptable dado que es dato informativo (no se actualiza en producción de forma frecuente). Si más adelante se quisiera TRM dinámica, se crearía una tabla `fx_rates` y se convertiría a columna calculada en la vista — fuera de alcance ahora.

---

## 2. Ajustes en el Paso B — edge function `descubrir-reglas`

Sin cambios en código. La función sigue haciendo solo:

```ts
UPDATE regla_propuesta_run
   SET costo_estimado_usd = <calculado>,
       tokens_input = ...,
       tokens_output = ...
 WHERE id = <run_id>;
```

El campo `costo_estimado_cop` se rellena automáticamente por ser GENERATED. Cero código adicional en la edge function.

---

## 3. Ajustes en el Paso C/D — UI `<ReglasPropuestas />`

### 3.1 Helper de formato

Nuevo helper compartido (`src/lib/currency.ts` o inline en `ReglasPropuestas.tsx` — sugiero inline por ahora, mover a `src/lib/` si aparece un segundo consumidor):

```ts
function formatCosto(usd: number | null, cop: number | null): React.ReactNode {
  if (usd == null && cop == null) return <span className="text-muted-foreground">—</span>;
  const copFmt = cop != null
    ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(cop)
    : null;
  const usdFmt = usd != null
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(usd)
    : null;
  return (
    <span className="tabular-nums">
      {copFmt && <span className="text-foreground">≈ {copFmt}</span>}
      {copFmt && usdFmt && " "}
      {usdFmt && <span className="text-xs text-muted-foreground">({usdFmt})</span>}
    </span>
  );
}
```

Notas:
- `Intl.NumberFormat("es-CO", currency: "COP")` produce `$470` (sin decimales, con punto como separador de miles). Coincide con la convención colombiana.
- USD entre paréntesis usa `text-xs text-muted-foreground` = cifra secundaria gris pequeña.
- `tabular-nums` alinea columnas cuando aparezca en tabla.
- Prefijo `≈` deja claro que es aproximado (refuerza el `COMMENT ON COLUMN`).

### 3.2 Dónde se aplica

**Card superior "Descubrimiento de reglas nuevas"** — subtítulo del último run:
```tsx
<p className="text-sm text-muted-foreground">
  Último análisis: {formatDate(lastRun.iniciado_at)} ·
  {" "}{lastRun.propuestas_generadas} propuestas ·
  {" "}Costo: {formatCosto(lastRun.costo_estimado_usd, lastRun.costo_estimado_cop)}
</p>
```

**Tabla del historial de runs** — nueva columna reemplaza a la anterior "Costo USD":
```tsx
<TableHead className="text-right">Costo</TableHead>
...
<TableCell className="text-right">
  {formatCosto(run.costo_estimado_usd, run.costo_estimado_cop)}
</TableCell>
```

**Modal de detalle del run** (si existiera en Paso E) — mismo helper.

### 3.3 Tipos TypeScript

Después de la migración, `src/integrations/supabase/types.ts` se regenera y añade `costo_estimado_cop: number | null` a `regla_propuesta_run` automáticamente. No hay que tocar tipos a mano.

---

## 4. Ejemplo visual esperado

```
Último análisis: 07/07/2026 14:32 · 8 propuestas · Costo: ≈ $470 (US$0.12)
                                                          ^^^^^^   ^^^^^^^^
                                                          foreground muted-fg
                                                          normal     xs
```

Tabla:
```
| Fecha       | Status  | Trámites | Propuestas | Costo             |
|-------------|---------|----------|------------|-------------------|
| 07/07 14:32 | success | 50       | 8          | ≈ $470 (US$0.12)  |
| 06/07 11:04 | error   | 50       | 3          | ≈ $195 (US$0.05)  |
```

---

## 5. Impacto en el resto del plan

- **Migración:** una sola `ALTER TABLE ADD COLUMN GENERATED` — trivial, reversible con `DROP COLUMN`.
- **Edge function:** cero cambios.
- **UI:** helper de ~10 líneas + 3 sitios donde se usa.
- **Tests:** ninguno nuevo necesario (dato informativo, no lógica de negocio). Si se quiere paranoia, un test de `formatCosto` con 4 casos (usd+cop, solo usd, solo cop, ambos null) — recomiendo posponer a Paso F.
- **Riesgo:** cero. La columna es GENERATED, no puede quedar desincronizada.

---

**Nada aplicado.** Espero aprobación para agregar este ALTER en la migración del Paso E (junto con `admin_review_propuesta`) o correrlo por separado ahora — tu decisión.
