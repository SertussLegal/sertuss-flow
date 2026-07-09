
# Diagnóstico "null" literal en `poder_banco` — SOLO PLAN

## 1. Datos reales encontrados

Consultas ejecutadas contra `cancelaciones` (152 filas totales):

| Ámbito | Ocurrencias `"null"`/`"undefined"` literales |
|---|---|
| Todo `data_final` de cancelaciones | **exactamente 2 filas, 2 campos c/u**: `apoderado_nombre` y `apoderado_cedula` |
| Otros campos de `poder_banco` (escritura, fecha, notaria) | **0** |
| Otros extractores (cédula, predial, cert. tradición, carta crédito) | **N/A**: usan shape `confField {valor, confianza}` + `unwrapConfianza`, no strings planos → no reproducen el patrón |
| `tramites` | tabla sin columnas `data_ia`/`data_final` (modelo distinto) |

Filas afectadas:

| id | flat `apoderado_nombre`/`cedula` | Bloque profundo v6 | Motivos classifier | created_at | updated_at |
|---|---|---|---|---|---|
| `0443d2f1…` | `"null"` / `"null"` | ausente (v6 no corrió) | `no_apoderado_tipo_from_ocr` | 2026-07-07 21:09 | 2026-07-08 15:44 |
| `32f5317e…` | `"null"` / `"null"` | `{tipo:null, nombre:"ANA MARIA MONTOYA ECHEVERRY", cedula:"52857443"}` | `natural_missing_poder_data` | 2026-07-07 21:55 | 2026-07-08 16:05 |

En ambas, `data_ia.poder_banco.*` y `data_final.poder_banco.*` traen el mismo `"null"` (no hubo edición humana corrigiéndolo).

## 2. Rastro del "null"

- **Origen**: extractor monolítico (Gemini) devolvió el string `"null"` a pesar de la instrucción "OMITE el campo si es ilegible". Confirmado porque `data_ia` (crudo tras merge) ya lo tenía.
- **Guard central existente**: `sanitizeString()` en `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts`, `NULLY_STRINGS` incluye ya `"null"`, `"NULL"`, `"Null"`, `"undefined"/"UNDEFINED"`, `"nan"/"NaN"/"NAN"/"Nan"`, `"n/a"/"N/A"/"N/a"`, `"na"/"NA"`, `"none"/"NONE"/"None"`, `"---"/"--"/"-"`, `"?"/"??"`, vacíos. **`sanitizeString("null") → undefined` ya funciona.**
- **Sitios que la aplican en `procesar-cancelacion`**: líneas 1089-1096 (`buildDocxVars`), 1391 (`pick` interno de `mergePoderBancoFlat`), 2401-2405 (merge de `data_final` con humano).

### Por qué escapó en estas 2 filas: **son datos legacy pre-guard**

Historial git de `poderBancoExtractor/merge.ts`:

```
6966599  2026-07-07 22:20:16 UTC  (introduce NULLY_STRINGS + sanitizeString)
```

Ambas filas se **crearon antes** (21:09 y 21:55 UTC). No es un bug activo en el código actual: es contaminación histórica de ~30-90 min de ventana. Las corridas posteriores (`system_events` "procesar-cancelacion.poder" con `resultado=exito` para trámites hermanos) ya pasan por el guard.

### Riesgo residual (real, aunque no reprodujo aquí)

En `mergePoderBancoV6`, la ruta "V6-wins override" está guardada por `cls.tipoEfectivo !== null`. Cuando el classifier degrada `tipoEfectivo` a `null` (caso `32f5317e…`, motivo `natural_missing_poder_data`), el override NO corre y el fallback legacy tampoco (guarda por `apoderadoOut?.tipo === "natural"|"juridica"`, y en degradación `tipo` queda `null`). Hoy `finalFlat.apoderado_nombre` queda `undefined` (sanitizado) y al serializar cae al `nullGetter → "___________"`, pero **se pierde info real del bloque profundo v6** (nombre/cedula que sí extrajo). No es el bug del ticket, pero es contiguo.

## 3. Otros extractores

- `cedula`, `predial`, `certificadoTradicion`, `cartaCredito`, `escrituraAntecedente`: emiten `confField` `{valor, confianza}`. El único punto de conversión a string plano es `unwrapConf()` en `merge.ts`, que ya delega en `sanitizeString`. No hay otros paths que salten el guard.
- `reconcileData.ts` (frontend): ya usa `sanitizeString`; test `sanitizeNullPattern.test.ts` cubre `avaluo_catastral`, `estrato`, `area`, `direccion`.
- Prompts de `procesar-cancelacion` ya instruyen "OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")" en las 8+ ocurrencias que valida el test `sanitizeNullPattern.test.ts`.

