
# Fix: priorizar V6 profundo sobre monolítico para `apoderado_nombre` / `apoderado_cedula`

## 1. Diagnóstico — de dónde viene "79.123.456"

Ruta actual en `mergePoderBancoV6` (`supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts`):

```
v6Flat  ──┐
          ├──► combinedDedicado ──┐
dedicado ─┘                       ├──► mergePoderBancoFlat(monolitico, combinedDedicado)
                                  │
monolitico ───────────────────────┘
```

- Líneas 116-124 combinan `v6Flat` con `dedicadoFlat` priorizando V6 (`v6Flat?.x ?? dedicadoFlat?.x`). OK.
- Línea 126 llama `mergePoderBancoFlat(monolitico, combinedDedicado)`, y `mergePoderBancoFlat` prioriza **monolítico > dedicado** (línea 82, `pick(m, d) = sanitize(m) ?? sanitize(d)`).
- Neto: **monolítico gana sobre V6**. Por eso `apoderado_cedula = "79.123.456"` (formato con puntos + 8 dígitos, típico de un firmante del banco) proviene del extractor **monolítico** (Gemini 2.5 Pro, prompt genérico que ve todo el trámite), mientras que V6 —con schema profundo dedicado a un solo instrumento— extrajo la real `52219803` y el classifier ya la validó como `tipo="natural"`.

El bloque de líneas 141-150 sólo actúa si `finalFlat.apoderado_nombre` está vacío; como monolítico llenó nombre y cédula, ese fallback no se dispara.

**Conclusión:** V6 tiene más contexto (ve `instrumento_poder` completo, distingue apoderado del banco de firmantes internos) y pasa por `classifyApoderado`. Cuando el classifier no degrada, V6 debe ganar.

## 2. Fix propuesto — patch quirúrgico en `mergePoderBancoV6`

Después de calcular `cls` y `apoderadoOut`, y antes de construir `finalFlat`, sobrescribir con V6 cuando `cls.tipoEfectivo !== null`.

```ts
// merge.ts — reemplazo de líneas 140-150

const finalFlat: PoderBancoFlat = { ...(flatMerged || {}) };

// 🎯 V6-wins: cuando el classifier NO degradó (tipo natural|juridica confirmado),
// V6 profundo es más confiable que el monolítico para identificar al apoderado.
// El monolítico a veces confunde al apoderado del banco con firmantes internos
// mencionados en el mismo documento.
if (cls.tipoEfectivo !== null && apoderadoOut) {
  if (cls.tipoEfectivo === "natural") {
    const v6Nombre = sanitizeString(apoderadoOut.nombre);
    const v6Cedula = sanitizeString(apoderadoOut.cedula);
    if (v6Nombre) finalFlat.apoderado_nombre = v6Nombre;
    if (v6Cedula) finalFlat.apoderado_cedula = v6Cedula;
  } else if (cls.tipoEfectivo === "juridica") {
    const reps = apoderadoOut.representantes || [];
    const firmante = reps.find((r) => r?.es_firmante && r?.nombre)
      || reps.find((r) => r?.nombre)
      || reps[0];
    const v6Nombre = sanitizeString(firmante?.nombre);
    const v6Cedula = sanitizeString(firmante?.cedula);
    if (v6Nombre) finalFlat.apoderado_nombre = v6Nombre;
    if (v6Cedula) finalFlat.apoderado_cedula = v6Cedula;
  }
}

// Fallback preexistente: si aún no hay nombre, rellenar desde V6 aunque
// tipo esté degradado (para no perder señal). Sin cambios de semántica.
if (!finalFlat.apoderado_nombre && apoderadoOut?.tipo === "juridica") {
  const reps = apoderadoOut.representantes || [];
  const primer = reps.find((r) => r?.nombre) || reps[0];
  if (primer?.nombre) finalFlat.apoderado_nombre = String(primer.nombre);
  if (primer?.cedula && !finalFlat.apoderado_cedula) finalFlat.apoderado_cedula = String(primer.cedula);
}
if (!finalFlat.apoderado_nombre && apoderadoOut?.tipo === "natural" && apoderadoOut.nombre) {
  finalFlat.apoderado_nombre = String(apoderadoOut.nombre);
  if (apoderadoOut.cedula && !finalFlat.apoderado_cedula) finalFlat.apoderado_cedula = String(apoderadoOut.cedula);
}
```

**Bonus para "jurídica":** además del override de nombre/cédula, se selecciona preferentemente el representante marcado `es_firmante=true` (más semánticamente preciso que "el primero con nombre").

## 3. Compatibilidad con V6 apagado

- `POWER_V6_EXTRACTOR_ENABLED=false` → `deepV6 = null` → línea 128 hace `early return` con `flatMerged` puro. **El bloque nuevo nunca se ejecuta.** Comportamiento legacy intacto.
- `deepV6` presente pero sin `apoderado` → `apoderadoOut = null` → guard `cls.tipoEfectivo !== null && apoderadoOut` falla. Sin cambios.
- `deepV6.apoderado.tipo` degradado a `null` por el classifier → `cls.tipoEfectivo = null` → no override. Se mantiene monolítico > dedicado como fallback conservador.

