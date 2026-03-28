
-- Config tramites: campos obligatorios por tipo de acto
CREATE TABLE public.config_tramites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_acto text NOT NULL UNIQUE,
  campos_obligatorios jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.config_tramites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read config"
  ON public.config_tramites FOR SELECT
  TO authenticated
  USING (true);

-- Seed Compraventa
INSERT INTO public.config_tramites (tipo_acto, campos_obligatorios) VALUES
('Compraventa', '["matricula_inmobiliaria","identificador_predial","linderos","avaluo_catastral"]');

-- Logs extraccion: data_ia vs data_final
CREATE TABLE public.logs_extraccion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid REFERENCES public.tramites(id) ON DELETE CASCADE NOT NULL,
  data_ia jsonb NOT NULL,
  data_final jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.logs_extraccion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own org logs_extraccion"
  ON public.logs_extraccion FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_user_org(auth.uid())
      AND (get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_user_org(auth.uid())
      AND (get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
  ));
