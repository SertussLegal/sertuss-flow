# Reporte — Trámite a8af7200 + análisis UX/A11y

## PARTE 1 — Validación técnica del trámite real

### 1. Estado final
| Campo | Valor |
|---|---|
| `status` | `completed` ✅ |
| `error_message` | `NULL` ✅ |
| `url_minuta_generada` | `cancelaciones/a8af7200-.../minuta.docx` ✅ |
| `url_certificado_generado` | poblado ✅ |
| `created_at` | 2026-07-22 01:55:41 UTC |
| `updated_at` | 2026-07-22 02:16:10 UTC (~20 min después) |

### 2. Metadatos del pipeline (`system_events`)
5 eventos, en orden cronológico:

1. `procesar-cancelacion.inmueble.coherencia` → `warnings` (persistió los 2 warnings incoherencia mención dirección/matrícula).
2. `procesar-cancelacion.poder` → `exito` (54.2 s, OCR Gemini del poder).
3. `procesar-cancelacion.cuantia` → `no_aplica` (`ocr_cuantia_credito`, sin monto).
4. `procesar-cancelacion.revision_manual` → `bloqueado` categoría `PODER_COHERENCIA_HARD_BLOCK` a las 01:57:30.
5. `procesar-cancelacion.revision_manual` → `desbloqueado` categoría `PODER_NO_LEGIBLE` a las 02:16:06 (Alejandra pulsó "Confirmar revisión manual").

**No aparecen** eventos `mono_status` / `v6_status` / `v6_enabled` para este trámite — ese flag/telemetría no se emite en este flujo (o quedó fuera de `system_events`).

### 3. Coherencia apoderado (plano vs anidado)
```
apoderado.tipo       = "natural"
apoderado.nombre     = "ANA MARIA MONTOYA ECHEVERRY"
apoderado.cedula     = "41939243"
apoderado_nombre     = "ANA MARIA MONTOYA ECHEVERRY"   ← coincide ✅
apoderado_cedula     = "41939243"                       ← coincide ✅
```
Plano y anidado **están sincronizados** — `syncApoderadoFlatWithNested` funcionó.

### 4. Warnings persistidos en `data_final`
- `poder_banco._coherencia_warnings` = `[]`
- `poder_banco._coherencia_suspicious` = `[]`
- `inmueble._coherencia_warnings` = `["inmueble_direccion_menciones_incoherentes","inmueble_matricula_menciones_incoherentes"]`
- `inmueble._coherencia_suspicious` = 4 paths (menciones_direccion, nomenclatura_predio, menciones_matricula, matricula_inmobiliaria)

Los warnings de inmueble siguen en `data_final` como historial forense, pero el `status=completed` porque el usuario confirmó revisión manual (`MANUAL_OVERRIDE_RULES`).

### 5. Escrituras — sin incoherencia
| Contexto | Valor | Fuente |
|---|---|---|
| Escritura de la hipoteca (que se cancela) | **8790** | `hipoteca_anterior.numero_escritura_hipoteca` = "OCHO MIL SETECIENTOS NOVENTA (8790)" |
| Escritura del poder general del banco | 7364 | `poder_banco.instrumento_poder.escritura_num` |
| Notaría emisora del poder | 32 de Bogotá D.C. | `notaria_emisora` |

El "8790" que ve Alejandra en pantalla es la **escritura de la hipoteca cancelada**, no la del poder. **No hay incoherencia** — son dos instrumentos distintos correctamente rotulados.

### 6. Zona ORIP
`inmueble.oficina_registro_zona = "ZONA SUR"` ✅ (fix de zona ORIP aplicado y funcionando).

### 7. Intentos/reintentos
Un solo ciclo de OCR + generación (54 s para el poder). No hay evidencia de timeouts/504 en logs para este ID. La "demora" percibida por Alejandra fue el loop del autosave 409 (bug ya diagnosticado y desplegado).

**Conclusión Parte 1:** El trámite quedó correctamente cerrado, sin incoherencias reales de datos entre plano/anidado ni entre escrituras.

---

## PARTE 2 — Análisis UX/A11y de la barra superior

### Componente afectado
`src/pages/CancelacionValidar.tsx` líneas 915–950 — barra sticky superior derecha con 3 indicadores:

| # | Elemento | Origen | Semántica real |
|---|---|---|---|
| A | Badge naranja **"Vista desactualizada"** (`AlertTriangle`) | `previewStale` state (línea 921) | El .docx generado ya no refleja los datos actuales del formulario |
| B | Botón azul **"Regenerar"** (`RefreshCw`) | siempre visible salvo `requiere_revision_manual` (línea 929) | Dispara re-generación manual del .docx |
| C | Badge verde **"Documento actualizado"** (`CheckCircle2`) | `<SaveStatusChip>` cuando `!isDirty && !saving && !error` | **En realidad significa "Formulario guardado"**, no "documento generado al día" |

### 1. Por qué se muestran los 3 a la vez
**Son dos sistemas de estado que miden cosas distintas y no se coordinan:**

- **SaveStatusChip** mide el ciclo *"formulario ↔ base de datos"* (`isDirty` / `saving` / `saved`). Verde = "los cambios se persistieron en Cloud".
- **previewStale** mide el ciclo *"data_final ↔ .docx generado"*. Naranja = "el .docx está desfasado respecto a data_final".

