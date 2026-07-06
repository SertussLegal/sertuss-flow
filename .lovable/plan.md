
# Diagnóstico — Modelo de consumo de créditos

Solo lectura. Ninguna modificación propuesta en esta respuesta.

---

## 1. SQL completo de las funciones

### `consume_credit` (LEGACY — wrapper delgado)

```sql
CREATE OR REPLACE FUNCTION public.consume_credit(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN public.consume_credit_v2(org_id, auth.uid(), 'LEGACY', NULL, NULL, 1);
END;
$$;
```

Solo delega en v2 con `action='LEGACY'` y 1 crédito. **No la llama nadie en el código actual** (grep no encuentra call-sites). Se mantiene por compatibilidad histórica.

### `consume_credit_v2` (LA QUE SE USA)

```sql
CREATE OR REPLACE FUNCTION public.consume_credit_v2(
  p_org_id uuid, p_user_id uuid, p_action text,
  p_tramite_id uuid DEFAULT NULL, p_tipo_acto text DEFAULT NULL,
  p_credits integer DEFAULT 1
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE current_balance integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships
                 WHERE user_id = auth.uid() AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Unauthorized: not a member of organization';
  END IF;

  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < p_credits THEN
    RETURN false;
  END IF;

  UPDATE public.organizations
  SET credit_balance = credit_balance - p_credits
  WHERE id = p_org_id;

  INSERT INTO public.credit_consumption
    (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, p_action, p_credits, p_tipo_acto);

  RETURN true;
END;
$$;
```

Atómica (`FOR UPDATE` + `UPDATE` + `INSERT` en misma tx). Valida membership y coincidencia de user.

Extra: `unlock_expediente(org, tramite, user)` — función paralela, hardcodea `credits = 2`, `action = 'APERTURA_EXPEDIENTE'`, resta y registra en `credit_consumption` + `activity_logs` en la misma transacción.

---

## 2. `src/services/credits.ts`

```ts
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type CreditAction =
  | "VALIDACION_CLAUDE" | "OCR_DOCUMENTO" | "GENERACION_DOCX"
  | "APERTURA_EXPEDIENTE" | "OTRO";

export interface ConsumeCreditOpts {
  organizationId: string; userId: string; action: CreditAction | string;
  tramiteId?: string | null; tipoActo?: string | null;
  credits?: number; silent?: boolean;
}

export async function consumeCredit(opts: ConsumeCreditOpts): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_credit_v2", {
    p_org_id: opts.organizationId, p_user_id: opts.userId,
    p_action: opts.action, p_tramite_id: opts.tramiteId ?? undefined,
    p_tipo_acto: opts.tipoActo ?? undefined,
    p_credits: opts.credits ?? 1,       // ← default 1, no constante central
  });
  if (error) { /* toast + return false */ }
  if (!data) { /* toast "sin créditos" + return false */ }
  return true;
}

export function notifyHttpQuotaError(status: number, fallback?: string): boolean { … }
```

Puntos clave:
- El wrapper acepta `credits` como parámetro opcional; por defecto **1**.
- **No hay constante/enum de precios** — cada call-site decide su propio número.

---

## 3. Call-sites y tabla acción → costo

Grep exhaustivo sobre todo el repo (`src/` + `supabase/functions/`):

