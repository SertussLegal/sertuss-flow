ALTER TABLE public.cancelaciones
  ADD COLUMN IF NOT EXISTS revision_manual_requerida boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revision_manual_confirmada_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS revision_manual_confirmada_por uuid REFERENCES auth.users(id);

ALTER TABLE public.cancelaciones
  DROP CONSTRAINT IF EXISTS cancelaciones_status_check;
ALTER TABLE public.cancelaciones
  ADD CONSTRAINT cancelaciones_status_check
  CHECK (status IN ('draft','processing','completed','error','requiere_revision_manual'));

CREATE INDEX IF NOT EXISTS cancelaciones_pend_revision_idx
  ON public.cancelaciones (organization_id, updated_at DESC)
  WHERE status = 'requiere_revision_manual';