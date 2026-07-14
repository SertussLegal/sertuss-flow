# Entrega 1 — Diff propuesto (SOLO PLAN)

Reordenada por prioridad: shared primero (schema + prompt), luego renderer defensivo con helpers reutilizables, luego tests. La motivación es que un segundo banco entrará en el pipeline pronto, y todo lo que sea específico de Davivienda debe quedar aislado.

---

## 1. Nuevo campo semántico `hipoteca_garantia_abierta` (schema + prompts)

**Objetivo:** que `valor_hipoteca_original` (monto del crédito) y `hipoteca_garantia_abierta` (techo de garantía) puedan coexistir. Hoy son mutuamente excluyentes por diseño del prompt.

### 1.1 `supabase/functions/procesar-cancelacion/index.ts` — schema monolítico (L113-179)

```diff
 interface HipotecaAnterior {
   ...
   valor_hipoteca_original: string;
-  valor_hipoteca_es_indeterminada?: boolean;
+  valor_hipoteca_es_indeterminada?: boolean;   // DEPRECATED alias — se rederiva en migración
+  hipoteca_garantia_abierta?: boolean;         // NUEVO — techo de garantía abierta/sin límite
 }
```

En el schema JSON (~L178-179):

```diff
- valor_hipoteca_original: { ...description: "...Cuantía indeterminada / hipoteca abierta → cadena vacía '' y valor_hipoteca_es_indeterminada=true..." },
- valor_hipoteca_es_indeterminada: { type: "boolean", description: "true SOLO si la hipoteca es declarada expresamente ABIERTA, SIN LÍMITE DE CUANTÍA, o de CUANTÍA INDETERMINADA." },
+ valor_hipoteca_original: { type: "string", description: "Monto del CRÉDITO HIPOTECARIO (mutuo) anclado al verbo rector ('presta', 'concede', 'desembolsa', 'otorga en mutuo'). Devuelve el monto SI EXISTE, INDEPENDIENTEMENTE de que la garantía se declare abierta. Formato notarial: '<LETRAS> DE PESOS ($<NÚMEROS>)' MAYÚSCULAS. Cadena vacía '' SOLO si no hay ninguna cifra anclable al mutuo. LISTA NEGRA: precio de venta, avalúo, subrogación, abono, saldo, subsidio, cesantías." },
+ hipoteca_garantia_abierta: { type: "boolean", description: "INDEPENDIENTE del monto. true si la escritura declara expresamente que la GARANTÍA HIPOTECARIA es 'ABIERTA', 'SIN LÍMITE DE CUANTÍA' o 'DE CUANTÍA INDETERMINADA'. Puede coexistir con un monto de mutuo (práctica VIS/Ley 546: mutuo determinado + garantía abierta). false por defecto." },
+ valor_hipoteca_es_indeterminada: { type: "boolean", description: "DEPRECATED — mantener por back-compat. Rellena con el mismo valor que hipoteca_garantia_abierta." },
```

En el bloque de instrucciones (~L361-371):

```diff
- Si encuentras un monto válido anclado al mutuo → 'valor_hipoteca_original' = "<LETRAS> DE PESOS ($<NÚMEROS>)" y 'valor_hipoteca_es_indeterminada' = false.
- Si la hipoteca es ABIERTA / SIN LÍMITE DE CUANTÍA / DE CUANTÍA INDETERMINADA → 'valor_hipoteca_original' = "" y 'valor_hipoteca_es_indeterminada' = true.
- Si hay dos cifras candidatas ambiguas → 'valor_hipoteca_original' = "" y 'valor_hipoteca_es_indeterminada' = false.
+ CAMPOS INDEPENDIENTES — evalúa cada uno por separado, pueden coexistir:
+   * valor_hipoteca_original: SI existe una cifra anclada al verbo rector del mutuo → devuélvela SIEMPRE, aunque la garantía se declare abierta (caso Ley 546/VIS típico). "" solo si no hay ninguna cifra anclable.
+   * hipoteca_garantia_abierta: true si aparece literal "HIPOTECA ABIERTA", "SIN LÍMITE DE CUANTÍA" o "DE CUANTÍA INDETERMINADA" en las cláusulas de la hipoteca. Es un hecho del texto — no depende de si encontraste o no un monto.
+   * valor_hipoteca_es_indeterminada: MISMO valor que hipoteca_garantia_abierta (campo legacy).
+ Ambigüedad entre dos cifras candidatas al mutuo → valor_hipoteca_original = "", hipoteca_garantia_abierta = evaluar de forma independiente.
```

