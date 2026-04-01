
-- =============================================
-- TABLA 1: reglas_validacion
-- =============================================
CREATE TABLE public.reglas_validacion (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  categoria VARCHAR(30) NOT NULL,
  campo_aplicable VARCHAR(100),
  tipo_acto VARCHAR(50)[] DEFAULT '{todos}',
  descripcion TEXT NOT NULL,
  regla_detalle TEXT NOT NULL,
  nivel_severidad VARCHAR(20) NOT NULL,
  auto_corregible BOOLEAN DEFAULT false,
  activa BOOLEAN DEFAULT true,
  aplica_a_momento VARCHAR(20)[] DEFAULT '{campos,documento}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reglas_activas ON reglas_validacion (activa) WHERE activa = true;
CREATE INDEX idx_reglas_tipo_acto ON reglas_validacion USING GIN (tipo_acto);
CREATE INDEX idx_reglas_momento ON reglas_validacion USING GIN (aplica_a_momento);

-- Trigger de validación para categoria
CREATE OR REPLACE FUNCTION public.validate_reglas_validacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.categoria NOT IN ('formato', 'coherencia', 'legal', 'negocio') THEN
    RAISE EXCEPTION 'categoria inválida: %', NEW.categoria;
  END IF;
  IF NEW.nivel_severidad NOT IN ('error', 'advertencia', 'sugerencia') THEN
    RAISE EXCEPTION 'nivel_severidad inválido: %', NEW.nivel_severidad;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_reglas_validacion
  BEFORE INSERT OR UPDATE ON public.reglas_validacion
  FOR EACH ROW EXECUTE FUNCTION public.validate_reglas_validacion();

-- =============================================
-- TABLA 2: configuracion_notaria
-- =============================================
CREATE TABLE public.configuracion_notaria (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  numero_notaria INTEGER NOT NULL,
  circulo VARCHAR(100) NOT NULL,
  departamento VARCHAR(100) NOT NULL,
  nombre_notario VARCHAR(200),
  tipo_notario VARCHAR(50),
  decreto_nombramiento TEXT,
  formato_encabezado TEXT,
  reglas_especificas JSONB DEFAULT '[]',
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger de validación para tipo_notario
CREATE OR REPLACE FUNCTION public.validate_configuracion_notaria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo_notario IS NOT NULL AND NEW.tipo_notario NOT IN ('titular', 'encargado', 'interino') THEN
    RAISE EXCEPTION 'tipo_notario inválido: %', NEW.tipo_notario;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_configuracion_notaria
  BEFORE INSERT OR UPDATE ON public.configuracion_notaria
  FOR EACH ROW EXECUTE FUNCTION public.validate_configuracion_notaria();

-- =============================================
-- TABLA 3: plantillas_validacion
-- =============================================
CREATE TABLE public.plantillas_validacion (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo_acto VARCHAR(50) NOT NULL,
  nombre_acto VARCHAR(200) NOT NULL,
  codigo_acto VARCHAR(20),
  campos_requeridos JSONB NOT NULL,
  campos_opcionales JSONB DEFAULT '[]',
  relaciones_entre_campos JSONB DEFAULT '[]',
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- TABLA 4: historial_validaciones
-- =============================================
CREATE TABLE public.historial_validaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tramite_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  tipo_acto VARCHAR(50),
  momento VARCHAR(20) NOT NULL,
  tab_origen VARCHAR(30),
  datos_enviados JSONB,
  respuesta_claude JSONB,
  total_errores INTEGER DEFAULT 0,
  total_advertencias INTEGER DEFAULT 0,
  total_sugerencias INTEGER DEFAULT 0,
  puntuacion INTEGER,
  correcciones_aplicadas JSONB DEFAULT '[]',
  tiempo_respuesta_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  costo_estimado_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger de validación para momento
CREATE OR REPLACE FUNCTION public.validate_historial_validaciones()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.momento NOT IN ('campos', 'documento') THEN
    RAISE EXCEPTION 'momento inválido: %', NEW.momento;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_historial_validaciones
  BEFORE INSERT OR UPDATE ON public.historial_validaciones
  FOR EACH ROW EXECUTE FUNCTION public.validate_historial_validaciones();

CREATE INDEX idx_historial_tramite ON historial_validaciones (tramite_id);
CREATE INDEX idx_historial_org ON historial_validaciones (organization_id);
CREATE INDEX idx_historial_fecha ON historial_validaciones (created_at);
CREATE INDEX idx_historial_errores ON historial_validaciones (total_errores) WHERE total_errores > 0;

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE reglas_validacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_notaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantillas_validacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_validaciones ENABLE ROW LEVEL SECURITY;

-- Reglas: lectura para usuarios autenticados (solo activas)
CREATE POLICY "Authenticated users can read active rules"
  ON reglas_validacion FOR SELECT
  TO authenticated
  USING (activa = true);

-- Configuración notaría: usuarios ven solo su organización
CREATE POLICY "Users can view own org config"
  ON configuracion_notaria FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

-- Admins pueden gestionar configuración de su org
CREATE POLICY "Admins can manage own org config"
  ON configuracion_notaria FOR ALL
  TO authenticated
  USING (organization_id = get_user_org(auth.uid()) AND get_user_role(auth.uid()) IN ('owner', 'admin'))
  WITH CHECK (organization_id = get_user_org(auth.uid()) AND get_user_role(auth.uid()) IN ('owner', 'admin'));

-- Plantillas: lectura para usuarios autenticados (solo activas)
CREATE POLICY "Authenticated users can read active templates"
  ON plantillas_validacion FOR SELECT
  TO authenticated
  USING (activa = true);

-- Historial: usuarios ven historial de su organización
CREATE POLICY "Users can view own org validation history"
  ON historial_validaciones FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

-- Service role puede insertar historial (edge functions)
CREATE POLICY "Service role can insert history"
  ON historial_validaciones FOR INSERT
  TO service_role
  WITH CHECK (true);
