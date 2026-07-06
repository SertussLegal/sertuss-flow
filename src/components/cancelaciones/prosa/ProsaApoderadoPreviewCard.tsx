// ============================================================================
// ProsaApoderadoPreviewCard — Tarjeta compacta bajo el formulario del apoderado
// que muestra un preview de la comparecencia según el tipo detectado y abre
// el `ProsaApoderadoModal` al hacer click.
// ============================================================================

import { useMemo, useState } from "react";
import { Sparkles, Pencil, User, Building2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { daviviendaTemplate } from "@shared/prosaBancos";
import type { ProsaContext, ProsaApoderadoOverride } from "@shared/prosaBancos/types";
import { ProsaApoderadoModal } from "./ProsaApoderadoModal";

interface Props {
  cancelacionId: string;
  baseContext: ProsaContext;
  override: ProsaApoderadoOverride | null;
  onOverrideChange: (o: ProsaApoderadoOverride | null) => void;
  disabled?: boolean;
}

export function ProsaApoderadoPreviewCard({
  cancelacionId,
  baseContext,
  override,
  onOverrideChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);

  const { preview, tipo, personalizado } = useMemo(() => {
    const tipoStr = baseContext.apoderado.tipo_override || baseContext.apoderado.tipo || null;
    const text = daviviendaTemplate.renderComparecencia({
      ...baseContext,
      notas_adicionales: override?.notas_adicionales ?? baseContext.notas_adicionales ?? null,
    });
    const first = text.slice(0, 220).trim();
    const hasNotas = !!(override?.notas_adicionales ?? "").trim();
    const campos = override?.campos_editados;
    const hasCampos = !!(
      campos?.sociedad_constitucion?.reforma_acta_numero ||
      campos?.sociedad_constitucion?.razon_social_anterior ||
      campos?.representante_legal_cargo ||
      campos?.representante_legal_cedula_expedida_en
    );
    return {
      preview: first + (text.length > 220 ? "…" : ""),
      tipo: tipoStr,
      personalizado: hasNotas || hasCampos,
    };
  }, [baseContext, override]);

  const tipoLabel =
    tipo === "juridica" ? "Persona jurídica" : tipo === "natural" ? "Persona natural" : "Tipo no definido";
  const TipoIcon = tipo === "juridica" ? Building2 : User;

  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className="group w-full text-left rounded-md border border-border/60 bg-muted/10 hover:bg-muted/30 hover:border-primary/40 transition-colors p-3 space-y-2 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Abrir editor de prosa del apoderado"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold">Prosa del apoderado (preview)</span>
            <Badge variant="outline" className="text-[9px] gap-1 py-0 h-4">
              <TipoIcon className="h-2.5 w-2.5" />
              {tipoLabel}
            </Badge>
            {personalizado && (
              <Badge className="text-[9px] py-0 h-4" style={{ backgroundColor: "hsl(45 100% 45%)", color: "#000" }}>
                Personalizado
              </Badge>
            )}
          </div>
          <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 pointer-events-none">
            <span><Pencil className="h-3 w-3" />Editar</span>
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">{preview}</p>
        <p className="text-[9px] text-muted-foreground/70">
          Impacta Parágrafo PRIMERO y SEGUNDO. Click para ver y personalizar.
        </p>
      </button>

      <ProsaApoderadoModal
        open={open}
        onOpenChange={setOpen}
        cancelacionId={cancelacionId}
        baseContext={baseContext}
        currentOverride={override}
        onSaved={onOverrideChange}
      />
    </>
  );
}

export default ProsaApoderadoPreviewCard;