### 1.2 Extractor dedicado de cuantía (~L1690-1818)

```diff
  properties: {
    valor_hipoteca_original: { ... },
-   valor_hipoteca_es_indeterminada: { type: "boolean", description: "true SOLO si la escritura declara expresamente 'HIPOTECA ABIERTA'..." },
+   valor_hipoteca_es_indeterminada: { type: "boolean", description: "Alias legacy — mismo valor que hipoteca_garantia_abierta." },
+   hipoteca_garantia_abierta: { type: "boolean", description: "INDEPENDIENTE del monto. true si la escritura declara ABIERTA/SIN LÍMITE. Puede ser true incluso cuando valor_hipoteca_original tiene un monto (caso VIS/Ley 546)." },
    motivo_null: { ... },
    candidatos_vistos: { ... },
  },
- required: [ "valor_hipoteca_original", "valor_hipoteca_es_indeterminada", ... ],
+ required: [ "valor_hipoteca_original", "valor_hipoteca_es_indeterminada", "hipoteca_garantia_abierta", ... ],
```

Árbol de decisión (~L1774-1789):

```diff
  a) UNA cifra "cuantia_credito"
-    → devolver monto formateado, es_indeterminada = false.
+    → valor_hipoteca_original = monto, hipoteca_garantia_abierta = detectAperturaLiteral(texto).
  b) VARIAS "cuantia_credito" mismo monto → igual que (a).
  c) VARIAS "cuantia_credito" montos distintos
     → valor_hipoteca_original = null, motivo_null = "ambigua_multiple".
+    hipoteca_garantia_abierta se evalúa igual, independiente.
  d) CERO "cuantia_credito" pero escritura declara ABIERTA
-    → valor_hipoteca_original = null, valor_hipoteca_es_indeterminada = true, motivo_null = "escritura_declara_abierta".
+    → valor_hipoteca_original = null, hipoteca_garantia_abierta = true, motivo_null = "escritura_declara_abierta". (Camino legacy intacto.)
  e) CERO "cuantia_credito" sin declaración de apertura
     → null, motivo_null = "sin_evidencia".
```

Añadir en el prompt del extractor dedicado un ejemplo VIS explícito:

```diff
+ Ejemplo 4 (Ley 546/VIS, mutuo + garantía abierta coexisten):
+   Texto: "SEGUNDA — HIPOTECA ABIERTA SIN LÍMITE EN LA CUANTÍA... PRIMERA — Cuantía del crédito: SIETE MILLONES NOVECIENTOS CINCUENTA Y OCHO MIL PESOS ($7.958.000)."
+   Salida: valor_hipoteca_original = "SIETE MILLONES ... ($7.958.000)", hipoteca_garantia_abierta = true, valor_hipoteca_es_indeterminada = true, motivo_null = null, confianza = "alta".
```

### 1.3 Lógica de reconciliación mono vs dedicada (~L1962-1980, L2498-2549)

```diff
- extracted.hipoteca_anterior.valor_hipoteca_original = dedicadaMonto;
- extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = false;
+ extracted.hipoteca_anterior.valor_hipoteca_original = dedicadaMonto;
+ extracted.hipoteca_anterior.hipoteca_garantia_abierta = dedicada.hipoteca_garantia_abierta === true;
+ extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = dedicada.hipoteca_garantia_abierta === true; // alias
```

