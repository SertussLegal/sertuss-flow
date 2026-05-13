-- Fase B: modelo real de identificación colombiano (CC, CE, NIT, PA, TI, PPT)
ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS tipo_identificacion text NOT NULL DEFAULT 'CC';

-- Backfill: personas jurídicas existentes son NIT
UPDATE public.personas
   SET tipo_identificacion = 'NIT'
 WHERE es_persona_juridica = true
   AND tipo_identificacion = 'CC';

-- Constraint suave: solo aceptar valores conocidos (los nuevos requieren cambio explícito)
ALTER TABLE public.personas
  DROP CONSTRAINT IF EXISTS personas_tipo_identificacion_chk;
ALTER TABLE public.personas
  ADD CONSTRAINT personas_tipo_identificacion_chk
  CHECK (tipo_identificacion IN ('CC','CE','NIT','PA','TI','PPT'));