| Acción del usuario | Créditos HOY | `p_action` | `p_tipo_acto` | Dónde está el número |
|---|---|---|---|---|
| Subir documento OCR (escrituras: sidebar en Validación) | **1** (default del wrapper) | `OCR_DOCUMENTO` | `actos.tipo_acto` | `src/pages/Validacion.tsx:1386` — omite `credits`, cae al default `?? 1` de `credits.ts:33` |
| Abrir/desbloquear expediente de escritura (compraventa+hipoteca) | **2** | `APERTURA_EXPEDIENTE` | derivado en SQL | `src/pages/Validacion.tsx:1854` → `rpc("unlock_expediente")`; el **`2` está hardcodeado dentro del SQL** de `unlock_expediente` (migración `20260310023133`, línea `credit_balance - 2`) |
| Generar docx de cancelación de hipoteca | **2** | `GENERACION_DOCX` | `cancelacion_hipoteca` | `supabase/functions/procesar-cancelacion/index.ts:1934` — literal `p_credits: 2` en el body del rpc |
| Validación con Claude (`VALIDACION_CLAUDE`) | — declarado como tipo pero **no se cobra en ningún call-site** | — | — | Solo aparece como etiqueta en `src/pages/Team.tsx:252, 486` (filtro del reporte) y en el enum de `credits.ts`. No hay rpc que la cargue. |
| Generación de docx de escritura (compraventa/hipoteca) | **0 adicional** | — | — | Cubierto por `APERTURA_EXPEDIENTE` (2 créditos ya cobrados). Comentarios explícitos en `Validacion.tsx` y `CancelacionValidar.tsx:513`. |

Evidencia adicional en producción (query a `credit_consumption`, todos los cobros históricos):

```
     action        | credits | count
-------------------+---------+-------
 GENERACION_DOCX   |    2    |   19    ← siempre cancelaciones
 APERTURA_EXPEDIENTE|   2    |   10    ← siempre escrituras
```

Nunca se ha registrado un cobro de `OCR_DOCUMENTO` ni `VALIDACION_CLAUDE` en producción — aunque el código de `Validacion.tsx:1386` sí lo intenta al subir un doc lateral en el flujo de escrituras. (Posible causa: los cobros solo ocurren después de `unlock_expediente`; antes el flujo de escritura ni siquiera llega a llamar OCR desde el sidebar en el volumen actual.)

### Dónde vive cada número (resumen)

| Costo | Ubicación | Cambiar requiere |
|---|---|---|
| `OCR_DOCUMENTO = 1` | Default `?? 1` en `src/services/credits.ts:33` (implícito, no explícito) | Editar JS y redeploy front |
| `APERTURA_EXPEDIENTE = 2` | Hardcodeado en SQL de `unlock_expediente` (línea `credit_balance - 2` y `VALUES (…, 2, …)`) | **Migración de BD** |
| `GENERACION_DOCX = 2` (cancelación) | Literal `p_credits: 2` en edge function `procesar-cancelacion/index.ts:1934` | Editar TS y redeploy edge function |

**No existe un catálogo/constante centralizada.** Los 3 números viven en 3 capas diferentes (front, edge, SQL).

---

## 4. ¿Tabla de "planes" o "precios" en BD?

**NO EXISTE.** Verificado con `\dt public.*`. Tablas presentes: `activity_logs, actos, cancelaciones, config_tramites, configuracion_notaria, credit_consumption, historial_validaciones, inmuebles, invitations, logs_extraccion, memberships, modules, notaria_styles, ocr_raw_cache, organization_modules, organizations, personas, plantillas_validacion, profiles, radicado_counters, reglas_validacion, system_events, tramites, user_active_context`.

- Ni `plans`, ni `pricing`, ni `packages`, ni `credit_prices`, ni `action_costs`.
- `organizations.credit_balance` es un `integer` plano — no distingue tipos de crédito ni tiene "plan_id".
- `credit_consumption` es **solo bitácora** (audit trail), no configuración.

**Consecuencia:** hoy no se puede cambiar cuánto cuesta una acción sin tocar código (front, edge function o migración SQL, dependiendo de la acción). Cada capa requiere un canal de deploy distinto.

---

## 5. Planes y precios en COP (Wompi u otro)

**Ninguna evidencia de integración de pagos.** Grep `wompi|stripe|mercadopago|pricing|checkout|pago|paquete` sobre todo el repo (excluyendo docs de plantillas) → 0 resultados en `src/` y `supabase/functions/`.

