// ============================================================================
// Fase 5 — Guardia de sincronización bucket ↔ contrato.
// Llama a `audit-refs-davivienda/hashes` con If-None-Match del etag compuesto
// del contrato. Espera 304 (cache-hit) o 200 con matching exacto de etags.
//
// Requiere env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Se salta con SKIP_BUCKET_SYNC_CHECK=1 (para PRs offline).
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import contract from "./referencia_davivienda.contract.json" with { type: "json" };

const SKIP = Deno.env.get("SKIP_BUCKET_SYNC_CHECK") === "1";
const URL_ = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.test({
  name: "sync: /hashes coincide con etags del contrato",
  ignore: SKIP || !URL_ || !KEY,
  async fn() {
    const t0 = performance.now();
    const composite = `${contract.sources.natural.etag}::${contract.sources.juridica.etag}`;
    const expectedEtag = `W/"${composite}"`;

    const res = await fetch(`${URL_}/functions/v1/audit-refs-davivienda/hashes`, {
      method: "GET",
      headers: {
        "x-service-key": KEY!,
        "if-none-match": expectedEtag,
      },
    });
    const dt = performance.now() - t0;

    if (res.status === 304) {
      await res.body?.cancel();
      console.log(`[sync] 304 Not Modified (${dt.toFixed(0)}ms) — bucket sincronizado.`);
      assert(dt < 2000, `Latencia excesiva: ${dt.toFixed(0)}ms`);
      return;
    }

    assertEquals(res.status, 200, `Esperado 200 o 304, recibido ${res.status}`);
    const body = await res.json();
    assertEquals(
      body.natural?.etag,
      contract.sources.natural.etag,
      `Etag NATURAL desincronizado: contrato=${contract.sources.natural.etag} bucket=${body.natural?.etag}. Correr regeneración manual del contrato.`,
    );
    assertEquals(
      body.juridica?.etag,
      contract.sources.juridica.etag,
      `Etag JURIDICA desincronizado: contrato=${contract.sources.juridica.etag} bucket=${body.juridica?.etag}. Correr regeneración manual del contrato.`,
    );
  },
});
