
CREATE TABLE public.system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  tramite_id uuid,
  user_id uuid,
  evento varchar NOT NULL,
  resultado varchar NOT NULL,
  categoria varchar NOT NULL,
  detalle jsonb DEFAULT '{}'::jsonb,
  tiempo_ms integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_system_events_org ON public.system_events(organization_id, created_at DESC);
CREATE INDEX idx_system_events_resultado ON public.system_events(resultado, created_at DESC);
CREATE INDEX idx_system_events_evento ON public.system_events(evento, created_at DESC);

ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert events for their own org
CREATE POLICY "Users can insert own org events"
ON public.system_events
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IS NULL OR organization_id = get_user_org(auth.uid())
);

-- Service role can insert any event (for edge functions)
CREATE POLICY "Service role can insert events"
ON public.system_events
FOR INSERT
TO service_role
WITH CHECK (true);

-- Owners can read all events
CREATE POLICY "Owners can read all events"
ON public.system_events
FOR SELECT
TO authenticated
USING (get_user_role(auth.uid()) = 'owner');

-- Admins can read their own org events
CREATE POLICY "Admins can read own org events"
ON public.system_events
FOR SELECT
TO authenticated
USING (
  organization_id = get_user_org(auth.uid())
  AND get_user_role(auth.uid()) = 'admin'
);
