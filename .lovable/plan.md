
# Diagnóstico — `template_venta_hipoteca.docx` (raíz vs `public/`)

## 1. Archivos comparados

| Ubicación | Tamaño | Modify (fs) |
|---|---|---|
| `template_venta_hipoteca.docx` (raíz) | 251.880 B | 2026-07-06 11:39 (checkout) |
| `public/template_venta_hipoteca.docx` | 252.360 B | 2026-07-06 11:39 (checkout) |

Las fechas de filesystem son iguales (timestamp de checkout del sandbox), no aportan señal. El historial de git no es consultable desde esta sesión (git está bloqueado por harness), así que la datación es por **contenido**, no por commits.

## 2. Comparación de partes internas del `.docx`

Ambos ZIP tienen la misma estructura. Hash MD5 por parte:

| Parte | Resultado |
|---|---|
| `word/styles.xml` | **SAME** |
| `word/header1.xml` | **SAME** |
| `word/header2.xml` | **SAME** |
| `word/numbering.xml` | **SAME** |
| `word/settings.xml` | **SAME** |
| `word/document.xml` | **DIFF** (320.497 vs 320.744 bytes) |

**Formato, estilos, fuentes, márgenes, encabezados: idénticos.** La única diferencia real está en el cuerpo del documento (`document.xml`).

## 3. Comparación de tags `{...}` de Docxtemplater

- Root: 101 tags únicos
- Public: 109 tags únicos

**Tags que existen SOLO en `public/` (la versión en producción):**

```
{notaria_circulo}
{notaria_circulo_proper}
{notaria_departamento}
{notaria_numero}
{notaria_numero_letras}
{notaria_numero_letras_femenino}
{notaria_numero_letras_lower}
{notaria_ordinal}
{notario_tipo}
```

**Tags que existen SOLO en la raíz:**

```
{# }
```

`{# }` es ruido: un `{#tiene_hipoteca}` partido por un run boundary de Word en la versión antigua. No es un tag real.

## 4. Comparación del texto legal/notarial

La versión de la raíz tiene datos **hardcodeados** para la Notaría 5 de Bogotá:

- Encabezado: `"OTORGADA ANTE EL NOTARIO QUINTO (5o) DEL CÍRCULO DE BOGOTÁ, D.C."` (literal)
- Entidad acreedora: `"BANCO DE BOGOTA S.A. NIT: 860.002.964-4"` (literal)
- Comparecencia: `"En la ciudad de Bogotá Distrito Capital, Departamento de Cundinamarca..."` (literal)
- Constancia: `"El Notario quinto (5o) del Círculo de Bogotá, D.C., de conformidad con..."` (literal)
- Pie: `"OTORGADA EN LA NOTARÍA QUINTA (5) DEL CÍRCULO DE BOGOTÁ, D.C."` (literal)

La versión de `public/` reemplazó **todos** esos literales por tags de Docxtemplater multi-tenant:

- `NOTARIO {notaria_numero_letras} ({notaria_ordinal}) DEL CÍRCULO DE {notaria_circulo}`
- `{actos.entidad_bancaria} NIT: {actos.entidad_nit}`
- `En la ciudad de {notaria_circulo_proper}, Departamento de {notaria_departamento}`
- `El Notario {notaria_numero_letras_lower} ({notaria_ordinal}) del Círculo de {notaria_circulo_proper}`

El resto del articulado (cláusulas primera–última, constancias notariales 1–4, SARLAFT, biométrica, REDAM, comprobantes fiscales) es **idéntico palabra por palabra**. No hay una sola cláusula legal diferente. No hay redacción distinta. Solo cambia el reemplazo de literales por variables.

## 5. Cuál es más reciente

La versión de `public/` es inequívocamente **posterior**: encaja con el pilar de arquitectura del proyecto declarado en project-knowledge ("Multi-tenant estricto") y en `mem://tech/arquitectura-multi-tenant` ("Terminología agnóstica para generación de docx"). La versión de la raíz corresponde a una etapa anterior mono-notaría (Notaría 5 de Bogotá) que fue superada cuando se introdujo el directorio de notarías y el enriquecimiento de bancos.

## 6. ¿Cambio sustancial o cosmético?

Es **sustancial en cuanto a arquitectura**, pero **cero riesgo funcional** para lo que hoy hay en `public/`:

- No hay cláusula legal, párrafo, constancia ni bloque en la raíz que **no exista** en `public/`. La versión de `public/` es un superconjunto estricto en términos de contenido semántico: mismo texto + variables donde antes había literales.
- Todos los tags de la raíz también están en `public/`, excepto el ruido `{# }`.
- Los 9 tags adicionales de `public/` (`notaria_*`, `notario_tipo`) son parte del pipeline vivo hoy — usarlos es lo que permite operar con cualquier notaría, no solo la 5 de Bogotá.
- Ninguna referencia en código apunta a la de la raíz: producción lee `public/template_venta_hipoteca.docx` vía fetch (confirmado en el audit previo en `Validacion.tsx` y `DocxPreview.tsx`).

## 7. Recomendación

**Es seguro eliminar `template_venta_hipoteca.docx` de la raíz del proyecto.**

- No aporta ningún contenido legal que no esté ya (mejor formulado) en `public/`.
- Mantenerla es riesgo: si alguien la referencia por error, generaría escrituras hardcodeadas a la Notaría 5 de Bogotá y Banco de Bogotá para clientes que no son ninguno de los dos.
- El código de producción ya la ignora.

Sugerencia de siguiente paso (con tu confirmación explícita, en build mode): borrar solo `template_venta_hipoteca.docx` de la raíz, correr tests para confirmar verde, y dejar `public/template_venta_hipoteca.docx` intacta.
