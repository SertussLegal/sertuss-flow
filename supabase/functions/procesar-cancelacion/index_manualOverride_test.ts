// Excepción "Manual > OCR > BD" generalizada a los 4 warnings
// `*_menciones_incoherentes`. Cada regla se suprime únicamente cuando el
// humano confirma Y el escalar relacionado tiene formato válido.
//
// Cubre 3 escenarios por warning:
//   A) Sin confirmación → bloqueado siempre.
//   B) Con confirmación + escalar válido → desbloqueado.
//   C) Con confirmación + escalar inválido → sigue bloqueado.
// Más 1 caso de composición (4 warnings simultáneos, todos corregidos).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectRequiereRevisionManual } from "./index.ts";

// deno-lint-ignore no-explicit-any
type Data = any;

function baseData(): Data {
  return {
    hipoteca_anterior: {},
    inmueble: { matricula_inmobiliaria: "50N-1234567", nomenclatura_predio: "CALLE 59 SUR - 84" },
    partes: {},
    analisis_legal: {},
    notaria_emisora: {},
    poder_banco: {
      apoderado_cedula: "55069433",
      apoderado_escritura: "16390",
      apoderado_fecha: "18/09/2025",
      apoderado: { cedula: "55069433" },
      instrumento_poder: { escritura_num: "16390", fecha: "18/09/2025" },
      poderdante: { representante_legal_cedula: "79382406" },
      _coherencia_warnings: [] as string[],
    },
  };
}

function withPoderWarning(d: Data, w: string): Data {
  d.poder_banco._coherencia_warnings = [w];
  return d;
}
function withInmWarning(d: Data, w: string): Data {
  d.inmueble._coherencia_warnings = [w];
  return d;
}

// ── RL banco ────────────────────────────────────────────────────────────

Deno.test("RL banco A: sin confirmación → bloqueado", () => {
  const d = withPoderWarning(baseData(), "rl_banco_menciones_incoherentes");
  const r = detectRequiereRevisionManual(d);
  assertEquals(r.requiere, true);
  assert(r.motivos.includes("rl_banco_menciones_incoherentes"));
});

Deno.test("RL banco B: confirmación + cédula válida → desbloqueado", () => {
  const d = withPoderWarning(baseData(), "rl_banco_menciones_incoherentes");
  d.poder_banco.poderdante.representante_legal_cedula = "79382406";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, false);
  assertEquals(r.motivos.length, 0);
});

Deno.test("RL banco C: confirmación + cédula inválida (letras) → sigue bloqueado", () => {
  const d = withPoderWarning(baseData(), "rl_banco_menciones_incoherentes");
  d.poder_banco.poderdante.representante_legal_cedula = "ABC-123";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
  assert(r.motivos.includes("rl_banco_menciones_incoherentes"));
});

Deno.test("RL banco C': confirmación + cédula vacía → sigue bloqueado", () => {
  const d = withPoderWarning(baseData(), "rl_banco_menciones_incoherentes");
  d.poder_banco.poderdante.representante_legal_cedula = "";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

// ── Apoderado cédula (Regla 6) ──────────────────────────────────────────

Deno.test("Apoderado cédula A: sin confirmación → bloqueado", () => {
  const d = withPoderWarning(baseData(), "apoderado_cedula_menciones_incoherentes");
  const r = detectRequiereRevisionManual(d);
  assertEquals(r.requiere, true);
  assert(r.motivos.includes("apoderado_cedula_menciones_incoherentes"));
});

Deno.test("Apoderado cédula B: confirmación + ambos escalares válidos → desbloqueado", () => {
  const d = withPoderWarning(baseData(), "apoderado_cedula_menciones_incoherentes");
  d.poder_banco.apoderado_cedula = "55069433";
  d.poder_banco.apoderado.cedula = "55069433";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, false);
});

Deno.test("Apoderado cédula C: confirmación + sólo escalar plano válido → sigue bloqueado", () => {
  const d = withPoderWarning(baseData(), "apoderado_cedula_menciones_incoherentes");
  d.poder_banco.apoderado_cedula = "55069433";
  d.poder_banco.apoderado.cedula = ""; // sólo uno válido → NO se suprime
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
  assert(r.motivos.includes("apoderado_cedula_menciones_incoherentes"));
});

Deno.test("Apoderado cédula C': confirmación + ambos inválidos → sigue bloqueado", () => {
  const d = withPoderWarning(baseData(), "apoderado_cedula_menciones_incoherentes");
  d.poder_banco.apoderado_cedula = "";
  d.poder_banco.apoderado.cedula = "";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

// ── Matrícula inmueble ──────────────────────────────────────────────────

Deno.test("Matrícula A: sin confirmación → bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_matricula_menciones_incoherentes");
  const r = detectRequiereRevisionManual(d);
  assertEquals(r.requiere, true);
  assert(r.motivos.includes("inmueble_matricula_menciones_incoherentes"));
});

Deno.test("Matrícula B: confirmación + formato canónico → desbloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_matricula_menciones_incoherentes");
  d.inmueble.matricula_inmobiliaria = "50N-1234567";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, false);
});

