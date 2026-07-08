
# Diagnóstico `valor_hipoteca` NULL en cancelaciones completadas (SOLO LECTURA)

Sin cambios propuestos. Solo evidencia.

## Universo auditado
11 filas `completed` de Sertuss (`ORDER BY created_at DESC LIMIT 20` devolvió 11). Campos relevantes en JSON: `valor_hipoteca_original` y `valor_hipoteca_es_indeterminada`, tanto a nivel top como dentro de `hipoteca_anterior` (no existe `cuantia_valor`; ese nombre asumido en la query original no está en el schema).

## 1. Filas con `valor_hipoteca` NULL en la columna
**11 / 11 (100 %).** La columna `cancelaciones.valor_hipoteca` está vacía en **todas** las completadas de la muestra, incluyendo las que sí tienen monto real en el JSON.

## 2. ¿El dato vive en el JSON aunque la columna esté NULL?

Tres grupos claros:

| Grupo | Filas | JSON `hipoteca_anterior.valor_hipoteca_original` | JSON `..._es_indeterminada` | `valor_hipoteca_original` (columna) | system_event |
|---|---|---|---|---|---|
| **A. Monto real en JSON** | 3 filas (mayo 2026: `498c0215`, `1e2069b7`, `a21ae265`) | `"CUARENTA Y OCHO MILLONES DOSCIENTOS MIL PESOS ($48.200.000)"` | `null` | Igual al JSON | (fuera de ventana de events) |
| **B. Indeterminada marcada en JSON** | 3 filas (`c506d69b`, `2bef1db3`, `290fd66a`) | `null` / vacío | `"true"` | vacío | `indeterminada_confirmada` o `fallo_ambiguo` + `cert_indeterminada:true` |
| **C. Indeterminada según event pero JSON dice `false`** | 5 filas (`2fb6ba16`, `9a78aebb`, `15582708`, `32f5317e`, `0443d2f1`) | `null` string | `"false"` | literal `"null"` string | `indeterminada_confirmada, aplicado:true, cert_indeterminada:true` |

Detalles adicionales:
- En el Grupo A la columna `valor_hipoteca_original` **sí quedó poblada** con el monto formateado, pero la columna numérica `valor_hipoteca` sigue NULL — indica que el mapeo a la columna legacy `valor_hipoteca` (numérica) nunca se cierra, mientras que `valor_hipoteca_original` (texto) sí.
- En Grupos B/C la columna `valor_hipoteca_original` está vacía o literal `"null"` (string), consistente con no haber monto.

## 3. ¿Estado legítimo "indeterminada" vs bug?

De los 8 registros recientes (jul 2026), **todos** los `system_events` de `procesar-cancelacion.cuantia` reportan `cert_indeterminada:true` con `motivo_null:"escritura_declara_abierta"` y fragmentos que dicen literalmente **"HIPOTECA ABIERTA SIN LÍMITE EN LA CUANTÍA"**. Esto es un estado de negocio legítimo (skill `cuantia-indeterminada-cancelacion`): no debe haber monto en la columna `valor_hipoteca`.

Contradicción interna en Grupo C: el system_event dice `indeterminada_confirmada, aplicado:true`, pero el JSON persistido tiene `hipoteca_anterior.valor_hipoteca_es_indeterminada = "false"`. El flag detectado por el extractor **no se propagó al `data_final` persistido**, o fue sobrescrito por una edición manual/merge posterior que puso `false` por defecto.

## 4. Veredicto

Hay **dos hallazgos distintos, ambos reales**, ninguno urgente hasta confirmar impacto:

**H1 — Bug de sincronización columna↔JSON (columna `valor_hipoteca` numérica muerta).**
En el Grupo A el JSON tiene monto real `$48.200.000` y `valor_hipoteca_original` (texto) sí se pobló, pero la columna numérica `valor_hipoteca` quedó NULL. Sugiere que el pipeline dejó de mapear a esa columna en algún refactor, o que nunca se mapeó y solo `valor_hipoteca_original` (string) es la fuente canónica actual. Hay que decidir si `valor_hipoteca` (numeric) es columna viva o legacy a deprecar.

**H2 — Flag `_es_indeterminada` no se persiste consistentemente en `data_final`.**
En Grupo C (5 filas) el extractor detectó indeterminada y el event dice `aplicado:true`, pero el JSON guardado tiene `false`. Solo Grupo B (3 filas) refleja `true`. Esto es un desalineamiento real entre lo que el extractor decide y lo que sobrevive en `data_final.hipoteca_anterior` — probable colisión con el `Read-then-Merge` (edición manual dejando `false` por defecto sobrescribe la señal del extractor) o con la precedencia manual > OCR cuando el humano no marcó nada.

**No es "un solo bug de mapeo".** Es la combinación:
- Columna numérica `valor_hipoteca` **nunca** se pobla (bug o legacy).
- Estado "indeterminada" es negocio legítimo para las 8 recientes, pero el flag JSON no se persiste igual en todas.
- Ninguna fila reciente tenía un monto que debía haberse copiado y se perdió — el extractor está haciendo su trabajo, el hueco es en la persistencia del flag y en la columna numérica muerta.

## Próximos pasos sugeridos (no ejecutados)

Antes de proponer fix, hace falta confirmar con el dueño de producto:
1. ¿La columna `valor_hipoteca` (numeric) sigue viva o se deprecó a favor de `valor_hipoteca_original` (text) + flag? Si viva, hay que mapearla desde el extractor.
2. ¿Por qué Grupo C persiste `_es_indeterminada:false` cuando el event dice `aplicado:true`? Revisar el path de escritura de `data_final.hipoteca_anterior` en `procesar-cancelacion` vs merge cliente. Sospecha alta: `mergeOverride` o el auto-save del formulario está reponiendo `false` como default.

Sin aprobación explícita, no toco nada.
