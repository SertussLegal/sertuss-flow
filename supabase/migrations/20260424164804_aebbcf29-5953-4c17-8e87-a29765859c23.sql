
-- =========================================
-- 1. TABLES
-- =========================================

CREATE TABLE IF NOT EXISTS public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'operator',
  is_personal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships(organization_id);

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_active_context (
  user_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_active_context ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.credit_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tramite_id uuid NULL,
  action text NOT NULL,
  credits integer NOT NULL DEFAULT 1,
  tipo_acto text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_consumption_org_date ON public.credit_consumption(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_consumption_user_date ON public.credit_consumption(user_id, created_at DESC);

ALTER TABLE public.credit_consumption ENABLE ROW LEVEL SECURITY;

-- =========================================
-- 2. CORE HELPERS (replace old behavior)
-- =========================================

-- get_active_org: reads user_active_context, falls back to personal membership, then any membership
CREATE OR REPLACE FUNCTION public.get_active_org(uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT organization_id FROM public.user_active_context WHERE user_id = uid),
    (SELECT organization_id FROM public.memberships WHERE user_id = uid AND is_personal = true LIMIT 1),
    (SELECT organization_id FROM public.memberships WHERE user_id = uid ORDER BY created_at ASC LIMIT 1),
    (SELECT organization_id FROM public.profiles WHERE id = uid)
  );
$$;

-- get_user_org: now delegates to get_active_org (backward compatibility)
CREATE OR REPLACE FUNCTION public.get_user_org(uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_active_org(uid);
$$;

-- get_user_role: returns role of active membership; fallback to profiles.role
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS public.org_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT m.role
       FROM public.memberships m
       JOIN public.user_active_context c ON c.organization_id = m.organization_id
      WHERE m.user_id = uid AND c.user_id = uid
      LIMIT 1),
    (SELECT m.role FROM public.memberships m WHERE m.user_id = uid AND m.is_personal = true LIMIT 1),
    (SELECT role FROM public.profiles WHERE id = uid)
  );
$$;

-- =========================================
-- 3. RLS POLICIES FOR NEW TABLES
-- =========================================

DROP POLICY IF EXISTS "Users see own memberships" ON public.memberships;
CREATE POLICY "Users see own memberships" ON public.memberships
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org admins see all memberships of their orgs" ON public.memberships;
CREATE POLICY "Org admins see all memberships of their orgs" ON public.memberships
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m2
    WHERE m2.user_id = auth.uid()
      AND m2.organization_id = memberships.organization_id
      AND m2.role IN ('owner','admin')
  )
);

DROP POLICY IF EXISTS "Users insert own memberships" ON public.memberships;
CREATE POLICY "Users insert own memberships" ON public.memberships
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage own active context" ON public.user_active_context;
CREATE POLICY "Users manage own active context" ON public.user_active_context
FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Own consumption visible" ON public.credit_consumption;
CREATE POLICY "Own consumption visible" ON public.credit_consumption
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org admins see active org consumption" ON public.credit_consumption;
CREATE POLICY "Org admins see active org consumption" ON public.credit_consumption
FOR SELECT TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
);

DROP POLICY IF EXISTS "Service role inserts consumption" ON public.credit_consumption;
CREATE POLICY "Service role inserts consumption" ON public.credit_consumption
FOR INSERT TO service_role
WITH CHECK (true);

-- =========================================
-- 4. ATOMIC CREDIT FUNCTIONS
-- =========================================

CREATE OR REPLACE FUNCTION public.consume_credit_v2(
  p_org_id uuid,
  p_user_id uuid,
  p_action text,
  p_tramite_id uuid DEFAULT NULL,
  p_tipo_acto text DEFAULT NULL,
  p_credits integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance integer;
BEGIN
  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < p_credits THEN
    RETURN false;
  END IF;

  UPDATE public.organizations
  SET credit_balance = credit_balance - p_credits
  WHERE id = p_org_id;

  INSERT INTO public.credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, p_action, p_credits, p_tipo_acto);

  RETURN true;
END;
$$;

