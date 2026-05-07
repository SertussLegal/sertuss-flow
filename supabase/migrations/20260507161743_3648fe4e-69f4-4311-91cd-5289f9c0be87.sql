
DROP FUNCTION IF EXISTS public.get_all_organizations();
CREATE FUNCTION public.get_all_organizations()
 RETURNS TABLE(id uuid, name text, nit character varying, address text, credit_balance integer, debug_tools_enabled boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.nit, o.address, o.credit_balance, o.debug_tools_enabled, o.created_at
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$function$;
