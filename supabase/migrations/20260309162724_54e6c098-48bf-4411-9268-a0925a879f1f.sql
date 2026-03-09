ALTER TABLE public.inmuebles ADD COLUMN IF NOT EXISTS es_propiedad_horizontal boolean DEFAULT false;
ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS apoderado_persona_municipio text DEFAULT '';