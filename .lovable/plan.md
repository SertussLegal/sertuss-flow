
# Diagnóstico A5 — Tabla "DATOS DE LA ESCRITURA PUBLICA" sale vacía

Investigación solo lectura. Base: cancelación real `d1d90c54-2f48-4736-8269-7d4f55de41d0`, captura del docx generado, código de `supabase/functions/procesar-cancelacion/index.ts`, plantillas en bucket `cancelaciones-plantillas/davivienda/`.

## Respuesta directa

**No es un desfase de nombres ni un bug de emisión. Es una decisión de diseño activa: el código y la plantilla asumen que esa tabla del encabezado es la ESCRITURA NUEVA (todavía sin numerar), no la hipoteca anterior.** Los datos de la hipoteca 3752/2002/Notaría 20 SÍ se emiten, pero a otro conjunto de tags (`*_hipoteca_*`) que la plantilla usa en el cuerpo (la cláusula), no en la tabla del encabezado.

## Evidencia código-por-código

### 1. Existen DOS familias de tags separadas para la misma "matriz" visual

En `buildDocxVars` (`supabase/functions/procesar-cancelacion/index.ts`):

| Familia | Tags | Fuente de datos | Poblado en d1d90c54 |
|---|---|---|---|
| **Hipoteca anterior** (cuerpo) | `numero_escritura_hipoteca_corto`, `fecha_escritura_hipoteca_{dia,mes,ano}`, `notaria_hipoteca_numero`, `ciudad_hipoteca`, `ciudad_hipoteca_corto`, `notaria_hipoteca_numero_letras`, `fecha_escritura_hipoteca_letras`, `escritura_hipoteca_numero_letras` | `data.hipoteca_anterior.*` (OCR) | **SÍ** — 3752/20/06/2002/0020/BOGOTA D.C. |
| **Escritura nueva** (tabla SNR encabezado) | `numero_escritura_nueva`, `numero_escritura_nueva_corto`, `numero_escritura_nueva_letras`, `fecha_otorgamiento_nueva{,_dia,_mes,_ano,_letras,_prosa,_cont}`, `notaria_emisora_numero`, `notaria_emisora_numero_letras`, `notaria_emisora_ciudad`, `notaria_emisora_titulo`, `notario_nombre` | `data.notaria_emisora.*` (UI manual en `CancelacionValidar.tsx` L1332–1343) | **NO** — `notaria_emisora = {}` (verificado por SQL) |

### 2. La intención es explícita en el código

`supabase/functions/procesar-cancelacion/index.ts` **L1096** — comentario textual del autor:

> `// Escritura NUEVA (tabla SNR encabezado) → undefined fuerza líneas en blanco`

Seguido de L1097–1104: todos los tags `*_nueva*` se emiten con `|| undefined` cuando `ne` (=`data.notaria_emisora`) está vacío. No es un accidente ni una regresión reciente — es diseño.

### 3. `SLIM_FIELDS` confirma que la plantilla usa los tags `*_nueva*` / `*_emisora_*`

`supabase/functions/procesar-cancelacion/index.ts` **L1151–1164** — el conjunto de fallback corto (`—` en vez de `___________`) lista **explícitamente** ambas familias:

```
"fecha_escritura_hipoteca_dia/mes/ano",
"notaria_hipoteca_numero",
"ciudad_hipoteca_corto",
"numero_escritura_hipoteca_corto",
// Tabla SNR (escritura nueva) — celdas angostas
"numero_escritura_nueva_corto",
"fecha_otorgamiento_nueva_dia/mes/ano",
"notaria_emisora_numero",
```

Que `notaria_emisora_numero` esté marcado como SLIM sólo tiene sentido si aparece dentro de una celda angosta de una tabla real de la plantilla. Prueba circunstancial fuerte de que la plantilla renderiza esos tags.

### 4. El patrón visual observado coincide 1:1 con nullGetter sobre tags `*_nueva*` / `*_emisora_*`

Captura del docx: `—` en 4 celdas (No. Escritura, Día, Mes, Año) y `___________` en 2 celdas (Notaría de Origen, Ciudad).

`nullGetter` en L1168–1169:
```
part.value in SLIM_FIELDS ? "—" : "___________"
```

Aplicado a los tags de "escritura nueva" con `data.notaria_emisora = {}`:

