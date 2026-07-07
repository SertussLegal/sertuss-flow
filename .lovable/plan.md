## Diagnóstico (evidencia del caso real 32f5317e)

**Data v6 persistida** (relevante):
```json
"apoderado": { "tipo": null, "cedula": "52857443", "nombre": "ANA MARIA MONTOYA ECHEVERRY" }
"instrumento_poder": {
  "escritura_num": "21843", "fecha": "2023-05-26",
  "notaria_numero": "29", "notaria_ciudad": "BOGOTA",
  "notario_titular_nombre": "DANIEL PALACIOS RUBIO"
}
"apoderado_nombre": "null",  "apoderado_cedula": "null",   ← string literal
"_classifier_motivos": ["natural_missing_poder_data"]
```

**Causa raíz #1 (classifier):** `apoderadoClassifier.ts` líneas 137-144 (Regla C) exige `apo.escritura_poder_num / _fecha / _notaria_num` **sobre el objeto `apoderado`**. Pero el schema v6 devuelto por Gemini **NO** pone esos campos en `apoderado` — los pone en el sibling `instrumento_poder` (que ES la escritura del poder mismo). Por eso Regla C dispara siempre en poderes DIRECTOS del banco a persona natural, aunque el poder esté 100% identificado.

Los campos `apo.escritura_poder_*` sólo tienen sentido cuando existe un **acto de sustitución** (Ana María recibe el poder → Ana María sustituye a Pedro): ahí sí hay una escritura extra que apunta a la escritura ORIGINAL del banco. En el patrón DIRECTO no existe tal acto.

**Causa raíz #2 (flat "null"):** Gemini está devolviendo, en algunos campos plano legacy, el `valor` como la string `"null"` (no `null` JSON). `unwrapConf` en `merge.ts:41-50` sólo hace `.trim()` y lo persiste tal cual. Downstream cualquier consumidor que lea el flat verá literalmente `"null"`.

---

## 1. Rediseño de `classifyApoderado` — reconocer los 2 patrones

**Contrato nuevo:** aceptar un segundo argumento opcional con el contexto v6.

```ts
export interface ClassifyContext {
  /** Del schema v6, sibling de apoderado. Datos de la escritura del poder mismo. */
  instrumento_poder?: {
    escritura_num?: string | null;
    fecha?: string | null;
    fecha_texto?: string | null;
    notaria_numero?: string | null;
    notaria_ciudad?: string | null;
  } | null;
  /** "true" | "false" | "null" del extractor v6. */
  has_apoderado_banco_v3?: "true" | "false" | "null" | null;
}

export function classifyApoderado(
  apo: ApoderadoPayload | null | undefined,
  ctx?: ClassifyContext,
): ClassifierResult
```

**Lógica nueva de Regla C (natural sin datos del poder):**

```ts
if (tipoIA === "natural") {
  // Regla A intacta (contaminación corporativa) — sin cambios.

  // Regla C — reescrita para distinguir DIRECTO vs SUSTITUCIÓN.
  const tieneEscrituraSustitucion =
    isNonEmpty(apo.escritura_poder_num) ||
    isNonEmpty(apo.escritura_poder_fecha) ||
    isNonEmpty(apo.escritura_poder_notaria_num);

  const inst = ctx?.instrumento_poder;
  const tieneInstrumentoDirecto =
    !!inst && (
      isNonEmpty(inst.escritura_num) ||
      isNonEmpty(inst.fecha) ||
      isNonEmpty(inst.fecha_texto) ||
      isNonEmpty(inst.notaria_numero)
    );

  // Requiere identidad mínima del apoderado en cualquier patrón.
  const tieneIdentidad = isNonEmpty(apo.nombre) && isNonEmpty(apo.cedula);

  // Poder DIRECTO válido: identidad + instrumento_poder.
  // Poder SUSTITUIDO válido: identidad + escritura_poder_* del sub-acto.
  // Degrada sólo si faltan AMBAS fuentes de evidencia del poder.
  if (!tieneIdentidad || (!tieneInstrumentoDirecto && !tieneEscrituraSustitucion)) {
    motivos.push("natural_missing_poder_data");
  }
}
```

