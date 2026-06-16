
-- 1) Allow invitees to read their own pending invitation by email
CREATE POLICY "Invitees can view their own invitation"
ON public.invitations
FOR SELECT
TO authenticated
USING (
  lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
);

-- 2) Anchor logs_extraccion to organization_id directly
ALTER TABLE public.logs_extraccion
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Backfill from parent tramite
UPDATE public.logs_extraccion l
SET organization_id = t.organization_id
FROM public.tramites t
WHERE l.tramite_id = t.id AND l.organization_id IS NULL;

ALTER TABLE public.logs_extraccion
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_extraccion_org ON public.logs_extraccion(organization_id);

-- Trigger to auto-populate organization_id from the parent tramite,
-- preventing cross-org INSERTs even if the client supplies a forged value
CREATE OR REPLACE FUNCTION public.set_logs_extraccion_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT t.organization_id INTO NEW.organization_id
  FROM public.tramites t
  WHERE t.id = NEW.tramite_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'tramite_id % no existe o no tiene organización', NEW.tramite_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_logs_extraccion_org ON public.logs_extraccion;
CREATE TRIGGER trg_set_logs_extraccion_org
BEFORE INSERT OR UPDATE OF tramite_id ON public.logs_extraccion
FOR EACH ROW EXECUTE FUNCTION public.set_logs_extraccion_org();

-- Replace RLS policy to use organization_id directly (defense in depth)
DROP POLICY IF EXISTS "Users can manage own org logs_extraccion" ON public.logs_extraccion;

CREATE POLICY "Users can manage own org logs_extraccion"
ON public.logs_extraccion
FOR ALL
TO authenticated
USING (
  organization_id = get_user_org(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_user_org(auth.uid())
      AND (
        get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role, 'admin'::org_role])
        OR t.created_by = auth.uid()
      )
  )
)
WITH CHECK (
  organization_id = get_user_org(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_user_org(auth.uid())
      AND (
        get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role, 'admin'::org_role])
        OR t.created_by = auth.uid()
      )
  )
);
