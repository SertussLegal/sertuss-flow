// ============================================================================
// poderBancoCache — Lookup + insert helper sobre `ocr_raw_cache`.
// Plan v5 sección B1: blinda el ciclo de vida del OCR del Poder con caché
// inmutable por (organization_id, doc_type, pdf_sha256).
//
// REGLAS DURAS:
// - La caché guarda el `raw_payload` PURO que devolvió el extractor IA.
//   Nunca se mezcla con ediciones humanas (eso vive en `data_final`).
// - Hit/Miss se reporta vía callback para que el caller emita
//   `system_events` con la categoría correcta (`POWER_CACHE_HIT|MISS`).
// - Si el flag `POWER_V5_ENABLED` está apagado, el caller NO debe llamar
//   este módulo — corre el extractor directo.
// ============================================================================

import {
  POWER_GEMINI_MODEL,
  POWER_PROMPT_VERSION,
  POWER_SCHEMA_VERSION,
} from "./poderBancoSchemaVersion.ts";
import { sha256OfOrderedBlobs } from "./pdfSha256.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface CacheLookupResult<T> {
  hit: boolean;
  payload: T | null;
  sha256: string;
}

export interface RunWithCacheOptions<T> {
  supabase: SupabaseClient;
  organizationId: string;
  /** Paths dentro del bucket (ordenados) que componen el PDF original. */
  bucket: string;
  paths: string[];
  /** Tipo de documento — distingue cachés (ej. "poder_banco_dedicado"). */
  docType: string;
  /** Extractor que se ejecuta SOLO si hay miss. Recibe los bytes ya leídos. */
  extractor: () => Promise<T | null>;
}

export interface RunWithCacheResult<T> {
  payload: T | null;
  cacheHit: boolean;
  sha256: string;
  /** "ok" | "miss_extracted" | "miss_no_payload" | "error_cache_skipped". */
  reason: string;
}

/**
 * Descarga los bytes de los archivos del bucket en el orden dado y devuelve
 * el SHA-256 estable (concatenación ordenada).
 */
async function computeSha(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<string | null> {
  const blobs: Uint8Array[] = [];
  for (const p of paths) {
    const { data, error } = await supabase.storage.from(bucket).download(p);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    blobs.push(buf);
  }
  if (blobs.length === 0) return null;
  return await sha256OfOrderedBlobs(blobs);
}

/**
 * Wrapper read-then-merge:
 *  1. Calcula SHA de los archivos.
 *  2. Busca en `ocr_raw_cache` por (org, docType, sha, schema_version, prompt_version).
 *  3. Hit  → devuelve `raw_payload` puro (inmutable).
 *  4. Miss → corre `extractor()` y guarda el resultado en caché.
 *
 * El caller decide qué hacer con el payload (típicamente: mergePoderBanco).
 * Si CUALQUIER paso de la caché falla, se cae con elegancia al modo legacy
 * (ejecuta el extractor sin caché). Nunca rompe el flujo principal.
 */
export async function runWithPoderCache<T>(
  opts: RunWithCacheOptions<T>,
): Promise<RunWithCacheResult<T>> {
  const { supabase, organizationId, bucket, paths, docType, extractor } = opts;

  let sha: string | null = null;
  try {
    sha = await computeSha(supabase, bucket, paths);
  } catch (_) {
    sha = null;
  }

  // Fallback total: sin SHA no hay caché. Corremos el extractor crudo.
  if (!sha) {
    const payload = await extractor();
    return {
      payload,
      cacheHit: false,
      sha256: "",
      reason: "error_cache_skipped",
    };
  }

  // ── LOOKUP ────────────────────────────────────────────────────────────
  try {
    const { data: hit } = await supabase
      .from("ocr_raw_cache")
      .select("raw_payload")
      .eq("organization_id", organizationId)
      .eq("doc_type", docType)
      .eq("pdf_sha256", sha)
      .eq("schema_version", POWER_SCHEMA_VERSION)
      .eq("prompt_version", POWER_PROMPT_VERSION)
      .maybeSingle();

    if (hit?.raw_payload) {
      return {
        payload: hit.raw_payload as T,
        cacheHit: true,
        sha256: sha,
        reason: "ok",
      };
    }
  } catch (_) {
    // lookup fallido → degradamos a extracción directa (sin escribir caché).
    const payload = await extractor();
    return {
      payload,
      cacheHit: false,
      sha256: sha,
      reason: "error_cache_skipped",
    };
  }

  // ── MISS: extraer + insertar ──────────────────────────────────────────
  const payload = await extractor();

  if (payload !== null && payload !== undefined) {
    try {
      await supabase.from("ocr_raw_cache").insert({
        organization_id: organizationId,
        doc_type: docType,
        pdf_sha256: sha,
        raw_payload: payload,
        gemini_model: POWER_GEMINI_MODEL,
        prompt_version: POWER_PROMPT_VERSION,
        schema_version: POWER_SCHEMA_VERSION,
      });
    } catch (_) {
      // Conflict (otra request ganó la carrera) o RLS rara — ignoramos.
    }
    return { payload, cacheHit: false, sha256: sha, reason: "miss_extracted" };
  }

  return { payload: null, cacheHit: false, sha256: sha, reason: "miss_no_payload" };
}
