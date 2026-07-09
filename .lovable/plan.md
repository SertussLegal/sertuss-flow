# Plan Final — Fase 2: coherencia intra-trámite poder ↔ acreedor

Construir un nuevo módulo isomórfico que valide que el `poder_banco.poderdante` corresponde al mismo banco que aparece como acreedor hipotecario en la escritura/certificado del MISMO trámite. HARD_BLOCK, misma gravedad que NO_LEGIBLE.

---

## Terreno relevante hallado (para no re-inventar)

- **`normalizeNit` ya existe** en `supabase/functions/_shared/isomorphic/prosaBancos/index.ts:29` como función privada de una línea: `nit.replace(/[.\s\-]/g, "")`. No está exportada. Es idéntica a lo que necesitamos.
- **`normalizeBankName` + fuzzy** ya existen en `src/lib/bankDirectory.ts:37-49` (quita acentos, sufijos comerciales `S.A./S.A.S./LTDA/E.U.`, normaliza espacios). Pero vive en `src/lib/` — **NO importable desde edge functions** (regla del proyecto: código isomórfico solo en `supabase/functions/_shared/isomorphic/`).
- **`partes.banco_nit`** viene con formato `"860.034.313-7"` (validado por prompt en `procesar-cancelacion/index.ts:239`). **`poderdante.entidad_nit`** viene sin puntos, `"900123456-7"` (validado por prompt en `poderBancoExtractor/tool.ts:66`). Formatos distintos → normalización obligatoria antes de comparar.
- **Punto de llamada evidente**: `procesar-cancelacion/index.ts:2748-2757` — bloque post-merge donde ya se invocan `annotatePoderCoherencia` y `runPoderCrossChecks`, con `extracted.partes` en scope. Ahí va la tercera llamada.

## Decisión de reutilización

- **Duplicar `normalizeNit`** dentro del nuevo `validateIntraTramite.ts` (una línea, cero costo, evita cambiar la firma pública de `prosaBancos`).
- **Portar `normalizeBankName`** al nuevo archivo (isomórfico). No mover `bankDirectory.ts` completo — solo replicar los ~15 líneas de la función pura de normalización. El día que se necesite en otro validador isomórfico, se extrae a `_shared/isomorphic/text/`.
- **Fuzzy match**: la técnica de `bankDirectory.ts` (contención bidireccional sobre nombres normalizados) es suficiente y determinista. No hace falta Levenshtein/dice.

---

## Archivos afectados

### 1. NUEVO: `supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts`

Módulo isomórfico puro (sin Deno, sin fetch). Firma:

```typescript
export interface PartesForCoherencia {
  banco_nit?: string | null;
  banco_acreedor?: string | null;
}

export interface IntraTramiteResult {
  warnings: string[];
  suspicious: Set<string>;
}

export function validatePoderVsCancelacion(
  merged: Record<string, unknown> | null | undefined,
  partes: PartesForCoherencia | null | undefined,
): IntraTramiteResult;
```

**Lógica (en este orden estricto):**

```
poderdanteNit = merged.poderdante.entidad_nit
poderdanteNom = merged.poderdante.entidad_nombre
acreedorNit   = partes.banco_nit
acreedorNom   = partes.banco_acreedor

nNitPoder    = normalizeNit(poderdanteNit)   // "" si null
nNitAcreedor = normalizeNit(acreedorNit)

// Regla 1 — primaria: NIT vs NIT.
if (nNitPoder && nNitAcreedor) {
  if (nNitPoder !== nNitAcreedor) {
    warnings.push("poder_entidad_nit_incoherente");
    suspicious.add("poderdante.entidad_nit");
    suspicious.add("partes.banco_nit");
  }
  // ← Sale aquí. NO evalúa Regla 2 aunque los nombres difieran.
  //   Rationale: NIT es evidencia más fuerte; si NIT coincide,
  //   asumimos que un desalineamiento textual del nombre es OCR ruido
  //   (ej. "DAVIVIENDA" vs "BANCO DAVIVIENDA S.A."), no incoherencia real.
  return { warnings, suspicious };
}

// Regla 2 — respaldo: nombre fuzzy, SOLO si falta al menos un NIT.
if (poderdanteNom && acreedorNom) {
  const nA = normalizeBankName(poderdanteNom);
  const nB = normalizeBankName(acreedorNom);
  if (nA && nB) {
    const match = nA === nB || nA.includes(nB) || nB.includes(nA);
    if (!match) {
      warnings.push("poder_entidad_nombre_incoherente");
      suspicious.add("poderdante.entidad_nombre");
      suspicious.add("partes.banco_acreedor");
    }
  }
}

return { warnings, suspicious };
```

**Helpers privados (copiados en el archivo):**

