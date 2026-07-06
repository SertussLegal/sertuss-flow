# Fase 1 · Validacion.tsx — diseño detallado (solo revisión, sin aplicar)

Objetivo: retirar quirúrgicamente las 2 llamadas en vivo a `validar-con-claude` y toda la UI derivada, reemplazándolas por un resumen determinista "top 3 a revisar" pre-preview. Cambios sólo en frontend; el edge function no se toca.

---

## 0. Hallazgos que exceden el plan previo (leer primero)

Al releer Validacion.tsx encontré 2 dependencias de Claude que el plan `Fase 1` original **no listó explícitamente** y que hay que resolver antes de borrar:

**H1 · `notariaSuggestions` (líneas 2577–2607 + banner 2790–2815 + botón "Aplicar todas")**
Feature real de usuario: lee `validacionCampos.validaciones` filtrando por `auto_corregible === true` + `valor_sugerido` + campo `notaria.*`, y ofrece autollenar campos de Notaría desde datos detectados por Claude en los OCR. **Si se retira Claude en Fase 1, esta feature muere silenciosamente.** Recomendación: retirarla explícitamente en el mismo commit (el usuario todavía puede llenar los campos a mano; el panel "Datos de la Notaría" sigue funcional). Reintroducible en Fase 4 si se decide, alimentado por un extractor determinista de notaría desde los certificados.

**H2 · `inlineBadgeMap` se propaga como prop `inlineBadges` a 3 forms hijos**
`PersonaForm`, `InmuebleForm`, `ActosForm` reciben `inlineBadges={inlineBadgeMap}` (líneas 3046, 3049, 3062, 3066). En Fase 1 les pasaremos `EMPTY_INLINE_BADGES = new Map()` (constante módulo-level, no un `new Map()` inline para no romper memoización). Los forms ya toleran un Map vacío (usan `.get()` que devuelve `undefined`). No requieren cambios internos.

**H3 · La premisa "las 35 reglas activas ya generadas"**
Tu prompt asume que ya existe un motor determinista en frontend que evalúa las 35 reglas de `reglas_validacion` y produce un `Validacion[]`. **No existe** — hoy sólo el edge `validar-con-claude` lee esa tabla. Opciones:

- **A (recomendada, alineada con el plan original)**: en Fase 1 implementamos `computeTopIssues` como helper puro TS con un **subset alto-ROI de 7 reglas** (las mismas del plan previo). No consulta BD, no hace red. Cubre los casos que en producción disparaban la mayoría de los hallazgos de Claude.
- **B**: crear un evaluador cliente que lea `reglas_validacion` de BD y aplique cada regla determinística. Es Fase 5+ realista (motor de reglas serializable + expresiones seguras). No cabe en Fase 1.

Este plan asume **opción A**. Si prefieres B, detente y coordinamos otro diseño.

---

## 1. Diff exacto — `src/pages/Validacion.tsx`

### 1.1 Imports (línea 19–20)

```diff
- import { validarConClaude, tieneErroresCriticos, contarPorNivel, obtenerBloqueantes, obtenerSidePanel, obtenerInlineBadges, type Validacion as ClaudeValidacion } from "@/services/validacionClaude";
- import { InlineBadgeDot } from "@/components/tramites/InlineBadgeDot";
+ import type { Validacion as ClaudeValidacion } from "@/services/validacionClaude";
+ import { computeTopIssues, type DeterministicIssue } from "@/lib/computeTopIssues";
```

Se conserva el import de tipo `Validacion` porque `PersonaForm/InmuebleForm/ActosForm` lo consumen en su prop `inlineBadges: Map<string, Validacion>`. Se elimina `InlineBadgeDot` porque todos sus usos desaparecen con Claude.

### 1.2 State (líneas 281–284)

```diff
- const [validacionDialogOpen, setValidacionDialogOpen] = useState(false);
- const [validacionResultado, setValidacionResultado] = useState<Awaited<ReturnType<typeof validarConClaude>> | null>(null);
- const [validacionCampos, setValidacionCampos] = useState<Awaited<ReturnType<typeof validarConClaude>> | null>(null);
- const [validandoCampos, setValidandoCampos] = useState(false);
+ const [topIssues, setTopIssues] = useState<DeterministicIssue[]>([]);
```

Se conserva `const [validando, setValidando] = useState(false);` (spinner del botón Generar; nada que ver con Claude).

### 1.3 Constante módulo-level (arriba, junto a otras consts)

```diff
+ const EMPTY_INLINE_BADGES: ReadonlyMap<string, ClaudeValidacion> = new Map();
```

