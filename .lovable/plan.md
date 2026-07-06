# Diagnóstico — Limpieza cosmética (solo lectura, sin ejecución)

## 1. Carpeta `.tmp-templates/`

**Hallazgo:** 3 archivos residuales, ninguno referenciado por código de producción.

**Evidencia:**
```
9121   .tmp-templates/CERTIFICADO can hipo blanqueado.docx        (2026-07-06)
28753  .tmp-templates/cancelacion_clean.docx                       (2026-07-06)
28753  .tmp-templates/formato cancelacion hipoteca blanqueado.docx (2026-07-06)
```
- `md5` de `cancelacion_clean.docx` y `formato cancelacion hipoteca blanqueado.docx` = idéntico (`f54cd383…`). Uno es copia del otro.
- `rg "tmp-templates"` en todo el repo → **0 resultados**. No hay ningún import, `fetch`, `readFile` o referencia en frontend, edge functions, tests ni migraciones.
- **No está en `.gitignore`** (revisado `.gitignore` completo). Están committeados como archivos normales — son residuo de subidas manuales de plantillas durante desarrollo.
- Las plantillas reales de cancelación viven en el bucket privado `cancelaciones-plantillas` (Lovable Cloud), no aquí.

**Recomendación:** ELIMINAR carpeta completa (residual, cero uso en runtime).

---

## 2. Lockfiles duplicados (`bun.lockb`, `bun.lock`, `package-lock.json`)

**Hallazgo:** Tres lockfiles committeados. Lovable/Vite usa `bun` como package manager.

**Evidencia:**
```
194663  bun.lock            (texto, formato bun >=1.1)
245395  bun.lockb           (binario, formato bun <1.1)
372722  package-lock.json   (npm)
```
- `package.json` no declara `packageManager` ni `engines`. No hay CI visible en el repo (Lovable Cloud maneja build internamente).
- Lovable estándar usa **bun** (documentado en instrucciones: `bun add`, `bun remove`). El formato vigente de bun es `bun.lock` (texto) — `bun.lockb` es el binario legacy previo a bun 1.1 y bun lo regenera/ignora si `bun.lock` existe.
- `package-lock.json` sólo se usaría si alguien corriera `npm install` fuera de Lovable.

**Riesgo real:**
- Desincronización silenciosa: un dev local corriendo `npm install` puede resolver versiones distintas a las que bun instala en Lovable → "funciona en mi máquina, falla en prod".
- Un `bun install` toca `bun.lock` pero deja `bun.lockb` obsoleto → diff ruidoso y falsas alarmas de auditoría de dependencias.
- Herramientas de seguridad (Dependabot, Snyk) auditan el lockfile "equivocado" y reportan CVEs stale.

**Recomendación:** MANTENER `bun.lock`, ELIMINAR `bun.lockb` y `package-lock.json`. Requiere confirmación humana antes de tocar lockfiles.

---

## 3. `src/shared/prosaBancos/legalProse.ts` (huérfano)

**Hallazgo:** Archivo de 97 líneas, **cero imports en todo el repo**.

**Evidencia:**
- `rg "prosaBancos/legalProse"` en todo el repo (incluyendo tests, edge functions, componentes) → **0 resultados**.
- El propio archivo se autodocumenta como *"Copia consolidada de `supabase/functions/process-expediente/legalProse.ts` para eliminar el path relativo cruzado"* — es un intento de consolidación que quedó a medias: se creó la copia isomórfica pero nadie migró los imports.
- Su contenido (`numeroConLetras`, `fechaProsa`, `numberToWordsLegal`) es un **subconjunto** de `src/lib/legalProse.ts` (que además exporta `escrituraProsa`, `montoProsa` y reusa `formatMonedaLegal`). Frontend usa `@/lib/legalProse`; edge functions usan `supabase/functions/process-expediente/legalProse.ts`. Ambas versiones ya funcionan sin este archivo.
- No hay lógica única aquí — todo lo que hace ya existe en las otras 2 copias.

**Recomendación:** ELIMINAR (código muerto real, experimento abandonado de consolidación isomórfica).

---

## 4. Plantilla `.docx` duplicada (raíz vs `public/`)

**Hallazgo:** NO son idénticas byte a byte; solo `public/` se usa en producción.

**Evidencia:**
```
md5  496e64bb4e612511d8b78ea39c46daf6   template_venta_hipoteca.docx        (251.880 bytes)
md5  cba11eb33974467ccd1f5208b462490d   public/template_venta_hipoteca.docx (252.360 bytes)
```
- Hashes y tamaños distintos → **son versiones diferentes**.
- Todos los `fetch` en el código apuntan a la ruta pública servida por Vite:
  - `src/pages/Validacion.tsx:2082` → `fetch("/template_venta_hipoteca.docx")`
  - `src/components/tramites/DocxPreview.tsx:290` → `fetch("/template_venta_hipoteca.docx")`
- Vite sirve `/…` desde `public/`. La copia en raíz **nunca se lee en runtime** — es residuo.
- El riesgo: futuros edits pueden modificar la copia equivocada creyendo que impacta producción.