```typescript
function normalizeNit(nit: string | null | undefined): string {
  if (!nit || typeof nit !== "string") return "";
  return nit.replace(/[.\s\-]/g, "").replace(/\D/g, "");
}

function normalizeBankName(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  let n = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  n = n.replace(/\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|E\.?U\.?)\b\.?/g, "");
  n = n.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  return n;
}
```

Nota: el `.replace(/\D/g, "")` extra en `normalizeNit` (respecto al de `prosaBancos`) blinda contra cualquier char no-numérico residual — comparación siempre sobre dígitos puros.

### 2. EDITAR: `validate.ts` — extender registros compartidos

```typescript
// HARD_BLOCK_WARNING_SUFFIXES: añadir 2 sufijos (ambos son HARD_BLOCK, como los ya existentes)
export const HARD_BLOCK_WARNING_SUFFIXES = [
  "_no_legible",
  "_incoherente",              // ya cubre "poder_entidad_nit_incoherente" y "poder_entidad_nombre_incoherente"
  "_placeholder",
  "_duplicidad_cruzada",
  "_menciones_incoherentes",
] as const;
```

**Ojo — decisión clave**: el sufijo `_incoherente` YA está en la lista (lo agregó Fase 1 vía `escritura_num_incoherente` y `fecha_incoherente`). Ambos nuevos warnings terminan en `_incoherente` → **no requieren nuevos sufijos**, ya son HARD_BLOCK por herencia del sufijo existente. Verificar con test explícito (ver §4).

```typescript
// WARNING_LABELS: añadir 2 entradas
poder_entidad_nit_incoherente:
  "El NIT del banco que otorga el poder no coincide con el NIT del acreedor hipotecario extraído de la escritura/certificado — el poder podría no aplicar a esta cancelación.",
poder_entidad_nombre_incoherente:
  "El nombre del banco que otorga el poder no coincide con el acreedor hipotecario extraído de la escritura/certificado — verifica que el poder corresponda a esta cancelación.",

// SUSPICIOUS_FIELD_LABELS: añadir 4 entradas
"poderdante.entidad_nit": "NIT del banco que otorga el poder",
"poderdante.entidad_nombre": "Nombre del banco que otorga el poder",
"partes.banco_nit": "NIT del banco acreedor (escritura/certificado)",
"partes.banco_acreedor": "Nombre del banco acreedor (escritura/certificado)",
```

### 3. EDITAR: `supabase/functions/procesar-cancelacion/index.ts`

**Import (junto a los existentes en línea 1408-1410):**

```typescript
import { validatePoderVsCancelacion } from "../_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts";
```

**Nueva función wrapper (justo después de `annotatePoderCoherencia`, ~línea 1440):**

```typescript
async function annotatePoderIntraTramite(
  supabase: any,
  merged: Record<string, unknown> | undefined | null,
  partes: { banco_nit?: string | null; banco_acreedor?: string | null } | null | undefined,
  ctx: { orgId: string; cancelacionId: string; userId: string; trigger: string },
): Promise<void> {
  if (!merged) return;
  const { warnings, suspicious } = validatePoderVsCancelacion(merged, partes);
  if (warnings.length === 0) return;
  // ACUMULAR — no sobrescribir lo que annotatePoderCoherencia ya escribió.
  const prevW = Array.isArray(merged._coherencia_warnings) ? merged._coherencia_warnings as string[] : [];
  const prevS = Array.isArray(merged._coherencia_suspicious) ? merged._coherencia_suspicious as string[] : [];
  merged._coherencia_warnings = [...prevW, ...warnings];
  merged._coherencia_suspicious = Array.from(new Set([...prevS, ...suspicious]));
  try {
    await supabase.from("system_events").insert({
      organization_id: ctx.orgId,
      tramite_id: ctx.cancelacionId,
      user_id: ctx.userId,
      evento: "procesar-cancelacion.poder.intra_tramite",
      resultado: "warnings",
      categoria: "ocr_poder_banco",
      detalle: { trigger: ctx.trigger, warnings, suspicious: Array.from(suspicious) },
    });
  } catch (_) { /* no bloqueante */ }
}
```

**Llamada (insertar entre `annotatePoderCoherencia` y `runPoderCrossChecks`, línea ~2753):**

```typescript
await annotatePoderCoherencia(supabaseService, mergedPoder, { … });
// NUEVA:
await annotatePoderIntraTramite(
  supabaseService,
  mergedPoder as unknown as Record<string, unknown>,
  { banco_nit: extracted.partes.banco_nit, banco_acreedor: extracted.partes.banco_acreedor },
  { orgId, cancelacionId, userId, trigger: "live_pipeline" },
);
await runPoderCrossChecks(supabaseService, mergedPoder, { … });
```

**Orden importa**: primero `annotatePoderCoherencia` (inicializa el array), luego intra-trámite (acumula), luego cross-checks (también acumula — verificar que ya lo hace; si sobrescribe, es bug preexistente fuera de alcance).

