
CREATE OR REPLACE FUNCTION public.validate_reglas_validacion()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
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

CREATE OR REPLACE FUNCTION public.validate_configuracion_notaria()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo_notario IS NOT NULL AND NEW.tipo_notario NOT IN ('titular', 'encargado', 'interino') THEN
    RAISE EXCEPTION 'tipo_notario inválido: %', NEW.tipo_notario;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_historial_validaciones()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.momento NOT IN ('campos', 'documento') THEN
    RAISE EXCEPTION 'momento inválido: %', NEW.momento;
  END IF;
  RETURN NEW;
END;
$$;