**Conclusión: problema aislado a `cancelaciones.poder_banco` legacy, no sistémico.**

## 4. Fix propuesto (3 partes, orden de riesgo creciente)

### 4.1. Limpieza de datos histórica (obligatorio — resuelve el ticket)

Migración de datos idempotente que, sobre `cancelaciones`, para cada key `apoderado_nombre|apoderado_cedula|apoderado_escritura|apoderado_fecha|apoderado_notaria_poder` dentro de `data_ia.poder_banco` y `data_final.poder_banco`, elimina el key si su valor (tras `trim` + `lower`) está en el set `NULLY_STRINGS`. Un `UPDATE` con `jsonb #- '{poder_banco,apoderado_nombre}'` condicionado por `->>` matching. **Solo cancelaciones cuyo `data_ia/data_final` contenga literales basura**; no toca las 150 filas limpias. Barrer las 2 conocidas + cualquier otra que aparezca.

### 4.2. Cinturón de seguridad al escribir (defensivo — bajo riesgo)

En `procesar-cancelacion/index.ts`, en el sitio único que hace `.update({data_ia: newDataIa, data_final: newDataFinal})` (path `reprocess_poder`) y en el path principal donde `mergedPoder` se asigna a `extracted.poder_banco`, envolver el objeto `poder_banco` en una función `stripNullyStrings(pb)` que recorra las claves conocidas y borre las que caigan en `NULLY_STRINGS`. Así, si un día un extractor futuro (o un cambio en Gemini) vuelve a filtrar el patrón, la BD nunca lo persiste. Reutiliza el `NULLY_STRINGS` existente exportándolo desde `merge.ts` (no duplicar la lista).

### 4.3. Test de regresión (mismo estilo que `sanitizeNullPattern.test.ts`)

Añadir a `src/shared/sanitizeNullPattern.test.ts` un bloque `describe("cancelaciones.poder_banco: nunca persiste 'null' literal")` que:
- Simule un `pb` con `{apoderado_nombre: "null", apoderado_cedula: "NULL", apoderado_escritura: "  null  "}` pasando por la función `stripNullyStrings` del punto 4.2 → resultado sin esas claves.
- Verifique que `mergePoderBancoV6` con `apoderadoOut.tipo === null` y bloque profundo v6 real ya no deja `finalFlat.apoderado_nombre` como `"null"` (regresión del caso `32f5317e…`).

### 4.4. Fuera de alcance (para tickets separados, mencionar pero no implementar aquí)

- **B2 relacionado**: extender la ruta V6-wins de `mergePoderBancoV6` para que, cuando `tipoEfectivo === null` PERO `apoderadoOut.nombre`/`cedula` estén presentes en el bloque profundo, se usen como fallback en `finalFlat`. Recupera info real de `32f5317e…` (ANA MARIA MONTOYA) que hoy se pierde. **No lo tocamos aquí porque cambia lógica de classifier, no es "arreglar el `null` literal".**
- **Ampliar `NULLY_STRINGS`**: **no es necesario**. El set actual ya cubre todos los casos observados en la BD. Añadir más variantes sin evidencia real solo genera falsos positivos.

## 5. Verificación post-fix

1. `SELECT count(*) FROM cancelaciones ... WHERE value ILIKE 'null'` debe dar **0** tras 4.1.
2. Vitest suite completa: `sanitizeNullPattern.test.ts` con nuevos casos verdes; resto sin regresión.
3. Deno tests de `procesar-cancelacion/*_test.ts` verdes.
4. Confirmar en las 2 filas afectadas que abriendo `CancelacionValidar` los inputs "Nombre apoderado" y "Cédula" aparecen vacíos (no con la palabra "null"), quedando editables y con badge rojo `cancelacionCriticalFields` señalando el faltante.

## 6. Archivos que se tocarían (referencia, no ejecutar)

- `supabase/migrations/<nuevo>_cleanup_poder_banco_null_literal.sql` (4.1)
- `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts` (exportar `NULLY_STRINGS` + añadir `stripNullyStrings(pb)`)
- `supabase/functions/procesar-cancelacion/index.ts` (2 sitios: aplicar `stripNullyStrings` al `poder_banco` antes de escribir a BD)
- `src/shared/sanitizeNullPattern.test.ts` (nuevo `describe`)

Sin cambios en frontend, `PoderViewerTab`, `PoderBannersV5`, ni schema de `credit_prices`.
