# Entrega 1 — Blindaje compartido del pipeline de poder bancario

Reordenada por prioridad: primero lo compartido (afecta a todo banco futuro), después el renderer específico de Davivienda que consume los helpers compartidos.

## Alcance
4 cambios de contrato/prompt + 1 refactor a helpers compartidos + suite de regresión. Todo dentro de `supabase/functions/_shared/isomorphic/` y `supabase/functions/procesar-cancelacion/`. Sin migración de BD, sin flags nuevos.

---

## 1. Schema compartido — desacoplar "garantía abierta" de "monto del crédito"

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` (sub-schema de `hipoteca_anterior`) + espejo en `types.ts` si existe el tipo TS.

**Diff propuesto (schema JSON):**
```diff
 hipoteca_anterior: {
   type: "object",
   properties: {
     ...
     valor_hipoteca_original: { type: ["string","null"], description: "Monto inicial del mutuo en formato TEXTO (NÚMERO) con M/CTE. \"\" (string vacío) si no aparece; NUNCA el literal \"null\"." },
-    valor_hipoteca_es_indeterminada: { type: "boolean", description: "true si la hipoteca es abierta/sin cuantía." }
+    valor_hipoteca_es_indeterminada: { type: "boolean", description: "DEPRECATED (legacy). true SOLO cuando NO existe ninguna cifra del mutuo en el documento. Ya no es espejo de garantía abierta." },
+    hipoteca_garantia_abierta: { type: "boolean", description: "true si la escritura declara literal HIPOTECA ABIERTA / SIN LÍMITE EN LA CUANTÍA / SIN LÍMITE DE CUANTÍA / DE CUANTÍA INDETERMINADA, INDEPENDIENTE de que exista o no un monto inicial del mutuo. false si la garantía se declara por cuantía específica. Coexiste con valor_hipoteca_original." }
   },
-  required: [..., "valor_hipoteca_es_indeterminada"]
+  required: [..., "valor_hipoteca_es_indeterminada", "hipoteca_garantia_abierta"]
 }
```

En `types.ts` (si existe el tipo `HipotecaAnterior`):
```diff
 export interface HipotecaAnterior {
   valor_hipoteca_original: string | null;
   valor_hipoteca_es_indeterminada: boolean;
+  hipoteca_garantia_abierta?: boolean;
 }
```

---

## 2. Prompts — ambos sitios en `procesar-cancelacion/index.ts`

**Archivo:** `supabase/functions/procesar-cancelacion/index.ts`.

### 2a. Bloque monolítico (~L361-371)
```diff
 - 'valor_hipoteca_original': monto inicial del mutuo en formato TEXTO (NÚMERO)…
-  · Si la escritura declara "HIPOTECA ABIERTA" o "SIN LÍMITE DE CUANTÍA", devolver "" y marcar valor_hipoteca_es_indeterminada=true.
+  · Devolver la cifra del mutuo si aparece anclada al préstamo, INDEPENDIENTEMENTE de que la garantía también se declare abierta.
+  · Si genuinamente no aparece ninguna cifra, devolver "" (string vacío). NUNCA el literal "null".
+- 'hipoteca_garantia_abierta': true si aparecen las frases "HIPOTECA ABIERTA", "SIN LÍMITE EN LA CUANTÍA", "SIN LÍMITE DE CUANTÍA", "CUANTÍA INDETERMINADA". Se evalúa por separado de valor_hipoteca_original; ambos campos pueden ser verdaderos simultáneamente (caso VIS/Ley 546).
- 'valor_hipoteca_es_indeterminada': true SOLO cuando NO exista ninguna cifra del mutuo en el documento.
```

### 2b. Extractor dedicado, caso d) (~L1774-1789)
```diff
 case d) La escritura declara garantía abierta:
-  → devolver valor_hipoteca_original="", valor_hipoteca_es_indeterminada=true
+  → derivar hipoteca_garantia_abierta=true SIEMPRE que aparezcan las frases ancla.
+  → SI ADEMÁS existe una cifra del mutuo (casos a/b), devolver ambas: valor_hipoteca_original=<cifra> y hipoteca_garantia_abierta=true.
+  → SI cero cifras: valor_hipoteca_original="", valor_hipoteca_es_indeterminada=true, hipoteca_garantia_abierta=true (regresión legacy).
+  → NUNCA devolver el literal "null" en valor_hipoteca_original. Usar "" cuando no exista.
```

---

## 3. Prompt de poder — refuerzo B (reforma) y C (cargo del RL)

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts`.

