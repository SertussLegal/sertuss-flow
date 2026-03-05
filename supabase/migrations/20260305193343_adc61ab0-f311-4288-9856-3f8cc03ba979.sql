
-- Enums
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'operator');
CREATE TYPE public.tramite_status AS ENUM ('pendiente', 'validado', 'word_generado');
CREATE TYPE public.persona_rol AS ENUM ('vendedor', 'comprador');

-- Organizations
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  nit varchar(20),
  address text,
  credit_balance integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  organization_id uuid REFERENCES public.organizations(id),
  role org_role NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Tramites
CREATE TABLE public.tramites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado text,
  tipo text,
  fecha date DEFAULT CURRENT_DATE,
  status tramite_status NOT NULL DEFAULT 'pendiente',
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tramites ENABLE ROW LEVEL SECURITY;

-- Personas
CREATE TABLE public.personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  rol persona_rol NOT NULL,
  nombre_completo text NOT NULL DEFAULT '',
  numero_cedula text DEFAULT '',
  estado_civil text DEFAULT '',
  direccion text DEFAULT '',
  es_persona_juridica boolean NOT NULL DEFAULT false,
  razon_social text DEFAULT '',
  nit varchar(20) DEFAULT '',
  representante_legal_nombre text DEFAULT '',
  representante_legal_cedula text DEFAULT '',
  es_pep boolean NOT NULL DEFAULT false
);
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

-- Inmuebles
CREATE TABLE public.inmuebles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  matricula_inmobiliaria text DEFAULT '',
  tipo_identificador_predial text DEFAULT 'chip',
  identificador_predial varchar(30) DEFAULT '',
  departamento text DEFAULT '',
  municipio text DEFAULT '',
  codigo_orip text DEFAULT '',
  tipo_predio text DEFAULT 'urbano',
  direccion text DEFAULT '',
  estrato text DEFAULT '',
  area text DEFAULT '',
  linderos text DEFAULT '',
  valorizacion text DEFAULT ''
);
ALTER TABLE public.inmuebles ENABLE ROW LEVEL SECURITY;

-- Actos
CREATE TABLE public.actos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid NOT NULL REFERENCES public.tramites(id) ON DELETE CASCADE,
  tipo_acto text DEFAULT '',
  valor_compraventa text DEFAULT '',
  es_hipoteca boolean NOT NULL DEFAULT false,
  valor_hipoteca text DEFAULT '',
  entidad_bancaria text DEFAULT '',
  apoderado_nombre text DEFAULT '',
  apoderado_cedula text DEFAULT '',
  afectacion_vivienda_familiar boolean NOT NULL DEFAULT false
);
ALTER TABLE public.actos ENABLE ROW LEVEL SECURITY;

-- Activity Logs
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Invitations
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  email text NOT NULL,
  role org_role NOT NULL DEFAULT 'operator',
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.get_user_org(uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = uid;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS org_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;

-- consume_credit function
CREATE OR REPLACE FUNCTION public.consume_credit(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance integer;
BEGIN
  SELECT credit_balance INTO current_balance FROM public.organizations WHERE id = org_id FOR UPDATE;
  IF current_balance IS NULL OR current_balance <= 0 THEN
    RETURN false;
  END IF;
  UPDATE public.organizations SET credit_balance = credit_balance - 1 WHERE id = org_id;
  RETURN true;
END;
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Activity log trigger on tramite status change to word_generado
CREATE OR REPLACE FUNCTION public.log_word_generated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'word_generado' AND (OLD.status IS DISTINCT FROM 'word_generado') THEN
    INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id)
    VALUES (NEW.organization_id, NEW.created_by, 'generated', 'tramite', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_tramite_word_generated
  AFTER UPDATE ON public.tramites
  FOR EACH ROW EXECUTE FUNCTION public.log_word_generated();

-- RLS Policies

-- organizations
CREATE POLICY "Users can view own org" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.get_user_org(auth.uid()));

CREATE POLICY "Owners can update org" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.get_user_org(auth.uid()) AND public.get_user_role(auth.uid()) = 'owner');

-- profiles
CREATE POLICY "Users can view org members" ON public.profiles
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org(auth.uid()));

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- tramites
CREATE POLICY "Users can view org tramites" ON public.tramites
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org(auth.uid())
    AND (
      public.get_user_role(auth.uid()) IN ('owner', 'admin')
      OR created_by = auth.uid()
    )
  );

CREATE POLICY "Users can insert org tramites" ON public.tramites
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org(auth.uid()));

CREATE POLICY "Users can update org tramites" ON public.tramites
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org(auth.uid())
    AND (
      public.get_user_role(auth.uid()) IN ('owner', 'admin')
      OR created_by = auth.uid()
    )
  );

-- personas (via tramite)
CREATE POLICY "Users can manage personas" ON public.personas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
      AND t.organization_id = public.get_user_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
      AND t.organization_id = public.get_user_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
    )
  );

-- inmuebles (via tramite)
CREATE POLICY "Users can manage inmuebles" ON public.inmuebles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
      AND t.organization_id = public.get_user_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
      AND t.organization_id = public.get_user_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
    )
  );

-- actos (via tramite)
CREATE POLICY "Users can manage actos" ON public.actos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
      AND t.organization_id = public.get_user_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
      AND t.organization_id = public.get_user_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
    )
  );

-- activity_logs
CREATE POLICY "Users can insert own logs" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "Admins can view org logs" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org(auth.uid())
    AND public.get_user_role(auth.uid()) IN ('owner', 'admin')
  );

-- invitations
CREATE POLICY "Admins can manage invitations" ON public.invitations
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org(auth.uid())
    AND public.get_user_role(auth.uid()) IN ('owner', 'admin')
  )
  WITH CHECK (
    organization_id = public.get_user_org(auth.uid())
    AND public.get_user_role(auth.uid()) IN ('owner', 'admin')
  );
