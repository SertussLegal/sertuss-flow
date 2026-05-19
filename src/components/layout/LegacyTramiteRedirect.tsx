import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mapea URLs antiguas `/tramite/:id` al módulo correcto consultando
 * el `tipo` del trámite en BD. Si no existe → /escrituras.
 *
 * Nota: tramites.tipo puede ser null para borradores antiguos —
 * por defecto se asume escritura.
 */
export const LegacyTramiteRedirect = () => {
  const { id } = useParams<{ id: string }>();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setTarget("/escrituras");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tramites")
        .select("tipo")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const tipo = (data?.tipo ?? "").toLowerCase();
      // Heurística simple — cualquier "cancelacion*" va al módulo nuevo.
      if (tipo.startsWith("cancelacion")) {
        setTarget(`/cancelaciones/${id}`);
      } else {
        setTarget(`/escrituras/${id}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!target) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  return <Navigate to={target} replace />;
};
