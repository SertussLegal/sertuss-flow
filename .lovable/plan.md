

## Plan: Conectar datos de antecedentes (OCR) y notaría a la previsualización para coherencia total

### Diagnóstico

Los datos del certificado de tradición (notaría de origen, escritura, fecha) se extraen correctamente por el OCR y se guardan en `tramites.metadata.extracted_documento`, pero **nunca se leen en `Validacion.tsx`** ni se pasan a `DocxPreview`. Por eso los 14 placeholders de `antecedentes.*` siempre muestran `___________`.

Además, no hay validación cruzada entre la notaría del certificado y la notaría configurada del sistema.

```text
Flujo actual (roto):
  scan-document → metadata.extracted_documento ✅
  Validacion.tsx → loadTramite → IGNORA extracted_documento ❌
  DocxPreview → antecedentes.* = "___________" siempre ❌

Flujo corregido:
  scan-document → metadata.extracted_documento ✅
  Validacion.tsx → loadTramite → lee extracted_documento → pasa a DocxPreview ✅
  DocxPreview → antecedentes.notaria = "Notaría 21" ✅
  DocxPreview → banner si notaría difiere de config ✅
```

### Cambios

**1. `src/pages/Validacion.tsx` — Leer `extracted_documento` de metadata**

En `loadTramite`, después de cargar `notariaConfig`, leer `meta.extracted_documento` y guardarlo en un nuevo estado `extractedDocumento`. Pasarlo como prop a `DocxPreview`.

**2. `src/components/tramites/DocxPreview.tsx` — Mapear antecedentes con datos reales**

- Agregar prop `extractedDocumento?: { notaria_origen?: string; numero_escritura?: string; fecha_documento?: string }`
- En `buildReplacements`, reemplazar los 14 `antecedentes.*` hardcoded con datos reales:
  - `antecedentes.notaria` → `extractedDocumento.notaria_origen`
  - `antecedentes.escritura` → `extractedDocumento.numero_escritura`
  - `antecedentes.fecha` → `extractedDocumento.fecha_documento`
  - Derivar campos como `antecedentes.escritura_num_numero`, `antecedentes.escritura_dia_letras`, etc. parseando la fecha y número

**3. Banner de coherencia — Validación cruzada**

En `DocxPreview`, si `extractedDocumento.notaria_origen` existe y difiere de `notariaConfig.nombre_notaria`, mostrar un banner informativo amarillo (no bloqueante) arriba del documento:
> "El certificado de tradición menciona **Notaría 21**, pero tu notaría configurada es **Notaría 5**. Esto es normal si el inmueble fue previamente escriturado en otra notaría."

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/Validacion.tsx` | Leer `meta.extracted_documento`, crear estado, pasarlo como prop a `DocxPreview` |
| `src/components/tramites/DocxPreview.tsx` | Recibir `extractedDocumento` en props, mapear antecedentes.*, agregar banner de coherencia |

2 archivos modificados.

