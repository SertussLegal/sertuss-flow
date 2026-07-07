
# Auditoría final de sesión — reporte SOLO LECTURA

## 1. Tests
`bunx vitest run` → **13 archivos / 115 tests, 100% verde** (7.84s). Sin warnings de resource leaks.

## 2. Tipos
`bunx tsgo --noEmit` → **0 errores, 0 output**. Limpio.

## 3. Bypass regression_cuantia — confirmado cerrado
Código en `procesar-cancelacion/index.ts:1806-1812`:
```ts
if (bodyAny?.action === "regression_cuantia") {
  const { data: isAdminData, error: isAdminErr } = await supabaseUser.rpc("is_platform_admin");
  if (isAdminErr || isAdminData !== true) {
    return new Response(JSON.stringify({ error: "Forbidden: platform admin required" }), { status: 403, ... });
  }
```
Solo `is_platform_admin()`. Cero matches de `REGRESSION_CUANTIA_TOKEN`, `X-Regression-Token` o `hasRegressionBypass` en todo el repo. Secreto ya no listado.

## 4. Estado real en BD de los 3 casos de cuantía
```
4b05d210 → valor_hipoteca_original = "OCHO MILLONES ... ($8.558.475)"   updated 2026-06-24
290fd66a → valor_hipoteca_original = NULL                                updated 2026-07-06
2bef1db3 → valor_hipoteca_original = NULL                                updated 2026-07-07
```
**Discrepancia detectada:** El modo `regression_cuantia` de hoy reportó `indeterminada_confirmada` para `290fd66a` y `2bef1db3`, pero ese modo es solo-lectura y no persiste. En BD ambos siguen con `valor_hipoteca_original = NULL` y **no hay columna `valor_hipoteca_es_indeterminada`** (no existe en el schema de `cancelaciones` — solo hay `valor_hipoteca`, `valor_hipoteca_original`, `numero_escritura_hipoteca`, `fecha_escritura_hipoteca`, `notaria_hipoteca`). Es decir, el flag booleano de "indeterminada" que devuelve el extractor no tiene columna persistente donde aterrizar en `cancelaciones`. Cabo suelto arquitectónico — revisar si debe persistirse o si vive solo en `data_ia`/logs.

## 5. Feature flags — estado y relación con la cuantía
| Flag | Default | Estado |
|---|---|---|
| `POWER_DEEP_SCHEMA_ENABLED` (alias `POWER_V5_ENABLED`) | **OFF** | Edge; controla pipeline profundo del Poder |
| `POWER_V6_EXTRACTOR_ENABLED` | **OFF** | Edge; extractor v6 del Poder |
| `VITE_POWER_DEEP_UI_ENABLED` | **ON** | Cliente; UI profunda del Poder |

**Punto importante y positivo:** `extractCuantiaDedicada` se invoca en el flujo real de usuarios en `index.ts:2092` y `:2421` (no solo desde regression mode). **El prompt semántico de cuantía validado hoy YA ESTÁ ACTIVO en producción**, no gateado por flag.

**Riesgo desalineado:** `POWER_V5/V6` están OFF por defecto en edge, pero la UI (`VITE_POWER_DEEP_UI_ENABLED`) está ON. Si un despliegue no setea explícitamente los flags edge, la UI muestra widgets profundos mientras el backend corre en modo legacy — puede producir estados inconsistentes en el Poder. Verificar los secrets de edge en el entorno de producción.

## 6. Residuos de la sesión
- **`_regression_cuantia.ts`**: script one-shot con encabezado que aclara "NO es edge function invocable — no exporta handler, no se despliega". Documentado correctamente; se puede conservar como herramienta de re-validación futura o mover a `scripts/`. No es urgente.
- **TODOs/FIXMEs añadidos hoy**: ninguno detectado. Los "TODOS" que aparecen son la palabra en español mayúscula en prompts.
- **Borradores huérfanos**: 0 pendientes de más de 15 días, 0 pendientes totales. `purge_expired_drafts` no tiene trabajo pendiente.
- **Secrets huérfanos**: lista actual = `CLAUDE_API_KEY`, `GOOGLE_API_KEY`, `LOVABLE_API_KEY`, `SUPABASE_*`. Sin residuos.

## 7. Recomendación: correr Deep Security Scan
No lo ejecuté (solo-lectura estricta y evita alterar estado del scanner). Se recomienda correr `security--run_security_scan` en el próximo turno, especialmente porque hoy se tocaron: RLS, gate de admin, y edge functions con service_role.

## 8. Cabos sueltos / cosas a mirar
1. **`valor_hipoteca_es_indeterminada` sin columna en `cancelaciones`** — el extractor lo devuelve, pero la BD no lo persiste. ¿Se pierde información?
2. **Flags `POWER_V5/V6_ENABLED` OFF por default en edge vs UI ON** — posible desalineación en producción.
3. **`_regression_cuantia.ts`** dentro de `supabase/functions/` — Deno lo verá, no es un edge (no exporta handler) pero convive con `index.ts`. Considerar moverlo fuera del directorio de la función (`scripts/` o `tools/`) para evitar confusión.
4. **Los 2 casos `290fd66a` y `2bef1db3`** en BD siguen sin cuantía persistida. Si en la operación real esos trámites deberían quedar marcados como "indeterminada" tras el rediseño, hay que reprocesarlos por la vía normal (no regression) para que se persistan.

## Veredicto
La sesión quedó **verde en lo estructural**: tests 115/115, tipos 0 errores, bypass cerrado, sin residuos de secrets. **Cabos sueltos reales**: la persistencia del flag `es_indeterminada` (arquitectural) y la desalineación de flags Power V5/V6 (operacional). Nada bloqueante pero merecen un ticket cada uno.

---
*Este reporte es solo lectura — no requiere aprobación de plan; ninguna acción de código propuesta.*