### 4. NUEVO: `src/shared/poderBancoValidateIntraTramite.test.ts`

Tests de regresión (7 casos exactos):

```typescript
import { describe, it, expect } from "vitest";
import {
  validatePoderVsCancelacion,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite";
import { HARD_BLOCK_WARNING_SUFFIXES, isHardBlockCoherenciaWarning } from "…/validate";

describe("validatePoderVsCancelacion", () => {
  const poderdante = (extra: Record<string, unknown>) => ({
    poderdante: { entidad_nit: null, entidad_nombre: null, ...extra },
  });

  it("Regla 1: NIT distinto → dispara poder_entidad_nit_incoherente", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "860034313-7", entidad_nombre: "BANCO DAVIVIENDA S.A." }),
      { banco_nit: "890903938-8", banco_acreedor: "BANCOLOMBIA S.A." },
    );
    expect(r.warnings).toContain("poder_entidad_nit_incoherente");
    expect(r.suspicious.has("poderdante.entidad_nit")).toBe(true);
    expect(r.suspicious.has("partes.banco_nit")).toBe(true);
  });

  it("Regla 1: NIT igual (formatos distintos) → NO dispara", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "860034313-7", entidad_nombre: "DAVIVIENDA" }),
      { banco_nit: "860.034.313-7", banco_acreedor: "BANCO DAVIVIENDA S.A." },
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("Regla 2: NIT faltante en poder + nombres distintos → dispara fuzzy", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nombre: "BANCOLOMBIA S.A." }),
      { banco_nit: "860.034.313-7", banco_acreedor: "BANCO DAVIVIENDA S.A." },
    );
    expect(r.warnings).toContain("poder_entidad_nombre_incoherente");
  });

  it("Regla 2: NIT faltante + nombres similares (DAVIVIENDA vs BANCO DAVIVIENDA S.A.) → NO dispara", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nombre: "DAVIVIENDA" }),
      { banco_acreedor: "BANCO DAVIVIENDA S.A." },
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("Ambos NIT presentes + coinciden, nombres diferentes → NO doble-dispara (Regla 2 no corre)", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "860034313-7", entidad_nombre: "DAVIVIENDA" }),
      { banco_nit: "860.034.313-7", banco_acreedor: "OTRO NOMBRE COMPLETAMENTE DISTINTO" },
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("Ambos NIT presentes + distintos → dispara Regla 1, ignora Regla 2 aunque nombres también difieran", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "111", entidad_nombre: "BANCOLOMBIA" }),
      { banco_nit: "222", banco_acreedor: "DAVIVIENDA" },
    );
    expect(r.warnings).toEqual(["poder_entidad_nit_incoherente"]);
  });

  it("Contrato HARD_BLOCK: ambos warnings terminan en _incoherente y son HARD_BLOCK", () => {
    expect(HARD_BLOCK_WARNING_SUFFIXES).toContain("_incoherente");
    expect(isHardBlockCoherenciaWarning("poder_entidad_nit_incoherente")).toBe(true);
    expect(isHardBlockCoherenciaWarning("poder_entidad_nombre_incoherente")).toBe(true);
  });
});
```

---

## Fuera de alcance

- No se toca `merge.ts` — los campos ya vienen mergeados.
- No se toca UI. Los sufijos ya son HARD_BLOCK vía `_incoherente`, y `revision_manual_requerida` se activa en el edge por lógica existente que consume `HARD_BLOCK_WARNING_SUFFIXES`. UI ya renderiza el label desde `WARNING_LABELS`.
- No se mueve `bankDirectory.ts` completo — solo se replica `normalizeBankName` en el nuevo módulo isomórfico.
- No se altera `crossCheck.ts` (sigue haciendo inter-trámite).
- No se altera `annotatePoderCoherencia` — se crea función hermana `annotatePoderIntraTramite`.
- Fase 3 (backfill retroactivo sobre cancelaciones históricas) sigue en pausa.

## Riesgos

- **Nombres bancarios muy cortos** ("BANCO W" normaliza a "W") podrían dar falsos positivos por inclusión bidireccional. Mitigación: la Regla 2 solo corre cuando falta un NIT; el catálogo de bancos colombianos no tiene otro monoletra. Aceptable.
- **Duplicación de `normalizeBankName`** (existe en `src/lib/bankDirectory.ts`). Aceptable: 15 líneas, pura, sin dependencias. Refactor a `_shared/isomorphic/text/` queda para cuando aparezca el segundo caller isomórfico.

## Validación post-implementación

1. Correr `poderBancoValidateIntraTramite.test.ts` (7/7 verde).
2. Correr suite completa Vitest (esperado sin regresiones).
3. Deploy explícito de `procesar-cancelacion`.
4. Confirmar en `system_events` que aparecen eventos `procesar-cancelacion.poder.intra_tramite` cuando el escenario dispare.
