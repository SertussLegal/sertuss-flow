# Fase 1 — Diseño detallado (retiro del auditor Claude en vivo + tablas base)

Cambio delicado. Fase 1 solo hace 3 cosas: (a) crear las 2 tablas del job de descubrimiento, (b) retirar Claude del flujo del usuario en `Validacion.tsx` sustituyéndolo por un helper determinista `computeTopIssues`, (c) marcar `validacionClaude.ts` como deprecated (stub). Nada del tab Admin (100% Fase 2). El edge function `validar-con-claude` **NO se toca ni se redespliega** en Fase 1 (queda huérfano en backend, se retira en Fase 3).

---

## 1. Archivos que se tocan (lista exacta)

### 1.1 Migración SQL nueva (una sola migración)

```sql
-- ============================================================
-- Fase 1: tablas base del job de descubrimiento de reglas
-- ============================================================

-- Runs del job
CREATE TABLE public.regla_propuesta_run (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','error')),
  disparado_por     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (disparado_por IN ('manual','cron')),
  triggered_by_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tramites_analizados INT NOT NULL DEFAULT 0,
  propuestas_generadas INT NOT NULL DEFAULT 0,
  tokens_input      INT NOT NULL DEFAULT 0,
  tokens_output     INT NOT NULL DEFAULT 0,
  costo_estimado_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  tiempo_ms         INT,
  error_detalle     JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.regla_propuesta_run TO authenticated;
GRANT ALL    ON public.regla_propuesta_run TO service_role;

ALTER TABLE public.regla_propuesta_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_reads_runs"
  ON public.regla_propuesta_run FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- (Sin INSERT/UPDATE policy: sólo service_role escribe desde la edge function.)

-- Propuestas individuales
CREATE TABLE public.regla_propuesta (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.regla_propuesta_run(id) ON DELETE CASCADE,
  tipo_acto         TEXT NOT NULL,
  categoria         TEXT NOT NULL
                    CHECK (categoria IN ('formato','coherencia','legal','negocio')),
  nivel_severidad   TEXT NOT NULL
                    CHECK (nivel_severidad IN ('error','advertencia','sugerencia')),
  titulo            TEXT NOT NULL,
  descripcion       TEXT NOT NULL,
  regla_deterministica_sugerida JSONB NOT NULL,
  campos_afectados  TEXT[] NOT NULL DEFAULT '{}',
  evidencia         JSONB NOT NULL DEFAULT '[]'::jsonb,
  frecuencia_estimada INT NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente','aprobada','rechazada','editada')),
  revisado_por      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revisado_at       TIMESTAMPTZ,
  nota_revision     TEXT,
  regla_creada_id   UUID REFERENCES public.reglas_validacion(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX regla_propuesta_run_idx    ON public.regla_propuesta(run_id);
CREATE INDEX regla_propuesta_status_idx ON public.regla_propuesta(status);

GRANT SELECT ON public.regla_propuesta TO authenticated;
GRANT ALL    ON public.regla_propuesta TO service_role;

ALTER TABLE public.regla_propuesta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_reads_propuestas"
  ON public.regla_propuesta FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- updated_at trigger reutilizando public.set_updated_at()
CREATE TRIGGER trg_regla_propuesta_updated_at
  BEFORE UPDATE ON public.regla_propuesta
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

Notas:
- **RLS lectura sólo para platform_admin.** No hay `organization_id`: es data global de producto.
- Sin INSERT/UPDATE policies en Fase 1 (nadie escribe todavía; el job es Fase 2). Se agregan en Fase 2 junto con el RPC `admin_aprobar_regla_propuesta`.

---

### 1.2 `src/pages/Validacion.tsx` — retiro de Claude

**Se eliminan:**

- Línea 19: import completo de `@/services/validacionClaude` (todos los símbolos).
- Línea 20: import `InlineBadgeDot` en Validacion.tsx **se mantiene** (lo consume `computeTopIssues` para el resumen post-generación, y los forms hijos lo importan aparte).
- Líneas 282–284: los 3 pieces of state Claude (`validacionResultado`, `validacionCampos`, `validandoCampos`) + `setValidacionResultado` en el flujo. Se conservan: `validando` (spinner del botón "Generar y Analizar Word") con nombre y comportamiento.
- Líneas ~876–898: memo `inlineBadgesByField` (mapa de badges por campo derivado de Claude) → se elimina.
- Líneas 1345–1382: función completa `validarDespuesDeCarga` (call-site #1 a Claude tras cada carga de doc). El sitio de invocación en línea 1499 se elimina también, y se depura la dependencia del `useCallback` en 1514.
- Líneas ~1960–2000: bloque completo dentro de `handleSidebarUpload`/handler pre-preview (call-site #2). Se reemplaza por: llamada directa a `setPreviewOpen(true)` (sin AlertDialog de Claude).
- Líneas 2504–2540: `hasTabInlineBadges` y su render (badges inline por tab).
- Líneas 2558, 2578–2579: uso de `validacionCampos` en el resumen superior.
- Líneas 2785, 2962: `InlineBadgeDot` cuyo `v` proviene de Claude (revisar caso por caso: si `v` es de origen determinista, se preserva).
- Líneas 2980–3060: sección UI "Validando..." + panel lateral `sidePanelItems` (obtenerSidePanel).
- Líneas 3520–3610 aprox: todo el `AlertDialog validacionDialogOpen` (dialog de errores críticos Claude) — reemplazado por nada (el flujo va directo a `PreviewModal`).
- `validacionDialogOpen`, `setValidacionDialogOpen` (state) — eliminados.

**Se agrega:**

- Import: `import { computeTopIssues, type DeterministicIssue } from "@/lib/computeTopIssues";`
- State nuevo: `const [topIssues, setTopIssues] = useState<DeterministicIssue[]>([]);`
- En `handleSidebarUpload` (y en cualquier otro punto donde hoy se llamaba a Claude pre-preview): reemplazar el bloque Claude por:
  ```ts
  const issues = computeTopIssues({
    tipoActo: actos.tipo_acto || "compraventa",
    vendedores, compradores, inmueble, actos,
  });
  setTopIssues(issues);
  setPreviewOpen(true);
  ```
- El resumen "top 3" se renderiza en `PreviewModal` (prop nueva `topIssues`) o como banner inline **sobre** el botón Generar; se elige lo segundo por ser menos intrusivo (una `Card` compacta con hasta 3 líneas: campo · nivel · explicación).

**Se conserva sin cambios:** `PersonaForm.tsx`, `InmuebleForm.tsx`, `ActosForm.tsx` reciben la prop `validaciones: Validacion[]` desde Validacion.tsx. En Fase 1 se pasa `[]` (array vacío). El tipo `Validacion` sigue existiendo (viene del stub deprecated, ver 1.4). Cero cambios en los forms hijos.

---

### 1.3 Nuevo archivo: `src/lib/computeTopIssues.ts`

Helper determinista puro (sin red, sin IA). Reglas espejo de las que ya están activas en la BD `reglas_validacion` — pero implementadas en TS para el "top 3" pre-preview. Contrato:

```ts
export interface DeterministicIssue {
  nivel: "error" | "advertencia" | "sugerencia";
  campo: string;
  explicacion: string;
  codigo_regla: string;
}

