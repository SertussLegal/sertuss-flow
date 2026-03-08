CREATE OR REPLACE FUNCTION public.admin_update_organization(
  target_org_id uuid, new_name text, new_nit varchar, new_address text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE organizations
  SET name = new_name, nit = new_nit, address = new_address
  WHERE id = target_org_id;
END;
$$;