### 1.4 `inlineBadgeMap` memo (líneas 873–898) → **eliminar bloque completo**

Reemplazar por nada (los consumidores usan `EMPTY_INLINE_BADGES`).

### 1.5 `validarDespuesDeCarga` (líneas 1345–1380) → **eliminar función completa**

Es la primera llamada en vivo a Claude (tras cada OCR).

### 1.6 Llamada en `handleSidebarUpload` (línea 1499)

```diff
-        // Disparar validación Claude en background (Momento 1: campos)
-        const tabOrigen: "vendedores" | "compradores" | "inmueble" | "actos" =
-          scanType === "certificado_tradicion" || scanType === "predial" ? "inmueble"
-          : tipo === "carta_credito" || tipo === "poder_notarial" ? "actos"
-          : scanType === "escritura_antecedente" ? "vendedores"
-          : tipo.startsWith("cedula_") ? "vendedores"
-          : "vendedores";
-        const tipoDocMapped: ... = ...;
-        validarDespuesDeCarga(tipoDocMapped, d, tabOrigen);
+        // (Retirado en Fase 1: auditor Claude en vivo. El "top-3" determinista se
+        // calcula al pulsar "Generar y Analizar Word".)
```

Y en el `useCallback` deps (línea 1514) quitar `validarDespuesDeCarga`.

### 1.7 `handlePrevisualizar` (líneas 1907–2005) — segunda llamada en vivo

Reemplazar el bloque `try { ... await validarConClaude(...) ... }` por:

```diff
   setValidando(true);
   try {
-    const datosExtraidos = { ... vendedores/compradores/inmueble/actos ... };
-    const validacionesApp: string[] = [...];
-    const resultado = await validarConClaude({ modo: "documento", ... });
-    if (resultado.estado === "error_sistema") { setPreviewOpen(true); return; }
-    if (resultado.estado === "aprobado" && !tieneErroresCriticos(resultado)) { setPreviewOpen(true); return; }
-    if (tieneErroresCriticos(resultado)) { setValidacionResultado(resultado); setValidacionDialogOpen(true); return; }
-    const conteo = contarPorNivel(resultado);
-    sonnerToast.info(`Validación: ${resultado.puntuacion ?? "—"}/100 — ...`, { ... });
-    setPreviewOpen(true);
-  } catch (err) {
-    console.error("Error en validación pre-preview:", err);
-    setPreviewOpen(true);
+    const issues = computeTopIssues({
+      tipoActo: actos.tipo_acto || "compraventa",
+      vendedores, compradores, inmueble, actos, notariaTramite,
+    });
+    setTopIssues(issues);
+    setPreviewOpen(true);
+  } catch (err) {
+    console.error("Error calculando top-issues:", err);
+    setTopIssues([]);
+    setPreviewOpen(true);
   } finally {
     setValidando(false);
   }
```

### 1.8 Bloque `renderTabs` — limpieza (líneas 2501–2607, 2782–2795, 2955–2963)

- **2501–2530** `getTabSeverity` y `hasTabInlineBadges` → eliminar ambas.
- **2532–2556** `renderTabIcon` → reducir a `const renderTabIcon = (_tabKey: string) => null;` (mantener nombre para no tocar los 4 `TabsTrigger` de la línea 2974–2977).
- **2558–2607** `conteo`, `totalHallazgos`, `notariaSuggestions`, `applyNotariaSuggestion`, `ignoreNotariaSuggestion`, `applyAllNotariaSuggestions` → **eliminar todo el bloque** (H1). También el import de `ignoredNotariaSuggestions`/setter en el useState correspondiente (buscar cerca de línea 280).
- **2782–2795** en el header del panel "Datos de la Notaría": eliminar el IIFE del `InlineBadgeDot` (líneas 2781–2786) y el `Badge` de "N sugerencias de IA" (2790–2794).
- **2804–2815** eliminar el bloque completo del banner "El asistente IA detectó…" + botón "Aplicar todas".
- **2957–2963** eliminar el IIFE del `InlineBadgeDot` en la etiqueta de cada campo notaría (dejar sólo `{NOTARIA_LABELS[key]}`).

### 1.9 Panel lateral post-carga (líneas 2980–3043) → **eliminar bloque completo**

Es el "Validando coherencia…" + el resumen expandible con `sidePanelItems`. Sustituido conceptualmente por el nuevo banner top-3 (§1.10).

### 1.10 Nuevo banner top-3 (insertar donde estaba §1.9, línea ~2980)

