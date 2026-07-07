
CREATE OR REPLACE FUNCTION public.admin_review_propuesta(
  p_id uuid,
  p_nuevo_status text,
  p_cambios jsonb DEFAULT NULL,
  p_nota text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_nuevo_status NOT IN ('pendiente','aprobada','rechazada','duplicada') THEN
    RAISE EXCEPTION 'Invalid status: %', p_nuevo_status;
  END IF;

  UPDATE public.regla_propuesta
  SET
    status = p_nuevo_status,
    revisado_por = auth.uid(),
    revisado_at = now(),
    nota_revision = COALESCE(p_nota, nota_revision),
    titulo = COALESCE(NULLIF(p_cambios->>'titulo',''), titulo),
    descripcion = COALESCE(NULLIF(p_cambios->>'descripcion',''), descripcion),
    categoria = COALESCE(NULLIF(p_cambios->>'categoria',''), categoria),
    nivel_severidad = COALESCE(NULLIF(p_cambios->>'nivel_severidad',''), nivel_severidad),
    tipo_acto = COALESCE(NULLIF(p_cambios->>'tipo_acto',''), tipo_acto),
    regla_deterministica_sugerida = COALESCE(p_cambios->'regla_deterministica_sugerida', regla_deterministica_sugerida),
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta not found: %', p_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_propuesta(uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_propuesta(uuid, text, jsonb, text) TO authenticated;
