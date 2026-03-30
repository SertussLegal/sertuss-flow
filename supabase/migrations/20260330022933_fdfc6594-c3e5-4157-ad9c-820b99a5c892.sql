
CREATE OR REPLACE FUNCTION public.purge_expired_drafts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.logs_extraccion WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  DELETE FROM public.personas WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  DELETE FROM public.inmuebles WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  DELETE FROM public.actos WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  DELETE FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days';
END;
$$;
