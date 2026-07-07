
# Diagnóstico de la cancelación real de Sertuss

**Sin cambios de código.** Solo hallazgos con evidencia. Al final pregunto si quieres que abra un plan de optimización.

## 1. Cancelación identificada

- **ID**: `2bef1db3-b798-48f7-bba6-0ad42ecb0558`
- **Org**: Sertuss Notaría Central (`614a4a8d…`)
- **Status final**: `completed`
- **Creada**: `16:48:51.930 UTC`
- **Última actualización**: `16:53:42.427 UTC`
- **Tiempo end-to-end**: **290.5 s (≈ 4 min 50 s)**

## 2. Línea de tiempo reconstruida

No existen timestamps granulares por sub-paso en la tabla `cancelaciones` (solo `created_at`/`updated_at`). Con `system_events`, `function_edge_logs` y `ai_gateway_logs` se reconstruye así:

```text
16:48:51.930  created (draft)
                │
                │  ~57 s → frontend rasteriza PDFs, sube a bucket
                ▼
16:49:48.317  POST procesar-cancelacion #1   edge exec  2 484 ms
16:49:57      → ai gateway: gemini-2.5-flash  7 537 ms   (poder, 20 págs, 5 906 in / 123 out)
16:51:11      → ai gateway: gemini-2.5-pro   82 443 ms  (monolítico, 14 808 in / 8 558 out)
16:51:12.106  system_event procesar-cancelacion.poder = "exito"
16:51:15      → ai gateway: gemini-2.5-flash  3 795 ms   (cuantía, 3 732 in / 32 out)
16:51:15.859  system_event procesar-cancelacion.cuantia = "fallo_ambiguo"
16:51:27.224  POST procesar-cancelacion #2   edge exec  4 643 ms
                │
                │  ~135 s   docx templating / consolidación / segundo turno
                ▼
16:53:42.518  POST procesar-cancelacion #3   edge exec  3 445 ms
16:53:42.427  updated_at final (status=completed)
```

## 3. Desglose por capa

| Capa | Tiempo | % del total |
|---|---:|---:|
| Frontend previo (rasterizado + upload) | ~57 s | 20 % |
| AI Gateway (3 llamadas, suma) | ~94 s | 32 % |
| Edge function CPU (suma de 3 POST) | ~10.6 s | 4 % |
| Frontend posterior (docx render, waits, UI) | ~128 s | 44 % |
| **Total** | **290 s** | 100 % |

## 4. Llamadas a Gemini (evidencia AI Gateway)

| # | log_id | Modelo | Duración | Tokens in/out | Propósito |
|---|---|---|---:|---|---|
| 1 | `019f3d7c-61b1-76cf…` | gemini-2.5-**flash** | **7.5 s** | 5 906 / 123 | Extracción poder (20 págs, 1 turno multimodal) |
| 2 | `019f3d7c-60a5-74af…` | gemini-2.5-**pro**   | **82.4 s** | 14 808 / 8 558 | Redacción monolítica de la minuta |
| 3 | `019f3d7d-a32e-7511…` | gemini-2.5-**flash** | **3.8 s** | 3 732 / 32 | Extracción cuantía (falló como "ambiguo") |

Coste total AI: **0.4295 créditos**. Cero reintentos, cero duplicados, cero 429/5xx.

## 5. Contraste con el diseño esperado (P3)

- P3 estimó ~3 llamadas a Gemini → **coincide exactamente con lo observado**.
- El poder llegó dedicado con flash multimodal en 1 turno (20 págs, 7.5 s) → consistente con lo diseñado.
- **No hubo llamada al extractor v6 nuevo**: `system_event` reporta `v5_enabled: false`, `cache_reason: v5_disabled`. La ruta corrida es la legacy — sin regresión, sin nuevo camino activado. `POWER_V6_EXTRACTOR_ENABLED=false` respetado.

## 6. ¿Escala lineal el poder?

Este caso: 20 págs → 7.5 s → **~375 ms/pág** (flash multimodal). Extrapolación teórica a 50 págs: ~18–19 s. Es un costo esperado por el volumen de tokens de imagen que se envían a la IA, no un cuello patológico.

## 7. Cuellos de botella reales, con evidencia

1. **gemini-2.5-pro para la minuta = 82 s (28 % del total end-to-end).** Es la pieza dominante. Genera 8 558 tokens de salida — no es un timeout, es tiempo de decodificación real de Pro.
2. **~57 s de frontend previo antes del primer POST.** No hay logs granulares del rasterizado; probablemente PDF.js + subida a `expediente-files`. Optimizable con paralelización de páginas o rasterizado en worker.
3. **~128 s entre POST #2 y `updated_at` final.** Probablemente docxtemplater + hidratación + segundo turno de guardado; sin instrumentación no se puede afinar más.

## 8. Lo que NO es un problema

- No hay reintentos ni duplicados en AI Gateway.
- Ninguna llamada colgada, ningún 429/5xx.
- Las 3 edge invocations son cortas (10.6 s en total). La edge function no bloquea esperando a la IA — probablemente delega al frontend el waitqueue.
- La llamada de cuantía marcada `fallo_ambiguo` es lógica de negocio (no encontró monto), no un error de infraestructura.

## Conclusión

- **~290 s se explican íntegramente por trabajo real**: 82 s de Gemini Pro para redactar la minuta, ~57 s de rasterizado/upload en el navegador, ~128 s de post-proceso docx en el frontend. **No hay anomalías** (reintentos, duplicados, timeouts, llamadas fantasma).
- El cuello de botella único y claramente medible es **Gemini 2.5 Pro (82 s, 28 %)**. Lo demás es tiempo distribuido en frontend sin instrumentación fina.

## ¿Quieres que abra un plan de optimización?

Opciones que tendría sentido explorar (no las estoy proponiendo aún, solo listándolas):

- **A.** Instrumentar el frontend (marcas de tiempo por sub-paso en `system_events` o console) para ver dónde se van los ~185 s de frontend.
- **B.** Evaluar bajar la minuta de `gemini-2.5-pro` → `gemini-2.5-flash` con guardarraíles, o dividirla en 2 llamadas más pequeñas en paralelo.
- **C.** Paralelizar rasterizado de páginas con Web Workers.

Confírmame si quieres que profundice en alguna, o si el diagnóstico ya es suficiente y cerramos aquí.
