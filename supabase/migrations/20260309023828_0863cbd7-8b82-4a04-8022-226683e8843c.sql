
ALTER TABLE personas ADD COLUMN IF NOT EXISTS municipio_domicilio text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS actua_mediante_apoderado boolean DEFAULT false;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS apoderado_persona_nombre text DEFAULT '';
ALTER TABLE personas ADD COLUMN IF NOT EXISTS apoderado_persona_cedula text DEFAULT '';
ALTER TABLE inmuebles ADD COLUMN IF NOT EXISTS avaluo_catastral text DEFAULT '';
ALTER TABLE inmuebles ADD COLUMN IF NOT EXISTS escritura_ph text DEFAULT '';
ALTER TABLE inmuebles ADD COLUMN IF NOT EXISTS reformas_ph text DEFAULT '';
