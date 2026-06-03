---
name: payload-crudo-tabla-snr
description: Mapeo atómico (sin regex inverso) hacia las celdas de la tabla SNR de la minuta de cancelación. Aplica cuando hay que rellenar número de escritura, día, mes, año, notaría y ciudad en las celdas angostas.
type: feature
---

# Payload crudo → Tabla SNR

## Origen de los datos

Schema `extract_cancelacion_hipoteca` (Gemini tool calling):
- `hipoteca_anterior.numero_escritura`: solo dígitos (`"3866"`).
- `hipoteca_anterior.fecha_escritura`: `{ dia: "01", mes: "06", ano: "2011" }` — dos dígitos / cuatro dígitos.
- `hipoteca_anterior.notaria`: `{ numero: "72", ciudad: "BOGOTA D.C." }`.
- `analisis_legal.afectacion_vivienda_anotacion` y `patrimonio_familia_anotacion`: 4 dígitos SNR (`"0007"`, `"0008"`).

## Formateo

Helper `pad4(...)`:
- Aplica `String(x).replace(/\D/g,"").padStart(4, "0")`.
- `"72"` → `"0072"`, `"3866"` → `"3866"`, `7` → `"0007"`, `""` → `""` (deja undefined y se renderiza `—` en celdas SLIM).

## Precedencia en `buildDocxVars`

Orden de spreads en el `return`:

```
{
  ...defaults,                 // regex inversos sobre prosa (legacy fallback)
  ..._v2Overrides,             // valores atómicos del schema + helpers V2
  // edición manual ya vino dentro de `data.*` desde data_final
}
```

`_v2Overrides` siempre PISA los defaults derivados de regex. Si el abogado edita manualmente, la edición vive en `data.*` y el helper recalcula los overrides.

## Anti-ejemplos

- ❌ Parsear `numero_escritura` desde la prosa `"... CUATRO MIL CIENTO SESENTA Y CINCO (4165)"` cuando ya viene atómico.
- ❌ Insertar la ciudad ORIP en la celda de notaría origen.
- ❌ Padding ad-hoc por tipo de campo: usar siempre `pad4`.
