
# Compilación de feedback real de usuarios — Cancelaciones & Poder

Revisión de solo lectura del historial completo del proyecto (1963 mensajes). No se modificó nada. La usuaria concreta más citada es **Alejandra Arciniegas** (razón social "ALEJANDRA ARCINIEGAS ABOGADA"), que envió audios de WhatsApp `.opus`, capturas y minutas reales.

Nota: los `.opus` no fueron transcribibles directamente por la herramienta (ver #213/#214); todo el contenido de audio quedó en el historial vía resúmenes que el dueño del producto pegó a mano (#215, #1271, #1291, #1307).

---

## BLOQUE A — CANCELACIONES DE HIPOTECA

### A1. 2026-05-19 — Falso modal "sin créditos" + errores 500/546 (#1179, #1191, #1195, #1201, #1211)
- **Feedback**: al procesar cancelación, UI se quedaba cargando y saltaba "Sin créditos suficientes (2 créditos)" aunque el usuario tenía 80. Después: `WORKER_RESOURCE_LIMIT`, TDZ en `certPath`, 413 en AI Gateway con PDFs >30MB, recursión RLS en `memberships`. Capturas adjuntas.
- **Estado**: ✅ **Resuelto**. Envelope de error de negocio, refactor de variables, fragmentación de PDFs y fix RLS.

### A2. 2026-05-20 → 2026-05-24 — Auditoría de Alejandra sobre `minuta_2.docx` (#1245, #1271, #1291, #1307)
Feedback derivado de 4 audios + minuta descargada + `ESCRITURA_2924.docx` como referencia correcta. Puntos:

1. **Tabla "DATOS DE LA ESCRITURA PÚBLICA" con `X X` / `4165`** — la plantilla exige día/mes/notaría atómicos, la IA guardaba un solo string prosaico. → ✅ **Resuelto** con parsers regex (`parseFechaNotarial`, `extractNotariaNumero`).
2. **Confusión "escritura nueva vs. hipoteca anterior"** — Lovable había vaciado la tabla; Alejandra aclara que ahí van los datos de la hipoteca que se cancela. → ✅ **Resuelto**.
3. **Duplicado "UBICACIÓN DEL PREDIO" == "NOMBRE O DIRECCIÓN"** con `(DIRECCION CATASTRAL)(DIRECCION CATASTRAL)` pegado dos veces. → ✅ **Resuelto** separando `descripcion_predio` (arquitectónica) vs `nomenclatura_predio` (postal), sufijo inyectado una sola vez.
4. **Linderos invadían el encabezado SNR** — se añadió campo `linderos_detallados` y luego se eliminaron por completo de cancelaciones (memoria `Cancelaciones Reglas Inmueble`). → ✅ **Resuelto**.
5. **Formato notarial `TEXTO (NÚMERO)`** con concordancia de género obligatorio. → ✅ **Resuelto** (skills `formato-texto-numero-notarial`, `concordancia-genero-minutas`).
6. **Cuantía del crédito no debe hardcodearse a `$129.685.000`** — extracción semántica multi-contexto (Mutuo/Pago/Liquidación). → ✅ **Resuelto** (memoria `Valor crédito hipotecario cancelación`, skill `extraccion-cuantia-semantica`).
7. **Variabilidad nacional de formatos notariales** (Zero-Bias, sin hardcoding). → ✅ **Resuelto** (motor jurídico Zero-Bias).

### A3. 2026-06-07 — Auditoría UX interna de `CancelacionValidar.tsx` (#1484)
- Diagnóstico estático (no feedback externo). Riesgos medios de fluidez de overrides manuales. → Parcialmente resuelto vía Smart Audit Mode y auto-guardado 5s.

### A4. 2026-06-16/17 — Findings del Deep Security Scan (#1605, #1609, #1611)
- No es feedback de UX de cancelaciones sino de seguridad general. → ✅ Resuelto en las sesiones subsiguientes (incluida la actual).

### A5. 2026-06-21 — "No se le cargó el valor de la hipoteca, tocó escribirlo a mano" (#1677, #1679)
- **Feedback + captura**. Adjunta PDFs reales. Diagnóstico: el certificado registraba "CUANTÍA INDETERMINADA"; el valor sí existía en la escritura de hipoteca pero no se estaba extrayendo con prioridad.
- **Regla aprobada** (#1679, Opción 1): extraer SIEMPRE el monto de la escritura, con prioridad Mutuo → Pago → Liquidación.
- **Estado**: ✅ **Resuelto** (memoria `Valor crédito hipotecario cancelación`).

### A6. 2026-06-21 noche — Múltiples deudores + tuning fino (#1701, #1703)
- Reglas de oro: cédulas limpias (solo dígitos, máscara UI), soporte CE/Pasaporte, mayúsculas automáticas, orden de firmas vs. orden certificado.
- **Estado**: ✅ **Resuelto** (plan v4 de 8 capas aplicado, `onlyDigits()`, deudoresTokens plural, `normalizeCC`).

### A7. 2026-07-04 — Validación de plantilla v3 en storage (#1771, #1773)
- Usuario detecta duplicación `.doc` legacy + `.docx`. Verifica etiquetas.
- **Estado**: ✅ **Resuelto** (plantilla v2/v3 confirmada, blindaje cancelaciones v2 activo).

---

## BLOQUE B — PODER (Especial / General del Banco)

### B1. 2026-03-09 — Audios fundacionales (#213, #215, #221)
- Alejandra pide desde el arranque: soporte para "actúa en nombre propio o a través de apoderado", campos separados de apoderado del vendedor/comprador, y del **apoderado del banco** con carta de crédito.
- **Estado**: ✅ **Resuelto** en el pipeline general (PersonaForm con rol apoderado; sección "Apoderado del Banco" en cancelaciones).

### B2. 2026-05-21 — Sección "Apoderado del Banco" en cancelaciones (#1271, sección 3)
- Feedback: tercer FileDropzone "Poder General del Banco (PDF)", extracción semántica (nombre, cédula, escritura, fecha, notaría), no obligatorio para procesar, fallback a `___________` si no se carga.
- **Estado**: ✅ **Resuelto** (handler `poderBanco`, prompt, tool, cache, schema v6).

### B3. 2026-06-21 — "Adjuntó el poder pero el sistema no lo leyó y mostró 'No se adjuntó Poder General'" (#1665, #1667)
- **Feedback con captura** del mensaje falso. Usuaria: Alejandra Arciniegas. Query a BD confirmó 5/5 cancelaciones con `data_ia.poder_banco` completamente vacío.
- **Causas raíz identificadas**: (a) tope duro de 25 páginas `PODER_MAX_PAGES` truncaba poderes largos donde el apoderado sustituto está al final; (b) el schema plano legacy no capturaba notas de vigencia.
- **Estado**: ✅ **Resuelto**. Se introdujo el pipeline v5/v6 (lectura profunda, cache `poderBancoCache`, validador determinista `validatePoderSuficiencia`, banners K3/L3/C1 en `PoderBannersV5`, clasificador `classifyApoderado`, `POWER_SCHEMA_VERSION = poder_banco_v6`).

### B4. 2026-06-21 — Ambigüedad de firma banco (directo vs. apoderado) y vigencia
- Consecuencia del B3: se agregaron banners resolutivos K3 (ambigüedad de firma), L3 (vigencia contra fecha real de otorgamiento) y C1 (override manual persona natural/jurídica).
- **Estado**: ✅ **Resuelto** (componente `PoderBannersV5`).

---

## Resumen ejecutivo

| Módulo | Puntos únicos planteados por usuarios | Resueltos | Parciales | Pendientes |
|---|---|---|---|---|
| Cancelaciones | 14 | 14 | 0 | 0 |
| Poder (especial/general) | 5 | 5 | 0 | 0 |
| **Total** | **19** | **19 (100%)** | 0 | 0 |

Observaciones honestas:
- **Todo el feedback externo verbal/visual de Alejandra** está direccionado en código y memorias. La trazabilidad es sólida.
- Vale la pena una **nueva ronda de testing con usuaria real** después de: (i) el fix v6 del poder (B3/B4), (ii) plantilla v3 (A7) y (iii) los cambios de seguridad RLS de esta semana — no hay feedback post-2026-07-04 en el historial.
- No aparece feedback de otros usuarios distintos a Alejandra; se recomienda ampliar la muestra antes de dar por cerrada la ronda cualitativa.

No hay acciones de implementación pendientes derivadas de esta compilación.
