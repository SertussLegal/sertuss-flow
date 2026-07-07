# Diagnóstico causa raíz — alerta persistente `adaptar-estilo-prosa`

**Modo:** SOLO LECTURA. No se aplicó ningún cambio.

## 1. Evidencia recolectada

### A. Timeline verificado
- Fix desplegado: **2026-07-07 14:08:55 UTC** (mtime real del archivo).
- Último scan: **2026-07-07 14:17:37 UTC** (~9 min después del fix). Campo `up_to_date: true`.
- Creación original de la finding: **2026-07-07 12:16:36 UTC** (antes del fix). El scanner **no cerró** la finding al re-correr.

Esto ya descarta "escaneo obsoleto" como en el turno anterior. El scan sí corrió después del fix.

### B. Prueba runtime — 5 variantes anónimas contra el endpoint en producción
Todas devuelven **HTTP 401** ahora mismo:
- Sin ningún header → 401
- Solo `apikey` anon (sin Authorization) → 401
- `Authorization:` vacío → 401
- `Authorization: Bearer_malformed` (sin espacio) → 401
- `Authorization: Bearer_` → 401

El endpoint está correctamente protegido en runtime. **No hay bypass real.**

### C. Comparativa con las funciones que SÍ pasan el scan
`process-expediente` y `procesar-cancelacion` usan el **mismo patrón exacto** que `adaptar-estilo-prosa`:
- Ninguna tiene `[functions.<name>] verify_jwt = true` en `supabase/config.toml` (config.toml solo declara `scan-document` y `validar-con-claude`, ambas con `verify_jwt = false`).
- Las 3 confían en validación aplicativa: `req.headers.get("Authorization")` → check `Bearer ` → `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization } } })` → `auth.getClaims(token)` → 401.
- El patrón que exige el scanner ("Example from scan-document/index.ts" en la remediation) coincide **literalmente** con lo que ya tenemos.

Hipótesis (1) descartada: el scanner no exige `verify_jwt` a nivel plataforma; si lo exigiera, `process-expediente` y `procesar-cancelacion` también estarían flagged.

### D. Sin copias duplicadas
No existe otro archivo `adaptar-estilo-prosa` en el repo (`supabase/functions/adaptar-estilo-prosa/index.ts` es único). No hay `_shared/handlers` ni preview separado. Lovable Cloud despliega una sola versión — la que respondió 401 en la prueba.

Hipótesis (4) descartada.

### E. Naturaleza del scanner
El bloque es `agent_security` (scanner agentic basado en LLM que lee el código fuente), no un prober HTTP dinámico. La `description` de la finding afirma textualmente: *"adaptar-estilo-prosa skips this step entirely"* — lo cual **es falso hoy** (líneas 55-66 tienen el bloque JWT completo).

Esto confirma que el scanner:
- Está evaluando una versión **cacheada** del archivo (índice previo al fix), o
- Reutilizó la finding del scan de 12:16 sin re-verificar el contenido actual del archivo (los scanners agentic suelen "arrastrar" findings abiertas cuando no las re-evalúan explícitamente).

## 2. Causa raíz

**El scanner `agent_security` está reportando una finding cacheada/arrastrada, no un fallo real del código.** El endpoint responde 401 a todas las variantes anónimas, el patrón coincide con el que el propio scanner cita como ejemplo correcto, y no existe otra versión desplegada.

Las hipótesis 1, 2 (patrón no reconocido), 3 (bypass runtime) y 4 (versión cacheada distinta a la nuestra) quedan descartadas por evidencia. Queda la hipótesis 5-derivada: **cache interna del propio scanner agentic**.

## 3. Acción recomendada (no aplicada)

Dos opciones, ambas SIN tocar código:

**Opción A — Marcar la finding como fixed con explicación auditable** vía `security--manage_security_finding` (`operation: mark_as_fixed`, `internal_id: adaptar_prosa_no_auth`, `scanner_name: agent_security`). La explicación cita: fix desplegado 14:08:55, curl multi-variante devuelve 401, patrón idéntico a las otras 4 funciones que sí pasan.

**Opción B — Esperar al próximo scan y forzar re-análisis** con `security--run_security_scan` (fuerza al scanner a re-leer el archivo). Si sigue apareciendo tras un scan forzado limpio, escalar a soporte Lovable con esta evidencia.

Recomiendo **Opción A** — la evidencia runtime + estática es concluyente y la finding es demostrablemente incorrecta hoy.

## 4. Restricción respetada
No se ejecutó ningún fix, ni se tocaron botones del scanner, ni se desplegó nada. Solo lectura y pruebas HTTP inertes.
