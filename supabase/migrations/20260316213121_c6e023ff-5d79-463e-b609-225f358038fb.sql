CREATE TABLE public.notaria_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nombre_notaria text NOT NULL DEFAULT '',
  ciudad text NOT NULL DEFAULT '',
  estilo_linderos text NOT NULL DEFAULT '',
  notario_titular text NOT NULL DEFAULT '',
  clausulas_personalizadas jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

ALTER TABLE public.notaria_styles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org styles"
  ON public.notaria_styles FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

CREATE POLICY "Admins can manage styles"
  ON public.notaria_styles FOR ALL TO authenticated
  USING (organization_id = get_user_org(auth.uid()) 
    AND get_user_role(auth.uid()) IN ('owner', 'admin'))
  WITH CHECK (organization_id = get_user_org(auth.uid()) 
    AND get_user_role(auth.uid()) IN ('owner', 'admin'));