**Recomendación:** ELIMINAR `template_venta_hipoteca.docx` (raíz). Requiere revisión humana rápida por si la versión de raíz tiene cambios más nuevos aún no promovidos a `public/`.

---

## 5. RPC `consume_credit` (sin `_v2`)

**Hallazgo:** Definido en migraciones y expuesto en `types.ts`, pero **cero llamadas activas** en frontend o edge functions.

**Evidencia:**
```
supabase/migrations/20260305193343_…sql:142   CREATE OR REPLACE FUNCTION public.consume_credit(org_id uuid)   ← creación original (marzo 2026)
supabase/migrations/20260424164804_…sql:181   CREATE OR REPLACE FUNCTION public.consume_credit(org_id uuid)   ← redefinición (abril 2026)
src/integrations/supabase/types.ts:1245       consume_credit: { Args: { org_id: string }; Returns: boolean }   ← autogenerado
```
- `rg "consume_credit"` (excluyendo `_v2`) en `src/`, `supabase/functions/`: **0 llamadas**. Todo el frontend usa `src/services/credits.ts` → `supabase.rpc("consume_credit_v2", …)`.
- Reemplazo: `consume_credit_v2` (con firma extendida: `p_org_id, p_user_id, p_action, p_tramite_id, p_tipo_acto, p_credits`) que además inserta audit trail atómico (documentado en el header de `services/credits.ts`).
- La versión `_v2` es la fuente única activa desde que se centralizó el cobro con metadata; `consume_credit` quedó como wrapper legacy sin consumidores.

**Recomendación:** REQUIERE REVISIÓN HUMANA antes de `DROP FUNCTION`. Aunque no hay llamadas en el código, conviene verificar que ningún trigger, vista, edge function externa o script administrativo la invoque. Si nada la usa → deprecar con `COMMENT` en migración nueva y eliminar en una siguiente.

---

## 6. Skills en `.workspace/skills/` no indexados

**Corrección al audit original:** Hay **14 skills** en `.workspace/skills/`, no 6. De ellos, **4 no aparecen referenciados** en el índice de memoria del proyecto (`mem://index.md`) ni en `project-knowledge`.

**Skills activos referenciados en memoria/project-knowledge (10):**
`sanitizar-direccion`, `convertir-numero-a-letras` (marcado `type: deprecated` — remite a `formato-texto-numero-notarial`), `formato-texto-numero-notarial`, `concordancia-genero-minutas`, `extraccion-cuantia-semantica`, `componente-segmented-choice`, `direccion-completa-saneada-cancelacion`, `cuantia-indeterminada-cancelacion`, `payload-crudo-tabla-snr`, `limitaciones-concurrentes-cancelacion`.

**Skills NO indexados en memoria (4):**

| Skill | Tema | Estado aparente |
|---|---|---|
| `gestionar-reglas-inmueble-por-modulo` | Diferenciar lógica de Inmuebles entre módulo Cancelaciones y Escrituras | Activo pero sin entrada en `mem://index.md` |
| `limpieza-segura-codigo` | Playbook de limpieza / refactor sin romper lógica (el que gobierna esta misma tarea) | Activo, meta-skill de proceso |
| `validar-poder-general-banco` | Procesamiento de poderes bancarios multi-página y antefirmas | Activo, tema cubierto parcialmente por otros features |
| `verificar-consistencia-notarial` | Cruce CTL vs escrituras anteriores para auditar gravámenes | Activo pero sin entrada en memoria |

Adicionalmente, `convertir-numero-a-letras` está marcado explícitamente `type: deprecated` y solo apunta a `formato-texto-numero-notarial` — es un puntero de compatibilidad.

**No son borradores** (los borradores viven en `.agents/skills/` o `.claude/skills/`, esta carpeta es de skills activos). Simplemente no se agregaron sus referencias al índice de memoria — omisión, no duplicación.

**Recomendación:** REQUIERE REVISIÓN HUMANA. No borrar (son skills activos válidos); decidir para cada uno: (a) añadir referencia a `mem://index.md` si sigue siendo relevante, o (b) desactivar desde Settings → Skills si el tema ya está cubierto por otro skill. `convertir-numero-a-letras` puede desactivarse formalmente ahora que su reemplazo está consolidado.

---

## Resumen de recomendaciones

| # | Item | Acción sugerida | Riesgo |
|---|---|---|---|
| 1 | `.tmp-templates/` | Eliminar | Ninguno |
| 2 | `bun.lockb` + `package-lock.json` | Eliminar (mantener `bun.lock`) | Bajo, requiere confirmar |
| 3 | `src/shared/prosaBancos/legalProse.ts` | Eliminar | Ninguno |
| 4 | `template_venta_hipoteca.docx` (raíz) | Eliminar (mantener `public/`) | Bajo, verificar que raíz no tenga cambios nuevos |
| 5 | RPC `consume_credit` (legacy) | Requiere revisión humana antes de DROP | Medio (base de datos) |
| 6 | 4 skills no indexados | Revisión humana caso por caso | Ninguno operativo |

**Nada se modificó en esta respuesta.** La ejecución de cualquiera de estas limpiezas requiere tu confirmación explícita por item (recomendado agruparlos: 1+3+4 en un lote, 2 en otro, 5+6 individualmente).
