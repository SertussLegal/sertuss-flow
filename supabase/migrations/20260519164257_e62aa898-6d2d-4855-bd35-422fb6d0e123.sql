
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.cancelaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  matricula_inmobiliaria text,
  deudor_nombre text,
  deudor_cedula text,
  valor_hipoteca numeric,
  aplica_ley_546 boolean NOT NULL DEFAULT false,
  url_minuta_generada text,
  url_certificado_generado text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cancelaciones_status_check CHECK (status IN ('draft','processing','completed','error'))
);

CREATE INDEX idx_cancelaciones_org ON public.cancelaciones(organization_id);

ALTER TABLE public.cancelaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own org cancelaciones"
  ON public.cancelaciones FOR SELECT TO authenticated
  USING (organization_id = public.get_active_org(auth.uid()));

CREATE POLICY "Users insert own org cancelaciones"
  ON public.cancelaciones FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_active_org(auth.uid()));

CREATE POLICY "Users update own org cancelaciones"
  ON public.cancelaciones FOR UPDATE TO authenticated
  USING (organization_id = public.get_active_org(auth.uid()))
  WITH CHECK (organization_id = public.get_active_org(auth.uid()));

CREATE TRIGGER cancelaciones_set_updated_at
  BEFORE UPDATE ON public.cancelaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
