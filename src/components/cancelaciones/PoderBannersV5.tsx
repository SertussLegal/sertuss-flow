// ============================================================================
// PoderBannersV5 — Banners K3 (ambigüedad de firma) y L3 (vigencia).
// Plan v5/B4.
//
// K3: cuando `has_apoderado_banco === null` la IA no pudo decidir si el banco
// firma directo o mediante apoderado. El banner es INTERACTIVO: dos botones
// resuelven el ternario en caliente (true → mediante apoderado / false → firma
// directo). Al resolver, el bloqueo de campos críticos cae.
//
// L3: vigencia evaluada contra la fecha de otorgamiento real; si el usuario
// no la ha fijado, se usa hoy + 30 días como estimación conservadora. Se
// re-evalúa en cada render cuando cambia la fecha — sin efectos secundarios.
// ============================================================================

import { AlertTriangle, CheckCircle2, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  evaluarVigenciaCliente,
  type VigenciaInput,
} from "@/lib/poderVigenciaCliente";

export interface PoderBannersV5Props {
  hasApoderadoBanco: boolean | null | undefined;
  vigencia?: VigenciaInput | null;
  /** Fecha planeada para firmar (string ISO o "YYYY-MM-DD"). Vacío → estimada. */
  fechaOtorgamientoNueva?: string;
  onResolveAmbiguity: (value: boolean) => void;
  poderAdjuntado: boolean;
}

export function PoderBannersV5({
  hasApoderadoBanco,
  vigencia,
  fechaOtorgamientoNueva,
  onResolveAmbiguity,
  poderAdjuntado,
}: PoderBannersV5Props) {
  if (!poderAdjuntado) return null;

  const showK3 = hasApoderadoBanco === null || hasApoderadoBanco === undefined;
  const vig = evaluarVigenciaCliente(vigencia, fechaOtorgamientoNueva || null);

  return (
    <div className="space-y-2">
      {showK3 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] leading-snug"
        >
          <div className="flex items-start gap-2">
            <ShieldQuestion className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <p className="font-semibold text-amber-600 dark:text-amber-400">
                Ambigüedad en la firma del banco
              </p>
              <p className="text-foreground/85">
                La IA no pudo determinar con certeza si el banco firmará directamente o mediante apoderado. Resuélvelo para continuar.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => onResolveAmbiguity(false)}
                >
                  El banco firma directo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-7 text-[11px]"
                  onClick={() => onResolveAmbiguity(true)}
                >
                  Actúa mediante apoderado
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {vig.estado === "expirado" && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-[12px] leading-snug"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-destructive">
                Poder expirado al {vig.fechaEval}
              </p>
              <p className="text-foreground/85 mt-1">
                La vigencia caducó el {vig.fechaLimiteNormalizada}.
                {vig.fechaEstimada
                  ? " La fecha de otorgamiento aún no se ha fijado; se usó hoy + 30 días como estimación. Edita la fecha real para re-evaluar."
                  : " No es posible otorgar la cancelación con este Poder."}
              </p>
            </div>
          </div>
        </div>
      )}

      {vig.estado === "vigente" && vig.fechaEstimada && vigencia?.tipo && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] leading-snug">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Vigencia evaluada con fecha estimada
              </p>
              <p className="text-foreground/85 mt-1">
                Aún no fijas la fecha de otorgamiento. Se evalúa contra <span className="font-mono">{vig.fechaEval}</span> (hoy + 30 días, hora Bogotá). Al fijar la fecha real, el estado se actualiza al instante.
              </p>
            </div>
          </div>
        </div>
      )}

      {vig.estado === "vigente" && !vig.fechaEstimada && vigencia?.tipo === "hasta_fecha" && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] leading-snug">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-foreground/85">
              Poder vigente hasta <span className="font-mono">{vig.fechaLimiteNormalizada}</span>; otorgamiento programado para <span className="font-mono">{vig.fechaEval}</span>.
            </p>
          </div>
        </div>
      )}

      {vig.estado === "atado_a_contrato" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-snug">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-foreground/85">
              Vigencia atada a un contrato laboral/comercial. Verifica manualmente con el banco que el apoderado siga activo a la fecha del otorgamiento.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
