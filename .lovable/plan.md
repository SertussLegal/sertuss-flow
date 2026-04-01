

## Plan: Corregir alertas de cédulas faltantes — deduplicar y filtrar entidades irrelevantes

### Problemas identificados

1. **Duplicados**: `propietariosCert` extrae TODAS las personas del certificado sin deduplicar por número de cédula. Si "GIL LUCUARA CAROLINA (52483193)" aparece 3 veces en el certificado, se lista 3 veces como faltante.

2. **Entidades irrelevantes**: Bancos (BANCOLOMBIA) y constructoras aparecen como "propietarios" en el certificado porque tienen anotaciones (hipotecas, gravámenes). No son vendedores — son acreedores hipotecarios. No se les debe pedir cédula.

### Cambios en `src/components/tramites/DocumentUploadStep.tsx`

**1. Deduplicar `propietariosCert` por número de cédula normalizado**

En el `useMemo` de `propietariosCert` (línea 143-149):
- Usar un `Map` por cédula normalizada para eliminar duplicados
- Mantener solo la primera ocurrencia de cada número

**2. Filtrar entidades que no son personas naturales vendedoras**

Detectar entidades jurídicas (S.A., S.A.S., LTDA, bancos conocidos) y excluirlas de la lista de "cédulas faltantes". 

Lógica:
- Si el nombre contiene patrones como `S.A.`, `S.A.S`, `LTDA`, `BANCO`, `BANCOLOMBIA`, `FIDUCIARIA` → es persona jurídica / entidad financiera
- Estas se excluyen de `missing_cedula` alerts
- Si por algún motivo un banco SÍ aparece como vendedor (cesión de derechos), se muestra con nota explicativa: "Entidad financiera — puede ser vendedor en caso de cesión de cartera o dación en pago"

**3. Resultado esperado**

La lista de "Cédulas faltantes" solo mostrará personas naturales únicas que realmente son propietarios y necesitan cédula. Ejemplo:
- GIL LUCUARA CAROLINA (CC 52483193) — 1 vez
- LUCUARA CARRILO MARIA LILA (CC 36149251) — 1 vez
- ALFONSO GIL LUIS (CC 4889839) — 1 vez

Sin bancos, sin constructoras, sin duplicados.

### Archivo a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocumentUploadStep.tsx` | Deduplicar propietariosCert, filtrar entidades jurídicas/financieras, agregar nota para entidades vendedoras |

Un solo archivo.

