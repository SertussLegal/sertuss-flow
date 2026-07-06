
# Auditoría de Inventario — Sertuss

**Modo:** solo lectura. Ningún archivo, política o tabla fue modificado.

---

## 1. Versionamiento paralelo

| Ruta | Estado | Severidad | Recomendación |
|---|---|---|---|
| `src/components/cancelaciones/PoderBannersV5.tsx` | **En uso** (importado en `CancelacionValidar.tsx:25,1102`). No existe V1–V4. | Baja | Renombrar a `PoderBanners.tsx` (el sufijo V5 refleja el `POWER_V5_ENABLED` flag interno, no una versión coexistente). |
| `supabase/functions/_shared/poderBancoSchemaVersion.ts` (`POWER_PROMPT_VERSION=v6`, `POWER_SCHEMA_VERSION=poder_banco_v6`) | **En uso** activo | Baja | Mantener — es versionado de cache invalidation, no de código. |
| `public.consume_credit` (RPC) — wrapper legacy que llama a `consume_credit_v2` | En BD y en `types.ts:1245`. No hay call-sites en `src/` ni `supabase/functions/`. | Media | Consolidar: retirar `consume_credit` una vez confirmado que ningún cliente antiguo lo invoca. |
| `public.get_user_org` — alias que delega en `get_active_org` | Aún referenciado por migraciones antiguas (`20260310`, `20260316`, `20260308`) para RLS. | Baja | Mantener el alias; requiere revisión humana antes de retirarlo. |
| `supabase/functions/_shared/prosaBancos/{davivienda,index,types}.ts` | Son **re-exports de 3 líneas** hacia `src/shared/prosaBancos/*` (fuente isomórfica). | Baja | Mantener — patrón intencional para Deno. |

> No se encontraron sufijos `_old`, `_new`, `_legacy`, `_deprecated`, `_backup` en el árbol de código.

---

## 2. Código muerto / no referenciado

| Ruta | Evidencia | Severidad | Recomendación |
|---|---|---|---|
| `src/shared/prosaBancos/legalProse.ts` (97 líneas) | **No importado** por nadie (`rg "prosaBancos/legalProse"` = 0 hits). El único `legalProse` en uso es `src/lib/legalProse.ts` (referenciado por `davivienda.ts` compartido vía `./legalProse.ts` relativo, pero ese path resuelve al de `src/shared`). Revisar si es shim vivo o duerme. | Media | Requiere revisión humana — potencial colisión con el archivo raíz `src/lib/legalProse.ts`. |
| `supabase/functions/process-expediente/legalProse.ts` (153 líneas) | Copia local en la edge function `process-expediente`. Es su propia fuente; no se ha migrado a `src/shared`. | Media | Consolidar con `src/shared/prosaBancos/legalProse.ts` o `src/lib/legalProse.ts` (ver §5). |
| `supabase/functions/_shared/apoderadoClassifier.ts` (166 líneas) vs `src/lib/apoderadoClassifier.ts` (151) | Divergencia de 15 líneas entre cliente y edge. | Alta | Consolidar bajo `src/shared/` (mismo patrón isomórfico que `prosaBancos`). |
| `src/lib/genero.ts` vs `supabase/functions/_shared/genero.ts` | Duplicado. | Alta | Consolidar en `src/shared/`. |
| `.workspace/skills/convertir-numero-a-letras`, `.../limpieza-segura-codigo`, `.../sanitizar-direccion`, `.../verificar-consistencia-notarial`, `.../validar-poder-general-banco`, `.../gestionar-reglas-inmueble-por-modulo` | Presentes en `.workspace/skills/` pero no aparecen listados en el índice del proyecto (que enumera 8 skills, aquí hay 14). | Baja | Requiere revisión humana — confirmar si son borradores activos o residuo. |

---

## 3. Artefactos de debug/diagnóstico en producción

| Componente | Ruta | Gate | Severidad | Recomendación |
|---|---|---|---|---|
| `DocxDebugModal` | `src/components/tramites/DocxDebugModal.tsx` → usado en `Validacion.tsx:3482` | Sin flag visible: se muestra según estado local `onDebugVisualChange`. Debería estar tras `organizations.debug_tools_enabled`. | **Alta** | Requiere revisión humana — verificar guard efectivo antes de producción. |
| `SystemMonitor` | `src/components/admin/SystemMonitor.tsx` → montado en `Admin.tsx:328` bajo `/admin` | Protegido por `isSuperAdmin(profile?.email)` + `is_platform_admin()` en SQL. | Baja | Mantener — gate correcto. |
| "Prueba de Validación con IA" (`handleTestClaude` en `Admin.tsx`) | En `/admin`, envía payload ficticio a `validar-con-claude`. | Mismo gate SuperAdmin. | Baja | Mantener. |
| `Bug` icon "Auditoría .docx" toggle (`admin_set_debug_tools`) | `Admin.tsx` — activa/desactiva `debug_tools_enabled` por org. | Solo SuperAdmin. | Baja | Mantener. |

