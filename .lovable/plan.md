# Cierre definitivo del bypass `regression_cuantia`

## Contexto

Auditoría de solo lectura encontró:
- Código fuente: limpio (solo `is_platform_admin()`, sin rama de token/header).
- Secreto `REGRESSION_CUANTIA_TOKEN`: eliminado.
- Último boot de la función en logs: `2026-07-07 19:36:47Z`, previo a la reversión del gate.

Riesgo residual: el runtime desplegado podría seguir corriendo la versión con la rama del token. Aunque el bypass es inexplotable (el secreto ya no existe → `hasRegressionBypass` siempre `false`), la higiene exige redeploy verificado.

## Pasos

1. Redesplegar `procesar-cancelacion` con `supabase--deploy_edge_functions`.
2. Consultar `supabase--edge_function_logs` filtrando `booted` y confirmar un evento nuevo con timestamp posterior al momento actual.
3. Verificación negativa opcional: invocar `POST /procesar-cancelacion` con body `{"action":"regression_cuantia","tramite_ids":["4b05d210-3549-4d91-93d0-78982b9f151c"]}` sin `Authorization` válido y sin `X-Regression-Token` → debe responder **401** (por falta de auth) o **403** (si hay JWT no-admin). Cualquier `200` sería regresión.

## Entregable

Reporte con timestamp del nuevo `booted` y, si se ejecuta el paso 3, el status HTTP observado.
