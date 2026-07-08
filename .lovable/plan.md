
# Compilación granular — 19 puntos de retroalimentación de Alejandra Arciniegas

Fuente: revisión de índices #213, #215, #1245, #1271, #1291, #1665, #1667, #1677, #1701, #1771 del historial de chat. La compilación previa (#1964, 2026-07-07) resumió estos mismos 19 puntos como "14 Cancelaciones + 5 Poder"; abajo se listan uno por uno con su origen y fix real.

## 🟦 CANCELACIONES (14)

### A1 — Audio fundacional: escanear cédula, domicilio ≠ dirección, actúa por apoderado
- **Fecha:** 2026-03-09 (audios `WhatsApp Audio 2026-03-08 at 20.32.06.opus`, #213/#215).
- **Problema:** En Vendedor/Comprador el formulario pedía "dirección" cuando la escritura pide *domicilio* (ciudad/municipio). Faltaba flag "actúa en nombre propio / apoderado" con subformulario de datos del apoderado.
- **Arreglo:** OCR de cédula en `scan-document/core/cedula/*`; campos `ciudad_domicilio` separados de dirección postal en `PersonaForm.tsx`; flag apoderado con bloque de datos anidado.

### A2 — Audio fundacional: CHIP vs Cédula Catastral, oficina registral, paz y salvo predial
- **Fecha:** 2026-03-09 (#215).
- **Problema:** "Número predial nacional" era ambiguo. Bogotá usa CHIP (AAA…), resto del país usa Cédula Catastral numérica; el avalúo sale del paz y salvo, no del certificado.
- **Arreglo:** Skill `identificador-predial-CHIP-vs-catastral`, memoria `mem://legal/requisitos-inmuebles`, extracción OCR dedicada en `scan-document/core/predial/*`.

### A3 — Audio fundacional: linderos generales + PH desde escritura antecedente
- **Fecha:** 2026-03-09 (#215).
- **Problema:** No se cargaba escritura antecedente para linderos especiales, ni se cruzaban las escrituras de constitución/aclaración/adición del reglamento de PH desde el certificado.
- **Arreglo:** `scan-document/core/escrituraAntecedente/*` + reconciliación multi-documento (`src/lib/reconcileData.ts`, memoria `mem://legal/reconciliacion-multidocumento`).

### A4 — Auditoría minuta mayo (1/7): Tabla "DATOS DE LA ESCRITURA PÚBLICA" con `X X` y fechas sin desglosar
- **Fecha:** 2026-05-20 (#1245, capturas de `minuta_2.docx`).
- **Problema:** La tabla mostraba `4165, X X, X X, X 2020` porque el OCR guardaba la fecha completa en una variable pero la plantilla exigía `{fecha_dia}/{fecha_mes}/{fecha_ano}/{notaria_numero}` atómicos.
- **Arreglo:** `parseFechaNotarial`, `extractNotariaNumero`, `formatMonedaColombiana` en `supabase/functions/procesar-cancelacion/index.ts` → `buildDocxVars` inyecta `fecha_escritura_hipoteca_dia/_mes/_ano` + `notaria_hipoteca_numero`.

### A5 — Auditoría minuta mayo (2/7): Confusión escritura nueva vs hipoteca anterior
- **Fecha:** 2026-05-21 (#1271, punto 1).
- **Problema:** Lovable interpretó que la tabla "DATOS DE LA ESCRITURA PÚBLICA" era la escritura *nueva* y la dejó vacía; en realidad Davivienda exige que ahí vayan los datos de la **hipoteca anterior** (para que la ORIP sepa qué gravamen levantar). Sólo el encabezado superior debe ir en blanco.
- **Arreglo:** Reasignación de tags en `buildDocxVars`: los campos de la hipoteca vieja se mapean a la tabla; sólo el número/fecha de la nueva quedan como `___________`. Confirmado en tests `procesar-cancelacion/index_test.ts` (SNR atómico, pad4).

### A6 — Auditoría minuta mayo (3/7): "UBICACIÓN DEL PREDIO" y "NOMBRE O DIRECCIÓN" duplicaban texto y `(DIRECCION CATASTRAL)` salía dos veces
- **Fecha:** 2026-05-21 (#1271, punto 2).
- **Problema:** Ambos campos recibían el mismo bloque, con `(DIRECCION CATASTRAL) (DIRECCION CATASTRAL)` pegado. Legalmente `UBICACIÓN` = descripción arquitectónica; `NOMBRE O DIRECCIÓN` = nomenclatura urbana + sufijo único.
- **Arreglo:** `descripcion_predio` vs `nomenclatura_predio` en el tool schema de Gemini; `buildDireccionCompletaSaneada()` inyecta el sufijo catastral una sola vez y sólo en Bogotá (tests #1 y #6 del `index_test.ts`).

### A7 — Auditoría minuta mayo (4/7): Linderos técnicos invadían el encabezado SNR
- **Fecha:** 2026-05-22 (#1291).
- **Problema:** Los linderos, medidas y coeficientes se colaban en las casillas superiores de calificación SNR (que deben ir cortas) porque el schema no los segregaba.
- **Arreglo:** Regla "cancelaciones sin linderos/áreas/coeficientes" (memoria `mem://features/cancelaciones-reglas-inmueble`), plantilla v2 sin bloque de linderos, prompt de `procesar-cancelacion` prohíbe emitir linderos en `descripcion_predio`.

### A8 — Auditoría minuta mayo (5/7): Formato `TEXTO (NÚMERO)` en cláusula segunda
- **Fecha:** 2026-05-22 (#1291, sección 1.3).
- **Problema:** Números de escritura, notaría y fecha salían en dígitos crudos ("5924", "13", "29/11/2024") en vez del estándar notarial "CINCO MIL NOVECIENTOS VEINTICUATRO (5924)".
- **Arreglo:** Skill `formato-texto-numero-notarial` + `concordancia-genero-minutas`, helpers en `src/lib/legalFormatters.ts`, aplicados en `buildDocxVars` y `legalProse`.

### A9 — Auditoría minuta mayo (6/7): Cuantía hardcodeada / "null" impreso en minuta (bug H2)
- **Fecha:** 2026-05-24 (#1307–#1310) → reincidencia detectada 2026-07-08.
- **Problema:** `valor_hipoteca_original` a veces salía como el string literal `"null"`, o como monto fijo copiado de otro trámite, cuando la escritura declaraba cuantía indeterminada.
- **Arreglo:** Extracción semántica (skill `extraccion-cuantia-semantica`), `mergeCuantiaIntoExtracted` + `buildClausulaPagoHipoteca` con leyenda "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA"; guard `sanitizeString`/`NULLY_STRINGS` (2026-07-08). Tests H2-1..H2-5 verdes.

### A10 — Auditoría minuta mayo (7/7): Datos del apoderado del banco hardcodeados (APODERADO_FIJO)
- **Fecha:** 2026-05-21 (#1271, sección 3).
- **Problema:** El apoderado del banco venía de un objeto estático, no del OCR del poder. Si el poder no se adjuntaba, aparecía un apoderado inventado.
- **Arreglo:** Nuevo `FileDropzone` "Poder General del Banco" no obligatorio en `CancelacionNueva.tsx`; extractor dedicado `scan-document/core/poderBanco/*`; sección "Apoderado del Banco" editable en `CancelacionValidar.tsx`; `nullGetter` pinta `___________` si vacío.

### A11 — Variabilidad nacional: separador de placa `-` (nunca palabra "GUION")
- **Fecha:** 2026-06-21 (#1701, punto derivado).
- **Problema:** Direcciones urbanas escritas con la palabra "GUION" ("60 GUION 65") en lugar del símbolo `-`.
- **Arreglo:** Regla core en memoria (`Direcciones urbanas: separador = "-"`), prompt de `procesar-cancelacion` explícito; test #10 del `index_test.ts` valida las 5 sub-reglas de nomenclatura.

### A12 — Sanitización de cédulas y soporte CE/Pasaporte
- **Fecha:** 2026-06-21 (#1701, puntos 1 y 3).
- **Problema:** Cédulas guardadas con puntos rompían edición manual e impedían cruce determinista. `tipo_id` asumía siempre CC, generando error sustancial si el deudor era extranjero.
- **Arreglo:** OCR guarda dígitos limpios; máscara visual sólo en UI; `tipo_id` como enum abierto (CC/CE/PA) en el schema de Gemini; `normalizeCC` en `src/lib/reconcileData.ts`.

### A13 — Orden de firmas independiente del orden del certificado
- **Fecha:** 2026-06-21 (#1701, punto 2).
- **Problema:** El array de deudores respetaba el orden del certificado, pero algunas notarías exigen orden alfabético o agrupado por género en el bloque de firmas.
- **Arreglo:** `normalizeDeudores` (L758–L783 de `procesar-cancelacion/index.ts`) mantiene el orden original + genera copia ordenable; género inferido por `inferGeneroFromNombre` con narrowing `"M"|"F"|""` (fix 2026-07-08).

### A14 — Plantilla v3 en storage + duplicados "blanqueado"
- **Fecha:** 2026-07-04 (#1771).
- **Problema:** Alejandra subió `formato cancelacion hipoteca v3` al bucket `cancelaciones-plantillas` pero coexistían dos archivos "blanqueado" duplicados; había que validar tags y limpiar.
- **Arreglo:** Auditoría de tags contra `docxTagCatalog.ts`; runtime download singleton (`loadTemplateOnce` en `DocxPreview.tsx`); memoria `mem://blindaje-cancelaciones-v2` con contrato de plantilla v2/v3.

---

## 🟧 PODER (Especial/General del Banco) — 5 puntos

### B1 — Audio fundacional: escanear poder del banco y carta de crédito
- **Fecha:** 2026-03-09 (#213/#215).
- **Problema:** Los datos del apoderado y del valor del crédito se digitaban a mano; Alejandra pidió que se extrajeran del PDF del poder y de la carta de crédito.
- **Arreglo:** Extractores dedicados `scan-document/core/poderBanco/*` y `scan-document/core/cartaCredito/*`, con handler/prompt/tool separados.

### B2 — Sección "Apoderado del Banco" en Cancelaciones
- **Fecha:** 2026-05-21 (#1271, sección 3).
- **Problema:** No existía en la UI una sección dedicada al apoderado del banco: los 5 campos (nombre, cédula, escritura, fecha, notaría) se perdían o se llenaban con datos de otras partes.
- **Arreglo:** `PoderViewerTab.tsx`, `PoderBannersV5.tsx`, `ProsaApoderadoModal.tsx`, `ProsaApoderadoPreviewCard.tsx`; `nullGetter` con `___________` cuando el poder no se cargó.

### B3 — Poder adjuntado pero NO leído (páginas 25+ truncadas) — el "punto grave" ya auditado hoy
- **Fecha:** 2026-06-21 (#1665, #1667 — caso Alejandra Arciniegas Abogada).
- **Problema:** BD confirmó 5/5 casos con `poder_banco` vacío pese a que el PDF estaba en storage. Causa: `PODER_MAX_PAGES` truncaba poderes largos y el schema legacy no capturaba la nota de vigencia (que suele estar en las últimas páginas).
- **Arreglo:** Fix v5/v6 (2026-06-21): `validatePoderSuficiencia`, `classifyApoderado`, `poder_banco_v6` schema con `POWER_SCHEMA_VERSION`, `PoderBannersV5`, extractor profundo isomórfico en `supabase/functions/_shared/isomorphic/poderBancoExtractor/*`.

### B4 — Valor de la hipoteca no se cargó (OCR no lo encontró en el poder/carta)
- **Fecha:** 2026-06-21 (#1677, adjuntó `50S-40394832.pdf` y `05700323000291276_Escritura.pdf`).
- **Problema:** Alejandra tuvo que digitar a mano el valor porque el OCR no lo detectó. Requería confirmar si el extractor podía haberlo encontrado.
- **Arreglo:** Extracción semántica jerárquica (Mutuo > Pago > Liquidación) documentada en memoria `mem://legal/valor-credito-hipotecario-cancelacion` y skill `extraccion-cuantia-semantica`; fallback a cuantía indeterminada explícita en lugar de string vacío ambiguo.

### B5 — Guard `null` string en campos planos del apoderado (bug categórico hermano de H2)
- **Fecha:** 2026-07-08 (detectado y arreglado hoy en la misma sesión H2).
- **Problema:** `apoderado_nombre`/`apoderado_cedula` recibían el string literal `"null"` cuando el bloque profundo v6 traía valores nully sin sanear.
- **Arreglo:** `sanitizeString` + `NULLY_STRINGS` aplicados en `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts` (`mergePoderBancoFlat`, `mergePoderBancoV6`, `unwrapConf`). Tests PODER-1..PODER-4 verdes.

---

## Observaciones

- Fuente de compilación previa: mensaje #1964 (2026-07-07), verificado hoy re-leyendo #213–#1771.
- Los 19 puntos están marcados como *resueltos* en el sistema; B3 fue re-auditado hoy (poder cancelación `32f5317e…`) y confirmado como caso pre-v6 (corrida 2026-07-07 21:55).
- Ningún punto es puramente cosmético: todos tocan lógica de OCR, prompt, `buildDocxVars` o el schema de extracción.
- No hay implementación en este entregable — es compilación de lectura.
