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
    // 3) Red de seguridad: separador de placa SIEMPRE como símbolo "-", nunca palabra "GUION"
    .replace(/\s+GUION(?:ES)?\s+/gi, " - ")
    // 4) Colapsar espacios
    .replace(/\s+/g, " ")
    .trim();
}
```

### Separador de placa: símbolo `-`, nunca la palabra `GUION`

Regla notarial colombiana: en la parte ALFABÉTICA de la nomenclatura urbana, el separador entre el primer y el segundo número de placa va como el SÍMBOLO `-` (guion ASCII rodeado de espacios), NO como la palabra `GUION`. La verbalización rompe la lectura natural del registrador.

- **Prompt + schema de Gemini** (`procesar-cancelacion` y `scan-document/core/certificadoTradicion`) ya instruyen explícitamente: `NÚMERO X - Y`, prohibido escribir `GUION`.
- **Red de seguridad determinista** en `buildDocxVars`: la regex `\s+GUION(?:ES)?\s+ → " - "` se aplica DESPUÉS de los strips de catastral/ciudad y ANTES del colapso de espacios. Cubre regresiones del LLM.
- **Excepciones explícitas — NO tocar:**
  - `matricula_inmobiliaria` (ej. `50C-2085432`): el guion ASCII es parte del contrato técnico ORIP.
  - `banco_nit` (ej. `860.034.313-7`): el guion del dígito de verificación DIAN es obligatorio.
  - El contenido dentro del paréntesis técnico `(98B No. 61A-54 S)`: el `-` ahí es estructural, no se verbaliza ni se altera.
  - La regex sólo matchea `GUION` como palabra suelta entre espacios, así que no afecta nombres propios.

#### Tabla de validación (Fase A)

| Input crudo | Output esperado |
|---|---|
| `CARRERA NOVENTA Y OCHO B NÚMERO SESENTA Y UN A GUION CINCUENTA Y CUATRO SUR (98B No. 61A-54 S)` | `CARRERA NOVENTA Y OCHO B NÚMERO SESENTA Y UN A - CINCUENTA Y CUATRO SUR (98B No. 61A-54 S)` |
| `CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84)` | `CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO (59 SUR No. 60-84)` |
| `CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B - VEINTIUNO (62A No. 53B-21)` | igual (ya viene correcto, idempotente) |

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
- ❌ Verbalizar el separador de placa como `GUION` en la parte alfabética (`"NÚMERO SESENTA GUION OCHENTA Y CUATRO"`) — debe ser el símbolo `-`. Aplica la regex `\s+GUION(?:ES)?\s+ → " - "` como red de seguridad.
- ❌ Aplicar la regex anti-`GUION` a `matricula_inmobiliaria` o `banco_nit` — el guion ASCII ahí es contrato técnico ORIP/DIAN y NO se altera.

---

## Historial

- **2026-07:** este skill absorbió a `sanitizar-direccion`. El contrato viejo `execute({nomenclatura_predio, ciudad})` de una sola fase está superado por el pipeline Fase A + Fase B descrito arriba. Cualquier referencia externa a `sanitizar-direccion` debe apuntar aquí.

