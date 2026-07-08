# Auditoría — 9 cancelaciones duplicadas matrícula 50C-2025538

**Nota previa importante:** la organización dueña de las 9 cancelaciones NO es `9610aa6c…` (Alejandra Arciniegas) como decía el brief, sino **`614a4a8d-1d5b-4c84-be92-d09152fd2e21`**. Las 9 fueron creadas por un solo usuario (`created_by = 875e66dc-9841-4ad8-8367-17be8c84cd19`). Vale la pena que el PO confirme de qué notaría es esta org antes de tomar acción.

## Tabla de las 9 filas

| # | id (8) | created_at (UTC) | status | rmr | apoderado_nombre (data_ia) | apoderado_cedula (data_ia) | minuta | cert |
|---|---|---|---|---|---|---|---|---|
| 1 | 290fd66a | 2026-07-06 00:20 | completed | **false** | FELIX REUZE CAÑAS | 19.345.545 | sí | sí |
| 2 | 2bef1db3 | 2026-07-07 16:48 | requiere_revision_manual | true | FELIX DE JESUS CAGUA | 79.123.456 | sí | sí |
| 3 | 0443d2f1 | 2026-07-07 21:09 | completed | true (retroactivo) | *null* | *null* | sí | sí |
| 4 | 32f5317e | 2026-07-07 21:55 | completed | **false** | *null* | *null* | sí | sí |
| 5 | 15582708 | 2026-07-07 23:02 | requiere_revision_manual | true | ANA MARIA MONTOYA ECHEVERRY | 79.123.456 | sí | sí |
| 6 | 9a78aebb | 2026-07-07 23:32 | requiere_revision_manual | true | ANA MARIA MONTOYA ECHEVERRY | 521639-4 | sí | sí |
| 7 | 2fb6ba16 | 2026-07-08 00:47 | requiere_revision_manual | true | ANA MARIA MONTOYA ECHEVERRY | 41525143 | sí | sí |
| 8 | c506d69b | 2026-07-08 01:40 | requiere_revision_manual | true | ANA MARIA MONTOYA ECHEVERRY | 41944755 | sí | sí |
| 9 | 2b8ea638 | 2026-07-08 13:47 | requiere_revision_manual | true | ANA MARIA MONTOYA ECHEVERRY | NO_LEGIBLE | sí | sí |

`data_final` coincide con `data_ia` en las 9 (el usuario no editó manualmente el apoderado en ninguna). Todas con `poder_adjuntado=true` y `escritura_antecedente_adjunta=true`.

## Respuestas puntuales

1. **¿Cuántas completadas vs a medias?** Las 9 se generaron end-to-end (minuta + certificado presentes). **4 con `status='completed'`** (290fd66a, 0443d2f1, 32f5317e, y el resto 5 quedaron en `requiere_revision_manual`). Ninguna quedó a medias por error — todas produjeron docx.

2. **Consistencia del apoderado en 9 corridas sobre el MISMO PDF de poder:**
   - **7 identidades distintas** de apoderado desde el mismo input:
     - FELIX REUZE CAÑAS / 19.345.545
     - FELIX DE JESUS CAGUA / 79.123.456
     - *null* / *null* (×2)
     - ANA MARIA MONTOYA ECHEVERRY con **5 cédulas diferentes**: `79.123.456`, `521639-4`, `41525143`, `41944755`, `NO_LEGIBLE`
   - Confirmación fortísima del patrón de **alucinación no determinista**: mismo PDF, resultados incompatibles entre sí, incluso cambiando el género (Félix vs Ana María). La cédula `79.123.456` es un placeholder típico de dataset de prueba de Gemini (secuencia trivial), y `41525143`/`41944755` no tienen dígito de verificación coherente entre corridas.

3. **Diferencias entre las 9 más allá de la fecha:** mismo `created_by`, misma org, misma matrícula, mismo deudor, mismo poder subido. La única variable observable es la ventana temporal (2 días) y el resultado de la extracción. `notaria_style_id` no existe en la tabla `cancelaciones` (los estilos viven a otro nivel), así que no aplica. No hay marca de versión del extractor por fila para comparar.

4. **`revision_manual_requerida`:** 6 de las 9 ya están en `true` (5 por status `requiere_revision_manual` en vivo + `0443d2f1` marcada retroactivamente en la limpieza de hoy). Tres quedaron completed sin marcar retroactivamente: `290fd66a`, `32f5317e` (con `data_ia` en null → probablemente parche manual o pipeline muy temprano) y las que no cayeron dentro del criterio del gate. Del batch confirmado con imagen corrupta 12192 B ya sabíamos que `0443d2f1` era una de las 3 que marcamos retroactivamente hoy.

5. **Hipótesis:** el usuario **reprocesó manualmente ~9 veces creando una cancelación NUEVA cada vez**, no reprocesando la existente. Muy probablemente porque al ver que el nombre/cédula del apoderado quedaba mal (o vacío), asumió que "volver a intentar" implicaba crear un caso nuevo. Cada intento produjo una identidad de apoderado incompatible con las demás — comportamiento clásico de alucinación no determinista sobre input ilegible (los JPGs de 12192 B / baja resolución ya identificados). Coincide en tiempo con el momento en que aún no existía ni el gate de calidad ni el aumento de resolución que implementamos hoy.

## Decisiones pendientes del Product Owner (nada se toca hasta que las confirme)

- **A.** ¿Consolidar las 9 en 1 sola cancelación válida + archivar las 8 restantes? ¿O marcar las 8 como `duplicada_de → id_final` y dejar rastro?
- **B.** ¿Marcar retroactivamente las 3 sin `rmr=true` (290fd66a, 32f5317e y cualquier otra completed sin flag) para forzar revisión humana antes de que sus docx se usen en la notaría?
- **C.** ¿Necesitamos un gate de UX que detecte "misma matrícula + mismo deudor + misma org en <7 días" y avise "¿estás seguro que no querías reprocesar la existente?" antes de dejar crear otra?

Si el PO aprueba alguna, la implementación es acotada (SELECT/UPDATE en las filas listadas + eventualmente un check en `CancelacionNueva.tsx`). Nada se ejecuta hasta que responda.
