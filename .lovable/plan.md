

## Plan: Sistema Híbrido de Monitoreo con Wrapper Centralizado

### Concepto

Crear un **wrapper centralizado** alrededor del cliente de Supabase que automáticamente registre éxito/error de todas las operaciones (edge functions, queries, inserts) sin necesidad de agregar `logEvent()` en cada feature nueva. Cualquier funcionalidad futura que use el wrapper queda automáticamente instrumentada.

### Arquitectura

```text
┌──────────────────────────────────────────────┐
│          Código de la app (features)          │
│  Usa: monitoredSupabase.functions.invoke()   │
│  Usa: monitoredSupabase.from("tabla")...     │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│     src/services/monitoredClient.ts           │
│  Wrapper que intercepta operaciones:          │
│  - functions.invoke → log éxito/error + ms   │
│  - from().insert/update/select → log errores │
│  - Fire-and-forget (no bloquea UI)           │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│           Tabla: system_events                │
│  evento, resultado, categoria, detalle,       │
│  tiempo_ms, organization_id, tramite_id       │
└──────────────────┬───────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
   ┌─────▼──────┐   ┌───────▼────────┐
   │ Proactivo   │   │ Admin Monitor  │
   │ Badge rojo  │   │ Tab con tabla  │
   │ si 3+ errs  │   │ + métricas     │
   └─────────────┘   └────────────────┘
```

### Implementación

**1. Migración SQL — Tabla `system_events`**

```sql
CREATE TABLE public.system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  tramite_id uuid,
  user_id uuid,
  evento varchar NOT NULL,
  resultado varchar NOT NULL,     -- 'success', 'error', 'warning'
  categoria varchar NOT NULL,     -- 'edge_function', 'database', 'ia'
  detalle jsonb DEFAULT '{}',
  tiempo_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_system_events_org ON system_events(organization_id, created_at DESC);
CREATE INDEX idx_system_events_resultado ON system_events(resultado, created_at DESC);
```

RLS: Authenticated puede INSERT (su org). Owners pueden SELECT todas las orgs. Admins SELECT su propia org.

**2. `src/services/monitoredClient.ts` — Wrapper centralizado**

Exporta un objeto con métodos proxy que envuelven las operaciones del cliente Supabase:
- `invokeFunction(name, body, options?)` — wrapper de `supabase.functions.invoke()` que mide tiempo, captura errores, y registra en `system_events` automáticamente
- `query(table)` — wrapper que intercepta `.select()`, `.insert()`, `.update()`, `.delete()` y registra solo los errores (no registra cada SELECT exitoso para evitar ruido)
- Toda la instrumentación es fire-and-forget con `.catch(() => {})` para nunca afectar la UX
- Captura automática de `organization_id` y `user_id` del contexto de auth

**3. Migrar llamadas existentes al wrapper**

Reemplazar las llamadas directas a `supabase.functions.invoke()` en:
- `Validacion.tsx` — `generate-document`, `validar-con-claude`
- `DocumentUploadStep.tsx` — `scan-document`

De: `supabase.functions.invoke("scan-document", { body })`
A: `monitoredClient.invokeFunction("scan-document", body)`

Esto automáticamente registra cada invocación con resultado, tiempo, y detalles del error si falla.

**4. Edge Functions — logging server-side**

Agregar INSERT a `system_events` con `service_role` en los catch blocks de:
- `scan-document/index.ts`
- `validar-con-claude/index.ts`

Esto captura errores que el cliente no puede ver (timeouts internos, errores de API de Google/Claude).

**5. Tab "Monitor" en Admin**

Nueva pestaña en `/admin` con:
- Tabla de últimos 100 eventos con filtros por tipo y resultado
- Métricas: tasa de éxito OCR, tiempo promedio Claude, errores últimas 24h
- Badge rojo en la navegación si hay 3+ errores del mismo tipo en 24h

### Extensibilidad futura

Cualquier feature nueva que use `monitoredClient.invokeFunction()` o `monitoredClient.query()` queda automáticamente instrumentada. No hay que recordar agregar logging manual.

### Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| Migración SQL | Crear tabla `system_events` con RLS e índices |
| `src/services/monitoredClient.ts` | **Nuevo** — wrapper centralizado |
| `src/services/systemEvents.ts` | **Nuevo** — helper de INSERT directo para edge functions |
| `src/components/tramites/DocumentUploadStep.tsx` | Usar `monitoredClient.invokeFunction` |
| `src/pages/Validacion.tsx` | Usar `monitoredClient.invokeFunction` |
| `src/pages/Admin.tsx` | Agregar tab "Monitor" |
| `supabase/functions/scan-document/index.ts` | INSERT en `system_events` en catch |
| `supabase/functions/validar-con-claude/index.ts` | INSERT en `system_events` en catch |

8 archivos (2 nuevos, 6 modificados) + 1 migración.

