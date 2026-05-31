---
name: formato-texto-numero-notarial
description: Estándar notarial colombiano de formato "TEXTO (NÚMERO)" — números, fechas, montos y escrituras en prosa legal con concordancia de género. Aplica al generar minutas, cláusulas y antefirmas para cualquier acto notarial (cancelación, compraventa, hipoteca, poder, sucesión).
type: feature
---

# Formato notarial colombiano `TEXTO (NÚMERO)`

Toda cifra, fecha o monto en una minuta notarial colombiana debe llevar el número en letras seguido del dígito entre paréntesis, con concordancia de género cuando aplique. Este skill define el contrato único de helpers.

## 1. Fuentes de verdad — NO reimplementar

| Capa | Archivo | Helpers exportados |
|---|---|---|
| Frontend (puro, testeable) | `src/lib/legalProse.ts` | `numeroConLetras`, `fechaProsa`, `escrituraProsa`, `montoProsa` |
| Backend (Deno, espejo) | `supabase/functions/process-expediente/legalProse.ts` | mismos helpers |
| Base sintáctica | `src/lib/legalFormatters.ts` | `numberToWords`, `formatMonedaLegal` |

Las dos primeras filas son **espejos sincronizados**. Cualquier cambio en uno debe replicarse en el otro inmediatamente (y reflejarse en `src/lib/legalProse.test.ts`).

## 2. Reglas de formato

### Números

`numeroConLetras(n, gender)` → `"doscientos veintidós (222)"`.

- `gender = "masculine"` (default): "uno", "veintiuno", "treinta y un".
- `gender = "feminine"`: para 1..10 usa ordinales (`"primera (1)"`, `"segunda (2)"`, ...`"décima (10)"`); para >10 morfología (`"veintiuna (21)"`).
- **Idempotencia:** si el input ya viene como `"... (NNN)"`, se devuelve intacto. Nunca doble-envolver.

### Fechas

`fechaProsa("2026-05-27")` → `"veintisiete (27) de mayo de dos mil veintiséis (2026)"`.

Acepta `YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`. Día y año van en letras + paréntesis; el mes va solo en letras (sin paréntesis).

### Escritura pública

`escrituraProsa({ numero, fecha, notariaNumero, circulo, tipo })` → `"Escritura Pública número dos mil novecientos veinticuatro (2924) de fecha veintisiete (27) de mayo de dos mil veintiséis (2026) otorgada en la Notaría quinta (5) del Círculo de Bogotá"`.

- Notaría va en **femenino** (`"primera"`, `"quinta"`, `"décima"`).
- Devuelve `null` si falta `numero` o `fecha` → el invocador decide colapsar/blank.

### Montos

`montoProsa(30000000)` → `"TREINTA MILLONES DE PESOS M/CTE ($30.000.000)"`.

- **Mantiene SIEMPRE el sufijo `M/CTE`** (Moneda Corriente — requisito de los registradores de instrumentos públicos en Colombia, NO removerlo).
- Elimina únicamente el `,00` cuando los decimales son cero.
- Idempotente: si ya viene formateado `"... ($NNN)"`, se devuelve intacto.
- Para cuantías indeterminadas usar el patrón de la skill `extraccion-cuantia-semantica` (flag booleano + condicional Docxtemplater), NUNCA inyectar literales en el campo de monto.

## 3. Uso en una nueva edge function

```ts
import { numeroConLetras, fechaProsa, escrituraProsa, montoProsa } from "./legalProse.ts";

const docxVars = {
  fecha_otorgamiento: fechaProsa(data.fecha),
  numero_protocolo: numeroConLetras(data.numero, "masculine"),     // Escrituras
  notaria_numero_prosa: numeroConLetras(data.notaria.numero, "feminine"),
  escritura_titulo: escrituraProsa(data.escritura) ?? "",
  valor_hipoteca_protocolo: montoProsa(data.valor),
};
```

## 4. Anti-ejemplos

- ❌ `"27 de mayo de 2026"` en una minuta (sin letras + paréntesis).
- ❌ `"$30.000.000,00"` o `"TREINTA MILLONES DE PESOS ($30.000.000)"` (falta `M/CTE` — los registradores lo rechazan).
- ❌ `"quinto (5)"` para notaría (debe ser **femenino**: `"quinta (5)"`).
- ❌ Reimplementar `numberToWords` en una nueva edge function.
- ❌ Concatenar `numeroConLetras(x) + " (" + x + ")"` (ya viene con paréntesis — produce doble envoltura).

## 5. Tests

`src/lib/legalProse.test.ts` contiene los casos canónicos. Cualquier cambio en los helpers debe ir acompañado de un test que pruebe la regla nueva (no solo el happy path).

## 6. Reutilización por acto

Patrón unificado para todos los tipos: Cancelación, Compraventa, Hipoteca, Poder, Sucesión, Divorcio. Si surge un caso nuevo (ej. porcentajes, coeficientes, plazos en años), agregar el helper a `legalProse.ts` con su test, replicar en el espejo backend y documentar aquí.
