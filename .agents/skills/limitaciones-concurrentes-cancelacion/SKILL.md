---
name: limitaciones-concurrentes-cancelacion
description: Blindaje registral para Afectación a Vivienda Familiar (Ley 258/1996) y Patrimonio de Familia Inembargable (Ley 70/1931 + Ley 495/1999) que concurren con la hipoteca a cancelar. Aplica al detectar anotaciones en el certificado de tradición y al redactar el PARÁGRAFO REGISTRAL.
type: feature
---

# Limitaciones concurrentes (Cancelaciones)

Cuando el certificado de tradición tiene anotaciones de **AFECTACIÓN A VIVIENDA FAMILIAR** o **PATRIMONIO DE FAMILIA INEMBARGABLE** constituidas en la **misma escritura pública** que la hipoteca a cancelar, el registrador puede cancelarlas por arrastre si la minuta no las preserva expresamente.

## Detección (Gemini, tool calling)

En `analisis_legal`:
- `concurre_afectacion_vivienda`: `true` SOLO si la anotación cita el mismo número/año/notaría de la hipoteca.
- `afectacion_vivienda_anotacion`: 4 dígitos SNR (`"0007"`).
- `concurre_patrimonio_familia`: idem.
- `patrimonio_familia_anotacion`: 4 dígitos SNR (`"0008"`).

Si la limitación pertenece a OTRA escritura, los flags deben ser `false` aunque la anotación exista.

## Redacción

Helper canónico: `buildClausulaLimitacionesSubsisten`. Produce 3 variantes:
1. Ambas leyes presentes.
2. Solo Ley 258 (Afectación a Vivienda Familiar).
3. Solo Ley 70 + 495 (Patrimonio de Familia Inembargable).

Cada variante declara expresamente que la limitación **SUBSISTE** por ministerio de la ley y solicita al registrador mantenerla vigente.

## Plantilla v2

Bloque insertado entre las cláusulas TERCERO y CUARTO:

```
{#limitaciones_concurrentes}PARÁGRAFO REGISTRAL.- {clausula_limitaciones_subsisten}{/limitaciones_concurrentes}
```

El bloque hereda fuente Arial 12, justificado, y solo se renderiza cuando `limitaciones_concurrentes=true`.

## Anti-ejemplos

- ❌ Listar las anotaciones sin invocar las leyes que las protegen.
- ❌ Cancelar la limitación junto con la hipoteca por omitir el parágrafo.
- ❌ Marcar `concurre_*=true` para anotaciones de otra escritura.
