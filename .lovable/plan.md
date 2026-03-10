

## Plan: NUPRE/CHIP desde Certificado + Áreas Construida y Privada

### Cambios

#### 1. Migration — Agregar columnas `area_construida` y `area_privada` a `inmuebles`
```sql
ALTER TABLE public.inmuebles ADD COLUMN area_construida text DEFAULT '';
ALTER TABLE public.inmuebles ADD COLUMN area_privada text DEFAULT '';
```

#### 2. Edge Function `scan-document/index.ts` — Actualizar schema y prompt

En `toolsByCertificado`, cambiar `area` por tres campos:
- `nupre` — "Código NUPRE del inmueble si aparece (ej: AAA0216ZOWF)"
- `area_construida` — "Área construida en m², si aparece"
- `area_privada` — "Área privada en m², si aparece"

Actualizar `systemPrompts.certificado_tradicion` para instruir al modelo a:
- Extraer el NUPRE si aparece (suele comenzar con AAA)
- Diferenciar área construida (CONST) y área privada (PRIV)
- Dejar en blanco si alguna de las dos no aparece en el documento

#### 3. `src/lib/types.ts` — Agregar campos al tipo `Inmueble`

Agregar `area_construida: string` y `area_privada: string` al interface y a `createEmptyInmueble()`.

#### 4. `src/components/tramites/InmuebleForm.tsx` — OCR mapping + UI

- En el handler de `certificado_tradicion`: si `d.nupre` existe y comienza con "AAA", asignarlo a `identificador_predial` y cambiar `tipo_identificador_predial` a `"chip"`.
- Mapear `d.area_construida` y `d.area_privada` a los nuevos campos.
- Reemplazar el campo único "Área (m²)" por dos campos: "Área Construida (m²)" y "Área Privada (m²)".

#### 5. `src/pages/Validacion.tsx` — Actualizar mappings y serialización

- Agregar `area_construida` y `area_privada` a `FIELD_TO_INMUEBLE` y a `inmuebleToRow()`.

### Archivos

| Archivo | Cambio |
|---------|--------|
| Migration SQL | `area_construida`, `area_privada` en `inmuebles` |
| `supabase/functions/scan-document/index.ts` | Schema: nupre, area_construida, area_privada; prompt actualizado |
| `src/lib/types.ts` | Agregar area_construida, area_privada |
| `src/components/tramites/InmuebleForm.tsx` | NUPRE→CHIP mapping, dos campos de área |
| `src/pages/Validacion.tsx` | FIELD_TO_INMUEBLE, inmuebleToRow |

