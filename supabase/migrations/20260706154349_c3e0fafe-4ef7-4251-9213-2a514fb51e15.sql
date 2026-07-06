
-- 1) Tabla credit_prices
CREATE TABLE public.credit_prices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL,
  tipo_acto    text NOT NULL,
  credits      integer NOT NULL CHECK (credits >= 0 AND credits <= 100),
  active       boolean NOT NULL DEFAULT true,
  notes        text,
  updated_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_prices_action_tipo_unique UNIQUE (action, tipo_acto)
);

GRANT SELECT ON public.credit_prices TO authenticated;
GRANT ALL    ON public.credit_prices TO service_role;

ALTER TABLE public.credit_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_prices readable by authenticated"
  ON public.credit_prices FOR SELECT TO authenticated USING (true);

CREATE POLICY "credit_prices writable by platform admin"
  ON public.credit_prices FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_credit_prices_updated_at
  BEFORE UPDATE ON public.credit_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Seed inicial
INSERT INTO public.credit_prices (action, tipo_acto, credits, notes) VALUES
  ('OCR_DOCUMENTO',       '*',                     1, 'OCR unitario por documento'),
  ('APERTURA_EXPEDIENTE', 'compraventa_hipoteca',  3, 'Apertura de expediente de escritura compraventa+hipoteca'),
  ('GENERACION_DOCX',     'cancelacion_hipoteca',  2, 'Generación de cancelación de hipoteca');

-- 3) consume_credit_v2 con resolución server-side
CREATE OR REPLACE FUNCTION public.consume_credit_v2(
  p_org_id uuid,
  p_user_id uuid,
  p_action text,
  p_tramite_id uuid DEFAULT NULL::uuid,
  p_tipo_acto text DEFAULT NULL::text,
  p_credits integer DEFAULT 1
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  current_balance integer;
  v_resolved integer;
  v_final integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not a member of organization';
  END IF;

  -- Resolver precio desde catálogo (match exacto de tipo_acto prioritario sobre comodín '*')
  SELECT credits INTO v_resolved
  FROM public.credit_prices
  WHERE active = true
    AND action = p_action
    AND (tipo_acto = p_tipo_acto OR tipo_acto = '*')
  ORDER BY (tipo_acto = COALESCE(p_tipo_acto, '')) DESC
  LIMIT 1;

  v_final := COALESCE(v_resolved, p_credits, 1);

  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < v_final THEN
    RETURN false;
  END IF;

  UPDATE public.organizations
  SET credit_balance = credit_balance - v_final
  WHERE id = p_org_id;

  INSERT INTO public.credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, p_action, v_final, p_tipo_acto);

  RETURN true;
END;
$function$;

-- 4) unlock_expediente leyendo desde credit_prices
CREATE OR REPLACE FUNCTION public.unlock_expediente(
  p_org_id uuid,
  p_tramite_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  current_balance integer;
  v_tipo_acto text;
  v_price integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not a member of organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tramites
    WHERE id = p_tramite_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: tramite does not belong to organization';
  END IF;

  SELECT tipo INTO v_tipo_acto FROM public.tramites WHERE id = p_tramite_id;

  SELECT credits INTO v_price
  FROM public.credit_prices
  WHERE active = true
    AND action = 'APERTURA_EXPEDIENTE'
    AND (tipo_acto = v_tipo_acto OR tipo_acto = '*')
  ORDER BY (tipo_acto = COALESCE(v_tipo_acto, '')) DESC
  LIMIT 1;

  v_price := COALESCE(v_price, 2);

  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < v_price THEN
    RETURN false;
  END IF;

  UPDATE public.organizations SET credit_balance = credit_balance - v_price WHERE id = p_org_id;

  UPDATE public.tramites SET is_unlocked = true WHERE id = p_tramite_id;

  INSERT INTO public.credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, 'APERTURA_EXPEDIENTE', v_price, v_tipo_acto);

  INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (p_org_id, p_user_id, 'APERTURA_EXPEDIENTE', 'tramite', p_tramite_id,
    jsonb_build_object('credits_consumed', v_price, 'old_balance', current_balance, 'new_balance', current_balance - v_price));

  RETURN true;
END;
$function$;