```tsx
{topIssues.length > 0 && (
  <Card className="mb-4 border-border/60 bg-muted/30">
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Info className="h-3.5 w-3.5 text-primary" />
        Top {topIssues.length} a revisar antes de generar
      </div>
      <ul className="space-y-1">
        {topIssues.map((it) => {
          const Icon = it.nivel === "error" ? AlertCircle
                     : it.nivel === "advertencia" ? AlertTriangle : Info;
          const cls = it.nivel === "error" ? "text-destructive"
                    : it.nivel === "advertencia" ? "text-accent" : "text-primary";
          return (
            <li key={it.codigo_regla + it.campo} className="flex items-start gap-2 text-xs">
              <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cls}`} />
              <span>
                <span className="font-medium text-foreground">{it.campo}</span>
                <span className="text-muted-foreground"> · {it.explicacion}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  </Card>
)}
```

Comportamiento con 0 issues: no se renderiza (todo OK). Con 1–2: se renderiza con ese conteo real. Con ≥3: sólo los 3 primeros (el helper trunca).

### 1.11 Props a los forms hijos (líneas 3046, 3049, 3062, 3066)

```diff
- inlineBadges={inlineBadgeMap}
+ inlineBadges={EMPTY_INLINE_BADGES as Map<string, ClaudeValidacion>}
```

### 1.12 AlertDialog Claude (líneas 3510–3612) → **eliminar bloque completo**

---

## 2. Nuevo archivo — `src/lib/computeTopIssues.ts` (contenido completo)

```ts
/**
 * Fase 1 (2026-07): reemplaza al auditor Claude en vivo.
 * Helper determinista puro: sin red, sin IA, sin BD.
 * Evalúa un subset alto-ROI de reglas y devuelve los N hallazgos más importantes
 * priorizados por severidad (error > advertencia > sugerencia).
 *
 * Reglas cubiertas en esta fase (7):
 *   R1 personas_sin_cedula                → error
 *   R2 sin_vendedores_o_compradores       → error
 *   R3 inmueble_sin_matricula             → error
 *   R4 cuantia_faltante                   → error (compraventa, hipoteca)
 *   R5 chip_o_catastro_faltante           → advertencia
 *   R6 lugar_expedicion_faltante          → advertencia
 *   R7 notaria_tramite_incompleta         → error
 */

export type Nivel = "error" | "advertencia" | "sugerencia";

export interface DeterministicIssue {
  nivel: Nivel;
  campo: string;         // etiqueta legible (no técnica)
  explicacion: string;
  codigo_regla: string;
}

export interface ComputeInput {
  tipoActo: string;
  vendedores: any[];
  compradores: any[];
  inmueble: any;
  actos: any;
  notariaTramite?: any;
}

const SEV: Record<Nivel, number> = { error: 0, advertencia: 1, sugerencia: 2 };

const isBogota = (municipio?: string) =>
  !!municipio && /bogot[aá]/i.test(municipio);

const slotOcupado = (p: any) =>
  !!(p?.nombre_completo || p?.numero_cedula || p?.razon_social || p?.nit);