## 4. Tests nuevos en `src/shared/poderBancoExtractor.test.ts`

Dentro de `describe("mergePoderBancoV6", ...)`:

```ts
it("V6-wins: tipo='natural' no degradado, cédula de V6 sobrescribe la del monolítico", () => {
  const mono = { apoderado_nombre: "PERSONA EQUIVOCADA", apoderado_cedula: "79.123.456" };
  const deep: PoderBancoDeepPayload = {
    has_apoderado_banco_v3: "true",
    apoderado: { tipo: "natural", nombre: "ANA MARIA MONTOYA", cedula: "52219803" },
    instrumento_poder: {
      escritura_num: "2415",
      fecha: "2025-08-19",
      notaria_numero: "32",
      notaria_ciudad: "BOGOTA D.C.",
    },
  };
  const merged = mergePoderBancoV6(mono, null, deep);
  expect(merged?.apoderado_nombre).toBe("ANA MARIA MONTOYA");
  expect(merged?.apoderado_cedula).toBe("52219803");
});

it("V6-wins: tipo='juridica' no degradado prefiere representante firmante", () => {
  const mono = { apoderado_nombre: "OTRO NOMBRE", apoderado_cedula: "111" };
  const deep: PoderBancoDeepPayload = {
    has_apoderado_banco_v3: "true",
    apoderado: {
      tipo: "juridica",
      sociedad_razon_social: "SOC S.A.S.",
      sociedad_nit: "900123456-7",
      sociedad_constitucion: { camara_comercio_numero: "999" },
      representantes: [
        { nombre: "SUPLENTE", cedula: "222", cargo: "SUPLENTE", es_firmante: false },
        { nombre: "TITULAR FIRMANTE", cedula: "333", cargo: "REP LEGAL", es_firmante: true },
      ],
    },
  };
  const merged = mergePoderBancoV6(mono, null, deep);
  expect(merged?.apoderado_nombre).toBe("TITULAR FIRMANTE");
  expect(merged?.apoderado_cedula).toBe("333");
});

it("V6 degradado (tipo=null por falta de datos): NO override, mantiene monolítico", () => {
  const mono = { apoderado_nombre: "NOMBRE MONO", apoderado_cedula: "111" };
  const deep: PoderBancoDeepPayload = {
    has_apoderado_banco_v3: "true",
    // Sin instrumento_poder ni escritura_poder_* → classifier degrada
    apoderado: { tipo: "natural", nombre: "IA NOMBRE", cedula: "222" },
  };
  const merged = mergePoderBancoV6(mono, null, deep);
  // classifier degradó → mono gana (comportamiento legacy)
  expect(merged?.apoderado_nombre).toBe("NOMBRE MONO");
  expect(merged?.apoderado_cedula).toBe("111");
  expect((merged?.apoderado as { tipo?: string | null })?.tipo).toBeNull();
});

it("V6 apagado (deepV6=null): comportamiento legacy sin cambios", () => {
  const mono = { apoderado_nombre: "MONO", apoderado_cedula: "999" };
  const merged = mergePoderBancoV6(mono, null, null);
  expect(merged?.apoderado_nombre).toBe("MONO");
  expect(merged?.apoderado_cedula).toBe("999");
});
```

También revisar que el test preexistente **"Humano/monolítico gana sobre v6 profundo en campos planos legacy"** siga verde. Debería: ese test no envía `instrumento_poder` ni datos de sustitución, por lo que el classifier lo degradará a `null` y el override no aplicará → monolítico sigue ganando. ✅

## 5. Plan de validación en vivo

1. Correr `bunx vitest run` — esperar 122 preexistentes + 4 nuevos = **126 verdes**.
2. Redesplegar `procesar-cancelacion`.
3. Pedir al usuario que reprocese el mismo poder de Ana María una vez más.
4. Verificar en BD sobre el nuevo `id`:
   ```sql
   SELECT data_ia->'poder_banco'->>'apoderado_nombre' AS nom_plano,
          data_ia->'poder_banco'->>'apoderado_cedula' AS ced_plana,
          data_ia->'poder_banco'->'apoderado'->>'cedula' AS ced_v6
   FROM cancelaciones WHERE id = '<nuevo_id>';
   ```
   **Esperado:** `nom_plano="ANA MARIA MONTOYA ECHEVERRY"`, `ced_plana="52219803"` == `ced_v6`.
5. Confirmar que el `.docx` renderiza la cédula correcta.

## 6. Riesgos / consideraciones

- **Regresión posible:** casos donde el humano editó manualmente `apoderado_cedula` en el monolítico y V6 se equivoca. Mitigación: la edición manual **no pasa por este merge** — vive en `data_final`, que siempre gana sobre `data_ia` en el pipeline downstream (regla "Read-then-Merge, Manual > OCR > BD"). Este merge sólo afecta `data_ia`.
- **Formato de cédula:** V6 devuelve dígitos limpios (`52219803`), monolítico a veces con puntos (`79.123.456`). El nuevo output será sin puntos — consistente con el formato canónico de la app.
- **Cambio de contrato observable:** consumidores que leyeran `data_ia.poder_banco.apoderado_cedula` esperando el valor del monolítico verán ahora el de V6 cuando el classifier valida. Es el comportamiento deseado.
