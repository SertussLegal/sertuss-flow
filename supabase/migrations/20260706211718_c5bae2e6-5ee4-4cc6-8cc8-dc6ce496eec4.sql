
-- Runs del job de descubrimiento de reglas
CREATE TABLE public.regla_propuesta_run (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','success','error')),
  disparado_por         TEXT NOT NULL DEFAULT 'manual'
                        CHECK (disparado_por IN ('manual','cron')),
  triggered_by_user     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tramites_analizados   INT NOT NULL DEFAULT 0,
  propuestas_generadas  INT NOT NULL DEFAULT 0,
  tokens_input          INT NOT NULL DEFAULT 0,
  tokens_output         INT NOT NULL DEFAULT 0,
  costo_estimado_usd    NUMERIC(10,6) NOT NULL DEFAULT 0,
  tiempo_ms             INT,
  error_detalle         JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.regla_propuesta_run TO authenticated;
GRANT ALL    ON public.regla_propuesta_run TO service_role;

ALTER TABLE public.regla_propuesta_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_reads_runs"
  ON public.regla_propuesta_run FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Propuestas individuales de reglas nuevas
CREATE TABLE public.regla_propuesta (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                          UUID NOT NULL REFERENCES public.regla_propuesta_run(id) ON DELETE CASCADE,
  tipo_acto                       TEXT NOT NULL,
  categoria                       TEXT NOT NULL
                                  CHECK (categoria IN ('formato','coherencia','legal','negocio')),
  nivel_severidad                 TEXT NOT NULL
                                  CHECK (nivel_severidad IN ('error','advertencia','sugerencia')),
  titulo                          TEXT NOT NULL,
  descripcion                     TEXT NOT NULL,
  regla_deterministica_sugerida   JSONB NOT NULL,
  campos_afectados                TEXT[] NOT NULL DEFAULT '{}',
  evidencia                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  frecuencia_estimada             INT NOT NULL DEFAULT 1,
  status                          TEXT NOT NULL DEFAULT 'pendiente'
                                  CHECK (status IN ('pendiente','aprobada','rechazada','editada')),
  revisado_por                    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revisado_at                     TIMESTAMPTZ,
  nota_revision                   TEXT,
  regla_creada_id                 UUID REFERENCES public.reglas_validacion(id) ON DELETE SET NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX regla_propuesta_run_idx    ON public.regla_propuesta(run_id);
CREATE INDEX regla_propuesta_status_idx ON public.regla_propuesta(status);

GRANT SELECT ON public.regla_propuesta TO authenticated;
GRANT ALL    ON public.regla_propuesta TO service_role;

ALTER TABLE public.regla_propuesta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin_reads_propuestas"
  ON public.regla_propuesta FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE TRIGGER trg_regla_propuesta_updated_at
  BEFORE UPDATE ON public.regla_propuesta
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