Deno.test("Matrícula C: confirmación + vacío → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_matricula_menciones_incoherentes");
  d.inmueble.matricula_inmobiliaria = "";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

Deno.test("Matrícula C': confirmación + NO_LEGIBLE → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_matricula_menciones_incoherentes");
  d.inmueble.matricula_inmobiliaria = "NO_LEGIBLE";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

Deno.test("Matrícula C'': confirmación + verbalizado sin patrón → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_matricula_menciones_incoherentes");
  d.inmueble.matricula_inmobiliaria = "CINCUENTA NORTE";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

// ── Dirección inmueble ──────────────────────────────────────────────────

Deno.test("Dirección A: sin confirmación → bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_direccion_menciones_incoherentes");
  const r = detectRequiereRevisionManual(d);
  assertEquals(r.requiere, true);
  assert(r.motivos.includes("inmueble_direccion_menciones_incoherentes"));
});

Deno.test("Dirección B: confirmación + string sustantivo → desbloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_direccion_menciones_incoherentes");
  d.inmueble.nomenclatura_predio = "CALLE 59 SUR - 84";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, false);
});

Deno.test("Dirección C: confirmación + vacío → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_direccion_menciones_incoherentes");
  d.inmueble.nomenclatura_predio = "";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

Deno.test("Dirección C': confirmación + NO_LEGIBLE → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_direccion_menciones_incoherentes");
  d.inmueble.nomenclatura_predio = "NO_LEGIBLE";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

Deno.test("Dirección C'': confirmación + solo underscores → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_direccion_menciones_incoherentes");
  d.inmueble.nomenclatura_predio = "________";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

Deno.test("Dirección C''': confirmación + string demasiado corto → sigue bloqueado", () => {
  const d = withInmWarning(baseData(), "inmueble_direccion_menciones_incoherentes");
  d.inmueble.nomenclatura_predio = "CL 5";
  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
});

// ── Composición ─────────────────────────────────────────────────────────

Deno.test("Composición: 4 warnings simultáneos + 4 escalares corregidos → desbloqueado", () => {
  const d = baseData();
  d.poder_banco._coherencia_warnings = [
    "rl_banco_menciones_incoherentes",
    "apoderado_cedula_menciones_incoherentes",
  ];
  d.inmueble._coherencia_warnings = [
    "inmueble_matricula_menciones_incoherentes",
    "inmueble_direccion_menciones_incoherentes",
  ];
  // Escalares ya válidos en baseData(); explicit por claridad:
  d.poder_banco.poderdante.representante_legal_cedula = "79382406";
  d.poder_banco.apoderado_cedula = "55069433";
  d.poder_banco.apoderado.cedula = "55069433";
  d.inmueble.matricula_inmobiliaria = "50N-1234567";
  d.inmueble.nomenclatura_predio = "CALLE 59 SUR - 84";

  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, false);
  assertEquals(r.motivos.length, 0);
});

Deno.test("Composición: 4 warnings + sólo 3 escalares válidos → sigue bloqueado por el 4º", () => {
  const d = baseData();
  d.poder_banco._coherencia_warnings = [
    "rl_banco_menciones_incoherentes",
    "apoderado_cedula_menciones_incoherentes",
  ];
  d.inmueble._coherencia_warnings = [
    "inmueble_matricula_menciones_incoherentes",
    "inmueble_direccion_menciones_incoherentes",
  ];
  d.inmueble.matricula_inmobiliaria = ""; // sólo éste queda inválido

  const r = detectRequiereRevisionManual(d, { manualReviewConfirmed: true });
  assertEquals(r.requiere, true);
  assertEquals(r.motivos, ["inmueble_matricula_menciones_incoherentes"]);
});