| Celda visible | Tag probable | En SLIM? | Render esperado | Render observado |
|---|---|---|---|---|
| No. Escritura | `numero_escritura_nueva_corto` | ✅ | `—` | `—` ✅ |
| Día | `fecha_otorgamiento_nueva_dia` | ✅ | `—` | `—` ✅ |
| Mes | `fecha_otorgamiento_nueva_mes` | ✅ | `—` | `—` ✅ |
| Año | `fecha_otorgamiento_nueva_ano` | ✅ | `—` | `—` ✅ |
| Notaría de Origen | `notaria_emisora_numero_letras` o `notaria_emisora_titulo` | ❌ | `___________` | `___________` ✅ |
| Ciudad | `notaria_emisora_ciudad` | ❌ | `___________` | `___________` ✅ |

Match completo. Ninguna otra combinación de tags produce ese mismo patrón mixto.

### 5. Los tests A5-1 / A5-2 son un falso positivo

`supabase/functions/procesar-cancelacion/index_test.ts` L281–326 verifican que `numero_escritura_hipoteca_corto="0559"`, `notaria_hipoteca_numero="0021"`, etc. Están verdes — pero **esos tags no son los que la plantilla `formato cancelacion hipoteca blanqueado v2.docx` pone en la tabla del encabezado**. Los tests blindan un contrato que la plantilla no consume. La segregación (A5-2) además cementa que la contaminación cruzada está prohibida: `data.hipoteca_anterior` NO puede llegar a los tags `*_nueva*`.

### 6. Contradicción histórica documentada

- Mensaje del 21-05-2026 (#1273): Alejandra corrige "esa tabla es la ESCRITURA NUEVA, vaciarla". Se implementa; queda comentario L1096 + tests A5.
- Mensaje del mismo día (#1271, versión completa del texto): Alejandra vuelve a corregir "no, esa tabla del formato Davivienda **exige** los datos de la hipoteca anterior".
- Última implementación (la que corre hoy): sigue la primera corrección. La segunda nunca se aplicó al código de la plantilla ni al mapeo.

## Limitación de la investigación

No pude descargar los bytes del template `formato cancelacion hipoteca blanqueado v2.docx` (282 KB, `cancelaciones-plantillas/davivienda/`) para leer literalmente los `{tags}` de la tabla:

- Bucket privado; política sólo permite `authenticated` con `foldername[1] = org_id`, y el folder es `davivienda/` — sólo `is_platform_admin()` puede leerlo.
- `LOVABLE_BROWSER_AUTH_STATUS=signed_out`; sin sesión inyectada.
- `SUPABASE_SERVICE_ROLE_KEY` no disponible en Lovable Cloud.
- Anon key → 404/403.

Los puntos 1–6 son evidencia circunstancial extremadamente fuerte (comentario explícito del autor + SLIM_FIELDS + patrón visual coincidente celda por celda), pero la confirmación literal del nombre de los 6 tags dentro de esa tabla del `.docx` sigue pendiente de acceso al binario. Formas de desbloquearla:

1. Iniciar sesión en el preview como `is_platform_admin()` (email `info@sertuss.com`) → próxima invocación puede firmar URL.
2. Exportar temporalmente el `.docx` a un bucket público sólo para lectura de este diagnóstico.
3. Ejecutar `psql \COPY` sobre `storage.objects` — no funciona: el binario vive en el backend de storage, no en Postgres.

## Conclusión

- **Causa raíz:** la plantilla `formato cancelacion hipoteca blanqueado v2.docx` conecta la tabla visible "DATOS DE LA ESCRITURA PUBLICA" a los tags de la **escritura nueva** (`*_nueva*` / `*_emisora_*`). El código sigue esa convención y sólo los llena cuando el operador rellena manualmente el bloque "Notaría / Escritura nueva" en la UI. En trámites que se generan de una sola pasada (como d1d90c54), ese bloque queda vacío → tabla vacía por diseño.
- **No es desfase de nombres.** Los nombres emitidos y los consumidos por la plantilla coinciden — sobre el conjunto equivocado.
- **No es una segunda tabla oculta.** Hay una sola tabla visible en el encabezado; el mapeo de `*_hipoteca_*` renderiza en otro lugar (párrafos de cláusula segunda) y sí muestra bien 3752/2002/Notaría 20 y el valor `$8.858.475`, exactamente como reportaste.
- **Los tests A5 protegen la interpretación equivocada** (la de mayo-2026 v1) y por eso el punto A5 estaba marcado como "resuelto" en el histórico sin serlo desde el punto de vista de Alejandra.

Ninguna implementación en este mensaje. Cuando pases a build, la decisión política es la primera pregunta: ¿la tabla debe salir con los datos de la hipoteca anterior (segunda corrección de Alejandra), o dejarse vacía a propósito y esperar edición manual del operador (interpretación actual)? El fix técnico es distinto según cuál se elija.