Análogo en el bloque de regen (L2498-2549). El caso "declara abierta" (L1979) ya no vacía el monto si `dedicadaMonto` también existe:

```diff
- extracted.hipoteca_anterior.valor_hipoteca_original = "";
- extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = true;
+ if (!dedicadaMonto) extracted.hipoteca_anterior.valor_hipoteca_original = "";
+ extracted.hipoteca_anterior.hipoteca_garantia_abierta = true;
+ extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = true;
```

### 1.4 Consumidor en la cláusula pago hipoteca

`src/lib/clausulaBuilder.ts` (`buildClausulaPagoHipoteca`) y frontend en `CancelacionValidar.tsx` L923: seguir leyendo `valor_hipoteca_es_indeterminada` (alias legacy, ya poblado). Sin cambios funcionales — el helper del skill `cuantia-indeterminada-cancelacion` sigue funcionando. La única diferencia: si ahora existe un monto Y hipoteca_garantia_abierta=true, la cláusula debe imprimir el monto (comportamiento actual del helper cuando `valor_hipoteca_original` tiene valor). El invariante del skill se preserva: precedencia manual > OCR > BD.

---

## 2. Prompt del extractor de poder — refuerzos B y C

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts`

### 2.1 Cargo del RL (L41-44) — quitar "cuando aparezcan"

```diff
-  - poderdante: la entidad bancaria que OTORGA el poder + datos del RL del
-    banco que firma EN NOMBRE del banco al constituir el poder. Extrae SIEMPRE
-    representante_legal_cargo (ej: "SUPLENTE DEL PRESIDENTE") y
-    representante_legal_cedula_expedida_en cuando aparezcan.
+  - poderdante: la entidad bancaria que OTORGA el poder + datos del RL del
+    banco que firma EN NOMBRE del banco al constituir el poder.
+    OBLIGATORIO buscar activamente y devolver:
+      * representante_legal_cargo — el cargo textual con el que firma
+        (ej: "SUPLENTE DEL PRESIDENTE", "VICEPRESIDENTE JURÍDICO",
+        "GERENTE DE OPERACIONES"). NO uses "REPRESENTANTE LEGAL"
+        como fallback genérico — devuelve el cargo específico que
+        aparece antefirma o en el certificado Superfinanciera.
+      * representante_legal_cedula_expedida_en — ciudad de expedición.
+    Si tras revisar cuerpo, antefirma y certificado Superfinanciera
+    genuinamente no aparece → null con confianza "baja". No inventes.
```

### 2.2 Reforma societaria (L51-62) — refuerzo de recall

```diff
-            - sociedad_constitucion.razon_social_anterior + reforma_acta_*
-              SOLO si hubo cambio de razón social documentado.
+            - sociedad_constitucion.razon_social_anterior +
+              reforma_acta_numero + reforma_acta_fecha_texto +
+              reforma_camara_fecha_texto — SI hubo cambio de razón social
+              documentado. REGLA DE CONSISTENCIA INTERNA: si detectas
+              razon_social_anterior, DEBES buscar en el mismo certificado
+              de Cámara los 3 datos de reforma (número de acta, fecha del
+              acta, fecha de inscripción en Cámara). Aparecen típicamente
+              en el mismo párrafo o página del certificado bajo etiquetas
+              como "Por acta N° ... de fecha ... inscrita el ...". Si
+              genuinamente falta uno tras esa doble verificación, marca
+              ese subcampo específico como null (los que sí encontraste
+              deben ir poblados). NO devuelvas los 3 como null si
+              razon_social_anterior sí está — es inconsistencia interna.
```

---

## 3. Schema — condicionar `sociedad_constitucion.numero` al `tipo_documento` (Bug A)

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` L118

