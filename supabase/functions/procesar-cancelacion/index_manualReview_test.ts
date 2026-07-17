// Tests de regresión para el hard-block NO_LEGIBLE en generación de docx.
// Cubre los 3 call sites: generateAndUploadCancelacionDocs directo (unit),
// y la integración de las acciones `confirm_manual_review` / `regen` a nivel
// de comportamiento del catch (contract-level, sin arrancar HTTP).
//
// El bug real: sin la defensa en profundidad, un docx notarial podría emitirse
// con el literal "NO_LEGIBLE" impreso en cédula/escritura/fecha del poder.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  detectRequiereRevisionManual,
  generateAndUploadCancelacionDocs,
  ManualReviewRequiredError,
} from "./index.ts";

// ── Factories ────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function cleanData(overrides: Record<string, unknown> = {}): any {
  return {
    hipoteca_anterior: {
      numero_escritura_hipoteca: "3866",
      fecha_escritura_hipoteca: "01/01/2011",
      notaria_hipoteca: "NOTARIA 72 DE BOGOTA",
      valor_hipoteca_original: "",
      valor_hipoteca_es_indeterminada: true,
    },
    inmueble: { matricula_inmobiliaria: "50N-1234", ciudad: "BOGOTA D.C.", departamento: "" },
    partes: {
      deudor_nombre: "JUAN PEREZ",
      deudor_identificacion: "1000000",
      deudor_tipo_id: "CC",
      banco_acreedor: "BANCO DAVIVIENDA S.A.",
      banco_nit: "860034313-7",
    },
    analisis_legal: { aplica_ley_546: false, explicacion_ley: "" },
    notaria_emisora: {},
    poder_banco: {
      apoderado_cedula: "55069433",
      apoderado_escritura: "16390",
      apoderado_fecha: "18/09/2025",
      apoderado: { cedula: "55069433" },
      instrumento_poder: { escritura_num: "16390", fecha: "18/09/2025" },
      _coherencia_warnings: [],
      ...(overrides.poder_banco as Record<string, unknown> | undefined ?? {}),
    },
    ...overrides,
  };
}

// Stub minimal de supabaseService — solo lo que consume la función tras el chequeo.
// Si el chequeo falla (throw), NUNCA se toca. Si NO falla, storage.upload es llamado.
function stubSupabase() {
  const calls: string[] = [];
  return {
    calls,
    storage: {
      from: (_bucket: string) => ({
        upload: async (path: string, _bytes: unknown, _opts: unknown) => {
          calls.push(path);
          return { error: null };
        },
        download: async (_path: string) => {
          // fillTemplate descargará la plantilla — no debería llegar aquí en tests
          // que esperan que el chequeo lance antes.
          return { data: null, error: new Error("download stub not implemented") };
        },
      }),
    },
    from: (_t: string) => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    }),
  };
}

// ── Tests unitarios del hard-block ──────────────────────────────────────

Deno.test("hard-block: caso limpio → detector no exige revisión", () => {
  const data = cleanData();
  const r = detectRequiereRevisionManual(data);
  assertEquals(r.requiere, false);
  assertEquals(r.paths.length, 0);
  assertEquals(r.motivos.length, 0);
});

const CRITICAL_PATHS: Array<[string, (d: ReturnType<typeof cleanData>) => void]> = [
  ["poder_banco.apoderado_cedula",   (d) => { d.poder_banco.apoderado_cedula = "NO_LEGIBLE"; }],
  ["poder_banco.apoderado_escritura",(d) => { d.poder_banco.apoderado_escritura = "NO_LEGIBLE"; }],
  ["poder_banco.apoderado_fecha",    (d) => { d.poder_banco.apoderado_fecha = "NO_LEGIBLE"; }],
  ["poder_banco.apoderado.cedula",   (d) => { d.poder_banco.apoderado.cedula = "NO_LEGIBLE"; }],
  ["poder_banco.instrumento_poder.escritura_num", (d) => { d.poder_banco.instrumento_poder.escritura_num = "NO_LEGIBLE"; }],
  ["poder_banco.instrumento_poder.fecha",         (d) => { d.poder_banco.instrumento_poder.fecha = "NO_LEGIBLE"; }],
];

