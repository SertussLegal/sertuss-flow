**Contexto:** aún NO hay decisión de diseño. La evidencia recolectada muestra que los 5 warnings hard-block persistidos tienen distinto "grado de resolubilidad" desde la UI actual, y que un recálculo genérico en el choke point tiene efectos secundarios reales.

Antes de escribir un plan concreto necesito que confirmes 3 cosas:

**A. Sobre editabilidad UI (punto 1):**
- ¿Aceptas que 4 de 5 warnings solo tienen UN lado editable? Eso significa que "recalcular en regen" solo puede **resolver** un warning cuando el lado editable se corrige a un valor que YA coincide con el lado no-editable (que sigue siendo la fuente inmutable del OCR). No es un fix pleno, es un unblock condicionado.
- ¿O prefieres que además habilitemos algún lado hoy disabled (ej: hacer `partes.banco_nit`/`banco_acreedor` editables como override manual con auditoría), para que el humano pueda arbitrar en cualquier dirección? Esto sería un cambio de UX/producto, no solo backend.

**B. Sobre semántica de recálculo (punto 2 + 3):**
Dos alternativas mutuamente excluyentes:
- **B1 — Recalcular solo para gating**: dentro de `generateAndUploadCancelacionDocs`, llamar los 2 validadores contra `data.poder_banco` + `data.partes`, y usar el resultado SOLO para decidir bloqueo (`detectRequiereRevisionManual`). No tocar `_coherencia_warnings` persistido. Ventaja: cero riesgo de romper UI/badges. Desventaja: la UI seguiría mostrando warnings viejos ya resueltos como "sospechosos" hasta la próxima extracción.
- **B2 — Recalcular y re-persistir**: reemplazar `_coherencia_warnings` con el recálculo antes de gate + storage. Ventaja: UI queda consistente. Desventaja: hay que orquestar los 3 anotadores (poder coherencia + intra-trámite + inmueble) para no borrarse entre sí, y hay que asegurar que la persistencia solo ocurra si `detectRequiereRevisionManual` decide `requiere=false` (o siempre, incluso si se lanza `ManualReviewRequiredError`). Además puede aparecer un warning NUEVO que antes no estaba (ej: humano editó y ahora sí hay incoherencia con instrumento_poder), y hay que decidir qué mostrar en UI.

**C. Sobre alcance de los 5 warnings:**
- `apoderado_cedula_placeholder`: es el único totalmente resoluble desde UI. ¿Lo tratamos igual que los otros 4 o le damos entrada propia en `MANUAL_OVERRIDE_RULES` (equivalente al patrón existente `apoderado_cedula_menciones_incoherentes`, con predicado `isCedulaEditadaValida`)? Sería consistente con las 4 reglas ya existentes.
- Los 4 warnings `_incoherente` (escritura/fecha/nit/nombre): dado que un lado no es editable, ¿tiene sentido siquiera ofrecer una excepción "Manual > OCR"? El humano solo puede corregir el lado editable *a coincidir con el otro*. Si coincide, el warning desaparece automáticamente al recalcular; si no coincide, el bloqueo es correcto. Es decir: la vía "recalcular en el choke point" es más natural aquí que "excepción Manual".

**Pregunta concreta que necesito responder antes de escribir plan:**

¿Prefieres (1) B1 quirúrgico + entrada nueva para `apoderado_cedula_placeholder` en `MANUAL_OVERRIDE_RULES`; (2) B2 estructural + no tocar `MANUAL_OVERRIDE_RULES`; o (3) híbrido: B1 para los 4 `_incoherente` (unblock por coincidencia real) + regla `MANUAL_OVERRIDE_RULES` para `apoderado_cedula_placeholder` (unblock explícito por edición humana)?

Sin respuesta a esto no puedo dimensionar el plan honestamente. La opción (3) es la que mejor respeta la evidencia (cada warning se resuelve por el mecanismo que su naturaleza permite), pero implica el doble de superficie de cambio.