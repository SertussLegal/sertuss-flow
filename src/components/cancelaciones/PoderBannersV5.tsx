// ============================================================================
// PoderBannersV5 — Banners K3 (ambigüedad de firma), L3 (vigencia) y
// C1 (clasificación defensiva Natural vs Jurídica — Plan v7 / Enmienda 1).
//
// K3: cuando `has_apoderado_banco === null` la IA no pudo decidir si el banco
// firma directo o mediante apoderado. Botones resuelven el ternario en caliente.
//
// L3: vigencia evaluada contra la fecha de otorgamiento real; si el usuario
// no la ha fijado, se usa hoy + 30 días como estimación conservadora.
//
// C1: si `classifyApoderado` degrada el tipo a null (contaminación corporativa,
// falta de datos de constitución, etc.), banner ámbar con `SegmentedChoice`
// para override manual. El override viaja como `apoderado.tipo_override` y
// gobierna sobre las reglas defensivas.
// ============================================================================

import { AlertTriangle, CheckCircle2, ShieldQuestion, UserRoundCog, ShieldAlert } from "lucide-react";
import { WARNING_LABELS, SUSPICIOUS_FIELD_LABELS, isHardBlockCoherenciaWarning } from "@shared/poderBancoExtractor/validate";
import { Button } from "@/components/ui/button";
import { SegmentedChoice } from "@/components/shared/SegmentedChoice";
import {
  evaluarVigenciaCliente,
  type VigenciaInput,
} from "@/lib/poderVigenciaCliente";
import {
  classifyApoderado,
  MOTIVO_LABELS,
  type ApoderadoPayload,
  type TipoApoderado,
} from "@shared/apoderadoClassifier";

export interface PoderBannersV5Props {
  hasApoderadoBanco: boolean | null | undefined;
  vigencia?: VigenciaInput | null;
  fechaOtorgamientoNueva?: string;
  onResolveAmbiguity: (value: boolean) => void;
  poderAdjuntado: boolean;
  /** Payload del apoderado — habilita banner C1 y override manual. */
  apoderado?: ApoderadoPayload | null;
  /** Callback para persistir apoderado.tipo_override. */
  onSetTipoOverride?: (value: TipoApoderado) => void;
  /** Warnings de coherencia determinista emitidos por el pipeline (Parte 2). */
  coherenciaWarnings?: string[] | null;
  /** Paths de campos sospechosos (para explicar cuáles revisar). */
  coherenciaSuspicious?: string[] | null;
  /** Fase E: la cancelación está en status 'requiere_revision_manual'. */
  manualReviewPending?: boolean;
  /** Fase E: callback que dispara la acción `confirm_manual_review`. */
  onConfirmManualReview?: () => Promise<void> | void;
  /** Fase E: la acción de confirmación está en vuelo. */
  manualReviewConfirming?: boolean;
}

export function PoderBannersV5({
  hasApoderadoBanco,
  vigencia,
  fechaOtorgamientoNueva,
  onResolveAmbiguity,
  poderAdjuntado,
  apoderado,
  onSetTipoOverride,
  coherenciaWarnings,
  coherenciaSuspicious,
  manualReviewPending,
  onConfirmManualReview,
  manualReviewConfirming,
}: PoderBannersV5Props) {
  if (!poderAdjuntado) return null;

  const showK3 = hasApoderadoBanco === null || hasApoderadoBanco === undefined;
  const vig = evaluarVigenciaCliente(vigencia, fechaOtorgamientoNueva || null);

  // C1 — Clasificación defensiva. Solo aplica cuando K3 ya está resuelto
  // (hay que saber si HAY apoderado antes de discutir su tipo).
  const classifier = apoderado ? classifyApoderado(apoderado) : null;
  const showC1 =
    !showK3 &&
    hasApoderadoBanco === true &&
    !!apoderado &&
    !!classifier &&
    classifier.tipoEfectivo === null &&
    !!onSetTipoOverride;

  const warnings = (coherenciaWarnings || []).filter(Boolean);
  const suspicious = (coherenciaSuspicious || []).filter(Boolean);
  const showCoherencia = warnings.length > 0 || suspicious.length > 0;

  // Fase E — Bloqueo duro por NO_LEGIBLE.
  const hayNoLegible = warnings.some((w) => w.endsWith("_no_legible"));
  const showManualReviewCta =
    hayNoLegible && !!manualReviewPending && typeof onConfirmManualReview === "function";


  return (
    <div className="space-y-2">
      {showCoherencia && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] leading-snug"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <p className="font-semibold text-amber-600 dark:text-amber-400">
                Revisa manualmente los datos del poder
              </p>
              <p className="text-foreground/85">
                El sistema detectó posibles inconsistencias en lo que la IA leyó.
                Verifica contra el PDF antes de generar el documento final.
              </p>
              {warnings.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-foreground/85">
                  {warnings.map((w) => (
                    <li key={w}>{WARNING_LABELS[w] ?? w}</li>
                  ))}
                </ul>
              )}
              {suspicious.length > 0 && (
                <p className="text-[11px] text-foreground/70">
                  Campos a revisar:{" "}
                  {suspicious
                    .map((p) => SUSPICIOUS_FIELD_LABELS[p] ?? p)
                    .join(" · ")}
                </p>
              )}
              {showManualReviewCta && (
                <div className="pt-2 space-y-1.5 border-t border-amber-500/30">
                  <p className="text-[11px] text-foreground/75">
                    Al confirmar declaras que verificaste estos datos contra el documento original.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-8 text-[12px]"
                    disabled={manualReviewConfirming}
                    onClick={() => { void onConfirmManualReview?.(); }}
                  >
                    {manualReviewConfirming
                      ? "Generando documento…"
                      : "Confirmar revisión manual y generar documento"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


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

      {showC1 && classifier && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-[12px] leading-snug"
        >
          <div className="flex items-start gap-2">
            <UserRoundCog className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <p className="font-semibold text-amber-600 dark:text-amber-400">
                Confirma el tipo de apoderado
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-foreground/85">
                {classifier.motivos.map((m) => (
                  <li key={m}>{MOTIVO_LABELS[m] ?? m}</li>
                ))}
              </ul>
              <div className="pt-1">
                <SegmentedChoice
                  value={
                    apoderado?.tipo_override === "natural" || apoderado?.tipo_override === "juridica"
                      ? apoderado.tipo_override
                      : ""
                  }
                  onChange={(v) => onSetTipoOverride?.((v as TipoApoderado) || null)}
                  options={[
                    { value: "natural", label: "Persona natural" },
                    { value: "juridica", label: "Persona jurídica" },
                  ]}
                />
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