---

## 4. Archivos que no deberían estar versionados

| Ruta | Motivo | Severidad | Recomendación |
|---|---|---|---|
| `.tmp-templates/*.docx` (3 archivos: `CERTIFICADO can hipo blanqueado.docx`, `cancelacion_clean.docx`, `formato cancelacion hipoteca blanqueado.docx`) | Carpeta con prefijo `.tmp-` — típica de scratch. | **Alta** | Eliminar del repo y añadir `.tmp-*` al `.gitignore`. |
| `bun.lockb` (245 KB, binario) coexiste con `bun.lock` (194 KB, texto) y `package-lock.json` (372 KB) | Tres lockfiles simultáneos. | Media | Requiere revisión humana — decidir gestor único (bun **o** npm). |
| `tsconfig.app.tsbuildinfo` (180 KB), `tsconfig.node.tsbuildinfo` (45 KB) | Artefactos de `tsc --incremental`. | Media | Añadir `*.tsbuildinfo` al `.gitignore`. |
| `template_venta_hipoteca.docx` (245 KB) duplicado en raíz y en `public/` (252 KB) | Copia binaria doble. | Media | Mantener solo `public/template_venta_hipoteca.docx`; eliminar la de raíz. |
| `.env` presente en la raíz | Ya está en `.gitignore` (línea final) — verificar que no se haya commit-eado previamente. | Alta | Requiere revisión humana (auditar historial). |
| `supabase/.temp/` (`cli-latest`, `gotrue-version`, `pooler-url`, `postgres-version`, `project-ref`, `rest-version`, `storage-migration`, `storage-version`) | Metadatos generados por Supabase CLI. | Baja | Añadir `supabase/.temp/` al `.gitignore`. |
| `deno.lock` en raíz (7.5 KB) | Se usa solo en edge functions; podría vivir dentro de `supabase/`. | Baja | Requiere revisión humana. |

---

## 5. Duplicación de lógica de negocio

| Lógica | Ubicaciones | Skill canónico | Severidad | Recomendación |
|---|---|---|---|---|
| Prosa legal (`numeroConLetras`, `montoProsa`, `fechaProsa`, `escrituraProsa`) | `src/lib/legalProse.ts` (177L, en uso), `src/shared/prosaBancos/legalProse.ts` (97L, huérfano), `supabase/functions/process-expediente/legalProse.ts` (153L, en uso solo por esa edge) | `formato-texto-numero-notarial`, `convertir-numero-a-letras` | **Alta** | Consolidar en `src/shared/legalProse.ts` como fuente isomórfica única. |
| Concordancia de género | `src/lib/genero.ts`, `supabase/functions/_shared/genero.ts` | `concordancia-genero-minutas` | **Alta** | Consolidar en `src/shared/genero.ts`. |
| Clasificador de apoderado (natural/jurídico) | `src/lib/apoderadoClassifier.ts` (151L), `supabase/functions/_shared/apoderadoClassifier.ts` (166L, **divergente**) | `validar-poder-general-banco` | **Alta** | Consolidar; la divergencia de 15 líneas es riesgo real de comportamiento distinto entre preview y `.docx`. |
| Campos críticos cancelación (`cancelacionCriticalFields.ts`) | Solo cliente. La validación en edge (`procesar-cancelacion`) reimplementa reglas parecidas. | `direccion-completa-saneada-cancelacion`, `cuantia-indeterminada-cancelacion`, `limitaciones-concurrentes-cancelacion` | Media | Requiere revisión humana — auditar equivalencia. |
| Extracción de cuantía semántica | `procesar-cancelacion`, `process-expediente`, `scan-document/core/poderBanco` | `extraccion-cuantia-semantica`, `valor-credito-hipotecario-cancelacion` | Media | Requiere revisión humana. |
| Formato de direcciones (guion vs "GUION") | Reglas en `cancelacionCriticalFields.ts`, prompts de `scan-document`, `davivienda.ts` | `sanitizar-direccion`, `direccion-completa-saneada-cancelacion` | Media | Consolidar como util pura en `src/shared/`. |

---

## 6. Superficie de seguridad / multi-tenancy

### 6a. RLS por tabla (todas las tablas `public`)

**RLS habilitado en las 24 tablas del schema `public`.** Ninguna tabla sensible queda expuesta.

