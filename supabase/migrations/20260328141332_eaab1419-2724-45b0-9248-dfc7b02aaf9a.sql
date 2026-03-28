
CREATE OR REPLACE FUNCTION public.purge_expired_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete related data first
  DELETE FROM public.personas WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  DELETE FROM public.inmuebles WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  DELETE FROM public.actos WHERE tramite_id IN (
    SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
  );
  -- Delete expired drafts
  DELETE FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days';
END;
$$;

-- Schedule daily purge at 3:00 AM UTC
SELECT cron.schedule('purge-expired-drafts', '0 3 * * *', 'SELECT public.purge_expired_drafts()');
