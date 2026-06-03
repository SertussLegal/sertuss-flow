---
name: cuantia-indeterminada-cancelacion
description: Manejo de hipotecas abiertas / de cuantía indeterminada en cancelaciones Davivienda. Aplica al construir la cláusula de pago, la prosa de la cláusula tercera y la sección inversa de la plantilla v2.
type: feature
---

# Cuantía indeterminada (Cancelaciones)

Helper canónico: `buildClausulaPagoHipoteca` y la sección `{^valor_hipoteca_es_indeterminada}` de la plantilla v2.

## Precedencia

1. **Edición manual** (`data_final.hipoteca_anterior.valor_hipoteca_es_indeterminada` y `valor_hipoteca_original`) **siempre prevalece** sobre lo que extrajo la IA.
2. La IA sólo marca `valor_hipoteca_es_indeterminada=true` cuando el documento declara expresamente HIPOTECA ABIERTA / SIN LÍMITE DE CUANTÍA. Ambigüedad ⇒ `false` y `valor_hipoteca_original=""` (mejor línea en blanco que cuantía falsa).
3. Al recalcular tras override manual, **todas** las salidas se rederivan en `buildDocxVars` antes de mapear a la plantilla:
   - `clausula_pago_hipoteca`
   - `valor_hipoteca_letras_o_indeterminado`
   - sección inversa `($ {valor_hipoteca_numeros})` se suprime sola.

## Reglas de salida

- Indeterminada: prosa habla de "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA", no aparece `$`, no aparece `___`.
- Determinada: prosa incluye el monto formateado en MAYÚSCULAS con doble expresión `"LETRAS DE PESOS ($NÚMEROS)"`.
- Vacío sin marca de indeterminada: cláusula de fallback que remite a la escritura sin afirmar el monto.

## Anti-ejemplos

- ❌ Renderizar `($___)` para hipotecas indeterminadas (era el bug original que cubría el blindaje v2).
- ❌ Forzar `valor_hipoteca_es_indeterminada=true` cuando hay reliquidación con saldo fijo: el override manual debe respetarse.
