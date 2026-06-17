-- =====================================================================
-- 1) create_organization_for_user — caller identity guard
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid,
  p_org_name text,
  p_org_nit character varying
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

  SELECT organization_id INTO existing_org_id FROM public.profiles WHERE id = v_caller;
  IF existing_org_id IS NOT NULL THEN
    RETURN existing_org_id;
  END IF;

  INSERT INTO public.organizations (name, nit)
  VALUES (COALESCE(NULLIF(TRIM(p_org_name), ''), 'Organizacion001'),
          NULLIF(TRIM(p_org_nit), ''))
  RETURNING id INTO new_org_id;

  UPDATE public.profiles
  SET organization_id = new_org_id, role = 'owner'
  WHERE id = v_caller;

  RETURN new_org_id;
END;
$function$;

-- =====================================================================
-- 2) Homogenize RLS: replace any get_user_org(...) → get_active_org(auth.uid())
-- =====================================================================
DO $$
DECLARE
  pol record;
  new_qual text;
  new_check text;
  sql text;
BEGIN
  FOR pol IN
    SELECT n.nspname AS schemaname,
           c.relname AS tablename,
           p.polname AS policyname,
           p.polcmd AS cmd,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check,
           ARRAY(
             SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)
           ) AS roles,
           CASE p.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        pg_get_expr(p.polqual, p.polrelid) ILIKE '%get_user_org%'
        OR pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%get_user_org%'
      )
  LOOP
    new_qual := regexp_replace(COALESCE(pol.qual, ''), 'get_user_org\s*\(\s*auth\.uid\(\)\s*\)', 'get_active_org(auth.uid())', 'gi');
    new_qual := regexp_replace(new_qual, 'public\.get_user_org\s*\(\s*auth\.uid\(\)\s*\)', 'public.get_active_org(auth.uid())', 'gi');
    new_check := regexp_replace(COALESCE(pol.with_check, ''), 'get_user_org\s*\(\s*auth\.uid\(\)\s*\)', 'get_active_org(auth.uid())', 'gi');
    new_check := regexp_replace(new_check, 'public\.get_user_org\s*\(\s*auth\.uid\(\)\s*\)', 'public.get_active_org(auth.uid())', 'gi');

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    sql := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      pol.policyname, pol.schemaname, pol.tablename, pol.permissive,
      CASE pol.cmd
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
        WHEN '*' THEN 'ALL'
      END,
      array_to_string(pol.roles, ', ')
    );

    IF pol.qual IS NOT NULL AND length(new_qual) > 0 THEN
      sql := sql || format(' USING (%s)', new_qual);
    END IF;
    IF pol.with_check IS NOT NULL AND length(new_check) > 0 THEN
      sql := sql || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE sql;
  END LOOP;
END $$;

-- =====================================================================
-- 3) system_events SELECT consolidation
-- =====================================================================
DROP POLICY IF EXISTS "Admins can read own org events" ON public.system_events;
DROP POLICY IF EXISTS "Owners read own org events" ON public.system_events;
DROP POLICY IF EXISTS "Owners and admins read own org events" ON public.system_events;

CREATE POLICY "Owners and admins read own org events"
ON public.system_events
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner', 'admin')
);