-- Legacy wrapper: keeps current code working
CREATE OR REPLACE FUNCTION public.consume_credit(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.consume_credit_v2(org_id, auth.uid(), 'LEGACY', NULL, NULL, 1);
END;
$$;

-- Atomic unlock: deduct 2 credits + audit log + mark tramite, all in one tx
CREATE OR REPLACE FUNCTION public.unlock_expediente(
  p_org_id uuid,
  p_tramite_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance integer;
  v_tipo_acto text;
BEGIN
  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < 2 THEN
    RETURN false;
  END IF;

  UPDATE public.organizations SET credit_balance = credit_balance - 2 WHERE id = p_org_id;

  UPDATE public.tramites SET is_unlocked = true WHERE id = p_tramite_id;

  SELECT tipo INTO v_tipo_acto FROM public.tramites WHERE id = p_tramite_id;

  INSERT INTO public.credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, 'APERTURA_EXPEDIENTE', 2, v_tipo_acto);

  INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (p_org_id, p_user_id, 'APERTURA_EXPEDIENTE', 'tramite', p_tramite_id,
    jsonb_build_object('credits_consumed', 2, 'old_balance', current_balance, 'new_balance', current_balance - 2));

  RETURN true;
END;
$$;

-- =========================================
-- 5. CONTEXT SWITCHING + INVITATIONS
-- =========================================

CREATE OR REPLACE FUNCTION public.set_active_context(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.org_role;
BEGIN
  SELECT role INTO v_role
  FROM public.memberships
  WHERE user_id = auth.uid() AND organization_id = p_org_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No membership for this organization';
  END IF;

  INSERT INTO public.user_active_context (user_id, organization_id, updated_at)
  VALUES (auth.uid(), p_org_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        updated_at = now();

  -- Sync legacy fields for backward compatibility
  UPDATE public.profiles
  SET organization_id = p_org_id, role = v_role
  WHERE id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_invitation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  SELECT * INTO v_inv FROM public.invitations
  WHERE id = p_invitation_id AND accepted_at IS NULL;

  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'Invitation not found or already accepted';
  END IF;

  IF lower(v_inv.email) <> lower(v_email) THEN
    RAISE EXCEPTION 'Invitation email mismatch';
  END IF;

  INSERT INTO public.memberships (user_id, organization_id, role, is_personal)
  VALUES (auth.uid(), v_inv.organization_id, v_inv.role, false)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.invitations SET accepted_at = now() WHERE id = p_invitation_id;

  RETURN v_inv.organization_id;
END;
$$;

-- =========================================
-- 6. NEW USER HANDLER (full_name + auto personal org)
-- =========================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_org_name text;
  v_org_nit text;
  v_personal_org_id uuid;
BEGIN
  v_full_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');
  v_org_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'org_name'), '');
  v_org_nit := NULLIF(TRIM(NEW.raw_user_meta_data->>'nit'), '');

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, v_full_name)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  -- Always create a personal org so the user has credits even before joining one
  INSERT INTO public.organizations (name, credit_balance)
  VALUES (COALESCE(v_full_name, NEW.email, 'Mi cuenta'), 5)
  RETURNING id INTO v_personal_org_id;

  INSERT INTO public.memberships (user_id, organization_id, role, is_personal)
  VALUES (NEW.id, v_personal_org_id, 'owner', true);

  INSERT INTO public.user_active_context (user_id, organization_id)
  VALUES (NEW.id, v_personal_org_id)
  ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id;

  -- Sync legacy profile.organization_id to personal org (will be overridden by org_name flow if needed)
  UPDATE public.profiles
  SET organization_id = v_personal_org_id, role = 'owner'
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Make sure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- 7. BACKFILL: existing users get memberships from current profile.organization_id
-- =========================================

INSERT INTO public.memberships (user_id, organization_id, role, is_personal)
SELECT p.id, p.organization_id, p.role, false
FROM public.profiles p
WHERE p.organization_id IS NOT NULL
ON CONFLICT (user_id, organization_id) DO NOTHING;

INSERT INTO public.user_active_context (user_id, organization_id)
SELECT p.id, p.organization_id
FROM public.profiles p
WHERE p.organization_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
