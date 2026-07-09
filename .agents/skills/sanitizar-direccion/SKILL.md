---
name: sanitizar-direccion
description: DEPRECADO — usar en su lugar `direccion-completa-saneada-cancelacion`, que absorbió este skill en 2026-07 y añade el pipeline Fase A (regex) + Fase B (sufijo notarial por municipio) y la regla GUION → símbolo "-".
type: deprecated
---

# DEPRECADO

Este skill fue absorbido por **`direccion-completa-saneada-cancelacion`** en 2026-07.

- El contrato viejo `execute({nomenclatura_predio, ciudad})` de una sola fase quedó superado por el pipeline de 2 fases documentado en el skill nuevo.
- Toda la lógica regex de limpieza del sufijo `(DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE …` vive ahora en la Fase A (`sanitizeNomenclaturaBase`) dentro de `supabase/functions/procesar-cancelacion/index.ts`.

**No uses este skill.** Redirige cualquier tarea de saneamiento de dirección al skill activo.
