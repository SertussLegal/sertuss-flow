# Ajuste Paso B — Fase 2: Agrupación determinista antes de Claude

Este ajuste reemplaza el Paso B original del plan de Fase 2. Nada más cambia (Paso A skeleton, C UI lectura, D botón+polling, E modal+RPC, F verificación siguen igual).

---

## 1. Nueva arquitectura del Paso B

**Antes:** Claude recibe 50 expedientes completos → detecta patrones + cuenta frecuencia + redacta.
**Ahora:** el código agrupa y cuenta patrones deterministas; Claude solo redacta/categoriza/propone regla sobre patrones ya consolidados.

```text
┌──────────────────────────────┐
│ SELECT 50 trámites (word_gen)│
│  + logs_extraccion           │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ diffTramite(data_ia,         │
│             data_final)      │  ← determinista, sin IA
│  → Diff[] por trámite        │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ groupPatterns(allDiffs)      │  ← agrupa por (campo, tipoDiscrepancia)
│  → Pattern[] con frecuencia  │     descarta frecuencia < 2
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Claude Sonnet 4 — 1 request  │
│  input: Pattern[] compactos  │  ← SOLO campos involucrados
│  output: propuesta redactada │     por patrón (título, cat,
│          por patrón          │     severidad, regla_det)
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ INSERT regla_propuesta       │
│ UPDATE regla_propuesta_run   │
└──────────────────────────────┘
```

---

## 2. Pseudocódigo de la fase determinista (TypeScript)

Ubicación: dentro de `supabase/functions/descubrir-reglas/index.ts` (o helper `_patterns.ts` en la misma carpeta si crece).

### 2.1 Tipos

```ts
type DiffTipo =
  | "solo_ia_vacio"       // data_ia vacío, humano lo llenó
  | "solo_final_vacio"    // humano borró un valor de la IA
  | "valor_distinto"      // ambos con valor, humano corrigió
  | "formato_normalizado" // mismo valor semántico, formato distinto (mayúsculas, espacios, guiones)
  | "booleano_flip";      // true ↔ false

interface Diff {
  tramiteId: string;
  campo: string;              // path dot-notation: "personas[0].lugar_expedicion", "inmueble.matricula_inmobiliaria"
  campoRaiz: string;          // "lugar_expedicion" (para agrupar sin importar índice)
  tipo: DiffTipo;
  valorIA: unknown;
  valorFinal: unknown;
  contexto: Record<string, unknown>; // ver §2.4
}

interface Pattern {
  campoRaiz: string;
  tipo: DiffTipo;
  frecuencia: number;                 // tramites distintos
  evidencia: Array<{
    tramiteId: string;
    valorIA: unknown;
    valorFinal: unknown;
    contexto: Record<string, unknown>;
  }>;
}
```

### 2.2 Diff por trámite

```ts
function diffTramite(tramiteId: string, dataIA: any, dataFinal: any): Diff[] {
  if (!dataFinal) return []; // sin correcciones humanas, no aporta señal
  const diffs: Diff[] = [];
  const paths = enumerateFieldPaths(dataIA, dataFinal); // recorre personas[], inmueble, actos
  for (const p of paths) {
    const vi = getPath(dataIA, p);
    const vf = getPath(dataFinal, p);
    const tipo = classifyDiff(vi, vf);
    if (!tipo) continue; // sin diferencia relevante
    diffs.push({
      tramiteId,
      campo: p,
      campoRaiz: rootField(p),                        // p.ej. "personas[0].lugar_expedicion" → "lugar_expedicion"
      tipo,
      valorIA: vi,
      valorFinal: vf,
      contexto: extractContext(dataFinal, p),         // §2.4
    });
  }
  return diffs;
}

function classifyDiff(vi: unknown, vf: unknown): DiffTipo | null {
  const eIA = isEmpty(vi), eF = isEmpty(vf);
  if (eIA && eF) return null;
  if (eIA && !eF) return "solo_ia_vacio";
  if (!eIA && eF) return "solo_final_vacio";
  if (typeof vi === "boolean" && typeof vf === "boolean" && vi !== vf) return "booleano_flip";
  if (String(vi) === String(vf)) return null;
  if (normalize(vi) === normalize(vf)) return "formato_normalizado";
  return "valor_distinto";
}

const normalize = (v: unknown) =>
  String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ").replace(/[-_]/g, "");
```

