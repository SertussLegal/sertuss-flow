
-- Drop existing FK constraints and recreate with ON DELETE CASCADE
ALTER TABLE public.personas DROP CONSTRAINT IF EXISTS personas_tramite_id_fkey;
ALTER TABLE public.personas ADD CONSTRAINT personas_tramite_id_fkey FOREIGN KEY (tramite_id) REFERENCES public.tramites(id) ON DELETE CASCADE;

ALTER TABLE public.inmuebles DROP CONSTRAINT IF EXISTS inmuebles_tramite_id_fkey;
ALTER TABLE public.inmuebles ADD CONSTRAINT inmuebles_tramite_id_fkey FOREIGN KEY (tramite_id) REFERENCES public.tramites(id) ON DELETE CASCADE;

ALTER TABLE public.actos DROP CONSTRAINT IF EXISTS actos_tramite_id_fkey;
ALTER TABLE public.actos ADD CONSTRAINT actos_tramite_id_fkey FOREIGN KEY (tramite_id) REFERENCES public.tramites(id) ON DELETE CASCADE;

-- Enable pg_cron and pg_net extensions for scheduled cleanup
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
