---
name: convertir-numero-a-letras
description: Conversión de números a formato notarial colombiano "LETRAS (NÚMERO)" para escrituras, fechas, notarías, años y montos. Aplica al hidratar variables docx con concordancia de género.
type: feature
---

# Conversión número → letras (formato notarial colombiano)

**Este skill es el contrato de uso. La implementación canónica vive en código** — no reimplementar las tablas de unidades/decenas/centenas en cada skill o edge function.

## Fuentes de verdad — NO reimplementar

| Capa | Archivo | Helpers |
|---|---|---|
| Frontend (puro) | `src/lib/legalProse.ts` | `numeroConLetras`, `fechaProsa`, `escrituraProsa`, `montoProsa` |
| Backend (Deno espejo) | `supabase/functions/process-expediente/legalProse.ts` | mismos exports |
| Motor base | `src/lib/legalFormatters.ts` | `numberToWords`, `formatMonedaLegal` |

Ver el skill complementario `formato-texto-numero-notarial` para reglas completas, anti-ejemplos y tests.

## Uso por tipo de campo

| Tipo de campo | Helper | Salida |
|---|---|---|
| Número de escritura | `numeroConLetras(2924, "masculine")` | `"dos mil novecientos veinticuatro (2924)"` |
| Número de notaría | `numeroConLetras(5, "feminine")` | `"quinta (5)"` (ordinal femenino para 1..10) |
| Día | `numeroConLetras(27, "masculine")` | `"veintisiete (27)"` |
| Año | `numeroConLetras(2026, "masculine")` | `"dos mil veintiséis (2026)"` |
| Fecha completa | `fechaProsa("2026-05-27")` | `"veintisiete (27) de mayo de dos mil veintiséis (2026)"` |
| Monto | `montoProsa(30000000)` | `"TREINTA MILLONES DE PESOS ($30.000.000)"` |
| Bloque escritura | `escrituraProsa({numero, fecha, notariaNumero, circulo})` | bloque hilado completo |

## Regla de oro

- **Femenino para notarías:** `Notaría primera (1)`, no `Notaría primero (1)`. Ordinales 1..10; morfología para >10.
- **Idempotencia:** los helpers detectan si el input ya está formateado `"... (NNN)"` y no doble-envuelven.
- **Inputs inválidos** (`<=0`, NaN, string sin dígitos) → devuelven `""`. El invocador decide si renderiza líneas en blanco.

## Anti-ejemplos

- ❌ Tabla hardcodeada con solo 3 números (`if (num === 32) ... else if (num === 13) ...`). Usar siempre `numberToWords` de `legalFormatters.ts`.
- ❌ Forzar mayúsculas globales (`.toUpperCase()`) — los textos de día/mes/notaría van en minúscula notarial; solo el monto va en MAYÚSCULAS.
- ❌ Reimplementar `numberToWords` en una nueva edge function.
- ❌ Devolver `"32 (32)"` cuando no se reconoce un número — debe ser `"treinta y dos (32)"` o `""` si falla.
