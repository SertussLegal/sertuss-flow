---
name: sanitizar-direccion
description: Limpieza y normalización del sufijo "(DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE …" en la nomenclatura urbana del inmueble, antes de inyectarla en la plantilla docx. Aplica a cancelaciones y escrituras notariales colombianas para evitar duplicados del sufijo cuando el OCR ya lo trae.
type: feature
---

# Saneamiento de nomenclatura urbana (`buildDocxVars`)

Garantiza que la variable `{nomenclatura_predio}` del docx final contenga **un único** sufijo `(DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE <CIUDAD>`, sin importar si el OCR ya lo trajo, lo trajo parcial o no lo trajo.

## Trigger
`buildDocxVars` (preparación final de variables docx), justo antes de pasar el objeto a Docxtemplater.

## Inputs

- `nomenclatura_predio: string` — dirección base extraída/editada.
- `ciudad: string` — municipio del inmueble.

## Output

- `nomenclatura_final: string` — dirección saneada con sufijo único, en MAYÚSCULAS.

## Reglas críticas de regex

1. **Escape de paréntesis:** los paréntesis del sufijo son opcionales y DEBEN ir escapados como `\(?` / `\)?`. Un regex tipo `?DIRECCION CATASTRAL?` es sintácticamente inválido y/o destruye el cuantificador.
2. **`Y/O` con slash escapado:** `Y\/?O` (la barra opcional). `YO` literal NO matchea `Y/O` real.
3. **Insensible a tildes:** usar `DIRECCI[OÓ]N` (con y sin tilde) y flag `i`.
4. **Greedy del cierre de ciudad:** el segundo regex consume `… DE LA CIUDAD Y/O MUNICIPIO DE <CUALQUIER COSA HASTA FIN DE LÍNEA>` para evitar dejar residuos de ciudad vieja antes de re-inyectar la actual.
5. **Colapso de espacios:** siempre cerrar con `replace(/\s+/g, " ").trim()`.
6. **MAYÚSCULAS al final:** el sufijo notarial va completo en mayúsculas.

## Implementación canónica

```ts
export function execute(input: { nomenclatura_predio: string; ciudad: string }) {
  let nomenclaturaBase = (input.nomenclatura_predio ?? "").trim();
  const ciudadInmueble = (input.ciudad || "").trim();

  nomenclaturaBase = nomenclaturaBase
    // 1) Remover cualquier variación de "(DIRECCION CATASTRAL)" con o sin paréntesis y con/sin tilde
    .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    // 2) Remover redundancia de ciudad que el OCR pegó al final
    .replace(/\s+DE\s+LA\s+CIUDAD\s+Y\/?O\s+MUNICIPIO\s+DE\s+.+$/i, "")
    // 3) Colapsar espacios
    .replace(/\s+/g, " ")
    .trim();

  // 4) Inyectar el sufijo estructurado UNA sola vez
  const nomenclaturaFinal = nomenclaturaBase
    ? `${nomenclaturaBase} (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE ${ciudadInmueble}`.toUpperCase().trim()
    : "";

  return { nomenclatura_final: nomenclaturaFinal };
}
```

## Tests mínimos esperados

| Input `nomenclatura_predio` | `ciudad` | Output esperado |
|---|---|---|
| `CALLE 66 C NUMERO 60-65` | `BOGOTA D.C.` | `CALLE 66 C NUMERO 60-65 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C.` |
| `CALLE 66 C NUMERO 60-65 (DIRECCION CATASTRAL)` | `BOGOTA D.C.` | igual al anterior (sin duplicar) |
| `CALLE 66 C NUMERO 60-65 DIRECCIÓN CATASTRAL DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA` | `BOGOTA D.C.` | igual al anterior |
| `CALLE 66 C NUMERO 60-65 DIRECCION CATASTRAL DE LA CIUDAD YO MUNICIPIO DE BOGOTA` | `BOGOTA D.C.` | igual al anterior (acepta `YO` sin slash) |
| `""` | `BOGOTA D.C.` | `""` (no inventa sufijo sin dirección) |

## Anti-ejemplos

- ❌ `replace(/?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*?/gi, "")` — paréntesis sin escapar = regex inválido.
- ❌ `replace(/\s+DE\s+LA\s+CIUDAD\s+YO\s+MUNICIPIO\s+DE\s+.+$/i, "")` — no matchea `Y/O` real.
- ❌ Inyectar el sufijo desde el prompt de Gemini (debe quedar como responsabilidad ÚNICA del backend en `buildDocxVars`).
- ❌ Aplicar este saneo cuando la ciudad esté vacía (devolver `""` sin sufijo).
