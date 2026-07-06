// ============================================================================
// ProsaLiveRenderer — Pinta el string canónico devuelto por
// `daviviendaTemplate.renderComparecencia(ctx)` y añade un borde dorado al
// sufijo `notas_adicionales` si existe. NO re-renderiza prosa: solo hace un
// diff textual por sufijo (garantía de paridad byte-a-byte con el .docx).
// ============================================================================

import { useMemo } from "react";
import { daviviendaTemplate, mergeOverride } from "@/shared/prosaBancos";
import type { ProsaContext, ProsaApoderadoOverride } from "@/shared/prosaBancos/types";

interface Props {
  base: ProsaContext;
  override?: ProsaApoderadoOverride | null;
  section?: "comparecencia" | "antefirma" | "nota";
  className?: string;
}

export function ProsaLiveRenderer({ base, override, section = "comparecencia", className }: Props) {
  const { canonico, notas } = useMemo(() => {
    const withoutNotes: ProsaContext = { ...base, notas_adicionales: null };
    const canBase =
      section === "comparecencia"
        ? daviviendaTemplate.renderComparecencia(withoutNotes)
        : section === "antefirma"
          ? daviviendaTemplate.renderAntefirma(withoutNotes)
          : daviviendaTemplate.renderNotaAutorizacion(withoutNotes);

    const merged = mergeOverride(base, override ?? null);
    const notas = (merged.notas_adicionales ?? "").trim();
    return { canonico: canBase, notas };
  }, [base, override, section]);

  return (
    <div className={`space-y-2 text-[13px] leading-relaxed ${className ?? ""}`}>
      <div className="border-l-2 border-primary/50 pl-3 whitespace-pre-wrap text-foreground/90">
        {canonico}
      </div>
      {notas && section === "comparecencia" && (
        <div
          className="border-l-2 pl-3 whitespace-pre-wrap italic text-foreground/80"
          style={{ borderColor: "hsl(45 100% 45%)" }}
          aria-label="Notas adicionales del usuario"
        >
          {notas}
        </div>
      )}
    </div>
  );
}

export default ProsaLiveRenderer;
