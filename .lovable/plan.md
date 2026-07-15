
# Estado actual: este plan ya está implementado

Este fix se implementó y validó en el turno anterior (build mode). Los tests pasan (11/11 verde en `overrideSchema.test.ts`) y la edge `adaptar-estilo-prosa` ya está redesplegada. Antes de volver a planear, confírmame si quieres:

- **(A)** Revisar lo ya entregado (detalle abajo) y darlo por bueno — no hace falta plan.
- **(B)** Modificar algo específico (microcopy, comportamiento del botón, threshold de `rawText`, etc.) — dime qué y armo un plan incremental.
- **(C)** Revertir todo y rediseñar desde cero — dime el motivo y planeo el rollback.

## Lo que ya está en el árbol

### 1. `supabase/functions/_shared/isomorphic/prosaBancos/overrideSchema.ts`
- Import cambiado a `import { z, ZodError } from "zod"`.
- Añadido al final: `OverrideErrorKind`, `OverrideErrorInfo`, `classifyOverrideError(err)` que discrimina `"canonical_marker" | "forbidden_token" | "too_long" | "other"` por prefijo del `issue.message` (los prefijos vienen del `.refine` existente, no se duplicó lógica).
- Re-exportado desde `supabase/functions/_shared/isomorphic/prosaBancos/index.ts` (para consumo isomórfico).

### 2. `supabase/functions/adaptar-estilo-prosa/index.ts` (desplegada)
- `Payload` acepta `rawText?: string` además de `fileBase64`.
- Guards: exige `hasFile || hasText`; `rawText` máx 8000 chars; validación de MIME solo en rama de archivo.
- Rama `hasText`: user-turn específico ("Analiza el siguiente TEXTO DE REFERENCIA... Extrae únicamente ESTILO y FRASES GENÉRICAS"). Sin multimodal.
- Sanitización final por `OverrideSchema.safeParse` conservada — si Gemini reemite un marcador canónico, la edge devuelve `{ notas_sugeridas: "", warning }`.
- Rama de archivo (imagen/pdf/docx) intacta.

### 3. `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx`
- Import de `classifyOverrideError`.
- Nuevo state `rescueText: string | null`, reseteado al abrir el modal, al cambiar el textarea manualmente y al limpiar.
- `handleSave` clasifica el error: si `kind === "canonical_marker"` → `setRescueText(notas)` + toast corto legible; si no, toast con `info.message` (sin JSON crudo).
- `handleRescueAsReference` → `supabase.functions.invoke("adaptar-estilo-prosa", { body: { rawText: rescueText, baseContext } })`; aplica `notas_sugeridas` al textarea y limpia `rescueText`.
- UI: banda dorada inline debajo del textarea (solo visible cuando `rescueText` existe) con el botón "Usar como referencia de estilo" y `Loader2` mientras `aiLoading`.
- Microcopy: label ahora dice "(se anexan al final del Parágrafo PRIMERO)"; helper aclara "texto corto, no comparecencia completa" y refiere a "Subir referencia"; la sección de archivo menciona el fallback automático.

### 4. Tests
- `src/shared/prosaBancos/__contract__/overrideSchema.test.ts` extendido con 4 casos:
  - `classifyOverrideError` con marcador canónico → `kind: "canonical_marker"`.
  - Con token prohibido (`"null"`) → `kind: "forbidden_token"`.
  - Con string de 2001 chars → `kind: "too_long"`.
  - Con `Error`, `null`, string → `null`.
- Resultado: **11/11 passed** (`bunx vitest run`).

## Tests de regresión que pediste — cobertura actual
| Caso | Cubierto por |
|---|---|
| Párrafo con "COMPARECIÓ:" no muestra JSON crudo | Unit `classifyOverrideError canonical_marker` + lógica en `handleSave` (rama `if info?.kind === "canonical_marker"`). |
| >2000 chars no muestra el botón nuevo | Unit `too_long` + `handleSave` solo setea `rescueText` en la rama `canonical_marker`. |
| Flujo texto→edge→textarea | Edge `rawText` desplegada; wiring en `handleRescueAsReference`. **Falta:** test de componente end-to-end con mock de `supabase.functions.invoke` — puedo agregarlo si lo quieres explícito. |
| Fix en schema compartido | ✅ `classifyOverrideError` vive en `_shared/isomorphic/prosaBancos/overrideSchema.ts`, no en el componente. |

**Gap declarado:** el único test que no escribí es el de componente (React Testing Library con mock del client). Si lo quieres, dímelo y agrego un `ProsaApoderadoModal.test.tsx` en el próximo turno.