```diff
- numero: { type: "string", description: "Número del documento/escritura de constitución. Solo dígitos si es escritura. null si no aparece." },
+ numero: { type: "string", description: "Número de la escritura pública de constitución. SOLO rellenar cuando tipo_documento='escritura_publica' — en ese caso, solo dígitos. Si tipo_documento='documento_privado', este campo DEBE ser null: los documentos privados de constitución (actas de asamblea, minutas privadas) NO tienen un 'número' propio del instrumento. NO confundir con el número de inscripción en Cámara de Comercio (ese va en camara_comercio_numero). null si no aparece o si el tipo es documento privado." },
```

Reflejar la misma regla en el prompt (L55):

```diff
-            - sociedad_constitucion.numero
+            - sociedad_constitucion.numero (SOLO si tipo_documento='escritura_publica'; para documento_privado devolver null — el número de Cámara va en camara_comercio_numero).
```

---

## 4. Renderer defensivo — helpers compartidos en `prosaBancos/`

**Nuevo archivo:** `supabase/functions/_shared/isomorphic/prosaBancos/prosaHelpers.ts`

Motivación: los defectos A/B/C aplicables al bloque de constitución + cargo del RL se repetirán en cada banco. Extraer helpers puros reutilizables. `davivienda.ts` los consume; el próximo template los reusa gratis. `legalProse.ts` sigue siendo el módulo de formateo numérico/fecha — el nuevo módulo es el de composición notarial de sociedades.

### 4.1 API propuesta

```ts
// prosaBancos/prosaHelpers.ts (ISOMÓRFICO — solo TS puro)
import { numeroConLetras, fechaProsa } from "./legalProse.ts";
import type { ApoderadoPayload, PoderdantePayload } from "./types.ts";

export interface DescribirConstitucionOpts {
  incluirReformaSiParcial?: boolean; // default true
}

/**
 * Frase notarial de constitución de la sociedad apoderada.
 * Defensivo:
 *   - Omite el "número" si tipo_documento='documento_privado' (aun si viene poblado por error del OCR).
 *   - Menciona la reforma con lo que tenga (aunque falten 1-2 de los 3 campos de reforma), en vez de callar todo.
 *   - Devuelve "" si no hay NADA que decir (no rompe la cláusula huésped).
 */
export function describirConstitucionSociedad(
  apoderado: Pick<ApoderadoPayload, "sociedad_razon_social" | "sociedad_constitucion">,
  opts?: DescribirConstitucionOpts,
): string;

/**
 * Fragmento "obrando en su condición de <cargo> y como tal representante legal del <banco>".
 * Defensivo:
 *   - Si `cargo` está vacío → devuelve solo "obrando en su condición de representante legal del <banco>"
 *     (sin duplicar "y como tal representante legal", que quedaría redundante).
 *   - Si `cargo` coincide (case-insensitive) con "representante legal" → mismo tratamiento.
 *   - Si `cargo` es específico (ej. "suplente del presidente") → frase completa canónica.
 */
export function describirCargoRL(cargo: string | null | undefined, nombreBanco: string): string;

/** Helper interno reusable: fecha ISO o textual a prosa lowercase. */
export function fechaOTextoProsa(fecha?: string | null, fechaTexto?: string | null): string;
```

### 4.2 Semántica de `describirConstitucionSociedad`

```
Ejemplos de salida (case ancla 60c879dd, CONECTIVA GLOBAL S.A.S., documento_privado):

Input completo:
  tipo_documento='documento_privado', numero='01775236' (basura del OCR),
  fecha_texto='18 de octubre de 2013', camara_comercio_ciudad='BOGOTA',
  camara_comercio_numero='01775236', libro='IX',
  razon_social_anterior='PROYECTOS LEGALES S.A.S.',
  reforma_acta_numero=null, reforma_acta_fecha_texto=null, reforma_camara_fecha_texto=null

Output:
  "sociedad constituida mediante documento privado del 18 de octubre de 2013
  de asamblea de accionistas, inscrita en la cámara de comercio de bogota
  bajo el número 01775236 del libro IX, se constituyó inicialmente como
  PROYECTOS LEGALES S.A.S. y posteriormente cambió su razón social a
  CONECTIVA GLOBAL S.A.S."
```

