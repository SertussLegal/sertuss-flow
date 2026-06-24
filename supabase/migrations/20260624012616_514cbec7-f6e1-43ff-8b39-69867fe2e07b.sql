
CREATE OR REPLACE FUNCTION public.admin_list_org_users(p_org_id uuid)
RETURNS TABLE (
    user_id uuid,
    email text,
    full_name text,
    role public.org_role,
    is_personal boolean,
    joined_at timestamptz,
    last_sign_in_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_operator_email text;
    v_client_ip text;
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Access Denied: Unauthorized privilege escalation attempt.'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.email INTO v_operator_email
    FROM auth.users u
    WHERE u.id = auth.uid();

    BEGIN
      v_client_ip := current_setting('request.headers', true)::jsonb->>'x-forwarded-for';
    EXCEPTION WHEN OTHERS THEN
      v_client_ip := NULL;
    END;

    INSERT INTO public.activity_logs (
        organization_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_org_id,
        auth.uid(),
        'ADMIN_VIEW_USERS',
        'organization',
        p_org_id,
        jsonb_build_object(
            'operator_email', v_operator_email,
            'client_ip', v_client_ip
        )
    );

    RETURN QUERY
    SELECT
        m.user_id,
        u.email::text,
        p.full_name::text,
        m.role,
        m.is_personal,
        m.created_at AS joined_at,
        u.last_sign_in_at
    FROM public.memberships m
    INNER JOIN public.profiles p ON p.id = m.user_id
    INNER JOIN auth.users u ON u.id = m.user_id
    WHERE m.organization_id = p_org_id
    ORDER BY m.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_org_users(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_org_users(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_org_users(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_org_users(uuid) TO authenticated;