### 3a. Cargo del RL (~L41-44)
```diff
-- representante_legal_cargo: cuando aparezcan, extraer el cargo textual (ej. "SUPLENTE DEL PRESIDENTE").
+- representante_legal_cargo: OBLIGATORIO. Extraer SIEMPRE el cargo textual completo tal como figura en el certificado ("SUPLENTE DEL PRESIDENTE", "GERENTE", "PRESIDENTE"…). Solo devolver null tras verificar explícitamente que el certificado no lo menciona.
-- representante_legal_cedula_expedida_en: cuando aparezca…
+- representante_legal_cedula_expedida_en: OBLIGATORIO. Ciudad de expedición de la cédula del RL.
```

### 3b. Reforma societaria (~L51-62)
```diff
-- razon_social_anterior, reforma_acta_numero, reforma_acta_fecha_texto, reforma_camara_fecha_texto: cuando aparezcan.
+- razon_social_anterior: OBLIGATORIO buscar. Si el certificado menciona un cambio de nombre/denominación anterior de la sociedad, extraer el nombre previo.
+- reforma_acta_numero, reforma_acta_fecha_texto, reforma_camara_fecha_texto: OBLIGATORIOS. Si razon_social_anterior se detecta, los TRES campos de reforma DEBEN buscarse activamente en el mismo párrafo/anexo. Solo devolver null tras búsqueda explícita.
+  Ejemplo textual real de párrafo de reforma:
+    "Por Acta No. 12 del 15 de marzo de 2023 de la Asamblea de Accionistas, inscrita en esta Cámara de Comercio el 3 de abril de 2023 bajo el número 01823456 del Libro IX, la sociedad cambió su razón social de PROYECTOS LEGALES S.A.S. a LEGAL BUILDERS S.A.S."
+    → razon_social_anterior="PROYECTOS LEGALES S.A.S.", reforma_acta_numero="12", reforma_acta_fecha_texto="15 de marzo de 2023", reforma_camara_fecha_texto="3 de abril de 2023".
```

---

## 4. Schema — condicionar `sociedad_constitucion.numero` al `tipo_documento`

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` (~L118).

```diff
 sociedad_constitucion: {
   type: "object",
   properties: {
     tipo_documento: { type: "string", enum: ["escritura_publica", "documento_privado"] },
-    numero: { type: ["string","null"], description: "Solo dígitos si es escritura. null si no aparece." }
+    numero: { type: ["string","null"], description: "Número del documento constitutivo. Rellenar SOLO si tipo_documento==='escritura_publica' (dígitos de la escritura). Si tipo_documento==='documento_privado' DEBE ser null — los documentos privados no tienen número. NUNCA reutilizar el número de inscripción de Cámara de Comercio (ese va en camara_comercio_numero)." }
   }
 }
```

---

## 5. Renderer defensivo — helpers compartidos en `legalProse.ts`

Extender `supabase/functions/_shared/isomorphic/prosaBancos/legalProse.ts` (módulo existente compartido) exportando tres funciones puras:

```ts
// Bug A — omite bloque "identificada con documento privado número X" si tipo_documento==='documento_privado'
export function describirConstitucionSociedad(soc: SociedadConstitucion | undefined): string {
  if (!soc) return "";
  const esEscritura = soc.tipo_documento === "escritura_publica";
  const partes: string[] = [];
  if (esEscritura && soc.numero) partes.push(`escritura pública número ${numeroConLetras(soc.numero)}`);
  if (esEscritura && soc.fecha_texto) partes.push(`del ${soc.fecha_texto}`);
  if (esEscritura && soc.notaria) partes.push(`otorgada en la ${soc.notaria}`);
  if (!esEscritura) partes.push("mediante documento privado");
  if (soc.fecha_texto && !esEscritura) partes.push(`del ${soc.fecha_texto}`);
  return partes.filter(Boolean).join(" ").trim();
}

