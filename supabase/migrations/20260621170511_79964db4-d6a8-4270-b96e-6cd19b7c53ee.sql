ALTER TABLE public.cancelaciones
  ADD COLUMN IF NOT EXISTS escritura_antecedente_adjunta boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cancelaciones.escritura_antecedente_adjunta IS
  'Indica si el usuario cargó la escritura pública antecedente en el cliente, permitiendo el disparo del OCR dedicado de cuantía cuando el certificado viene indeterminado.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cancelaciones TO authenticated;
GRANT ALL ON public.cancelaciones TO service_role;