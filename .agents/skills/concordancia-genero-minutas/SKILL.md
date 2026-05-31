---
name: concordancia-genero-minutas
description: Reglas de concordancia gramatical de género (M/F/Jurídica) para minutas notariales colombianas. Aplica al inyectar tokens como art_deudor, tit_deudor, id_deudor, art_apoderado, art_banco en plantillas docx. Usar siempre que se genere prosa notarial con personas naturales o jurídicas.
type: feature
---

# Concordancia de género en minutas notariales

Este skill define el contrato único de tokens gramaticales que toda Edge Function de generación docx (procesar-cancelacion, futuras procesar-compraventa, procesar-hipoteca, etc.) debe respetar para evitar errores como "el deudora" o "la señor".

## 1. Fuentes de verdad — NO reimplementar

| Capa | Archivo | Exporta |
|---|---|---|
| Backend (Deno) | `supabase/functions/_shared/genero.ts` | `deudorTokens`, `apoderadoTokens`, `bancoTokens`, `inferGeneroFromNombre` |
| Frontend (React) | `src/lib/genero.ts` | `inferGeneroFromNombre`, `GeneroGramatical` |

**Regla:** cualquier nueva edge function de generación docx DEBE importar `_shared/genero.ts`. Prohibido duplicar las flexiones M/F/FALLBACK en otro lugar.

## 2. Contrato de tipos

```ts
type GeneroGramatical = "M" | "F" | "JURIDICA" | "";
type TratamientoEntidad = "M" | "F" | "";  // banco: "establecimiento bancario" vs "entidad"
```

`""` (cadena vacía) significa **incertidumbre explícita** → el motor inyecta el FALLBACK combinado notarial (`el(la) señor(a)`, `identificado(a)`). Nunca asumir un género por defecto.

## 3. Tokens estándar por rol

| Rol | Tokens disponibles | Fuente del género |
|---|---|---|
| Deudor (persona natural) | `art_deudor`, `tit_deudor`, `id_deudor` | UI: `SegmentedChoice` M/F + inferencia desde primer nombre |
| Apoderado (persona natural) | `art_apoderado`, `tit_apoderado`, `id_apoderado` | UI: `SegmentedChoice` M/F |
| Banco (persona jurídica) | `art_banco`, `id_banco` | UI: `SegmentedChoice` "La entidad" (F) / "El establecimiento bancario" (M) |

## 4. Flujo obligatorio en una nueva edge function

```ts
import { deudorTokens, apoderadoTokens, bancoTokens, inferGeneroFromNombre } from "../_shared/genero.ts";

const generoDeudor = data.deudor.genero || inferGeneroFromNombre(data.deudor.nombre);
const tratamientoBanco = data.banco.tratamiento || "";  // sin inferencia: decisión humana

const docxVars = {
  ...deudorTokens(generoDeudor),
  ...apoderadoTokens(data.apoderado?.genero),
  ...bancoTokens(tratamientoBanco),
  // ... resto de variables
};
```

## 5. Plantilla docx — uso de tokens

```
Compareció {art_deudor} {nombre_deudor}, {id_deudor} con cédula ...
En representación de {art_banco}, comparece {art_apoderado} {nombre_apoderado} ...
```

NUNCA hardcodear "el señor" o "la señora" en una plantilla — usar siempre el token.

## 6. UI — selección manual

Para campos de género en pantallas de validación, usar el componente `SegmentedChoice` (ver skill `componente-segmented-choice`). El valor `""` debe quedar permitido para forzar fallback notarial seguro cuando hay duda.

## 7. Anti-ejemplos

- ❌ `"el(la) señor(a)"` hardcodeado en la plantilla.
- ❌ Inferir género del banco a partir del NIT o el nombre (siempre es decisión humana).
- ❌ Llamar `inferGeneroFromNombre` y sobrescribir una selección manual ya guardada.
- ❌ Copiar las listas `NOMBRES_F` / `NOMBRES_M` en una nueva edge function.

## 8. Extensión

Cuando se agregue un nuevo rol (vendedor, comprador, cónyuge, fiador), añadir su factory `<rol>Tokens(g)` en `_shared/genero.ts` siguiendo el mismo patrón (`M` / `F` / `FALLBACK` notarial), y exponer el campo de género en la UI con `SegmentedChoice`.
