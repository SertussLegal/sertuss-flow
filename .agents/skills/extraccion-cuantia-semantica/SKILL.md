---
name: extraccion-cuantia-semantica
description: Reglas type-safe para extraer la "cuantía" o "valor del crédito hipotecario" desde escrituras notariales colombianas con IA, evitando confundir con precio de venta, avalúo o subrogación. Aplica a cancelaciones, hipotecas nuevas, compraventas con hipoteca y subrogaciones.
type: feature
---

# Extracción semántica de cuantías hipotecarias (type-safe)

Este skill regula CÓMO el extractor IA debe localizar e inyectar la cifra de un crédito hipotecario o cualquier "cuantía" notarial en un campo de monto, para evitar rechazos de calificación registral por cifras erróneas.

Se aplica al tool/function-call de extracción de cualquier sección (Cancelaciones, Escrituras de Compraventa con Hipoteca, Hipoteca nueva, Subrogación) que tenga un campo numérico de monto del crédito.

## 1. Anclaje sintáctico (obligatorio)

La cifra DEBE estar gobernada gramaticalmente por un **verbo rector del gravamen** sobre el mismo inmueble:

- `constituye`, `grava`, `hipoteca`, `garantiza`, `otorga garantía hipotecaria`
- `presta`, `concede`, `desembolsa`, `entrega`

La **proximidad física** a la palabra "hipoteca" NO es suficiente — necesitas la relación sintáctica verbo→monto.

## 2. Lista negra de conceptos (ignora el monto, NO el párrafo)

Descarta cualquier cifra cuyo sujeto sintáctico sea:

- `precio de venta`, `valor de la compraventa`
- `avalúo catastral`, `avalúo comercial`
- `liberación de gravamen`, `subrogación`
- `abono`, `saldo pendiente`
- `subsidio`, `cesantías`

Si el párrafo trae estos conceptos como referencia descriptiva **y** además una cifra anclada al mutuo, extrae solo la del mutuo. No descartes el párrafo entero.

## 3. Jerarquía de búsqueda (en orden)

1. **MUTUO** — el banco "presta / otorga / concede / desembolsa / entrega" una suma al deudor como crédito.
2. **PAGO** — cláusula de compraventa: "el saldo del precio se cubre con el producto del crédito que le concede [BANCO] por valor de …".
3. **LIQUIDACIÓN** — casilla anexa "CUANTÍA DEL MUTUO", "VALOR DEL CRÉDITO", "MONTO DEL PRÉSTAMO".

### Fallback de cuerpo

Si la carátula / hoja de calificación no aparece, recorre las cláusulas del cuerpo buscando:
`CUANTÍA`, `GARANTÍA HIPOTECARIA`, `MUTUO HIPOTECARIO`, `VALOR DEL CRÉDITO` — siempre ancladas al mismo crédito.

## 4. Contrato de variables (type-safe — CRÍTICO)

Para cada acto, el schema debe exponer DOS campos:

| Campo | Tipo | Contenido |
|---|---|---|
| `valor_X_original` (o nombre equivalente) | string | SOLO monto formateado `"<LETRAS> DE PESOS ($<NÚMEROS>)"` o cadena vacía `""`. **NUNCA literales descriptivos.** |
| `valor_X_es_indeterminada` | boolean | `true` si el acto es de cuantía abierta / indeterminada; `false` en cualquier otro caso. |

### Reglas de salida

- **Monto válido anclado al verbo rector** → `valor_X_original = "<LETRAS> DE PESOS ($<NÚMEROS>)"`, flag = `false`.
- **Acto ABIERTO / SIN LÍMITE DE CUANTÍA / INDETERMINADO** → `valor_X_original = ""`, flag = `true`. El formateador del Word usa el flag para renderizar el texto legal (`HIPOTECA DE CUANTÍA INDETERMINADA` u otro literal). NUNCA inyectar literales en el campo de monto.
- **Empate ambiguo** (dos cifras candidatas sin desambiguar) → `valor_X_original = ""`, flag = `false`. Degrada limpiamente a líneas en blanco (`___________`) para que el notario complete a mano.
- **No hay evidencia** → idem empate (`""`, `false`).

## 5. Backend — defensa en profundidad

En el `buildDocxVars` (o equivalente) del backend, aplicar una red de seguridad determinista:

```ts
const valorRaw = (data.valor_X_original || "").trim();
const esIndetIA = data.valor_X_es_indeterminada === true;
// Tolerancia retro: versiones viejas pueden haber inyectado el literal en el campo de monto.
const esIndetLegacy = /HIPOTECA\s+DE\s+CUANT[IÍ]A\s+INDETERMINADA/i.test(valorRaw);
const esIndeterminada = esIndetIA || esIndetLegacy;

const valorMonto: string | undefined = esIndeterminada ? undefined : (valorRaw || undefined);
// Mapear a la plantilla:
//   valor_X_original: valorMonto                       // limpio
//   valor_X_es_indeterminada: esIndeterminada || undefined  // consumido por condicional Docxtemplater
```

La plantilla puede usar un condicional Docxtemplater:

```
{#valor_X_es_indeterminada}HIPOTECA DE CUANTÍA INDETERMINADA{/}
{^valor_X_es_indeterminada}{valor_X_original}{/}
```

## 6. Precedencia de fuentes (regla universal del proyecto)

`Edición Manual > Extracción OCR/IA > Base de Datos`. Si el usuario edita el monto en UI, esa edición debe sobrevivir a re-runs de la IA. Implementar merge selectivo campo-a-campo (NUNCA shallow merge: `source ?? ia` borra campos que la IA sí extrajo cuando `source` es parcial).

## 7. Reutilización

Este contrato es **agnóstico al tipo de acto**. Aplícalo a:

- Cancelaciones de hipoteca (Davivienda y otras).
- Constitución de hipoteca (acto nuevo).
- Escrituras de compraventa con hipoteca simultánea.
- Subrogaciones de crédito.

Cualquier nuevo flujo notarial que requiera capturar un monto crediticio debe seguir el mismo schema de dos campos (`monto` + `_es_indeterminada`) y la misma jerarquía semántica.
