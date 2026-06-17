-- Hard reset de create_organization_for_user: purga todas las firmas previas
-- y redefine con tipos uniformes 'text' + 4 guards secuenciales.

DROP FUNCTION IF EXISTS public.create_organization_for_user(uuid, text, varchar);
DROP FUNCTION IF EXISTS public.create_organization_for_user(uuid, text, text);
DROP FUNCTION IF EXISTS public.create_organization_for_user(uuid, text, varchar(20));

CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid,
  p_org_name text,
  p_org_nit  text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  new_org_id uuid;
  existing_org_id uuid;
BEGIN
  -- GUARD 1: sesión activa
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no session';
  END IF;

  -- GUARD 2: identidad coincide con el caller (anti-spoof)
  IF p_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;

  -- GUARD 3: nombre de organización requerido
  IF p_org_name IS NULL OR TRIM(p_org_name) = '' THEN
    RAISE EXCEPTION 'Bad Request: Organization name is required';
  END IF;

  -- GUARD 4: longitud máxima de NIT
  IF p_org_nit IS NOT NULL AND LENGTH(TRIM(p_org_nit)) > 20 THEN
    RAISE EXCEPTION 'Bad Request: NIT cannot exceed 20 characters';
  END IF;

  -- Idempotencia: si el usuario ya pertenece a una organización, devuélvela
  SELECT organization_id INTO existing_org_id
  FROM public.profiles
  WHERE id = v_caller;

  IF existing_org_id IS NOT NULL THEN
    RETURN existing_org_id;
  END IF;

  -- Inserción sanitizada
  INSERT INTO public.organizations (name, nit)
  VALUES (TRIM(p_org_name), NULLIF(TRIM(p_org_nit), ''))
  RETURNING id INTO new_org_id;

  UPDATE public.profiles
  SET organization_id = new_org_id, role = 'owner'
  WHERE id = v_caller;

  RETURN new_org_id;
END;
$$;