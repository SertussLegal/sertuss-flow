
-- 1. Drop the unique constraint on notaria_styles.organization_id to allow 1:N
ALTER TABLE public.notaria_styles DROP CONSTRAINT IF EXISTS notaria_styles_organization_id_key;

-- Also check for unique index
DROP INDEX IF EXISTS notaria_styles_organization_id_key;

-- 2. Add geometry columns to notaria_styles
ALTER TABLE public.notaria_styles
  ADD COLUMN IF NOT EXISTS margin_top_mm integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS margin_bottom_mm integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS margin_left_mm integer NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS margin_right_mm integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS line_height_pt integer NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS lineas_por_pagina integer NOT NULL DEFAULT 30;

-- 3. Add redaction preference columns
ALTER TABLE public.notaria_styles
  ADD COLUMN IF NOT EXISTS precios_mayusculas boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS formato_fecha text NOT NULL DEFAULT 'notarial',
  ADD COLUMN IF NOT EXISTS linderos_formato text NOT NULL DEFAULT 'bloque';

-- 4. Add notaria_style_id FK to tramites
ALTER TABLE public.tramites
  ADD COLUMN IF NOT EXISTS notaria_style_id uuid REFERENCES public.notaria_styles(id);
