DROP FUNCTION IF EXISTS public.create_organization_for_user(uuid, text, varchar);

CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid,
  p_org_name text,
  p_org_nit varchar(20)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  new_org_id uuid;
  existing_org_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no session';
  END IF;
  IF p_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;
  IF p_org_name IS NULL OR TRIM(p_org_name) = '' THEN
    RAISE EXCEPTION 'Bad Request: Organization name is required';
  END IF;

  SELECT organization_id INTO existing_org_id FROM public.profiles WHERE id = v_caller;
  IF existing_org_id IS NOT NULL THEN
    RETURN existing_org_id;
  END IF;

  INSERT INTO public.organizations (name, nit)
  VALUES (TRIM(p_org_name), NULLIF(TRIM(p_org_nit), ''))
  RETURNING id INTO new_org_id;

  UPDATE public.profiles
  SET organization_id = new_org_id, role = 'owner'
  WHERE id = v_caller;

  RETURN new_org_id;
END;
$function$;