| Tabla | Políticas | Observación |
|---|---|---|
| `activity_logs` | 3 (SELECT admins, DELETE deny, UPDATE deny) | Correcto |
| `actos` | 2 (ALL, DELETE) | Redundancia: `ALL` ya incluye DELETE |
| `cancelaciones` | 3 (SELECT/INSERT/UPDATE own org). **Sin DELETE policy** | Datos de deudores y valores de crédito — **DELETE no permitido a nadie** salvo service_role: revisar si es intencional |
| `config_tramites` | 1 SELECT | OK |
| `configuracion_notaria` | 2 (SELECT, ALL admins) | OK |
| `credit_consumption` | 3 (SELECT admins/own, INSERT service_role) | Correcto — sin UPDATE/DELETE |
| `historial_validaciones` | 2 (SELECT own org, INSERT service_role) | OK |
| `inmuebles` | 2 (ALL, DELETE) | Redundancia |
| `invitations` | 2 (ALL admins, SELECT invitee) | OK |
| `logs_extraccion` | 1 (ALL own org) | Permite DELETE del cliente — revisar |
| `memberships` | 5 (SELECT own, SELECT admins, INSERT/UPDATE/DELETE admins) | Buen granularidad |
| `modules` | 1 SELECT | OK |
| `notaria_styles` | 2 (SELECT, ALL admins) | OK |
| `ocr_raw_cache` | 1 SELECT | Cache — no client writes |
| `organization_modules` | 1 SELECT | Escritura solo vía `admin_toggle_module` |
| `organizations` | 3 (SELECT members, INSERT authenticated, UPDATE owners) | **INSERT abierta a authenticated** — mitigado por `handle_new_user` pero explotable |
| `personas` | 2 (ALL, DELETE) | Datos personales (cédulas) — redundancia policy |
| `plantillas_validacion` | 1 SELECT | OK |
| `profiles` | 5 (SELECT own, SELECT org members, INSERT own, UPDATE own, UPDATE admins) | OK; trigger `prevent_profile_role_self_update` protege escalada |
| `radicado_counters` | **0 policies** con RLS ON | Tabla inaccesible desde cliente — solo `next_radicado()` SECURITY DEFINER. OK pero explícito |
| `reglas_validacion` | 1 SELECT | Solo service_role escribe |
| `system_events` | 4 (SELECT owners, INSERT service_role, UPDATE deny, DELETE deny) | Modelo append-only correcto |
| `tramites` | 4 (SELECT/INSERT/UPDATE org, DELETE own drafts) | OK |
| `user_active_context` | 4 (SELECT/INSERT/UPDATE/DELETE own) | OK |

### 6b. Políticas revisadas más de una vez (indicio de fix reactivo)

| Tabla | Migraciones que la tocan | Severidad | Recomendación |
|---|---|---|---|
| `tramites` | 4 migraciones (`20260305`, `20260310`, `20260417`, `20260617`) | Media | Requiere revisión humana — consolidar en una policy definitiva documentada |
| `cancelaciones` | 4 migraciones (`20260519`, `20260616`, `20260621` × 2) | **Alta** | Datos sensibles (deudores, valores) — auditar que el estado final sea el diseñado |
| `personas` | 3 migraciones (`20260305`, `20260310`, `20260617`) | Alta | Cédulas — misma auditoría |
| 15 migraciones tocando RLS entre 08/06 y 05/07 | — | Media | Indica ciclo de ajuste reactivo; documentar diseño final |

### 6c. Hallazgos puntuales

- **Alta:** `cancelaciones` sin política DELETE — confirmar si es política de retención o omisión.
- **Alta:** `organizations` INSERT abierto a `authenticated` — considerar restringir a la RPC `create_organization_for_user`.
- **Media:** `logs_extraccion` policy `ALL` permite DELETE al cliente — revisar.
- **Baja:** políticas duplicadas `ALL` + `DELETE` en `actos`, `inmuebles`, `personas` — limpieza cosmética.

---

## Resumen — 3 prioridades más urgentes

1. **Consolidar lógica isomórfica duplicada** (`genero`, `apoderadoClassifier`, `legalProse`) bajo `src/shared/`; la divergencia real en `apoderadoClassifier` puede causar preview ≠ `.docx`.
2. **Auditar `DocxDebugModal` y su gate**, y limpiar `.tmp-templates/`, `bun.lockb` duplicado, `*.tsbuildinfo`, `template_venta_hipoteca.docx` duplicado, `supabase/.temp/` del repo.
3. **Revisar RLS de `cancelaciones` y `personas`** — múltiples iteraciones reactivas sobre tablas con datos sensibles (deudores, cédulas, cuantías) requieren fijar y documentar el diseño final; confirmar decisión sobre DELETE en `cancelaciones` e INSERT abierto en `organizations`.
