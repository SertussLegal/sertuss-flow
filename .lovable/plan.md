# Entrega 1 — Blindaje compartido del pipeline de poder bancario

Reordenada por prioridad: primero lo compartido (afecta a todo banco futuro), después el renderer específico de Davivienda que consume los helpers compartidos.

## Alcance
4 cambios de contrato/prompt + 1 refactor a helpers compartidos + suite de regresión. Todo dentro de `supabase/functions/_shared/isomorphic/` y `supabase/functions/procesar-cancelacion/`.

## 1. Schema compartido — desacoplar "garantía abierta" de "monto del crédito"

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` (y espejo en `types.ts` si existe el tipo TS).

Agregar en el sub-schema de `hipoteca_anterior`:
```ts
hipoteca_garantia_abierta: {
  type: "boolean",
  description: "true si la escritura declara HIPOTECA ABIERTA / SIN LÍMITE DE CUANTÍA / SIN LÍMITE EN LA CUANTÍA, independiente de que exista o no un monto inicial del mutuo. false si la garantía se declara por cuantía específica. Coexiste con valor_hipoteca_original."
}
```

Mantener `valor_hipoteca_original` y `valor_hipoteca_es_indeterminada` como están (backward-compat), pero re-documentar `valor_hipoteca_es_indeterminada` como "true solo si NO existe ninguna cifra del mutuo en el documento" — deja de ser espejo de `garantia_abierta`.

## 2. Prompts — ambos sitios

**Archivos:**
- `supabase/functions/procesar-cancelacion/index.ts` (bloque monolítico L361-371)
- `supabase/functions/procesar-cancelacion/index.ts` (extractor dedicado L1774-1789, caso d)

Cambios:
- `valor_hipoteca_original`: buscar y devolver la cifra del mutuo si existe, **sin importar** si el documento también declara garantía abierta. Devolver `""` (string vacío) si genuinamente no aparece — nunca el string literal `"null"`.
- `hipoteca_garantia_abierta`: derivar de forma independiente por frases ancla ("hipoteca abierta", "sin límite en la cuantía", "sin límite de cuantía").
- `valor_hipoteca_es_indeterminada`: solo `true` cuando cero cifras del mutuo (regresión legacy).

## 3. Prompt de poder — refuerzo B (reforma) y C (cargo del RL)

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts`.

- **L41-44 (cargo):** eliminar "cuando aparezcan" que contradice el "SIEMPRE". Dejar únicamente la instrucción obligatoria con el ejemplo "SUPLENTE DEL PRESIDENTE".
- **L51-62 (reforma):** promover reforma_acta_numero/fecha_texto y camara_fecha_texto a OBLIGATORIOS con el mismo tono que ORIP. Agregar verificación cruzada: **si `razon_social_anterior` se detecta, los tres campos de reforma DEBEN buscarse activamente**; devolver `null` solo tras búsqueda explícita. Ejemplo textual concreto de un párrafo de reforma.

## 4. Schema — condicionar `sociedad_constitucion.numero` al `tipo_documento`

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` L118.

Reescribir la descripción de `numero`:
> "Solo se rellena si `tipo_documento === 'escritura_publica'`. Si `tipo_documento === 'documento_privado'` DEBE ser `null` — un documento privado no tiene número. Nunca reutilizar el número de inscripción en Cámara de Comercio."

## 5. Renderer defensivo — helpers compartidos (NO Davivienda-específicos)

**Archivo nuevo:** `supabase/functions/_shared/isomorphic/prosaBancos/prosaHelpers.ts` (o extender `legalProse.ts` si prefieren un solo módulo).

Exportar funciones puras:
- `describirConstitucionSociedad(soc)` — omite bloque de `numero` cuando `tipo_documento==='documento_privado'` incluso si viene poblado por error. Degrada con gracia si faltan campos.
- `describirReformaSocietaria(soc)` — imprime lo que tenga (1, 2 o 3 campos de reforma) sin frase colgada; devuelve `""` si no hay ni razón social anterior ni ningún campo de reforma.
- `describirCargoRL(rl)` — si `representante_legal_cargo` está presente imprime `"${cargo} y como tal representante legal"`; si vacío imprime solo `"representante legal"` (sin duplicar).

**Archivo:** `supabase/functions/_shared/isomorphic/prosaBancos/davivienda.ts` consume los tres helpers. Los bloques inline actuales (L46-64, L74-83, L100-109) se sustituyen por llamadas a los helpers.

## 6. Tests de regresión

**Vitest — `src/**/__tests__/` o `supabase/functions/_shared/isomorphic/__tests__/`:**
- `prosaHelpers.test.ts`:
  - `describirConstitucionSociedad`: documento_privado con `numero` poblado por error → omitido.
  - `describirReformaSocietaria`: 1/3, 2/3, 3/3 campos → prosa coherente; 0/3 + sin razón social anterior → cadena vacía.
  - `describirCargoRL`: cargo presente → doble mención correcta; cargo vacío → sola mención.
- `davivienda.test.ts` (extender): consume helpers y no rompe casos existentes.

**Deno — `supabase/functions/procesar-cancelacion/__tests__/`:**
- Caso ancla `60c879dd`: fixture con hipoteca $7.958.000 + "sin límite en la cuantía" → `valor_hipoteca_original="7958000"` **y** `hipoteca_garantia_abierta=true` coexistiendo.
- Caso legacy: fixture con cero cifras + "hipoteca abierta" → `valor_hipoteca_original=""`, `valor_hipoteca_es_indeterminada=true`, `hipoteca_garantia_abierta=true` (regresión).
- Caso cifras + sin declaración de apertura → `garantia_abierta=false`.

## Detalles técnicos

- **No se toca** el guard de generación docx ni `stripNullyStrings` (ya bien blindados).
- **Backward-compat:** trámites cerrados con `valor_hipoteca_es_indeterminada=true` y sin el nuevo campo → helpers de prosa deben tolerar `hipoteca_garantia_abierta===undefined` como equivalente al valor legacy.
- **Orden de merge:** primero (1)+(3)+(4) que son el contrato compartido, luego (2) que reescribe prompts, después (5) renderer y (6) tests. Un solo PR, sin flags nuevos.
- **No hay migración de BD** — todos los campos viven en `data_final` JSON.

## Fuera de alcance (Entrega 2+)
- Reintroducción de `notariaSuggestions` con extractor determinista.
- Prosa para bancos distintos a Davivienda (se activará cuando se decida cuál sigue, ya con los helpers listos).
- Renombrar `valor_hipoteca_es_indeterminada` (dejar deprecado por ahora para no romper histórico).
