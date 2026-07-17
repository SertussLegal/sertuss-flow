// ============================================================================
// Test de cobertura permanente — cierra el hueco "warning nuevo con sufijo
// hard-block agregado sin excepción". Escanea los archivos fuente que
// emiten warnings de coherencia, extrae los códigos y valida que cada uno
// esté cubierto por el mecanismo correcto (MANUAL_OVERRIDE_RULES,
// SCALAR_COHERENCE_GATING_CODES, o lista explícita de irresolubles).
//
// NOTA — todos los códigos hard-block del sistema son literales estáticos
// (no template literals). Grep confirmado 2026-07-17: cero
// `warnings.push(\`${x}_...\`)` en isomorphic/. Si en el futuro se
// introduce un push dinámico, este test debe extenderse para reconocerlo
// (o el push debe convertirse a literal, opción preferida).
//
// NO_LEGIBLE como CENTINELA de campo (data.poder_banco.<campo>==="NO_LEGIBLE")
// vive en detectRequiereRevisionManual.paths y auto-resuelve por relectura
// del valor actual — NO es un warning en _coherencia_warnings. Los CÓDIGOS
// *_no_legible que sí viven en _coherencia_warnings (apoderado_cedula_no_legible,
// escritura_poder_no_legible, fecha_poder_no_legible) están en
// SCALAR_COHERENCE_GATING_CODES y se resuelven vía recálculo escalar.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HARD_BLOCK_WARNING_SUFFIXES,
  MANUAL_OVERRIDE_RULES,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/hardBlockRules";
import { SCALAR_COHERENCE_GATING_CODES } from "../../supabase/functions/_shared/isomorphic/scalarGatingRecompute";
import { WARNING_LABELS } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const ROOT = resolve(__dirname, "../..");
const SOURCES = [
  "supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts",
  "supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts",
  "supabase/functions/_shared/isomorphic/poderBancoExtractor/crossCheck.ts",
  "supabase/functions/_shared/isomorphic/certificadoInmuebleValidate.ts",
];

/** Códigos hard-block que hoy NO tienen mecanismo de auto-resolución tras
 *  edición humana. Cada entrada debe explicar por qué. Este catálogo hace
 *  visible la decisión en el diff — no es un vertedero. */
const KNOWN_UNRESOLVABLE_HARD_BLOCKS: Record<string, string> = {
  apoderado_nombre_duplicidad_cruzada:
    "crossCheck es cruce INTER-trámite (mismo apoderado en cancelaciones distintas de orgs distintas). Requiere acceso a supabaseService → no es puro, no se puede recalcular dentro del choke point sin expandir alcance.",
  apoderado_cedula_duplicidad_cruzada:
    "Mismo motivo que apoderado_nombre_duplicidad_cruzada — crossCheck inter-trámite.",
};

/** Extrae todos los códigos de warning emitidos por los archivos fuente.
 *  Enfoque: en lugar de intentar cazar el patrón de push (frágil — hay al
 *  menos 3 formas: literal directo, valor de campo `warning:`, y variable
 *  cargada desde tabla `[["codigo", ...]]`), extraemos TODOS los string
 *  literals cortos y filtramos por sufijo hard-block conocido o
 *  `_confianza_baja`. Sacrifica algo de precisión (podría incluir paths
 *  que terminen igual, aunque en este código base no ocurre) a cambio de
 *  cobertura total garantizada. */
function extractEmittedCodes(): Set<string> {
  const codes = new Set<string>();
  const literalRe = /"([a-z][a-z_]+)"/g;
  const eligibleSuffixes = [...HARD_BLOCK_WARNING_SUFFIXES, "_confianza_baja"];
  for (const rel of SOURCES) {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    let m: RegExpExecArray | null;
    while ((m = literalRe.exec(src)) !== null) {
      const s = m[1];
      if (eligibleSuffixes.some((suf) => s.endsWith(suf))) codes.add(s);
    }
  }
  return codes;
}

/** Sufijo hard-block al que pertenece el código, o null si es soft. */
function hardBlockSuffix(code: string): string | null {
  for (const suf of HARD_BLOCK_WARNING_SUFFIXES) {
    if (code.endsWith(suf)) return suf;
  }
  return null;
}

const EMITTED = extractEmittedCodes();
const OVERRIDE_WARNINGS = new Set(MANUAL_OVERRIDE_RULES.map((r) => r.warning));
const GATING = new Set<string>(SCALAR_COHERENCE_GATING_CODES);

