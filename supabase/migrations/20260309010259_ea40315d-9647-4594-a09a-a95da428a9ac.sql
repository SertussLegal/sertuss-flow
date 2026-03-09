
CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid,
  p_org_name text,
  p_org_nit varchar
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_org_id uuid;
  existing_org_id uuid;
BEGIN
  -- Check if user already has an organization
  SELECT organization_id INTO existing_org_id FROM profiles WHERE id = p_user_id;
  IF existing_org_id IS NOT NULL THEN
    RETURN existing_org_id;
  END IF;

  -- Create organization with 5 free credits (default)
  INSERT INTO organizations (name, nit)
  VALUES (COALESCE(NULLIF(TRIM(p_org_name), ''), 'Organizacion001'), NULLIF(TRIM(p_org_nit), ''))
  RETURNING id INTO new_org_id;

  -- Link profile to organization and set as owner
  UPDATE profiles
  SET organization_id = new_org_id, role = 'owner'
  WHERE id = p_user_id;

  RETURN new_org_id;
END;
$$;
