CREATE OR REPLACE FUNCTION public.tramite_org_from_path(p_path text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  first_segment text := NULLIF(split_part(p_path, '/', 1), '');
  second_segment text := NULLIF(split_part(p_path, '/', 2), '');
  candidate uuid;
  org uuid;
BEGIN
  IF first_segment IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    candidate := first_segment::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    candidate := NULL;
  END;

  IF candidate IS NOT NULL THEN
    SELECT t.organization_id INTO org
    FROM public.tramites t
    WHERE t.id = candidate;

    IF org IS NOT NULL THEN
      RETURN org;
    END IF;

    SELECT c.organization_id INTO org
    FROM public.cancelaciones c
    WHERE c.id = candidate;

    IF org IS NOT NULL THEN
      RETURN org;
    END IF;
  END IF;

  IF first_segment = 'cancelaciones' AND second_segment IS NOT NULL THEN
    BEGIN
      candidate := second_segment::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      candidate := NULL;
    END;

    IF candidate IS NOT NULL THEN
      SELECT c.organization_id INTO org
      FROM public.cancelaciones c
      WHERE c.id = candidate;
      RETURN org;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;