Cuando el usuario edita un campo, autoguarda, y **no** dispara `regen` (caso de `requiere_revision_manual`, o cambios que solo pintan `setPreviewStale(true)` sin auto-regen), quedan simultáneamente:
- verde ✅ "Documento actualizado" (guardado OK)
- naranja ⚠️ "Vista desactualizada" (docx atrás)

El copy del chip verde ("Documento actualizado") **es engañoso** — refuerza la contradicción visual porque usa la palabra "documento" cuando en realidad habla del formulario.

### 2. Jerarquía visual correcta
Regla: **un solo mensaje dominante sobre el estado global del trámite** en la barra superior. Los dos ciclos son distintos, pero para el usuario "está listo o no está listo" es una sola pregunta.

Prioridad recomendada (mayor → menor):
1. Bloqueo (`requiere_revision_manual`) — ámbar dominante
2. Error de guardado — rojo
3. Guardando / regenerando — azul spinner
4. **Vista desactualizada** (naranja) — cuando `previewStale`
5. Cambios pendientes — ámbar suave (`isDirty`)
6. **Todo al día** (verde) — SOLO cuando `!isDirty && !previewStale && !saving`

Nunca mostrar 4+6 juntos ni 6 solo si 4 aplica.

### 3. Corrección propuesta (sin implementar)

**Cambio A — Renombrar copy del chip verde**
- "Documento actualizado" → **"Todo al día"** o **"Guardado y sincronizado"**.
- Evita colisión semántica con "documento" del .docx generado.

**Cambio B — Coordinar los dos estados en `SaveStatusChip`**
- Pasar `previewStale` como prop al chip.
- Nueva rama antes de la verde: si `previewStale === true`, no mostrar verde; que el badge naranja "Vista desactualizada" (que ya vive fuera del chip) sea el único indicador de estado.
- Alternativamente: fusionar todo en un solo chip con 6 estados y eliminar el badge naranja separado.

**Cambio C — Posicionamiento**
- Mantener el chip único a la derecha.
- El botón "Regenerar" siempre a la izquierda del chip, con `variant="default"` (destacado) solo cuando `previewStale`, y `variant="outline"` (secundario) cuando todo al día. Esto ya funciona bien.

### 4. Accesibilidad

**Botones:**
- ✅ "Regenerar" tiene texto visible + icono. OK.
- ⚠️ Botón "Volver" (línea 904): usa `<ArrowLeft>` + texto "Volver". OK.
- ⚠️ Los `<TabsTrigger>` (Minuta/Certificado/Poder) heredan a11y de Radix. OK.

**Contraste (tokens semánticos actuales — modo oscuro/claro):**
- Naranja "Vista desactualizada": `text-amber-600 dark:text-amber-400` sobre `bg-amber-500/10`. Cumple AA en dark, **límite AA en light** (medir con `#d97706` sobre fondo casi blanco = ratio ~4.1:1 — pasa AA texto normal, no AA large-inverted). Aceptable pero apretado.
- Verde chip: `text-emerald-700 dark:text-emerald-300` sobre `bg-emerald-500/10`. Cumple AA.
- Azul "Regenerar" en `variant="default"`: usa token `bg-primary text-primary-foreground` (Azul Notarial #2D5B8C sobre blanco). Cumple AA holgado.

**Roles/aria:**
- ✅ `SaveStatusChip` tiene `role="status" aria-live="polite"`.
- ❌ El badge "Vista desactualizada" (línea 921) **no tiene `role="status"` ni `aria-live`** — un usuario con lector de pantalla no se entera cuando el docx queda desfasado tras editar. Debería anunciarse.
- ⚠️ `title="Los cambios se guardaron..."` (línea 924) es solo tooltip visual; no lo lee NVDA/VoiceOver. Convertir a `aria-label` o mover a texto visible.
- ✅ Icono decorativo `AlertTriangle` no necesita `aria-label` porque el texto adyacente ya lo describe.

**Tabulación:**
- Orden actual: Volver → tabs (3) → Regenerar → chip (no focuseable).
- El chip verde/rojo/ámbar **no es focuseable** (`div` sin tabIndex). Para lectores de pantalla se anuncia por `aria-live`, pero el estado "Vista desactualizada" no está en live-region — se pierde.
- Cuando aparece el CTA "Reintentar" dentro del chip de error, sí es focuseable (Button). OK.

### 5. Recomendaciones prioritarias (a validar antes de implementar)
1. **P0 (semántica):** renombrar "Documento actualizado" → "Todo al día" y suprimir el chip verde cuando `previewStale`.
2. **P1 (a11y):** añadir `role="status" aria-live="polite"` al badge "Vista desactualizada".
3. **P2 (contenido):** cambiar `title=` → tooltip Radix o `aria-label`.
4. **P3 (opcional):** unificar los dos indicadores en `SaveStatusChip` para tener un solo lugar donde vive el estado global.

---

**No se hicieron cambios de código.** Espero tu confirmación de cuáles P0–P3 avanzar antes de tocar `CancelacionValidar.tsx` o `SaveStatusChip.tsx`.