describe("Cobertura permanente de warnings hard-block", () => {
  it("sanity — el escaneo debe capturar al menos los códigos conocidos", () => {
    expect(EMITTED.has("escritura_num_incoherente")).toBe(true);
    expect(EMITTED.has("rl_banco_menciones_incoherentes")).toBe(true);
    expect(EMITTED.has("apoderado_cedula_placeholder")).toBe(true);
    expect(EMITTED.has("poder_entidad_nit_incoherente")).toBe(true);
    expect(EMITTED.has("apoderado_cedula_no_legible")).toBe(true);
    expect(EMITTED.has("inmueble_direccion_menciones_incoherentes")).toBe(true);
  });

  // ── Aserción 1: cobertura _menciones_incoherentes → MANUAL_OVERRIDE_RULES
  it("Aserción 1 — todo `*_menciones_incoherentes` tiene entrada en MANUAL_OVERRIDE_RULES", () => {
    const menciones = [...EMITTED].filter((c) => c.endsWith("_menciones_incoherentes"));
    expect(menciones.length).toBeGreaterThan(0);
    for (const code of menciones) {
      expect(
        OVERRIDE_WARNINGS.has(code),
        `Warning "${code}" no tiene entrada en MANUAL_OVERRIDE_RULES — deja el trámite bloqueado para siempre tras la corrección humana. Ver skill validar-poder-general-banco sección 2 y hardBlockRules.ts.`,
      ).toBe(true);
    }
  });

  // ── Aserción 2: cobertura _incoherente / _no_legible → SCALAR_COHERENCE_GATING_CODES o MANUAL_OVERRIDE_RULES
  it("Aserción 2 — todo `_incoherente` (no menciones) y `_no_legible` está en SCALAR_COHERENCE_GATING_CODES o MANUAL_OVERRIDE_RULES", () => {
    const escalares = [...EMITTED].filter((c) => {
      if (c.endsWith("_menciones_incoherentes")) return false;
      return c.endsWith("_incoherente") || c.endsWith("_no_legible");
    });
    expect(escalares.length).toBeGreaterThan(0);
    for (const code of escalares) {
      const covered = GATING.has(code) || OVERRIDE_WARNINGS.has(code);
      expect(
        covered,
        `Warning "${code}" no está en SCALAR_COHERENCE_GATING_CODES ni en MANUAL_OVERRIDE_RULES — recálculo escalar o excepción manual requerida para evitar bloqueo permanente tras edición humana.`,
      ).toBe(true);
    }
  });

  // ── Aserción 3: cobertura WARNING_LABELS
  it("Aserción 3 — todo código emitido tiene entrada en WARNING_LABELS", () => {
    for (const code of EMITTED) {
      expect(
        code in WARNING_LABELS,
        `Warning "${code}" no tiene entrada en WARNING_LABELS — la UI no sabrá qué texto mostrar. Agrega la clave en validate.ts::WARNING_LABELS.`,
      ).toBe(true);
    }
  });

  // ── Aserción 4: _placeholder / _duplicidad_cruzada → MANUAL_OVERRIDE_RULES o registro explícito
  it("Aserción 4 — todo `_placeholder` y `_duplicidad_cruzada` está en MANUAL_OVERRIDE_RULES o documentado en KNOWN_UNRESOLVABLE_HARD_BLOCKS", () => {
    const especiales = [...EMITTED].filter(
      (c) => c.endsWith("_placeholder") || c.endsWith("_duplicidad_cruzada"),
    );
    expect(especiales.length).toBeGreaterThan(0);
    for (const code of especiales) {
      const covered =
        OVERRIDE_WARNINGS.has(code) || code in KNOWN_UNRESOLVABLE_HARD_BLOCKS;
      expect(
        covered,
        `Warning "${code}" no tiene mecanismo de resolución. Añade entrada en MANUAL_OVERRIDE_RULES o documéntalo explícitamente en KNOWN_UNRESOLVABLE_HARD_BLOCKS con la razón.`,
      ).toBe(true);
    }
  });

  // ── Sanidad cruzada: los códigos gating NO deben overlap con override rules
  it("no-overlap — SCALAR_COHERENCE_GATING_CODES y MANUAL_OVERRIDE_RULES son disjuntos", () => {
    for (const code of GATING) {
      expect(
        OVERRIDE_WARNINGS.has(code),
        `Warning "${code}" está en ambos catálogos — es ambiguo qué mecanismo lo resuelve. Elige uno.`,
      ).toBe(false);
    }
  });

  // ── Sanidad: todo código en los 2 catálogos activos es realmente emitido en el código fuente
  it("catálogos vivos — todo código en SCALAR_COHERENCE_GATING_CODES es emitido por algún validador", () => {
    for (const code of GATING) {
      expect(
        EMITTED.has(code),
        `Warning "${code}" está en SCALAR_COHERENCE_GATING_CODES pero ningún validador escaneado lo emite. Puede ser código muerto o el escaneo no cubre su archivo — revisar SOURCES en este test.`,
      ).toBe(true);
    }
  });

  it("catálogos vivos — todo código en MANUAL_OVERRIDE_RULES es emitido por algún validador", () => {
    for (const code of OVERRIDE_WARNINGS) {
      expect(
        EMITTED.has(code),
        `Warning "${code}" está en MANUAL_OVERRIDE_RULES pero ningún validador escaneado lo emite. Puede ser código muerto o el escaneo no cubre su archivo — revisar SOURCES en este test.`,
      ).toBe(true);
    }
  });

  // ── Verificación H4: no hay warnings dinámicos (template literals) en el
  //    conjunto escaneado. Si esto fallara, el regex de extracción se queda
  //    corto y la cobertura sería un falso positivo.
  it("H4 — cero `warnings.push(\\`${x}_...\\`)` dinámicos en fuentes escaneadas", () => {
    const dynamicRe = /warnings\.push\(\s*`[^`]*\$\{/;
    for (const rel of SOURCES) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      expect(
        dynamicRe.test(src),
        `${rel} contiene un warnings.push con template literal dinámico — el escaneo enumerable ya no es completo. Convierte a literal o extiende este test.`,
      ).toBe(false);
    }
  });
});
