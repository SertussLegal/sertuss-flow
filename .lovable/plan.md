## Caso auditado

- **Cancelación:** `0443d2f1-2206-4e44-bc46-6c0af2bbf7ee`
- **Org:** Sertuss Notaría Central (`614a4a8d…`)
- **Creada:** 2026-07-07 21:09:15Z · **Última actualización:** 21:11:21Z
- **Status:** `completed`

## 1. ¿Corrió el extractor v6?

**NO.** Evidencia directa del `system_events` del propio trámite:

```
evento: procesar-cancelacion.poder  resultado: exito
detalle: { v5_enabled: false, cache_reason: "v5_disabled",
          dedicated_status: "fulfilled", campos_llenos: 8,
          poder_banco_presente: true, paginas_enviadas: 28 }
```

`data_ia.poder_banco.apoderado` está **vacío** (no existe la clave anidada). Solo hay los campos planos legacy (`apoderado_nombre`, `apoderado_cedula`, `apoderado_escritura`, etc.) más un `_classifier_motivos: ["no_apoderado_tipo_from_ocr"]`. `apoderado_nombre` y `apoderado_cedula` vienen como el string literal `"null"` (no `null` JSON).

- `data_ia.poder_banco.apoderado.tipo` → **ausente**.
- No hay eventos con `[v6 extractor failed]` en logs del trámite.
- El evento del poder no tiene ninguna traza `v6_*`, solo `v5_enabled: false`.

**Diagnóstico:** el secret `POWER_V6_EXTRACTOR_ENABLED=true` que se seteó en el turno anterior **no está activo en el runtime** que procesó este caso. Hipótesis probables (a confirmar en build mode):
- El redeploy de `procesar-cancelacion` posterior al `set_secret` no llegó a inyectar el env var, o el secret quedó con otro nombre / no propagado.
- El gate del v6 en el código exige adicionalmente que `POWER_DEEP_SCHEMA_ENABLED` esté ON (revisar `procesar-cancelacion/index.ts:1973-1978`). Si es una AND, v6 nunca corre con V5=OFF.

## 2. Cuantía semántica

**Funcionó como se esperaba.** `resultado_derivado = indeterminada_confirmada`, confianza `alta`, `motivo_null = "escritura_declara_abierta"`, `cert_indeterminada = true`. Detectó 2 candidatos (`102.767.850` y `67.000.000`) y los clasificó ambos como `"otro"` (no cuantía del crédito). `valor_hipoteca_original = NULL` correctamente persistido.

## 3. Documento final (.docx)

No hay evidencia directa de generación exitosa en `system_events` (no aparece evento `docx_generado` ni error). `status = completed` y `updated_at` 21:11:21Z sugiere que el flujo terminó sin excepción, pero **no puedo confirmar sin logs de edge** (indexación en 0 resultados para `procesar-cancelacion`) ni sin abrir el archivo generado. `data_final` está vacío para `cuantia_hipoteca`.

## 4. UI ProsaApoderadoPreviewCard

**No verificable desde backend.** No hay telemetría de render de este componente. Dado que `data_ia.poder_banco.apoderado` viene vacío y `buildProsaContext` es tolerante (sintetiza shape desde campos planos), el componente **debería** haber renderizado con `tipo = "Tipo no definido"` y prosa Davivienda default. No hay error reportado, pero no hay confirmación positiva.

## 5. Veredicto de pipeline end-to-end

| Componente | Estado |
|---|---|
| P1-P3 extractor plano legacy | ✅ Corrió (`campos_llenos: 8`, `dedicated_status: fulfilled`) |
| **V6 extractor profundo** | ❌ **NO corrió** (`v5_enabled: false`, sin bloque `apoderado` anidado) |
| Cuantía semántica | ✅ Funcionó (`indeterminada_confirmada`, confianza alta) |
| Docx final | ⚠️ Sin evidencia negativa, sin confirmación positiva |
| UI Prosa apoderado | ⚠️ No verificable desde backend |

**Conclusión honesta:** el pipeline legacy + cuantía semántica funcionó. **El objetivo declarado de la sesión anterior (activar V6 antes de que Alejandra pruebe) NO se cumplió en runtime.** El secret quedó seteado pero el trámite real fue procesado con V6 apagado. Antes de invitar a Alejandra hay que investigar por qué `POWER_V6_EXTRACTOR_ENABLED=true` no tuvo efecto: revisar el gate exacto en `procesar-cancelacion/index.ts` (¿requiere también V5?), reconfirmar el redeploy, y correr un segundo caso de prueba verificando que aparezca el bloque `data_ia.poder_banco.apoderado.{tipo,nombre,…}` y trazas v6 en `system_events`.

## Próximo paso sugerido (requiere aprobación para pasar a build)

1. Leer líneas ~1973-1978 y ~2341-2372 de `procesar-cancelacion/index.ts` para verificar la condición exacta del gate v6.
2. Comprobar en Project Settings que `POWER_V6_EXTRACTOR_ENABLED` figura y su valor.
3. Redesplegar y correr un smoke test controlado antes de habilitar a Alejandra.
