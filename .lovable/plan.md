# Plan: Bloquear generación de docx cuando persiste `NO_LEGIBLE`

## Problema (bug confirmado)

`generateAndUploadCancelacionDocs()` en `supabase/functions/procesar-cancelacion/index.ts:1188` **no** valida `detectRequiereRevisionManual()` antes de renderizar. Se llama desde 3 sitios:

| Call site | Línea | ¿Protegido hoy? | Riesgo |
|---|---|---|---|
| Flujo normal (heavyWork) | ~2852 | Sí — `if (revision.requiere) { ... } else { generar }` en L2799–L2862 | OK |
| `action: "confirm_manual_review"` | ~2145 | **No** | Si `data_final` sigue con `NO_LEGIBLE` en cualquiera de los 6 paths críticos, se emite docx con el literal impreso |
| `regen: true` | ~2485 | **No** | Si `manualOverrides` (SSOT del frontend) o `data_final` conservan `NO_LEGIBLE` (autosave silencioso re-dispara regen tras cada tecla), se emite docx contaminado |

Un documento notarial con "NO_LEGIBLE" en cédula, número de escritura o fecha del poder es un fallo crítico: sale del sistema y puede llegar a firma.

## Sobre "vaciar campos intencionalmente" en regen

Revisado `src/pages/CancelacionValidar.tsx` (L400–L506): el comentario "SSOT: frontend payload manda. Permite vaciar campos intencionalmente" se refiere a strings vacíos / `null` — el UI presenta inputs de texto editables sobre `data_final`. **No hay flujo en que el usuario elija dejar el literal `"NO_LEGIBLE"` a propósito**: el detector se dispara únicamente en los 6 paths (cédula, escritura, fecha del apoderado; cédula, escritura, fecha del instrumento) y son campos requeridos por la plantilla. La plantilla los renderiza como texto directo. Conclusión: bloquear cuando aparezca `NO_LEGIBLE` es seguro y correcto para las 3 rutas.

Nota: strings vacíos siguen permitidos (la plantilla los mapea a `___________` por `nullgetter`). El bloqueo es exclusivamente contra el centinela textual `"NO_LEGIBLE"` y los `_coherencia_warnings` hard-block ya cubiertos por `detectRequiereRevisionManual`.

## Diseño

### 1. Fold del chequeo dentro de `generateAndUploadCancelacionDocs`

Primer paso de la función, antes de `buildDocxVars`:

```ts
class ManualReviewRequiredError extends Error {
  readonly code = "MANUAL_REVIEW_REQUIRED";
  constructor(
    public readonly paths: string[],
    public readonly motivos: string[],
  ) {
    super(
      `Generación bloqueada: ${paths.length} campo(s) NO_LEGIBLE, ` +
      `${motivos.length} hard-block de coherencia.`,
    );
    this.name = "ManualReviewRequiredError";
  }
}

async function generateAndUploadCancelacionDocs(...) {
  const revision = detectRequiereRevisionManual(data);
  if (revision.requiere) {
    throw new ManualReviewRequiredError(revision.paths, revision.motivos);
  }
  // ...resto igual
}
```

Ventaja: **fail-safe por construcción**. Cualquier futuro call site queda protegido automáticamente.

### 2. Cada call site captura y traduce

**Flujo normal (L2799–L2862):** ya hace el chequeo antes. Se conserva tal cual (defensa en profundidad). El `try/catch` de `bgErr` mantiene el comportamiento existente.

**`confirm_manual_review` (L2143–L2189):** el `try/catch` interno captura `ManualReviewRequiredError` específicamente:

```ts
} catch (genErr) {
  if (genErr instanceof ManualReviewRequiredError) {
    // Persistir revisita: el usuario confirmó sin corregir los 6 paths.
    // NO cambiamos status (sigue en 'requiere_revision_manual').
    void supabaseService.from("system_events").insert({
      organization_id: orgId, tramite_id: cancelacionId, user_id: userId,
      evento: "procesar-cancelacion.confirm_manual_review",
      resultado: "rechazado",
      categoria: "PODER_NO_LEGIBLE_PERSISTE",
      detalle: { paths: genErr.paths, motivos: genErr.motivos },
    }).then(() => {}, () => {});
    return biz(
      "manual_review_not_resolved",
      `Aún hay campos sin resolver: ${[...genErr.paths, ...genErr.motivos].join(", ")}. ` +
      `Corrígelos antes de confirmar.`,
    );
  }
  // resto igual (generation_error)
}
```

**`regen: true` (L2475–L2499):** capturar antes del `update` y devolver 409 de negocio:

```ts
try {
  const { minutaPath, certPath } = await generateAndUploadCancelacionDocs(...);
  // ...update + response ok
} catch (genErr) {
  if (genErr instanceof ManualReviewRequiredError) {
    // Persistir manualOverrides recibidos (el usuario está editando) pero
    // NO tocar url_minuta_generada — el docx previo (si existe) queda intacto.
    await supabaseService.from("cancelaciones").update({
      data_final: data, updated_at: new Date().toISOString(),
    }).eq("id", cancelacionId);
    return new Response(JSON.stringify({
      ok: false,
      error: "manual_review_required",
      paths: genErr.paths,
      motivos: genErr.motivos,
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  throw genErr;
}
```

