-- ============================================================================
-- ocr_raw_cache — Tabla técnica de auditoría e inmutabilidad del OCR.
-- Almacena el payload CRUDO devuelto por Gemini para cada PDF de Poder
-- General de Banco (extensible a otros doc_type). Permite reutilizar la
-- extracción sin re-cobrar tokens cuando el mismo PDF se sube en otro
-- trámite de la misma organización, SIN propagar correcciones humanas
-- (las ediciones viven en cancelaciones.data_final, no aquí).
--
-- Sellado RLS (plan v5 sección P):
--   - SELECT: solo miembros de la organización.
--   - INSERT/UPDATE/DELETE: SIN policy → anon y authenticated bloqueados.
--     service_role inserta por bypass nativo de RLS.
-- ============================================================================

CREATE TABLE public.ocr_raw_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  pdf_sha256 char(64) NOT NULL,
  raw_payload jsonb NOT NULL,
  gemini_model text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocr_raw_cache_unique_lookup
    UNIQUE (organization_id, doc_type, pdf_sha256, prompt_version, schema_version)
);

-- GRANTs mínimos. Sin INSERT/UPDATE/DELETE a authenticated.
GRANT SELECT ON public.ocr_raw_cache TO authenticated;
GRANT ALL    ON public.ocr_raw_cache TO service_role;

ALTER TABLE public.ocr_raw_cache ENABLE ROW LEVEL SECURITY;

-- Única policy: lectura por miembros de la organización.
CREATE POLICY "Members read their org cache"
  ON public.ocr_raw_cache
  FOR SELECT
  USING (public.is_org_member(organization_id));

-- Índices de lookup y TTL.
CREATE INDEX ocr_raw_cache_lookup_idx
  ON public.ocr_raw_cache (organization_id, doc_type, pdf_sha256, prompt_version, schema_version);
CREATE INDEX ocr_raw_cache_ttl_idx
  ON public.ocr_raw_cache (created_at);