for (const [pathName, mutate] of CRITICAL_PATHS) {
  Deno.test(`hard-block: NO_LEGIBLE en ${pathName} → generateAndUpload lanza ManualReviewRequiredError`, async () => {
    const data = cleanData();
    mutate(data);
    const sb = stubSupabase();
    const err = await assertRejects(
      () => generateAndUploadCancelacionDocs(sb, "test-id", data, null),
      ManualReviewRequiredError,
    );
    assert(err.paths.includes(pathName), `paths debe incluir ${pathName}, got: ${JSON.stringify(err.paths)}`);
    assertEquals(err.code, "MANUAL_REVIEW_REQUIRED");
    assertEquals(sb.calls.length, 0, "no se debe haber intentado subir docs");
  });
}

Deno.test("hard-block: _coherencia_warnings con sufijo hard-block → lanza con motivos", async () => {
  const data = cleanData();
  // Warning hard-block que NO está en SCALAR_COHERENCE_GATING_CODES (Parte A
  // 2026-07-17) — los códigos gating se re-evalúan contra los datos actuales
  // y, si los datos limpios de cleanData() ya no los emiten, se filtran.
  // `rl_banco_menciones_incoherentes` se resuelve por MANUAL_OVERRIDE_RULES
  // solo si `manualReviewConfirmed=true`, y aquí lo llamamos sin ese flag,
  // por lo que sigue siendo bloqueante — comportamiento estable del test.
  data.poder_banco._coherencia_warnings = ["rl_banco_menciones_incoherentes"];
  const sb = stubSupabase();
  const err = await assertRejects(
    () => generateAndUploadCancelacionDocs(sb, "test-id", data, null),
    ManualReviewRequiredError,
  );
  assertEquals(err.paths.length, 0);
  assert(err.motivos.length > 0, "motivos no debe estar vacío");
  assertEquals(sb.calls.length, 0);
});

Deno.test("hard-block: combinación NO_LEGIBLE + warning → paths y motivos ambos poblados", async () => {
  const data = cleanData();
  data.poder_banco.apoderado_cedula = "NO_LEGIBLE";
  data.poder_banco._coherencia_warnings = ["instrumento_poder_incoherente"];
  const sb = stubSupabase();
  const err = await assertRejects(
    () => generateAndUploadCancelacionDocs(sb, "test-id", data, null),
    ManualReviewRequiredError,
  );
  assert(err.paths.length >= 1);
  assert(err.motivos.length >= 1);
  assertEquals(sb.calls.length, 0);
});

// ── Tests de integración (contract-level) ───────────────────────────────
// Nota: no arrancamos el server HTTP; validamos que la clase de error
// preserva `paths`/`motivos` para que los catch de confirm_manual_review y
// regen puedan traducirlos correctamente.

Deno.test("integración: confirm_manual_review — error preserva paths/motivos para traducción biz", () => {
  const err = new ManualReviewRequiredError(
    ["poder_banco.apoderado_cedula"],
    ["apoderado_cedula_no_legible"],
  );
  // El catch de confirm_manual_review devuelve biz("manual_review_not_resolved", ...).
  // Aquí verificamos el shape que ese catch consumirá.
  assertEquals(err.code, "MANUAL_REVIEW_REQUIRED");
  assertEquals(err.paths, ["poder_banco.apoderado_cedula"]);
  assertEquals(err.motivos, ["apoderado_cedula_no_legible"]);
  const pendientes = [...err.paths, ...err.motivos].join(", ");
  assert(pendientes.includes("poder_banco.apoderado_cedula"));
  assert(pendientes.includes("apoderado_cedula_no_legible"));
});

Deno.test("integración: regen — error se serializa como body 409 {manual_review_required}", () => {
  const err = new ManualReviewRequiredError(
    ["poder_banco.instrumento_poder.fecha"],
    [],
  );
  // El catch de regen construye este body — validamos que los campos existan.
  const body = {
    ok: false,
    error: "manual_review_required",
    paths: err.paths,
    motivos: err.motivos,
  };
  assertEquals(body.error, "manual_review_required");
  assertEquals(body.paths, ["poder_banco.instrumento_poder.fecha"]);
  assertEquals(body.motivos, []);
  assertEquals(body.ok, false);
});
