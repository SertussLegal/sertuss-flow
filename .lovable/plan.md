
# Compilación granular — 19 puntos de retroalimentación de Alejandra Arciniegas

Solo lectura. Recuperado del historial (mensajes #213 – #2114). Los 3 puntos ya verificados con evidencia real en sesiones previas quedan marcados **[VERIFICADO]**; el resto queda **[PENDIENTE]** de auditoría independiente. Los 7 puntos derivados de la auditoría de la minuta real de mayo (A4 – A10) van marcados con `†`.

---

## Bloque A — Cancelaciones (14 puntos)

**A1 — Formulario Vendedor/Comprador confunde "dirección" con "domicilio"** *(2026-03-09)*
- Problema: en el paso de personas, "dirección" pedía domicilio real de habitación, no la del inmueble; además faltaba flag "actúa por apoderado" con subformulario para representantes.
- Fix aplicado: OCR de cédula, separación de campos "dirección de residencia" vs "dirección del inmueble", bloque anidado para apoderado.
- Estado: **[PENDIENTE]**

**A2 — "Número predial nacional" es ambiguo (CHIP vs Cédula Catastral); avalúo salía del paz y salvo** *(2026-03-09)*
- Problema: Bogotá usa CHIP alfanumérico; resto del país Cédula Catastral numérica. El sistema los mezclaba y además tomaba el "avalúo" desde el paz y salvo (dato incorrecto).
- Fix aplicado: skill dedicado + memoria `mem://legal/requisitos-inmuebles`; normalización según ciudad.
- Estado: **[PENDIENTE]**

**A3 — No se cargaban escrituras antecedentes para linderos ni se cruzaban entre sí** *(2026-03-09)*
- Problema: el flujo de compraventa no permitía subir la escritura antecedente para heredar linderos técnicos; tampoco había reconciliación multi-documento.
- Fix aplicado: `scan-document/core/escrituraAntecedente/*` + `reconcileData.ts` (Reconciliación multi-documento vía `normalizeCC`).
- Estado: **[PENDIENTE]**

**A4† — Tabla "DATOS DE LA ESCRITURA PÚBLICA" salía con `X X` en la fecha** *(2026-05-20)*
- Problema: `parseFechaNotarial` no era atómica: día/mes/año llegaban partidos y la plantilla imprimía literales "X X" en las celdas.
- Fix aplicado: `buildDocxVars` inyecta directamente `{fecha_dia}/{mes}/{ano}/{notaria}` en la tabla SNR.
- Estado: **[PENDIENTE]**

**A5† — Confusión escritura nueva vs. hipoteca anterior en la tabla "DATOS DE LA ESCRITURA PÚBLICA"** *(2026-05-21)*
- Problema (según Alejandra): esa tabla del formato Davivienda es para la **hipoteca anterior** (la que se cancela). Lovable primero la dejó vacía, luego se sobrecorrigió y llegó a poner los datos en la casilla equivocada.
- Fix aplicado: reasignación explícita de tags en `buildDocxVars` — tabla SNR ↔ hipoteca anterior; encabezado de escritura nueva ↔ vacío con `___________`.
- Estado: **[PENDIENTE]** (parcial: existen tests A5-1 / A5-2 en `procesar-cancelacion/index_test.ts` desde 2026-07-08, pero no reauditado hoy contra minuta real).

**A6† — Duplicación de `(DIRECCION CATASTRAL)` y de ciudad/notaría (`BOGOTA D.C. DEL BOGOTA D.C.`)** *(2026-05-21)*
- Problema: `descripcion_predio` y `nomenclatura_predio` se cruzaban; el sufijo `(DIRECCION CATASTRAL)` aparecía dos veces; la notaría se concatenaba con la ciudad ya incluida en el string.
- Fix aplicado: `buildDireccionCompletaSaneada()` (Bogotá) + condicional de omisión de ciudad cuando la notaría ya la contiene.
- Estado: **[PENDIENTE]**

**A7† — Linderos técnicos invadían las casillas cortas SNR** *(2026-05-22)*
- Problema: en cancelaciones no se necesitan linderos (medidas, coordenadas), solo la descripción arquitectónica corta; se estaban metiendo bloques largos y desbordaban celdas.
- Fix aplicado: regla en `mem://features/cancelaciones-reglas-inmueble`, bloque vacío en plantilla v2.
- Estado: **[PENDIENTE]**

**A8† — Números crudos en las cláusulas (matrícula transcrita a letras, montos sin `M/CTE`, etc.)** *(2026-05-22)*
- Problema: violación del formato notarial colombiano `TEXTO (NÚMERO)` con concordancia de género; la matrícula `50C-2085432` salía como "CINCUENTA C – DOSCIENTOS…".
- Fix aplicado: skills `formato-texto-numero-notarial` + `concordancia-genero-minutas`, aplicados en `legalFormatters.ts` / `legalProse.ts` (`montoProsa` conserva `M/CTE`).
- Estado: **[PENDIENTE]**

**A9† — `valor_hipoteca_original` llegaba con string literal `"null"` a la minuta** *(2026-05-24)*
- Problema: la cuantía se imprimía literalmente como la palabra "null" cuando la extracción semántica no encontraba Mutuo/Pago/Liquidación.
- Fix aplicado: `mergeCuantiaIntoExtracted` + `sanitizeString`/`NULLY_STRINGS` (2026-07-08).
- Estado: **[VERIFICADO]** (auditoría de sesión previa confirmó el fix en vivo).

**A10† — Apoderado del banco hardcodeado (`APODERADO_FIJO` = HEIBER HERNAN BELTRAN TORRES)** *(2026-05-21)*
- Problema: para cualquier trámite se inyectaba siempre el mismo apoderado, sin importar si Alejandra había cargado un poder o no.
- Fix aplicado: eliminación de `APODERADO_FIJO`, tercer `FileDropzone` no obligatorio, extractor `poderBanco/*`, `nullGetter` que pinta `___________`.
- Estado: **[PENDIENTE]** (auditoría 2026-07-08 confirmó 0 residuos hardcodeados en `src/` y `supabase/functions/`, pero no está en la lista de los 3 confirmados en vivo por Alejandra).

**A11 — El texto salía con la palabra "GUION" en direcciones, en lugar del símbolo `-`** *(2026-06-21)*
- Problema: la IA transcribía "guion" literalmente en la nomenclatura urbana.
- Fix aplicado: regla explícita en memoria + reforzada en el prompt (matrículas/NIT conservan guion ASCII; direcciones urbanas usan el símbolo).
- Estado: **[PENDIENTE]**

**A12 — Cédulas con puntos rompían edición manual; `tipo_id` siempre venía CC** *(2026-06-21)*
- Problema: al pegar una cédula formateada "1.234.567" el sistema no reconciliaba con la OCR; el tipo de documento se forzaba a CC.
- Fix aplicado: `normalizeCC` en `reconcileData.ts`.
- Estado: **[PENDIENTE]**

**A13 — Orden de firmas no alfabético en la antefirma** *(2026-06-21)*
- Problema: cuando había varios deudores, el orden en la antefirma no era el esperado (alfabético para firma; original para el cuerpo).
- Fix aplicado: `normalizeDeudores` mantiene orden original + expone copia ordenable para la antefirma.
- Estado: **[PENDIENTE]**

**A14 — Plantilla v3 duplicada en storage** *(2026-07-04)*
- Problema: había dos versiones de plantilla conviviendo en el bucket `cancelaciones-plantillas`, generando resultados distintos según cuál cargara el runtime.
- Fix aplicado: auditoría de tags, singleton `loadTemplateOnce` en `DocxPreview.tsx`, memoria `mem://blindaje-cancelaciones-v2`.
- Estado: **[PENDIENTE]**

---

## Bloque B — Poder General del Banco (5 puntos)

**B1 — Datos del apoderado y valor del crédito no se extraían del PDF** *(2026-03-09)*
- Problema: no existía flujo específico para el poder ni para la carta de crédito; los campos quedaban vacíos siempre.
- Fix aplicado: extractores `poderBanco/*` y `cartaCredito/*`.
- Estado: **[PENDIENTE]**

**B2 — Sección "Apoderado del Banco" salía vacía aunque hubiera datos** *(2026-05-21)*
- Problema: aun con OCR exitoso, la UI no renderizaba los datos ni permitía editarlos; en la minuta salía `___________` en la antefirma.
- Fix aplicado: `PoderViewerTab.tsx`, `PoderBannersV5.tsx`, `ProsaApoderadoModal.tsx`, `nullGetter` alineado.
- Estado: **[PENDIENTE]**

**B3 — Poder adjuntado pero NO leído (páginas 25+ truncadas)** *(2026-06-21)*
- Problema: los poderes bancarios superan 25 páginas y los datos del apoderado sustituto están al final; el sistema truncaba y mostraba "No se adjuntó Poder General".
- Fix aplicado: pipeline v5/v6 con `PODER_MAX_PAGES`, `POWER_SCHEMA_VERSION`, `poderBancoExtractor/*`, `validatePoderSuficiencia`, `classifyApoderado`.
- Estado: **[VERIFICADO]** (re-auditado 2026-07-08 sobre poder real `32f5317e…`).

**B4 — Valor de la hipoteca no encontrado por OCR** *(2026-06-21)*
- Problema: el certificado de tradición decía "CUANTÍA INDETERMINADA"; el sistema no sabía ir a buscar el monto real a la escritura antecedente (Mutuo/Pago/Liquidación).
- Fix aplicado: extracción semántica jerárquica documentada en `mem://legal/valor-credito-hipotecario-cancelacion`.
- Estado: **[PENDIENTE]** (relacionado con A9 pero es la ruta OCR, no la sanitización del literal "null").

**B5 — `apoderado_nombre` / `apoderado_cedula` con string literal `"null"`** *(2026-07-08)*
- Problema: encontrado en el camino, no era parte de los 19 originales. El campo plano llegaba con la palabra "null" cuando el V6 profundo no producía apoderado.
- Fix aplicado: `sanitizeString` + `NULLY_STRINGS` en `merge.ts` (mismo patrón que A9).
- Estado: **[VERIFICADO]**.

---

## Resumen del estado

| Estado | Cantidad | Puntos |
|---|---|---|
| **[VERIFICADO]** | 3 | A9, B3, B5 |
| **[PENDIENTE]** | 16 | A1, A2, A3, A4, A5, A6, A7, A8, A10, A11, A12, A13, A14, B1, B2, B4 |

Los 7 puntos de la auditoría de la minuta real de mayo son **A4 – A10** (marcados `†`).

Solo compilación; ninguna auditoría, verificación o cambio de código se ejecuta con este plan.