Sin cambios en:
- Override manual (precedencia máxima).
- Regla A (contaminación corporativa).
- Regla B (jurídica sin constitución).
- Confianza baja / sin tipo IA.
- Motivos: reusa el string `"natural_missing_poder_data"` — sólo cambia la condición que lo dispara, no su semántica externa.

**Call site en `merge.ts:111`:** pasar el ctx.
```ts
const cls = classifyApoderado(apoderadoIn, {
  instrumento_poder: deepV6.instrumento_poder ?? null,
  has_apoderado_banco_v3: deepV6.has_apoderado_banco_v3 ?? null,
});
```

Ningún otro consumidor (`src/shared/apoderadoClassifier.ts` shim, PoderBannersV5, ProsaApoderadoPreviewCard) necesita cambios de firma: el 2º argumento es opcional; los tests actuales que llaman sin ctx seguirán funcionando (`instrumento_poder=undefined` → `tieneInstrumentoDirecto=false`, y como esos tests SÍ pasan `escritura_poder_*` en apo, `tieneEscrituraSustitucion=true`, resultado idéntico).

---

## 2. Fix "null" literal en merge plano

En `poderBancoExtractor/merge.ts`, endurecer `unwrapConf`:

```ts
const NULLY_STRINGS = new Set(["null", "NULL", "Null", "undefined", "N/A", "n/a", "-", "--", "---"]);

export function unwrapConf(v: unknown): string | undefined {
  if (v == null) return undefined;
  const raw =
    typeof v === "string" ? v
    : (typeof v === "object" && v !== null && "valor" in v ? (v as any).valor : undefined);
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t || NULLY_STRINGS.has(t)) return undefined;
  return t;
}
```

Y añadir un saneador simétrico para los campos plano que vienen del monolítico (no todos pasan por `unwrapConf`), aplicado dentro de `mergePoderBancoFlat` justo antes del `pick`:

```ts
const sanitize = (s: string | null | undefined): string | undefined => {
  if (s == null) return undefined;
  const t = String(s).trim();
  if (!t || NULLY_STRINGS.has(t)) return undefined;
  return t;
};
```
y usar `pick(sanitize(m), sanitize(d))` en los 5 campos.

Con este saneo, el objeto persistido dejará de exponer `"apoderado_nombre": "null"` y quedará ausente (o rellenado por el fallback nested del bloque 116-126, que ya escribe desde `apoderadoOut.nombre` cuando el flat está vacío).

---

## 3. Plan de tests

Nuevos en `src/shared/apoderadoClassifier.test.ts`:

```ts
describe("classifyApoderado — patrones de poder v6", () => {
  const anaMaria = {
    tipo: "natural" as const,
    nombre: "ANA MARIA MONTOYA ECHEVERRY",
    cedula: "52857443",
    // sin escritura_poder_* (esto es DIRECTO, no sustitución)
  };
  const instrumentoOk = {
    escritura_num: "21843", fecha: "2023-05-26",
    notaria_numero: "29", notaria_ciudad: "BOGOTA",
  };

  it("PODER DIRECTO: banco → natural, con instrumento_poder → tipoEfectivo='natural'", () => {
    const r = classifyApoderado(anaMaria, { instrumento_poder: instrumentoOk });
    expect(r.tipoEfectivo).toBe("natural");
    expect(r.motivos).toEqual([]);
  });

  it("PODER DIRECTO sin ctx: retrocompatibilidad — degrada como antes", () => {
    const r = classifyApoderado(anaMaria);
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("natural_missing_poder_data");
  });

  it("SUSTITUCIÓN: apoderado con escritura_poder_* pero sin instrumento → 'natural'", () => {
    const r = classifyApoderado(
      { ...anaMaria, escritura_poder_num: "999", escritura_poder_fecha: "2024-01-01", escritura_poder_notaria_num: "5" },
    );
    expect(r.tipoEfectivo).toBe("natural");
  });

  it("SIN NINGUNA EVIDENCIA del poder: degrada", () => {
    const r = classifyApoderado(anaMaria, { instrumento_poder: {} });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("natural_missing_poder_data");
  });

  it("Sin identidad (falta cédula o nombre): degrada aunque haya instrumento", () => {
    const r = classifyApoderado({ ...anaMaria, cedula: null }, { instrumento_poder: instrumentoOk });
    expect(r.tipoEfectivo).toBeNull();
  });
});
```

