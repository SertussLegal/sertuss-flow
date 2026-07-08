# Plan — Coherencia intra-documento del poder bancario (self-consistency)

Solo diseño. No toca código.

## 1) Diagnóstico del terreno actual

**A. Qué páginas ve el extractor**
`procesar-cancelacion/index.ts` (líneas ~2250-2267 y ~2652+) arma `poderUrls` listando **todos los .jpg del prefix del poder en storage** y los pasa completos, en orden, tanto a `extractPoderBancoDedicado` como a `extractPoderBancoV6`. Si el usuario subió un PDF único que contiene el poder + el Certificado de la Superintendencia Financiera protocolizado, esas páginas del certificado **ya están dentro del contexto multimodal**. El prompt v7 explícitamente le dice al modelo: "el usuario puede enviarte hasta 50 páginas… REVISA TODAS las páginas". Sección "anexos" del prompt menciona "Certificados de Superfinanciera y/o Cámara de Comercio".

**B. Qué captura hoy el schema (`tool.ts` v6)**
- `poderdante.representante_legal_cedula` (**un solo campo, una sola vez**).
- `apoderado.*` (natural o jurídica con `representantes[]`).
- `instrumento_poder.*`.
- `anexos` mencionado en prompt pero **NO hay bloque estructurado tipo `certificado_superfinanciera.representantes_legales[]`** con nombres/cédulas. El certificado se usa como contexto visual, no se re-extrae en un bloque contrastable.

Consecuencia: el modelo **emite la cédula del RL del banco una sola vez**, aunque en el PDF esté escrita 3 veces (cuerpo, firma, certificado Superfinanciera). No hay dos salidas independientes que comparar.

**C. Qué chequea hoy el detector de coherencia**
- `validate.ts` (Reglas 2.1–4): compara `poder_banco.apoderado_escritura` (plano legacy) contra `instrumento_poder.escritura_num` (profundo), y `apoderado_cedula` (plano) contra `apoderado.cedula` (profundo). Esto es **self-consistency del OUTPUT del modelo, no del documento**: como el modelo llena ambos desde la misma lectura, si alucina, alucina igual en ambos y el chequeo pasa. Fue lo que ocurrió con `79392406`. También detecta: formato de cédula, colisión apoderado==RL banco, `NO_LEGIBLE`, placeholders conocidos.
- `crossCheck.ts`: compara **ENTRE cancelaciones distintas** de la misma organización (mismo nombre con cédula distinta, misma cédula con nombre distinto). No mira el documento fuente.

**Conclusión: hoy NO existe ningún chequeo que confronte dos menciones independientes del mismo dato dentro del MISMO PDF.** Es un tipo de regla nuevo, no una extensión trivial.

**D. ¿Hay redundancia interna en el output del modelo hoy?**
No. `representante_legal_cedula` aparece en un único slot. Los campos "plano vs profundo" son back-compat del mismo dato, no lecturas independientes.

## 2) Opciones evaluadas

**(a) Extracción redundante desde el mismo prompt** — pedirle al modelo que llene, además del campo actual, un bloque nuevo tipo `poderdante.menciones_cedula_rl[]` con la cédula tal como aparece en cada sección (cuerpo, firma, certificado Superfinanciera) y qué página. Luego comparar programáticamente.
- Costo: 0 llamadas extra, +N tokens de output.
- Riesgo: el modelo puede "auto-consistir" el error si lee mal la primera vez y transcribe el mismo dígito 3 veces sin volver a mirar. Mitigable si el prompt exige releer cada sección de forma independiente ("no copies de campos anteriores; relee cada página"). Aun así, un modelo con un solo pase probablemente reproduce su primera lectura.
- **No cierra el caso real**: el error "79392406 vs 79382406" es transposición de un dígito; un LLM que "leyó" 3 → 9 en el cuerpo probablemente lee 3 → 9 también en la firma. Redundancia dentro del mismo pase reduce, no elimina.

**(b) Segunda pasada dedicada al Certificado de la Superintendencia** — extractor separado que solo recibe las páginas identificadas como Certificado Superfinanciera y devuelve un bloque estructurado `{representantes_legales: [{nombre, cedula, cargo}]}`. Luego `validate.ts` compara `poderdante.representante_legal_{nombre,cedula}` contra ese bloque.
- Costo: +1 llamada Gemini (~$0.001-0.003) cuando hay poder con certificado adjunto. Recomputa sobre subset chico (2-5 páginas típicamente).
- Ventaja: dos pases **independientes** con contextos distintos → la probabilidad de que ambos comentan la misma transposición es mucho menor.
- Cerraría el caso real: el certificado Superfinanciera es texto administrativo limpio (mejor OCR que un poder manuscrito/protocolizado), y sería la fuente de verdad autoritativa. Discrepancia → `revision_manual_requerida = true` + warning `rl_banco_incoherente_vs_superfinanciera`.
- Complejidad extra: detectar qué páginas son el certificado Superfinanciera. Dos vías: (i) heurística/keyword ("SUPERINTENDENCIA FINANCIERA DE COLOMBIA") con un pase barato o marca del prompt v7, (ii) pedirle al extractor actual que devuelva `anexos.superfinanciera.paginas[]` como índices, ya cabe en el schema con un campo nuevo.

**(c) Híbrido — redundancia interna barata + segunda pasada solo cuando discrepe** — combinar (a) y (b): pedirle al modelo que devuelva `menciones_cedula_rl[]` con {seccion, valor, pagina}. Si todas coinciden y hay ≥2 (cuerpo/firma), pasa. Si hay discrepancia interna O solo hay 1 mención, disparar segunda pasada dedicada al certificado. Si aun así hay discrepancia entre pases → `revision_manual_requerida`.
- Costo: 0 llamadas extra en el caso feliz, +1 en el caso sospechoso.
- Máxima cobertura sin costo constante.