export function computeTopIssues(input: ComputeInput, max = 3): DeterministicIssue[] {
  const out: DeterministicIssue[] = [];
  const { tipoActo, vendedores, compradores, inmueble, actos, notariaTramite } = input;

  // R2 — al menos un vendedor y un comprador
  const vendReales = (vendedores || []).filter(slotOcupado);
  const compReales = (compradores || []).filter(slotOcupado);
  if (vendReales.length === 0)
    out.push({ nivel: "error", campo: "Vendedores", codigo_regla: "R2_sin_vendedores",
      explicacion: "No hay vendedores registrados." });
  if (compReales.length === 0)
    out.push({ nivel: "error", campo: "Compradores", codigo_regla: "R2_sin_compradores",
      explicacion: "No hay compradores registrados." });

  // R1 — cada persona ocupada debe tener cédula (o NIT si es PJ)
  const check = (label: string, list: any[]) =>
    list.forEach((p, i) => {
      if (!slotOcupado(p)) return;
      const id = p.es_persona_juridica ? p.nit : p.numero_cedula;
      if (!id || !String(id).trim())
        out.push({
          nivel: "error",
          campo: `${label} ${i + 1}${p.nombre_completo ? ` (${p.nombre_completo})` : ""}`,
          codigo_regla: "R1_persona_sin_id",
          explicacion: p.es_persona_juridica
            ? "Falta NIT de la persona jurídica."
            : "Falta número de cédula.",
        });
    });
  check("Vendedor", vendedores || []);
  check("Comprador", compradores || []);

  // R3 — inmueble sin matrícula
  if (!inmueble?.matricula_inmobiliaria || !String(inmueble.matricula_inmobiliaria).trim())
    out.push({ nivel: "error", campo: "Inmueble", codigo_regla: "R3_sin_matricula",
      explicacion: "Falta matrícula inmobiliaria." });

  // R4 — cuantía
  const requiereCuantia = /compraventa|hipoteca/i.test(tipoActo || "");
  if (requiereCuantia) {
    const cv = Number(actos?.valor_compraventa || 0);
    if (/compraventa/i.test(tipoActo) && (!cv || cv <= 0))
      out.push({ nivel: "error", campo: "Actos · Valor de compraventa",
        codigo_regla: "R4_cuantia_compraventa",
        explicacion: "El valor de la compraventa está vacío o en cero." });
    if (actos?.es_hipoteca || /hipoteca/i.test(tipoActo)) {
      const vh = Number(actos?.valor_hipoteca || 0);
      if (!vh || vh <= 0)
        out.push({ nivel: "error", campo: "Actos · Valor de hipoteca",
          codigo_regla: "R4_cuantia_hipoteca",
          explicacion: "El valor de la hipoteca está vacío o en cero." });
    }
  }

  // R5 — CHIP en Bogotá / catastral fuera de Bogotá
  const idPredial = String(inmueble?.identificador_predial || "").trim();
  if (!idPredial) {
    if (isBogota(inmueble?.municipio))
      out.push({ nivel: "advertencia", campo: "Inmueble · CHIP",
        codigo_regla: "R5_chip_faltante",
        explicacion: "En Bogotá el CHIP es obligatorio; está vacío." });
    else
      out.push({ nivel: "advertencia", campo: "Inmueble · Cédula catastral",
        codigo_regla: "R5_catastral_faltante",
        explicacion: "Falta cédula catastral del inmueble." });
  }

  // R6 — lugar de expedición
  const sinLugar = [...(vendedores || []), ...(compradores || [])]
    .filter(slotOcupado)
    .filter((p) => !p.es_persona_juridica && !String(p.lugar_expedicion || "").trim());
  if (sinLugar.length > 0)
    out.push({ nivel: "advertencia", campo: "Personas · Lugar de expedición",
      codigo_regla: "R6_lugar_expedicion",
      explicacion: `Falta lugar de expedición en ${sinLugar.length} persona(s).` });

  // R7 — notaría del trámite
  if (notariaTramite) {
    const faltan: string[] = [];
    if (!String(notariaTramite.numero_notaria || "").trim()) faltan.push("número");
    if (!String(notariaTramite.circulo || "").trim()) faltan.push("círculo");
    if (!String(notariaTramite.nombre_notario || "").trim()) faltan.push("notario");
    if (faltan.length)
      out.push({ nivel: "error", campo: "Datos de la notaría",
        codigo_regla: "R7_notaria_incompleta",
        explicacion: `Falta ${faltan.join(", ")} en los datos de la notaría del trámite.` });
  }

  return out
    .sort((a, b) => SEV[a.nivel] - SEV[b.nivel])
    .slice(0, max);
}
```

Tests unitarios: nuevo archivo `src/lib/computeTopIssues.test.ts` con 1 caso por regla + 1 caso "sin issues" + 1 caso "trunca a 3 con overflow".

---

## 3. `src/services/validacionClaude.ts` — recomendación

**Recomendación: dejarlo como stub deprecated en Fase 1, no borrarlo.**

Razones:
- `PersonaForm`, `InmuebleForm`, `ActosForm` importan **el tipo** `Validacion` para su prop `inlineBadges`. Borrar el archivo obliga a tocar 3 forms en el mismo commit — más superficie de riesgo para una fase cuyo objetivo es "cambio quirúrgico".
- El tipo se sigue usando aunque la implementación desaparezca (contrato UI-agnóstico para la Fase 3 futura si se decide reintroducir badges deterministas).
- Costo del stub: ~15 líneas, cero llamadas de red.

Contenido propuesto (idéntico al del plan previo, §1.4): dejar sólo `export interface Validacion { ... }` y borrar todas las funciones (`validarConClaude`, `contarPorNivel`, `obtenerBloqueantes`, `obtenerSidePanel`, `obtenerInlineBadges`, `tieneErroresCriticos`, `obtenerAutoCorregibles`, `obtenerValidacionesCampo`). Header con `@deprecated` + fecha + puntero a Fase 2/3.

Borrado real en Fase 5 (junto con reintroducción — o no — de un motor determinista de badges y refactor de los 3 forms para no depender del tipo).

---

## 4. Confirmación de dependencias externas (evidencia, no suposición)

`rg` sobre `src` excluyendo `Validacion.tsx` y `validacionClaude.ts`:

```
src/components/tramites/PersonaForm.tsx:34:  import type { Validacion } from "@/services/validacionClaude";
src/components/tramites/InmuebleForm.tsx:18: import type { Validacion } from "@/services/validacionClaude";
src/components/tramites/ActosForm.tsx:11:    import type { Validacion } from "@/services/validacionClaude";
```

- ✅ **Sólo imports de tipo**. Ningún componente lee `validacionResultado`/`validacionCampos` fuera de Validacion.tsx.
- ✅ Los 3 forms consumen `inlineBadges: Map<string, Validacion>` → seguros con `EMPTY_INLINE_BADGES` (Map vacío).
- ⚠️ **H1 (§0)**: `notariaSuggestions` está **dentro** de Validacion.tsx pero el plan previo no lo mencionó — es dependencia interna, se retira en el mismo commit.
- ✅ `creditsBus.ts` mantiene `"validar-con-claude"` como `CreditAction`. No se toca (el edge sigue desplegado; el botón de Admin lo usa).
- ✅ Ningún hook/contexto/localStorage persiste resultado de Claude.

**Veredicto**: seguro proceder con el borrado descrito, siempre que aceptemos retirar `notariaSuggestions` en el mismo commit.

---

## 5. Plan de verificación

### Automatizado (obligatorio antes de merge)

- `bunx vitest run src/lib/computeTopIssues.test.ts` — ≥9 casos (7 reglas + sin-issues + overflow).
- `bunx vitest run` — suite completa en verde (baseline 84/84).
- `tsgo` — sin errores de tipo. Detecta imports rotos si algún consumidor externo no visto lee el estado eliminado.

### Manual (checklist en preview)

1. **Trámite nuevo compraventa vacío** → click "Generar y Analizar Word" → banner top-3 muestra: `Vendedores · sin registro`, `Compradores · sin registro`, `Inmueble · falta matrícula`. No aparece AlertDialog Claude. No spinner "Validando coherencia…".
2. **Carga cédula vendedor** → NO aparece spinner ni panel lateral Claude. Sidebar dice "Documento procesado". Consola limpia. Network tab: cero llamadas a `/functions/v1/validar-con-claude`.
3. **Trámite completo con todo llenado correctamente** → click "Generar" → NO se renderiza el banner (topIssues vacío). Abre PreviewModal directamente.
4. **Bogotá sin CHIP** (identificador_predial vacío + municipio = "Bogotá") → banner incluye advertencia CHIP.
5. **Persona con nombre pero sin cédula** → banner muestra error `Vendedor 1 (Juan Pérez) · Falta número de cédula`.
6. **Notaría del trámite incompleta** (dejar `numero_notaria` vacío) → banner incluye error R7 con lista `número, círculo, notario`.
7. **Regresión Cancelaciones** — abrir `/cancelaciones/nueva`, cargar poder, generar. Sin cambios (Claude nunca tocó ese flujo).
8. **Admin → botón "Test Claude"** sigue funcional (Fase 2 lo retira).
9. **Consola** — cero warnings/errores nuevos que mencionen `validacionClaude`, `validacionCampos`, `validacionResultado`.
10. **Tabs superiores** (Vendedores/Compradores/Inmueble/Actos) — sin dots inline, sin iconos de severidad. Solo el texto de la pestaña.

---

## Resumen

- **1 archivo nuevo**: `src/lib/computeTopIssues.ts` (+ test).
- **2 archivos editados**: `src/pages/Validacion.tsx` (retiro Claude + banner top-3 + retiro `notariaSuggestions`), `src/services/validacionClaude.ts` (reducido a stub del tipo).
- **0 edge functions tocadas**. Cero redeploy.
- **0 tablas tocadas** (Fase 1 SQL ya está aplicada).
- **Reversible** con revert del commit.

**Punto de atención principal**: `notariaSuggestions` (H1). Confirma explícitamente que aceptas retirarla en el mismo commit; si prefieres preservarla con otra fuente (extractor determinista de notaría desde certificados), es un mini-scope adicional que hay que decidir antes de que yo escriba una sola línea.

Espero tu aprobación línea por línea (o rechazo/ajustes) antes de pasar a build mode.