Regla de degradación de reforma:
- 3 de 3 campos → frase canónica completa (como hoy).
- 1-2 de 3 campos → frase reducida "mediante acta <lo_que_hay>, cambió su razón social a <actual>".
- 0 de 3 campos + razon_social_anterior presente → "se constituyó inicialmente como <anterior> y posteriormente cambió su razón social a <actual>" (sin fechas).
- razon_social_anterior ausente → omitir todo el bloque reforma.

Regla de `numero` para documento_privado: siempre omitir, aunque venga poblado (defensa contra falla de schema).

### 4.3 `davivienda.ts` — usar los helpers

```diff
-import { numeroConLetras, fechaProsa } from "./legalProse.ts";
+import { numeroConLetras, fechaProsa } from "./legalProse.ts";
+import {
+  describirConstitucionSociedad,
+  describirCargoRL,
+} from "./prosaHelpers.ts";
...
-function descripcionConstitucionSociedad(ctx: ProsaContext): string { ... 40 líneas inline ... }
+// (extraído a prosaHelpers.ts; se conserva solo lo específico de Davivienda)
...
 function comparecenciaJuridica(ctx: ProsaContext): string {
-  const constitucion = descripcionConstitucionSociedad(ctx);
+  const constitucion = describirConstitucionSociedad(ctx.apoderado);
   ...
-  const rlBancoCargo = low(ctx.poderdante.representante_legal_cargo).toLowerCase() || "representante legal";
+  const cargoFragmento = describirCargoRL(ctx.poderdante.representante_legal_cargo, NOMBRE_BANCO);
   ...
-  const s = `... expedida en ${rlBancoCiu}, obrando en su condición de ${rlBancoCargo} y como tal representante legal del ${NOMBRE_BANCO}, mediante la escritura pública número ${escrituraPoderNum} ...`;
+  const s = `... expedida en ${rlBancoCiu}, ${cargoFragmento}, mediante la escritura pública número ${escrituraPoderNum} ...`;
```

`describirCargoRL("SUPLENTE DEL PRESIDENTE", "BANCO DAVIVIENDA S.A.")` →
  `"obrando en su condición de suplente del presidente y como tal representante legal del BANCO DAVIVIENDA S.A."`

`describirCargoRL(null, "BANCO DAVIVIENDA S.A.")` →
  `"obrando en su condición de representante legal del BANCO DAVIVIENDA S.A."` (sin duplicación).

`describirCargoRL("REPRESENTANTE LEGAL", "BANCO DAVIVIENDA S.A.")` → igual que el caso null.

---

## 5. Tests de regresión

### 5.1 `supabase/functions/procesar-cancelacion/_regression_cuantia.ts` (o `_test.ts` nuevo)

- **Test A (ancla real 60c879dd/escritura 7058):** input mock donde el extractor dedicado devuelve `valor_hipoteca_original="SIETE MILLONES ... ($7.958.000)"` y `hipoteca_garantia_abierta=true`. Assert: en `data_ia` y `data_final` post-reconciliación, ambos campos coexisten. `valor_hipoteca_es_indeterminada` alias = true. La cláusula pago (via `buildClausulaPagoHipoteca`) IMPRIME el monto (no la frase indeterminada).
- **Test B (legacy — 0 cifras + declara abierta):** input mock con `dedicadaMonto=""`, `hipoteca_garantia_abierta=true`. Assert: `valor_hipoteca_original=""`, `valor_hipoteca_es_indeterminada=true`, cláusula pago imprime frase "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA" (comportamiento actual preservado).
- **Test C (monto solo, no abierta):** `dedicadaMonto="X"`, `hipoteca_garantia_abierta=false`. Assert: `es_indeterminada=false`, monto se imprime.

### 5.2 `src/shared/prosaBancos/__contract__/prosaHelpers.test.ts` (nuevo)

