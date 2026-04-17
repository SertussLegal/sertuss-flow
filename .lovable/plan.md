

## Plan: Detección genérica de personas jurídicas (sin nombres hardcodeados)

### Enfoque

Reemplazar el filtro por nombre con **3 criterios genéricos acumulativos** en `DocumentUploadStep.tsx`. Una persona es jurídica (y se excluye de la alerta) si cumple **cualquiera**:

**Criterio 1 — Tipo de identificación explícito**
Si el campo `tipo_id` / `tipo_identificacion` del propietario es `NIT` (no `CC`, `CE`, `TI`, `PA`), es jurídica.

**Criterio 2 — Sufijos societarios genéricos**
Regex limpia con SOLO sufijos legales (no nombres comerciales):
```ts
const LEGAL_SUFFIX = /\b(S\.?A\.?S?\.?|LTDA\.?|E\.?S\.?P\.?|E\.?I\.?C\.?E\.?|S\.?C\.?A\.?|S\.?\s*EN\s*C\.?|&\s*C[IÍ]A|Y\s+C[IÍ]A|S\.?A\.?\s*ESP|EU|SAS|S\s+A\s+S|CORP|INC|GMBH|N\.?V\.?)\b/i;
```

**Criterio 3 — Formato de número NIT**
Heurística: número de identificación con **9-10 dígitos** que **empieza por 8 o 9** (rango asignado a personas jurídicas en Colombia por la DIAN). Ejemplo: `8600073361` → empieza con `8`, 10 dígitos → NIT. Cédulas de personas naturales colombianas no empiezan por 8 o 9 con 10 dígitos (excepción extranjeros con CE — pero CE no se confunde con CC en el flujo).

```ts
const NIT_NUMBER_PATTERN = /^[89]\d{8,9}$/;
```

### Lógica combinada

```ts
function isPersonaJuridica(prop: { nombre?: string; tipo_id?: string; numero_id?: string }): boolean {
  // 1. Tipo explícito
  if (prop.tipo_id?.toUpperCase().trim() === 'NIT') return true;
  // 2. Sufijo societario en el nombre
  if (prop.nombre && LEGAL_SUFFIX.test(prop.nombre)) return true;
  // 3. Formato del número
  const num = (prop.numero_id || '').replace(/\D/g, '');
  if (NIT_NUMBER_PATTERN.test(num)) return true;
  return false;
}
```

Aplicar en el filtro existente (línea ~190) reemplazando la regex `ENTITY_PATTERNS`. COLSUBSIDIO con `8600073361` se excluye por **Criterio 3** (empieza con 8, 10 dígitos) sin necesitar su nombre. BANCOLOMBIA S.A. se excluye por **Criterio 2** (sufijo `S.A.`). Cualquier propietario con `tipo_id: "NIT"` se excluye por **Criterio 1**.

### Mejora de copy de la alerta (líneas ~759-770)

Reemplazar "Cédulas faltantes" por mensaje no bloqueante:

> **Personas naturales identificadas en el certificado sin cédula cargada:**
> [lista]
> 
> Si alguna es vendedor, sube su cédula. Si son acreedores u otros terceros, puedes continuar — esos datos se completarán en la notaría.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocumentUploadStep.tsx` | Eliminar `ENTITY_PATTERNS` con nombres → reemplazar por helper `isPersonaJuridica()` con los 3 criterios genéricos. Reescribir copy de alerta. |

### Verificación

- COLSUBSIDIO (NIT 8600073361) → excluida por criterio 3
- BANCOLOMBIA S.A. → excluida por criterio 2
- Cualquier `tipo_id: NIT` → excluida por criterio 1
- Persona natural con CC `1020304050` (empieza con 1) → SÍ aparece en alerta (correcto)

### Riesgos

Mínimos. Los tres criterios son ortogonales y conservadores. Falso positivo posible: una cédula muy antigua que empiece con 8 o 9 — extremadamente raro en Colombia (rango DIAN reservado a jurídicas desde décadas).

