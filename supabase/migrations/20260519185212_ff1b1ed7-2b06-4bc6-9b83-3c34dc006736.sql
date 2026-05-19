
ALTER TABLE public.cancelaciones
  ADD COLUMN IF NOT EXISTS data_ia jsonb,
  ADD COLUMN IF NOT EXISTS data_final jsonb,
  ADD COLUMN IF NOT EXISTS numero_escritura_hipoteca text,
  ADD COLUMN IF NOT EXISTS fecha_escritura_hipoteca text,
  ADD COLUMN IF NOT EXISTS notaria_hipoteca text,
  ADD COLUMN IF NOT EXISTS direccion_inmueble text,
  ADD COLUMN IF NOT EXISTS ciudad_inmueble text,
  ADD COLUMN IF NOT EXISTS deudor_tipo_id text,
  ADD COLUMN IF NOT EXISTS banco_acreedor text DEFAULT 'BANCO DAVIVIENDA S.A.',
  ADD COLUMN IF NOT EXISTS banco_nit text DEFAULT '860.034.313-7',
  ADD COLUMN IF NOT EXISTS explicacion_ley text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS valor_hipoteca_original text;