- `describirConstitucionSociedad` con `tipo_documento='documento_privado'` + `numero='01775236'` → el `01775236` NO aparece en la salida (defensa Bug A).
- Reforma con solo `razon_social_anterior` → salida menciona ambas razones sociales sin fechas, no rompe.
- Reforma con 2 de 3 campos → salida menciona lo que tiene.
- Reforma con 3 de 3 → salida canónica completa (paridad con snapshot actual de Davivienda para el caso "16390 poder + CONECTIVA + reforma completa").
- `describirCargoRL(null, "BANCO X")` → NO contiene "y como tal representante legal" duplicado.
- `describirCargoRL("REPRESENTANTE LEGAL", "BANCO X")` → mismo output que null.
- `describirCargoRL("SUPLENTE DEL PRESIDENTE", "BANCO X")` → frase canónica con doble mención justificada.

### 5.3 `src/shared/prosaBancos/__contract__/parity.test.ts` (existente)

Actualizar snapshot esperado para el caso Davivienda-CONECTIVA con datos completos, comprobar que la salida sigue siendo palabra-por-palabra igual a la minuta de referencia oficial. Regenerar snapshot con los helpers en su sitio y confirmar diff vacío contra `referencia_davivienda.contract.json`.

### 5.4 `supabase/functions/_shared/__tests__/poderBancoExtractor_schema_test.ts` (nuevo, Deno)

Test estático: parsear `poderBancoTool.function.parameters` y verificar que:
- `sociedad_constitucion.numero.description` contiene "documento_privado" y "null".
- El prompt (import string) contiene "OBLIGATORIO" cerca de `representante_legal_cargo`.
- El prompt contiene la palabra "consistencia interna" cerca de `reforma_acta`.

---

## Resumen de archivos tocados

| Archivo | Cambio |
|---|---|
| `supabase/functions/procesar-cancelacion/index.ts` | Nuevo campo `hipoteca_garantia_abierta` en 2 schemas (monolítico + dedicado) + 3 prompts + reconciliación mono/dedicada + reconciliación regen. |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` | Descripción de `sociedad_constitucion.numero` condicionada a `tipo_documento`. |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts` | Refuerzo B (reforma con doble verificación) + C (cargo obligatorio, quitar "cuando aparezcan") + A (nota sobre numero vs Cámara). |
| `supabase/functions/_shared/isomorphic/prosaBancos/prosaHelpers.ts` | **NUEVO** — `describirConstitucionSociedad`, `describirCargoRL`, `fechaOTextoProsa`. Isomórfico, puro. |
| `supabase/functions/_shared/isomorphic/prosaBancos/davivienda.ts` | Consumir helpers, borrar `descripcionConstitucionSociedad` inline, ajustar plantilla `comparecenciaJuridica` para insertar `cargoFragmento` sin duplicar "representante legal". |
| `supabase/functions/procesar-cancelacion/_regression_cuantia_test.ts` | Nuevos tests A/B/C coexistencia monto + apertura. |
| `src/shared/prosaBancos/__contract__/prosaHelpers.test.ts` | **NUEVO** — cobertura helpers defensivos. |
| `src/shared/prosaBancos/__contract__/parity.test.ts` | Refresco snapshot Davivienda con helpers. |
| `supabase/functions/_shared/__tests__/poderBancoExtractor_schema_test.ts` | **NUEVO** — validación estática del schema/prompt. |

## Notas de riesgo

- El campo `valor_hipoteca_es_indeterminada` NO se elimina — se mantiene como alias legacy porque `clausulaBuilder.ts` y `CancelacionValidar.tsx` L923 lo leen. Migración transparente.
- `data_final` de trámites ya cerrados no se retroactiva; solo trámites nuevos + regen manual verán `hipoteca_garantia_abierta`.
- No se toca el helper `buildClausulaPagoHipoteca` (skill `cuantia-indeterminada-cancelacion` sigue mandando). El nuevo campo solo desbloquea que en caso VIS el monto exista, y el helper ya sabe imprimir el monto cuando está presente.
- Los helpers isomórficos NO importan nada externo — pasan el gate `purity.test.ts`.