## 3) Propuesta

**Ir por (c) — híbrido, en dos fases separadas para poder medir cada una:**

**Fase 1 — Redundancia interna (barata, primera línea)**
- Añadir al schema (`tool.ts`) un array nuevo `poderdante.menciones_rl[]` con `{ seccion: "cuerpo"|"firma"|"certificado_superfinanciera"|"otro", nombre_transcrito, cedula_transcrita, pagina_aprox }`.
- Añadir al prompt (`prompt.ts`) un bloque nuevo "TRAZABILIDAD DEL RL DEL BANCO" que instruye: releer cada aparición como si fuera la primera, no copiar entre secciones, transcribir dígito a dígito lo que se ve en cada lugar. Mínimo 2 menciones esperadas cuando hay certificado adjunto.
- En `validate.ts` añadir Regla 5 `rl_banco_menciones_incoherentes`: si `menciones_rl[]` tiene ≥2 entradas y alguna cédula normalizada difiere entre sí, o difiere de `poderdante.representante_legal_cedula`, → warning + `suspicious.add("poderdante.representante_legal_cedula")` + entra a `HARD_BLOCK_WARNING_SUFFIXES` (`_incoherente` ya está listado).
- Aporte esperado: atrapa el ~40-60% de estos casos (transposiciones donde el modelo relee y ve algo distinto la segunda vez).

**Fase 2 — Segunda pasada dedicada al certificado Superfinanciera (autoridad)**
- Nuevo extractor `extractCertificadoSuperfinanciera(paginasIdx, urls)` en `_shared/isomorphic/`. Prompt corto y schema chico (`{ entidad, nit, representantes: [{nombre, cedula, cargo, tipo: "principal"|"suplente"}] }`).
- Se dispara **solo cuando Fase 1 marca discrepancia** O cuando `menciones_rl[]` viene con 1 sola entrada (baja evidencia). No corre en el caso feliz → costo marginal.
- Nueva Regla 6 en `validate.ts` (cross-source, no puramente isomórfica; puede vivir en un `validateSuperfinanciera.ts` separado): compara la cédula del `representante_legal_cedula` contra los `representantes[]` del certificado. Si el nombre coincide (fuzzy MAYÚSCULAS-sin-acentos) pero la cédula difiere → warning `rl_banco_incoherente_vs_superfinanciera` (hard-block).
- Para la detección de páginas del certificado usa `anexos.superfinanciera_paginas[]`, campo nuevo en el schema principal que Fase 1 ya llena.

**Fase 3 — Retroactivo (opcional, mismo diseño)**
Correr Fase 1 (y Fase 2 si aplica) sobre las cancelaciones cerradas de las últimas N semanas como job manual (mismo patrón que `descubrir-reglas`), marcando `revision_manual_requerida = true` + `system_events` cuando dispare. No requiere reprocesar el poder si guardamos las páginas — reutiliza `poderUrls`.

## Detalles técnicos

- **Puntos de cambio previstos** (para futuro build mode, NO ahora):
  - `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` — añadir `poderdante.menciones_rl[]` + `anexos.superfinanciera_paginas[]`.
  - `.../poderBancoExtractor/prompt.ts` — sección "TRAZABILIDAD DEL RL DEL BANCO".
  - `.../poderBancoExtractor/validate.ts` — Regla 5 (`rl_banco_menciones_incoherentes`).
  - Nuevo `.../poderBancoExtractor/validateSuperfinanciera.ts` — Regla 6 y prompt+schema del extractor dedicado.
  - `procesar-cancelacion/index.ts` — orquestar Fase 2 condicional y persistir warnings; ya existe `revision_manual_requerida` y `ManualReviewRequiredError` para bloquear la generación de docx.
- **Compatibilidad**: campos nuevos son opcionales; no rompe caché `ocr_raw_cache` porque el SHA-256 se calcula sobre las páginas, no sobre el schema; pero el output cacheado antiguo no tendrá `menciones_rl[]` — se degrada a "no evidence, no warning", igual que hoy.
- **Métricas a exigir antes de shippear Fase 2**: tasa de disparo real de Fase 1 sobre backfill de últimas 4 semanas + estimación de costo Gemini extra.
- **Fuera de alcance de este plan**: cambiar la plantilla docx, tocar `detectRequiereRevisionManual`, tocar `crossCheck.ts` (sigue siendo cross-cancelación, propósito distinto).

## Riesgos y límites honestos

- Si el poder llega **sin certificado Superfinanciera adjunto**, Fase 2 no aplica y solo queda Fase 1. Documentar que en ese régimen el chequeo es probabilístico.
- Si el OCR consistentemente alucina el mismo dígito en las 3 menciones (posible con dígitos muy borrosos), ni (a) ni (b) atrapan. Ese subconjunto quedará como riesgo residual, mitigado por `crossCheck.ts` (histórico) y por la revisión humana previa a firma.
- Regla 5 depende de que el modelo obedezca "no copies entre secciones". Hay que validarlo empíricamente antes de darla por buena — parte del criterio de aceptación de Fase 1.

## Decisión que necesito de ti

1. ¿Vamos por el híbrido (c) en dos fases separadas, o prefieres empezar solo por Fase 1 (barata, sin llamada extra) y decidir Fase 2 con los datos?
2. Fase 3 retroactiva: ¿sí, y sobre qué ventana (14 / 30 / 90 días)?
3. ¿El certificado Superfinanciera hoy siempre viene dentro del mismo PDF del poder en tu operación, o a veces llega como archivo aparte? Impacta si Fase 2 puede asumir mismas `poderUrls` o necesita otra fuente de páginas.
