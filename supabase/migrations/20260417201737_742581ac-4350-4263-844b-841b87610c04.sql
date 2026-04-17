-- 1. Tabla contador
CREATE TABLE IF NOT EXISTS public.radicado_counters (
  organization_id uuid NOT NULL,
  year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);
ALTER TABLE public.radicado_counters ENABLE ROW LEVEL SECURITY;
-- Sin policies: acceso solo vía SECURITY DEFINER function

-- 2. Función generadora atómica
CREATE OR REPLACE FUNCTION public.next_radicado(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year int := EXTRACT(YEAR FROM now())::int;
  next_num int;
BEGIN
  INSERT INTO public.radicado_counters (organization_id, year, last_number)
  VALUES (p_org_id, current_year, 1)
  ON CONFLICT (organization_id, year)
  DO UPDATE SET last_number = public.radicado_counters.last_number + 1
  RETURNING last_number INTO next_num;
  RETURN current_year::text || '-' || LPAD(next_num::text, 4, '0');
END;
$$;

-- 3. Trigger BEFORE INSERT en tramites
CREATE OR REPLACE FUNCTION public.assign_radicado_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.radicado IS NULL OR TRIM(NEW.radicado) = '' THEN
    NEW.radicado := public.next_radicado(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_radicado ON public.tramites;
CREATE TRIGGER trg_assign_radicado
BEFORE INSERT ON public.tramites
FOR EACH ROW
EXECUTE FUNCTION public.assign_radicado_on_insert();

-- 4. Backfill de trámites existentes sin radicado
DO $$
DECLARE
  rec RECORD;
  yr int;
  num int;
BEGIN
  -- Inicializar contadores con el máximo existente por org+año (parseando radicados ya con formato YYYY-NNNN)
  INSERT INTO public.radicado_counters (organization_id, year, last_number)
  SELECT
    organization_id,
    EXTRACT(YEAR FROM created_at)::int AS yr,
    COALESCE(MAX(
      CASE
        WHEN radicado ~ '^\d{4}-\d+$'
          AND split_part(radicado, '-', 1)::int = EXTRACT(YEAR FROM created_at)::int
        THEN split_part(radicado, '-', 2)::int
        ELSE 0
      END
    ), 0) AS last_number
  FROM public.tramites
  WHERE radicado IS NOT NULL
  GROUP BY organization_id, EXTRACT(YEAR FROM created_at)
  ON CONFLICT (organization_id, year) DO UPDATE
    SET last_number = GREATEST(public.radicado_counters.last_number, EXCLUDED.last_number);

  -- Asignar radicado a los que estén NULL, en orden cronológico por org+año
  FOR rec IN
    SELECT id, organization_id, EXTRACT(YEAR FROM created_at)::int AS yr
    FROM public.tramites
    WHERE radicado IS NULL OR TRIM(radicado) = ''
    ORDER BY organization_id, created_at
  LOOP
    INSERT INTO public.radicado_counters (organization_id, year, last_number)
    VALUES (rec.organization_id, rec.yr, 1)
    ON CONFLICT (organization_id, year)
    DO UPDATE SET last_number = public.radicado_counters.last_number + 1
    RETURNING last_number INTO num;

    UPDATE public.tramites
    SET radicado = rec.yr::text || '-' || LPAD(num::text, 4, '0')
    WHERE id = rec.id;
  END LOOP;
END $$;