---
name: direccion-completa-saneada-cancelacion
description: Construcción geográfica única del tag `{direccion_completa_saneada}` en la plantilla v2 de cancelación de hipoteca Davivienda. Decide cuándo añadir "(DIRECCION CATASTRAL)" (solo Bogotá D.C.) y la coletilla "DE LA CIUDAD Y/O MUNICIPIO DE …" según el municipio del inmueble. Aplica al mapear datos hacia la plantilla, no a la extracción IA.
type: feature
---

> Complementa (no reemplaza) al skill `sanitizar-direccion`, que regula la limpieza regex previa de la nomenclatura. Este skill define la salida final hacia la plantilla v2.


# Dirección completa saneada (Cancelaciones)

Helper canónico: `buildDireccionCompletaSaneada` en `supabase/functions/procesar-cancelacion/index.ts`.

## Contrato

Input atómico (nunca prosa):
- `nomenclaturaBase`: dirección postal corta. Ej. `"CALLE 66 C NUMERO 60-65"`. Sin sufijos catastrales, sin ciudad, sin apartamento.
- `ciudad`: nombre del municipio en MAYÚSCULAS. Ej. `"BOGOTA D.C."`, `"VILLETA"`.
- `departamento`: MAYÚSCULAS. Vacío permitido sólo en Bogotá D.C.
- `esBogota`: derivado por normalización (`/^BOGOTA(\s|,|\.|$|D)/i`).

## Reglas

1. **Bogotá D.C.** → `"{base} (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C."`.
2. **Otro municipio** → `"{base} DE LA CIUDAD Y/O MUNICIPIO DE {ciudad} DEPARTAMENTO DE {departamento}"`. Sin `(DIRECCION CATASTRAL)` (lo inyecta el registrador local sólo si lo exige).
3. Nunca duplicar la ciudad (la coletilla es responsabilidad exclusiva del helper).
4. Si `nomenclaturaBase` está vacía → `undefined` y la plantilla deja líneas en blanco.

## Plantilla v2

Único tag visible: `{direccion_completa_saneada}`. Se eliminaron `{nomenclatura_predio}`, `{direccion_inmueble}` redundantes y todos los textos hardcodeados `"(DIRECCION CATASTRAL)"` y `"DE LA CIUDAD Y/O MUNICIPIO DE"`.

## Anti-ejemplos

- ❌ Concatenar `ciudad_inmueble` por fuera del helper → duplica la ciudad.
- ❌ Añadir `(DIRECCION CATASTRAL)` para municipios distintos de Bogotá.
- ❌ Devolver la dirección con apartamento/torre (esos van en `descripcion_predio`).
