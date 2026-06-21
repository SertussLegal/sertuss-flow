ALTER TABLE public.cancelaciones
  ADD COLUMN poder_adjuntado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cancelaciones.poder_adjuntado IS 'Indica si el cliente cargó un archivo de Poder General en el frontend, independientemente del éxito de la extracción de la IA. Fuente de verdad: frontend al momento del upload.';

GRANT SELECT, UPDATE ON public.cancelaciones TO authenticated;
GRANT ALL ON public.cancelaciones TO service_role;