Nuevos en `src/shared/poderBancoExtractor.test.ts`:

```ts
describe("unwrapConf + mergePoderBancoFlat — saneo de 'null' literal", () => {
  it("unwrapConf: la string 'null' se normaliza a undefined", () => {
    expect(unwrapConf("null")).toBeUndefined();
    expect(unwrapConf("NULL")).toBeUndefined();
    expect(unwrapConf({ valor: "null" })).toBeUndefined();
    expect(unwrapConf({ valor: "  " })).toBeUndefined();
    expect(unwrapConf({ valor: "REAL" })).toBe("REAL");
  });

  it("mergePoderBancoV6: el flat 'null' del monolítico NO contamina, y el fallback nested rellena", () => {
    const merged = mergePoderBancoV6(
      { apoderado_nombre: "null", apoderado_cedula: "null" } as any,
      null,
      { apoderado: { tipo: "natural", nombre: "ANA MARIA", cedula: "52857443" } } as any,
    );
    expect(merged?.apoderado_nombre).toBe("ANA MARIA");
    expect(merged?.apoderado_cedula).toBe("52857443");
  });
});
```

Los tests existentes de la Regla C (línea 83-85 con `escritura_poder_num=""`) siguen verdes: pasan sin ctx → `tieneInstrumentoDirecto=false`, y con `escritura_poder_num=""` → `tieneEscrituraSustitucion=false` → degrada.

---

## 4. Plan de re-validación

1. `bunx vitest run` (esperar 115 previos + ~7 nuevos verdes).
2. Redeploy de `procesar-cancelacion` (`merge.ts` es isomórfico → cambio en el paquete `_shared/isomorphic` se recompila con el redeploy).
3. Pedir al usuario que reintente desde la UI el mismo poder de Ana María (o crear cancelación nueva con el mismo PDF).
4. Query de verificación:
```sql
SELECT id, status,
  data_ia->'poder_banco'->'apoderado'->>'tipo'   AS tipo,
  data_ia->'poder_banco'->>'apoderado_nombre'    AS flat_nombre,
  data_ia->'poder_banco'->>'apoderado_cedula'    AS flat_cedula,
  data_ia->'poder_banco'->'_classifier_motivos'  AS motivos
FROM cancelaciones
WHERE organization_id = (SELECT id FROM organizations WHERE name ILIKE '%sertuss%')
ORDER BY created_at DESC LIMIT 1;
```
Criterios de éxito:
- `tipo = "natural"` ✅
- `flat_nombre = "ANA MARIA MONTOYA ECHEVERRY"` (no `"null"`) ✅
- `flat_cedula = "52857443"` (no `"null"`) ✅
- `motivos = []` ✅
5. Abrir la UI de validación: confirmar que `ProsaApoderadoPreviewCard` renderiza la prosa de persona natural.

**Reproceso del trámite 32f5317e existente:** no se hará. El fix afecta la **clasificación en el momento de extracción**; los datos ya persistidos no se re-clasifican solos. La ruta correcta es una cancelación nueva con el mismo PDF. Si el producto quiere "curar" el registro viejo, es un update SQL puntual (`data_ia->apoderado->tipo = 'natural'`) que se puede hacer aparte, no forma parte de este fix.

---

## 5. Rollback

- Revertir el diff de `apoderadoClassifier.ts` (recuperar Regla C original) y `merge.ts` (recuperar `unwrapConf` sin `NULLY_STRINGS`).
- Redeploy de `procesar-cancelacion`.
- Los datos persistidos con el fix aplicado siguen siendo válidos (no hay cambio de shape, sólo se pobló `tipo` donde antes era null).

---

## Fuera de alcance

- Cambiar el prompt v6 para que Gemini deje de emitir `"null"` literal: es defensivo pero costoso (invalida caché). El saneo en `unwrapConf` es suficiente.
- Reclasificar automáticamente registros históricos.
- Añadir un motivo nuevo `natural_missing_identity`: se reusa `natural_missing_poder_data` para no ampliar la superficie de strings estables.