### 2.3 Agrupación y frecuencia

```ts
function groupPatterns(all: Diff[]): Pattern[] {
  const map = new Map<string, Pattern>();
  const seen = new Map<string, Set<string>>(); // key → set de tramiteId
  for (const d of all) {
    const key = `${d.campoRaiz}::${d.tipo}`;
    if (!map.has(key)) {
      map.set(key, { campoRaiz: d.campoRaiz, tipo: d.tipo, frecuencia: 0, evidencia: [] });
      seen.set(key, new Set());
    }
    const s = seen.get(key)!;
    if (!s.has(d.tramiteId)) s.add(d.tramiteId);
    map.get(key)!.evidencia.push({
      tramiteId: d.tramiteId,
      valorIA: d.valorIA,
      valorFinal: d.valorFinal,
      contexto: d.contexto,
    });
  }
  const patterns: Pattern[] = [];
  for (const [key, p] of map) {
    p.frecuencia = seen.get(key)!.size;
    if (p.frecuencia >= 2) patterns.push(p);
  }
  // ordenar por frecuencia desc, cortar top 20 antes de enviar a Claude
  return patterns.sort((a, b) => b.frecuencia - a.frecuencia).slice(0, 20);
}
```

### 2.4 Contexto mínimo por patrón

Para cada campo raíz se define una whitelist de "campos hermanos" que Claude necesita para razonar sobre la regla, sin filtrar el expediente completo:

```ts
const CONTEXT_WHITELIST: Record<string, string[]> = {
  lugar_expedicion: ["municipio_domicilio", "tipo_identificacion"],
  matricula_inmobiliaria: ["departamento", "municipio", "tipo_predio"],
  identificador_predial: ["municipio", "tipo_identificador_predial"],
  valor_hipoteca: ["es_hipoteca", "entidad_bancaria"],
  entidad_nit: ["entidad_bancaria"],
  representante_legal_nombre: ["es_persona_juridica", "razon_social"],
  // … completar según los 7 campos con más señal
};

function extractContext(dataFinal: any, path: string): Record<string, unknown> {
  const root = rootField(path);
  const siblings = CONTEXT_WHITELIST[root] ?? [];
  const parent = parentPath(path);
  const ctx: Record<string, unknown> = {};
  for (const s of siblings) ctx[s] = getPath(dataFinal, `${parent}.${s}`);
  return ctx;
}
```

**Filtrado de PII:** ningún nombre, cédula, teléfono, email o valor monetario no relacionado con el campo del patrón entra al payload. Solo el `valorIA`, `valorFinal` y los siblings whitelisted.

---

## 3. Prompt actualizado a Claude

Un solo request con `tool_use` forzado. El input ya no son 50 expedientes, son ≤20 patrones consolidados.

### 3.1 Sistema

```
Eres un redactor técnico especializado en reglas de validación notarial.

Recibes patrones de corrección humana YA DETECTADOS Y CONTADOS por un
proceso determinista. Tu único trabajo es, para cada patrón:

1. Redactar un título ≤80 chars y descripción ≤400 chars claros y accionables.
2. Clasificar categoria (formato | coherencia | legal | negocio).
3. Asignar nivel_severidad (error | advertencia | sugerencia) — por defecto
   "sugerencia" salvo evidencia clara de bloqueo legal.
4. Proponer una regla determinista implementable como
   regex | comparacion | presencia | rango, con expresion concreta y
   descripcion_humana.
5. Indicar tipo_acto aplicable (compraventa | hipoteca | poder | cancelacion | todos).

NO cuentes frecuencias — llegan resueltas en el campo `frecuencia`.
NO inventes patrones nuevos — responde exactamente un item por patrón recibido.
NO leas ni razones sobre datos fuera del bloque <patrones_readonly>.
Devuelve JSON estricto vía tool_use, en el mismo orden que recibiste.
```

### 3.2 User