// Bug B — imprime lo que exista de la reforma sin frase colgada
export function describirReformaSocietaria(soc: SociedadConstitucion | undefined): string {
  if (!soc) return "";
  const tieneAlgo = soc.razon_social_anterior || soc.reforma_acta_numero || soc.reforma_acta_fecha_texto || soc.reforma_camara_fecha_texto;
  if (!tieneAlgo) return "";
  const frases: string[] = [];
  if (soc.razon_social_anterior) frases.push(`antes denominada ${soc.razon_social_anterior}`);
  if (soc.reforma_acta_numero) frases.push(`Acta No. ${soc.reforma_acta_numero}`);
  if (soc.reforma_acta_fecha_texto) frases.push(`del ${soc.reforma_acta_fecha_texto}`);
  if (soc.reforma_camara_fecha_texto) frases.push(`inscrita en Cámara de Comercio el ${soc.reforma_camara_fecha_texto}`);
  return frases.join(", ");
}

// Bug C — evita duplicar "representante legal" si cargo está vacío
export function describirCargoRL(rl: RepresentanteLegal | undefined): string {
  const cargo = (rl?.representante_legal_cargo ?? "").trim();
  return cargo ? `${cargo.toLowerCase()} y como tal representante legal` : "representante legal";
}
```

**Archivo:** `supabase/functions/_shared/isomorphic/prosaBancos/davivienda.ts` — los bloques inline actuales (~L46-64 constitución, L74-83 reforma, L100-109 cargo) se sustituyen por llamadas a los tres helpers. Cero lógica nueva Davivienda-específica.

---

## 6. Tests de regresión

### 6a. Vitest — `src/**/__tests__/` (o dentro de `_shared/isomorphic/__tests__/`)
- **`legalProse.test.ts`** (nuevo o extendido):
  - `describirConstitucionSociedad`: `tipo_documento='documento_privado'` con `numero='01775236'` poblado por error → salida omite el número.
  - `describirReformaSocietaria`: 3 casos (1/3, 2/3, 3/3 campos) → prosa coherente sin comas colgadas; caso 0/3 sin `razon_social_anterior` → cadena vacía.
  - `describirCargoRL`: cargo `"SUPLENTE DEL PRESIDENTE"` → `"suplente del presidente y como tal representante legal"`; cargo vacío → `"representante legal"` (sin duplicar).
- **`davivienda.test.ts`** (extender): fixture antes/después consume helpers, casos existentes siguen pasando.

### 6b. Deno — `supabase/functions/procesar-cancelacion/__tests__/`
- **Caso ancla `60c879dd`:** fixture con hipoteca $7.958.000 + "sin límite en la cuantía" → `valor_hipoteca_original` con la cifra en formato notarial **y** `hipoteca_garantia_abierta=true` coexistiendo.
- **Caso legacy:** fixture con cero cifras + "hipoteca abierta" → `valor_hipoteca_original=""`, `valor_hipoteca_es_indeterminada=true`, `hipoteca_garantia_abierta=true` (regresión intacta).
- **Caso cifras + sin declaración de apertura:** → `hipoteca_garantia_abierta=false`, `valor_hipoteca_es_indeterminada=false`.
- **Anti-regresión anti-`"null"`:** ningún camino devuelve el string literal `"null"` — solo `""` o valor real.

---

## Detalles técnicos

- **No se toca** el guard de generación docx ni `stripNullyStrings` (ya bien blindados por el bus de 5 capas del poder bancario).
- **Backward-compat:** trámites cerrados sin el nuevo campo → los helpers tratan `hipoteca_garantia_abierta===undefined` como equivalente a `valor_hipoteca_es_indeterminada` (comportamiento legacy).
- **Orden de merge en un solo PR:** (1)+(3)+(4) contrato compartido → (2) prompts → (5) helpers + Davivienda → (6) tests. Ambas suites deben quedar verdes (Deno + Vitest).
- **Sin migración de BD** — todo vive en `data_final` JSON.

## Fuera de alcance (Entrega 2+)
- Reintroducción de `notariaSuggestions` con extractor determinista.
- Renderer de prosa para bancos distintos a Davivienda (activable cuando se defina el siguiente, ya con los helpers listos).
- Renombrar o retirar `valor_hipoteca_es_indeterminada` — se deja deprecado para no romper histórico.