export interface ComputeInput {
  tipoActo: string;
  vendedores: any[];
  compradores: any[];
  inmueble: any;
  actos: any;
}

export function computeTopIssues(input: ComputeInput, max = 3): DeterministicIssue[];
```

Reglas implementadas en Fase 1 (subset alto-ROI, no las 35):
1. **Personas sin cédula** (campo `numero_cedula` vacío) → error.
2. **Vendedores o compradores en 0** → error.
3. **Inmueble sin matrícula inmobiliaria** → error.
4. **Cuantía en 0 o vacía** cuando `tipo_acto` la requiere (compraventa, hipoteca) → error.
5. **CHIP vacío en Bogotá** o **cédula catastral vacía en otros municipios** → advertencia.
6. **Falta lugar_expedicion** en al menos una persona → advertencia.
7. **Notaría de trámite incompleta** (numero_notaria, circulo o notario) → error.

Devuelve máximo `max` items, priorizando error > advertencia > sugerencia. Testeable con vitest en aislamiento; se agrega `src/lib/computeTopIssues.test.ts` con al menos 1 caso por regla.

---

### 1.4 `src/services/validacionClaude.ts` — stub deprecated

Se **reduce a stub** (no se borra, para no romper imports de tipo `Validacion` en 3 forms):

```ts
/**
 * @deprecated Fase 1 (2026-07): auditor Claude en vivo retirado.
 * Este módulo sólo mantiene el tipo `Validacion` para retrocompatibilidad
 * de PersonaForm/InmuebleForm/ActosForm. Toda la lógica de invocación fue removida.
 * La reconversión del edge function a "descubrimiento de reglas" ocurre en Fase 2.
 */