- No hay tabla de planes en BD.
- No hay edge function de checkout/webhook.
- No hay secreto `WOMPI_*` registrado (solo aparecen: `SUPABASE_*`, `LOVABLE_API_KEY`, `CLAUDE_API_KEY`, `GOOGLE_API_KEY`).
- La única forma de "recargar" créditos hoy es manual: SuperAdmin (info@sertuss.com) usa `admin_update_credits(org, new_balance, reason)` en `/admin`. Queda en `activity_logs` con acción `CREDIT_UPDATE`.
- El botón "Ver planes" del modal `CreditsBlockedModal` redirige a `/equipo` (`src/pages/Team.tsx`), pero esa página **no tiene checkout** — solo muestra el consumo histórico y los miembros.

Onboarding: `handle_new_user` regala **5 créditos iniciales** al crear la organización personal (evidencia: función SQL en `<db-functions>`).

Estado actual en producción (query real):
```
 ALEJANDRA ARCINIEGAS ABOGADA │ 48 créditos
 Sertuss Notaría Central       │ 68 créditos
```
Ambas cargas son ajustes manuales del SuperAdmin.

---

## 6. Costo real para Sertuss por consulta

**No hay ninguna instrumentación de costos en el código.** No se registran tokens consumidos, ni USD facturados, ni modelo usado por request en tablas de auditoría.

Lo que sí se sabe leyendo el código de las edge functions:

| Consulta | Proveedor | Modelo | Tokens/costo estimable |
|---|---|---|---|
| `scan-document` (OCR) | Google (Gemini directo con `GOOGLE_API_KEY`) | `gemini-2.5-flash` con tool calling + imágenes JPEG del expediente | Depende del nº de páginas subidas; **no se loguea `usage`** de Gemini |
| `process-expediente` (redacción) | Google Gemini | `gemini-2.5-pro` con prompt largo + salida HTML completa | 1 llamada por escritura; **sin registro de tokens** |
| `procesar-cancelacion` | Google Gemini + lógica determinista | Gemini + docx template desde bucket | **sin registro de tokens** |
| `validar-con-claude` | Anthropic (`CLAUDE_API_KEY` directa) | Claude Sonnet 4 | **sin registro de tokens** |

- Ninguna función guarda `response.usage.total_tokens`, `input_tokens`, `output_tokens`, ni un campo `cost_usd` en `credit_consumption`, `activity_logs` o `system_events`.
- No hay tabla `ai_gateway_requests` propia (Lovable AI Gateway sí registra internamente, pero eso está fuera del código del proyecto y solo lo ve el workspace vía `ai_gateway_logs--*`).
- Para obtener un costo real por trámite hoy toca cruzar manualmente: (a) facturas de Google AI Studio, (b) facturas de Anthropic, (c) uso del AI Gateway de Lovable — ninguno reconciliado con `credit_consumption.tramite_id`.

**Recomendación NO ejecutada** (fuera de alcance de este diagnóstico): antes de rediseñar precios, instrumentar cada edge function para guardar `input_tokens`, `output_tokens` y modelo usado en `credit_consumption.metadata` (columna aún no existe, requiere migración).

---

## Resumen ejecutivo

- **3 acciones cobran hoy**, con precios en 3 capas distintas (SQL, edge TS, default de wrapper JS).
- **1 acción declarada (`VALIDACION_CLAUDE`) no cobra en ningún flujo real.**
- **Cero infraestructura de planes/precios en BD.**
- **Cero integración de pagos (Wompi/otros).** Recargas 100% manuales por SuperAdmin.
- **Cero telemetría de costos IA.** Rentabilidad por trámite es hoy un cálculo externo, no consultable desde la app.

Cambiar precios en el futuro requerirá, en el mejor caso, tocar 3 sitios; en el peor (si se quiere flexibilidad por org/plan) una migración que introduzca una tabla `credit_prices(action, tipo_acto, credits)` consultada dentro de `consume_credit_v2` / `unlock_expediente`.
