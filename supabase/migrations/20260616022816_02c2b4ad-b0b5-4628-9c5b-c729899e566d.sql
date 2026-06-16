-- 1) activity_logs & system_events: append-only para usuarios (bloqueo explícito UPDATE/DELETE)
CREATE POLICY "Deny update for authenticated"
  ON public.activity_logs AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Deny delete for authenticated"
  ON public.activity_logs AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);

CREATE POLICY "Deny update for authenticated"
  ON public.system_events AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY "Deny delete for authenticated"
  ON public.system_events AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);

-- 2) logs_extraccion: el trigger trg_set_logs_extraccion_org ya sobrescribe organization_id
-- antes de la validación RLS. Lo blindamos para que SIEMPRE provenga del tramite_id,
-- ignorando cualquier valor enviado por el cliente.
CREATE OR REPLACE FUNCTION public.set_logs_extraccion_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT t.organization_id INTO v_org
  FROM public.tramites t
  WHERE t.id = NEW.tramite_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'tramite_id % no existe o no tiene organización', NEW.tramite_id;
  END IF;

  -- Sobrescribir SIEMPRE, ignorando cualquier valor proveniente del cliente.
  NEW.organization_id := v_org;
  RETURN NEW;
END;
$function$;

-- 3) Storage bucket cancelaciones-plantillas: SELECT por tenant (objeto debe comenzar con organization_id/)
CREATE POLICY "Members can read own org cancelaciones plantillas"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cancelaciones-plantillas'
    AND (storage.foldername(name))[1] = public.get_active_org(auth.uid())::text
  );
