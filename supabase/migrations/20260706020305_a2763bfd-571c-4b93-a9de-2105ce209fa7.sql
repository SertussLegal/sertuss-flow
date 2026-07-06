ALTER TABLE public.cancelaciones
  ADD COLUMN IF NOT EXISTS prosa_apoderado_override JSONB;

COMMENT ON COLUMN public.cancelaciones.prosa_apoderado_override IS
  'Override editable del usuario para la prosa del Apoderado del Banco (Feature POWER_V5). Estructura validada por src/shared/prosaBancos/overrideSchema.ts. Prioridad: Manual > OCR > BD. Persiste solo a nivel de trámite — nunca altera plantillas canónicas.';