```
<reglas_existentes_readonly>
[ { codigo, categoria, descripcion } × 35 ]   // para evitar duplicados
</reglas_existentes_readonly>

<patrones_readonly>
[
  {
    "id": "p1",
    "campoRaiz": "lugar_expedicion",
    "tipo": "solo_ia_vacio",
    "frecuencia": 7,
    "evidencia": [
      { "tramiteId": "…", "valorIA": null, "valorFinal": "BOGOTÁ",
        "contexto": { "municipio_domicilio": "CHIA", "tipo_identificacion": "CC" } },
      … máx 5 evidencias por patrón …
    ]
  },
  …
]
</patrones_readonly>

Redacta una propuesta por cada patrón, en el mismo orden.
Si un patrón ya está cubierto por una regla existente, marca
`duplicado_de: "<codigo>"` y no propongas regla.
```

### 3.3 Schema tool_use (idéntico shape al plan previo, con `id` y `duplicado_de`)

```json
{
  "propuestas": [{
    "id": "p1",
    "titulo": "…",
    "descripcion": "…",
    "tipo_acto": "…",
    "categoria": "…",
    "nivel_severidad": "…",
    "campos_afectados": ["…"],
    "regla_deterministica_sugerida": { "tipo": "…", "expresion": "…", "descripcion_humana": "…" },
    "duplicado_de": null
  }]
}
```

Al insertar en `regla_propuesta`: si `duplicado_de != null`, se descarta (o se guarda con status `rechazada_auto` según preferencia — recomiendo descartar para no ensuciar la tabla).

---

## 4. Nuevo estimado de tokens y costo

Base: Claude Sonnet 4 vía Anthropic API. Precios: input $3/M tokens, output $15/M tokens.

### Diseño anterior (50 expedientes completos)

| Ítem | Estimación |
|---|---|
| 50 trámites × ~2.5 KB JSON compacto c/u | ~125 KB ≈ **~35 000 tokens input** |
| 35 reglas × ~150 chars | ~5 KB ≈ **~1 500 tokens input** |
| Prompt sistema + instrucciones | ~800 tokens |
| **Input total** | **~37 000 tokens** |
| Output (hasta 15 propuestas × ~400 tokens) | **~6 000 tokens** |
| **Costo** | 37 000 × $3/M + 6 000 × $15/M ≈ **$0,20 USD/run** |

### Diseño ajustado (≤20 patrones consolidados)

| Ítem | Estimación |
|---|---|
| 20 patrones × ~600 bytes (5 evidencias whitelisted + metadata) | ~12 KB ≈ **~3 500 tokens input** |
| 35 reglas existentes | ~1 500 tokens input |
| Prompt sistema + instrucciones | ~700 tokens |
| **Input total** | **~5 700 tokens** |
| Output (20 propuestas × ~350 tokens) | **~7 000 tokens** |
| **Costo** | 5 700 × $3/M + 7 000 × $15/M ≈ **$0,12 USD/run** |

**Reducción:**
- Input: **~85% menor** (37k → 5.7k tokens).
- Costo total: **~40% menor** (~$0.20 → ~$0.12), limitado por el output que se mantiene alto porque igual redactamos propuestas largas.
- Latencia esperada: baja de 15–60s a **8–25s** (Sonnet 4 con contexto pequeño es notablemente más rápido).
- Beneficio adicional no cuantificado en $: **precisión de frecuencia** deja de depender del criterio de Claude — ahora es determinista y auditable.

---

## 5. Impacto en el resto del plan

- **Paso A, C, D, E, F:** sin cambios.
- **`regla_propuesta.frecuencia_estimada`:** ya no es "estimada", es exacta — considerar renombrar a `frecuencia` en Paso E o dejar el nombre y documentarlo (recomiendo dejar el nombre para no tocar migración).
- **Riesgo R1 (regla peligrosa)** se reduce: Claude nunca decide qué es un patrón, solo redacta uno real.
- **Riesgo R2 (duplicados)** se refuerza: prompt recibe reglas existentes + campo `duplicado_de` explícito.
- **Riesgo R6 (prompt injection)**: mitigado más fuerte, ya no entra texto libre de OCR de campos irrelevantes; solo entran los valores de los campos del patrón (que sí pueden contener texto, pero acotado).

---

**Nada aplicado.** Espero aprobación de este ajuste antes de mover Paso B a build.
