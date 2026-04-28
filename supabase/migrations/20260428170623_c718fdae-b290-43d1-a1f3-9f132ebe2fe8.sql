
-- ============================================================
-- 1. STORAGE: bucket privado expediente-files
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('expediente-files', 'expediente-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Helper: resuelve organization_id del trámite a partir del path "{tramite_id}/..."
CREATE OR REPLACE FUNCTION public.tramite_org_from_path(p_path text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.organization_id
  FROM public.tramites t
  WHERE t.id = NULLIF(split_part(p_path, '/', 1), '')::uuid
$$;

-- Policies sobre storage.objects para el bucket expediente-files
DROP POLICY IF EXISTS "expediente_files_select" ON storage.objects;
CREATE POLICY "expediente_files_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'expediente-files'
  AND public.tramite_org_from_path(name) = public.get_active_org(auth.uid())
);

DROP POLICY IF EXISTS "expediente_files_insert" ON storage.objects;
CREATE POLICY "expediente_files_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expediente-files'
  AND public.tramite_org_from_path(name) = public.get_active_org(auth.uid())
);

DROP POLICY IF EXISTS "expediente_files_update" ON storage.objects;
CREATE POLICY "expediente_files_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'expediente-files'
  AND public.tramite_org_from_path(name) = public.get_active_org(auth.uid())
)
WITH CHECK (
  bucket_id = 'expediente-files'
  AND public.tramite_org_from_path(name) = public.get_active_org(auth.uid())
);

DROP POLICY IF EXISTS "expediente_files_delete" ON storage.objects;
CREATE POLICY "expediente_files_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'expediente-files'
  AND public.tramite_org_from_path(name) = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner'::org_role, 'admin'::org_role)
);

-- ============================================================
-- 2. AUDITORÍA OBLIGATORIA EN credit_consumption
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_credit_tramite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tramite_id IS NULL AND COALESCE(NEW.action, '') <> 'LEGACY' THEN
    RAISE EXCEPTION 'credit_consumption requires tramite_id (action=%)', NEW.action;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_credit_tramite ON public.credit_consumption;
CREATE TRIGGER trg_enforce_credit_tramite
BEFORE INSERT ON public.credit_consumption
FOR EACH ROW
EXECUTE FUNCTION public.enforce_credit_tramite();

-- ============================================================
-- 3. REVOCACIÓN INSTANTÁNEA DE MEMBRESÍAS
-- ============================================================

-- Policy DELETE: owners/admins de la org pueden borrar miembros (no su propia membership ni personales)
DROP POLICY IF EXISTS "Admins can revoke org memberships" ON public.memberships;
CREATE POLICY "Admins can revoke org memberships"
ON public.memberships FOR DELETE
TO authenticated
USING (
  is_personal = false
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.memberships m2
    WHERE m2.user_id = auth.uid()
      AND m2.organization_id = memberships.organization_id
      AND m2.role IN ('owner'::org_role, 'admin'::org_role)
  )
);

-- Trigger: al borrar la membership, si era el contexto activo del usuario, redirigir a personal
CREATE OR REPLACE FUNCTION public.handle_membership_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_personal_org uuid;
  v_active_org uuid;
BEGIN
  SELECT organization_id INTO v_active_org
  FROM public.user_active_context
  WHERE user_id = OLD.user_id;

  IF v_active_org IS DISTINCT FROM OLD.organization_id THEN
    RETURN OLD;
  END IF;

  SELECT organization_id INTO v_personal_org
  FROM public.memberships
  WHERE user_id = OLD.user_id AND is_personal = true
  LIMIT 1;

  IF v_personal_org IS NULL THEN
    SELECT organization_id INTO v_personal_org
    FROM public.memberships
    WHERE user_id = OLD.user_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_personal_org IS NOT NULL THEN
    INSERT INTO public.user_active_context (user_id, organization_id, updated_at)
    VALUES (OLD.user_id, v_personal_org, now())
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          updated_at = now();

    UPDATE public.profiles
    SET organization_id = v_personal_org
    WHERE id = OLD.user_id;
  ELSE
    DELETE FROM public.user_active_context WHERE user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_membership_cleanup ON public.memberships;
CREATE TRIGGER trg_revoke_membership_cleanup
AFTER DELETE ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.handle_membership_revocation();

-- ============================================================
-- 4. PERSISTENCIA DEL .DOCX
-- ============================================================
ALTER TABLE public.tramites
ADD COLUMN IF NOT EXISTS docx_path text;
