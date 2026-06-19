---
name: direccion-completa-saneada-cancelacion
description: Construcción geográfica única del tag `{direccion_completa_saneada}` en plantillas de cancelación de hipoteca (Davivienda y otros). Incluye el sub-paso de limpieza regex de la nomenclatura urbana (antes `sanitizar-direccion`) y la decisión de sufijos "(DIRECCION CATASTRAL)" y "DE LA CIUDAD Y/O MUNICIPIO DE …". Aplica en `buildDocxVars` / `buildDireccionCompletaSaneada`, nunca en el prompt de Gemini.
type: feature
---

# Dirección completa saneada (Cancelaciones) — pipeline unificado

Pipeline de 2 fases que vive en `supabase/functions/procesar-cancelacion/index.ts`:

1. **Fase A — Saneamiento regex** (`sanitizeNomenclaturaBase`): limpia residuos catastrales y ciudad duplicada que el OCR pudo dejar.
2. **Fase B — Construcción final** (`buildDireccionCompletaSaneada`): inyecta el sufijo notarial UNA sola vez según municipio.

Único tag visible en la plantilla v2: `{direccion_completa_saneada}`. Se eliminaron `{nomenclatura_predio}`, `{direccion_inmueble}` y todo literal hardcodeado de `"(DIRECCION CATASTRAL)"` / `"DE LA CIUDAD Y/O MUNICIPIO DE"`.

---

## Fase A — Saneamiento regex (sub-paso interno)

Objetivo: garantizar que `nomenclaturaBase` llegue a la Fase B sin ningún rastro previo del sufijo notarial.

### Reglas críticas de regex

1. **Escape de paréntesis:** opcionales como `\(?` / `\)?`. Un regex tipo `?DIRECCION CATASTRAL?` es sintácticamente inválido.
2. **`Y/O` con slash escapado:** `Y\/?O` (la barra opcional). `YO` literal NO matchea `Y/O` real.
3. **Insensible a tildes:** `DIRECCI[OÓ]N` con flag `i`.
4. **Greedy del cierre de ciudad:** consume `… DE LA CIUDAD Y/O MUNICIPIO DE <CUALQUIER COSA HASTA FIN DE LÍNEA>` para evitar residuos de ciudad vieja.
5. **Colapso de espacios:** cerrar con `replace(/\s+/g, " ").trim()`.

### Implementación canónica

```ts
function sanitizeNomenclaturaBase(input: string): string {
  return (input ?? "")
    .trim()
    // 1) Remover cualquier variación de "(DIRECCION CATASTRAL)" con/sin paréntesis y con/sin tilde
    .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    // 2) Remover redundancia de ciudad pegada por OCR
    .replace(/\s+DE\s+LA\s+CIUDAD\s+Y\/?O\s+MUNICIPIO\s+DE\s+.+$/i, "")
    // 3) Colapsar espacios
    .replace(/\s+/g, " ")
    .trim();
}
```

---

## Fase B — Construcción final

### Contrato

Input atómico (nunca prosa):
- `nomenclaturaBase`: dirección postal corta YA saneada por Fase A. Ej. `"CALLE 66 C NUMERO 60-65"`. Sin sufijos, sin ciudad, sin apartamento.
- `ciudad`: nombre del municipio en MAYÚSCULAS. Ej. `"BOGOTA D.C."`, `"VILLETA"`.
- `departamento`: MAYÚSCULAS. Vacío permitido sólo en Bogotá D.C.
- `esBogota`: derivado por normalización (`/^BOGOTA(\s|,|\.|$|D)/i`).

### Reglas

1. **Bogotá D.C.** → `"{base} (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C."`.
2. **Otro municipio** → `"{base} DE LA CIUDAD Y/O MUNICIPIO DE {ciudad} DEPARTAMENTO DE {departamento}"`. Sin `(DIRECCION CATASTRAL)` (lo inyecta el registrador local sólo si lo exige).
3. Nunca duplicar la ciudad (la coletilla es responsabilidad exclusiva del helper).
4. Si `nomenclaturaBase` está vacía → `undefined` y la plantilla deja líneas en blanco. NO inventar sufijo sin dirección.
5. Sufijo notarial siempre en MAYÚSCULAS.

---

## Tests mínimos esperados (cubren A + B)

| Input crudo | `ciudad` | Output esperado |
|---|---|---|
| `CALLE 66 C NUMERO 60-65` | `BOGOTA D.C.` | `CALLE 66 C NUMERO 60-65 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C.` |
| `CALLE 66 C NUMERO 60-65 (DIRECCION CATASTRAL)` | `BOGOTA D.C.` | igual (sin duplicar) |
| `CALLE 66 C NUMERO 60-65 DIRECCIÓN CATASTRAL DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA` | `BOGOTA D.C.` | igual |
| `CALLE 66 C NUMERO 60-65 DIRECCION CATASTRAL DE LA CIUDAD YO MUNICIPIO DE BOGOTA` | `BOGOTA D.C.` | igual (acepta `YO` sin slash) |
| `CALLE 10 # 5-20` | `VILLETA` (dpto `CUNDINAMARCA`) | `CALLE 10 # 5-20 DE LA CIUDAD Y/O MUNICIPIO DE VILLETA DEPARTAMENTO DE CUNDINAMARCA` |
| `""` | `BOGOTA D.C.` | `undefined` |

---

## Anti-ejemplos

- ❌ Llamar a la Fase B sin pasar antes por Fase A (residuos OCR duplican el sufijo).
- ❌ Concatenar `ciudad_inmueble` por fuera del helper → duplica la ciudad.
- ❌ Añadir `(DIRECCION CATASTRAL)` para municipios distintos de Bogotá.
- ❌ Devolver la dirección con apartamento/torre (esos van en `descripcion_predio`).
- ❌ Inyectar el sufijo desde el prompt de Gemini (responsabilidad ÚNICA del backend en `buildDocxVars`).
- ❌ `replace(/?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*?/gi, "")` — paréntesis sin escapar = regex inválido.
- ❌ `replace(/\s+DE\s+LA\s+CIUDAD\s+YO\s+MUNICIPIO\s+DE\s+.+$/i, "")` — no matchea `Y/O` real.