export interface Validacion {
  nivel: "error" | "advertencia" | "sugerencia";
  codigo_regla: string;
  campo: string;
  campos_relacionados?: string[];
  valor_actual?: string;
  valor_sugerido?: string;
  explicacion: string;
  auto_corregible: boolean;
  ui_target?: "modal_bloqueante" | "side_panel_audit" | "field_inline_badge";
  priority?: "high" | "medium" | "low";
}
```

Todas las funciones (`validarConClaude`, `contarPorNivel`, `obtenerBloqueantes`, etc.) se eliminan del archivo. Cualquier import roto se detectará al build; se limpia en Validacion.tsx en el mismo commit.

---

### 1.5 `src/pages/Admin.tsx` — NO se toca en Fase 1

El botón de test manual de Claude (línea 186) sigue existiendo apuntando al edge function actual. En Fase 2 se retira junto con la aparición del tab "Reglas propuestas". Decisión consciente: mantener herramienta de debug hasta reconvertir el edge.

---

### 1.6 Edge functions — NO se tocan en Fase 1

- `supabase/functions/validar-con-claude/index.ts`: sin cambios. Queda desplegado pero sin cliente que lo llame (excepto botón de test en Admin).
- `supabase/config.toml`: sin cambios.
- Cero riesgo de imports cross-src, cero redeploy.

---

## 2. Reversibilidad

| Cambio | Reversible por | Riesgo |
|---|---|---|
| Migración SQL | `DROP TABLE regla_propuesta, regla_propuesta_run CASCADE;` (aditivo, no toca tablas existentes) | Muy bajo |
| Retiro Claude en Validacion.tsx | Revert del commit vía historial de Lovable | Bajo (código previo intacto en git) |
| Stub validacionClaude.ts | Revert del commit | Bajo |
| computeTopIssues.ts nuevo | `rm` del archivo | Ninguno |

Punto de rollback único: revert al commit anterior a Fase 1. Las tablas nuevas quedan huérfanas pero inactivas (sin escritores).

---

## 3. Plan de verificación

**Automatizado (obligatorio antes de merge):**
- `computeTopIssues.test.ts`: ≥7 casos (uno por regla).
- Build TypeScript sin errores (`tsgo`) — detecta imports rotos.
- Vitest de contract existentes deben pasar sin cambios (no dependen de Claude).

**Manual (checklist QA):**
1. Login → nuevo trámite compraventa → cargar cédula → **NO** aparece spinner "Validando…", **NO** aparece panel lateral Claude, **NO** dot inline en tabs.
2. Completar mínimo (vendedor, comprador, inmueble, actos) → click "Generar y Analizar Word" → **NO** aparece `AlertDialog` de "Revisión de validación" → abre `PreviewModal` directamente.
3. Sobre el botón Generar, aparece Card compacto con **hasta 3 hallazgos** deterministas (o vacío si todo OK).
4. Con datos incompletos (ej: sin matrícula) → top issues muestra el error correspondiente en rojo.
5. Cancelaciones y otros flujos: sin cambios (Claude nunca los tocó, verificar por regresión).
6. Admin → botón "Test Claude" sigue funcionando (fase 2 lo retira).
7. Consola sin warnings/errores nuevos relacionados a `validacionClaude`.
8. Network tab: cero llamadas a `/functions/v1/validar-con-claude` durante flujo normal de usuario.

**BD (post-migración):**
- `\d public.regla_propuesta` y `\d public.regla_propuesta_run` muestran estructura correcta.
- `SELECT count(*) FROM regla_propuesta;` = 0 (sin escritores aún).
- Como usuario no-admin: `SELECT * FROM regla_propuesta;` → 0 filas (RLS bloquea).

---

## 4. Riesgo específico: dependencias ocultas de `validacionResultado`

**Verificado por grep completo (`rg validacionResultado|validacionCampos|validarConClaude`):**

- ✅ `validacionResultado`: solo se lee dentro del `AlertDialog` (líneas 3520–3610) que se elimina en el mismo commit.
- ✅ `validacionCampos`: solo alimenta memos internos (`inlineBadgesByField`, `hasTabInlineBadges`, resumen 2558/2578) que también se eliminan.
- ✅ `PersonaForm`/`InmuebleForm`/`ActosForm` reciben `validaciones` como prop desde Validacion.tsx; en Fase 1 se pasa `[]` — los componentes renderizan sin badges, cero crashes (ya soportan array vacío por lógica de `filter()`).
- ✅ `InlineBadgeDot` en sí es agnóstico al origen; se conserva por si otros contextos lo usan.
- ✅ Ningún hook, contexto, o storage persiste el resultado de Claude → no hay estado zombie en localStorage/sessionStorage.
- ✅ `creditsBus.ts` sí referencia `"validar-con-claude"` como una `CreditAction`. Se conserva (no cuesta nada, y el edge sigue vivo para el botón de Admin).

**Conclusión:** el borrado es seguro. Ningún consumidor externo al bloque UI que se elimina lee `validacionResultado`/`validacionCampos`.

---

## 5. Redeploy de edge functions

**Ninguno.** Fase 1 es puramente:
- 1 migración SQL (aditiva).
- Cambios frontend (React/TS).
- Sin `deno.json`, sin imports cross-src, sin riesgo del bug de shim que ya resolvimos hoy.

`validar-con-claude` queda deployado y funcional pero silenciado desde el cliente. Su reconversión (nuevo endpoint `descubrir-reglas` o mutación del actual) es Fase 2.

---

## Resumen ejecutivo

Fase 1 = migración + retiro quirúrgico del auditor en vivo + helper determinista + stub. Sin tocar backend deployado. Reversible en un revert. Tests unitarios cubren el helper nuevo; checklist QA cubre regresiones UI. Cero riesgo de imports cross-src.

**Espero aprobación línea por línea antes de pasar a build mode.**