Detalle importante para regen: hoy el autosave silencioso (`CancelacionValidar.tsx` L439) invoca `procesar-cancelacion` tras cada edit relevante. Si el usuario aún no ha corregido `NO_LEGIBLE`, el 409 debe ser silencioso en UI (no toast destructivo). Se debe actualizar el manejo del error en `CancelacionValidar.tsx` para diferenciar 409 `manual_review_required` de errores duros: en el path silencioso solo loguear a consola; en el path manual (`handleRegenerar`, L494) mostrar toast informativo con los paths pendientes.

### 3. Tests de regresión

Nuevo archivo `supabase/functions/procesar-cancelacion/index_manualReview_test.ts` (Deno test, sigue el patrón de `index_test.ts`):

- **Test 1 — flujo normal, caso limpio:** `data` sin `NO_LEGIBLE` y sin warnings → `generateAndUploadCancelacionDocs` retorna `{minutaPath, certPath}` sin lanzar.
- **Test 2 — flujo normal, `NO_LEGIBLE` en `poder_banco.apoderado_cedula`:** lanza `ManualReviewRequiredError` con `paths` que incluye ese path.
- **Tests 3-7 — un test por cada uno de los otros 5 paths críticos** (`apoderado_escritura`, `apoderado_fecha`, `apoderado.cedula`, `instrumento_poder.escritura_num`, `instrumento_poder.fecha`) → todos lanzan.
- **Test 8 — hard-block por coherencia:** `_coherencia_warnings: ["apoderado_cedula_no_legible"]` sin `NO_LEGIBLE` textual → lanza con `motivos.length > 0`.
- **Test 9 — combinación:** `NO_LEGIBLE` + warning → `paths` y `motivos` no vacíos.
- **Test 10 (integración, opcional stub HTTP):** simular request `action=confirm_manual_review` con `data_final` sucio → response `manual_review_not_resolved`.
- **Test 11 (integración):** simular request `regen=true` con `manualOverrides` sucios → response 409 `manual_review_required`, `url_minuta_generada` no se sobreescribe.

Los tests 1–9 son puros contra la función exportada; requiere agregar `export` a `generateAndUploadCancelacionDocs`, `detectRequiereRevisionManual` y `ManualReviewRequiredError`. Los tests 10–11 usan el patrón de mock existente en `index_test.ts`.

## Diff propuesto (resumen)

```text
supabase/functions/procesar-cancelacion/index.ts
+ class ManualReviewRequiredError extends Error { code, paths, motivos }
+ export { ManualReviewRequiredError, generateAndUploadCancelacionDocs, detectRequiereRevisionManual }
  generateAndUploadCancelacionDocs:
+   const revision = detectRequiereRevisionManual(data);
+   if (revision.requiere) throw new ManualReviewRequiredError(revision.paths, revision.motivos);
  confirm_manual_review catch:
+   if (genErr instanceof ManualReviewRequiredError) → biz("manual_review_not_resolved", ...) + system_events
  regen block:
+   try { generateAndUpload... } catch (genErr) {
+     if (ManualReviewRequiredError) → persist data_final only, return 409
+   }
  Flujo normal (L2799-L2862): sin cambios (ya protegido, se conserva defensa en profundidad).

supabase/functions/procesar-cancelacion/index_manualReview_test.ts   (NUEVO)
  11 casos descritos arriba.

src/pages/CancelacionValidar.tsx
  Manejo diferenciado de error 409 { error: "manual_review_required" }:
  - path silencioso (L439): swallow + console.warn
  - path manual (L501): toast.info con paths/motivos, sin toast.error
```

## Fuera de alcance (explícito)

- No se cambia el detector `detectRequiereRevisionManual`.
- No se cambia el prompt v7 ni `validate.ts`.
- No se toca la plantilla docx ni `buildDocxVars`.
- No se cambia el flujo normal (ya está protegido) — solo se agrega defensa en profundidad implícita al foldear el chequeo dentro de la función.

## Riesgos y mitigaciones

1. **Autosave silencioso spam de 409:** mitigado en el patch de `CancelacionValidar.tsx` (swallow en path silencioso). Alternativa si se quiere ser aún más quirúrgico: enviar un flag `silent: true` en el payload y no bloquear en regen silencioso — descartado por seguridad (mejor ser estricto: el 409 impide sobreescribir el docx previo con uno contaminado).
2. **Docx previo intacto tras regen bloqueado:** intencional. Si el usuario ya tenía una minuta válida y ahora edita y mete `NO_LEGIBLE`, preferimos conservar la vieja a emitir una nueva rota.
3. **Backfill/estados legacy:** filas ya en `completed` con `NO_LEGIBLE` histórico no se tocan; el bloqueo solo aplica en el momento de generar.

