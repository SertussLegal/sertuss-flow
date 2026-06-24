ALTER TABLE public.organization_modules REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.organization_modules;