/**
 * Script one-shot de re-validación regresiva para el rediseño semántico del
 * extractor dedicado de cuantía. NO es una edge function invocable — no
 * exporta handler, no se despliega, no consume créditos y no escribe en BD.
 *
 * Uso local (fuera del pipeline de deploy):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LOVABLE_API_KEY=... \
 *     deno run --allow-env --allow-net \
 *       supabase/functions/procesar-cancelacion/_regression_cuantia.ts \
 *       4b05d210-3549-4d91-93d0-78982b9f151c \
 *       290fd66a-c87c-4c3e-a344-e6bc47564966 \
 *       2bef1db3-b798-48f7-bba6-0ad42ecb0558
 *
 * Para cada ID:
 *   1) Lista páginas JPG en el prefijo del bucket usado por reprocess_cuantia.
 *   2) Genera URLs firmadas.
 *   3) Llama a extractCuantiaDedicada con el prompt nuevo.
 *   4) Imprime resultado (motivo_null, confianza, monto) y candidatos_vistos.
 *
 * Umbral de aceptación (verificación humana sobre la salida):
 *   - 4b05d210 → dígitos exactos $8.558.475 (regresión-cero).
 *   - Al menos uno de los otros dos → "exito" o motivo_null accionable.
 *   - Ninguno debe listar cifras ausentes del PDF.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractCuantiaDedicada } from "./index.ts";

const BUCKET_OUTPUT = "cancelaciones-plantillas";
const PREFIX_SUFIJO = "cancelaciones/soportes/escritura";

async function createSignedUrl(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  path: string,
  expiresIn = 60 * 30,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_OUTPUT)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`signedUrl failed for ${path}: ${error?.message ?? "no url"}`);
  }
  return data.signedUrl;
}

async function runOne(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  apiKey: string,
  cancelacionId: string,
) {
  console.log("\n" + "═".repeat(78));
  console.log(`Trámite: ${cancelacionId}`);
  console.log("═".repeat(78));

  const prefix = `${cancelacionId}/${PREFIX_SUFIJO}`;
  const { data: files, error } = await supabase.storage.from(BUCKET_OUTPUT).list(prefix);
  if (error || !files || files.length === 0) {
    console.log(`  ⚠ Sin páginas en ${prefix} (${error?.message ?? "empty"})`);
    return;
  }
  const paths = files
    .filter((f: { name?: string }) => f.name && /\.jpe?g$/i.test(f.name))
    .sort((a: { name?: string }, b: { name?: string }) =>
      (a.name ?? "").localeCompare(b.name ?? "")
    )
    .map((f: { name: string }) => `${prefix}/${f.name}`);

  if (paths.length === 0) {
    console.log(`  ⚠ Sin JPG en ${prefix}`);
    return;
  }
  console.log(`  ${paths.length} página(s) encontradas`);

  const urls = await Promise.all(paths.map((p: string) => createSignedUrl(supabase, p)));
  const t0 = Date.now();
  const run = await extractCuantiaDedicada(urls, apiKey);
  const ms = Date.now() - t0;

  console.log(`\n  ── Resultado (${ms} ms) ────────────────────────────────`);
  console.log(`  paginas_totales : ${run.paginas_totales}`);
  console.log(`  paginas_enviadas: ${run.paginas_enviadas}${run.truncado ? " (truncado head+tail)" : ""}`);
  if (run.error_status) {
    console.log(`  ERROR           : ${run.error_status} — ${run.error_msg ?? ""}`);
    return;
  }
  const r = run.result ?? {};
  console.log(`  monto           : ${r.valor_hipoteca_original ?? "null"}`);
  console.log(`  es_indeterminada: ${r.valor_hipoteca_es_indeterminada ?? "n/a"}`);
  console.log(`  confianza       : ${r.confianza ?? "n/a"}`);
  console.log(`  motivo_null     : ${r.motivo_null ?? "null"}`);

  const cand = r.candidatos_vistos ?? [];
  console.log(`\n  candidatos_vistos (${cand.length}):`);
  for (const c of cand) {
    const marker = c.clasificacion === "cuantia_credito" ? "◆" : " ";
    const montoStr = c.monto !== null && c.monto !== undefined
      ? "$" + c.monto.toLocaleString("es-CO")
      : "—";
    console.log(`    ${marker} [${c.clasificacion.padEnd(14)}] ${montoStr}`);
    console.log(`         "${(c.texto_fragmento ?? "").slice(0, 160)}"`);
  }
}

async function main() {
  const url = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!url || !srk || !key) {
    console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / LOVABLE_API_KEY");
    Deno.exit(1);
  }
  const ids = Deno.args.length > 0 ? Deno.args : [
    "4b05d210-3549-4d91-93d0-78982b9f151c",
    "290fd66a-c87c-4c3e-a344-e6bc47564966",
    "2bef1db3-b798-48f7-bba6-0ad42ecb0558",
  ];
  const supabase = createClient(url, srk);
  for (const id of ids) {
    try {
      await runOne(supabase, key, id);
    } catch (e) {
      console.error(`  ✖ Fallo inesperado para ${id}:`, (e as Error).message);
    }
  }
}

if (import.meta.main) await main();
