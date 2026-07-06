// ============================================================================
// ProsaApoderadoModal — Edición y personalización de la prosa del apoderado
// (Modal Híbrido v5). Split-view: preview canónico (izq) + notas + IA (der).
//
// - Sanitiza con OverrideSchema antes de guardar.
// - Persiste en cancelaciones.prosa_apoderado_override (JSONB).
// - Adjuntar archivo de referencia → edge `adaptar-estilo-prosa` → sugiere notas.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

import { supabase } from "@/integrations/supabase/client";
import {
  OverrideSchema,
  FORBIDDEN_NOTE_TOKENS,
  FORBIDDEN_CANONICAL_MARKERS,
} from "@shared/prosaBancos/overrideSchema";
import type { ProsaContext, ProsaApoderadoOverride } from "@shared/prosaBancos/types";
import { ProsaLiveRenderer } from "./ProsaLiveRenderer";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cancelacionId: string;
  baseContext: ProsaContext;
  currentOverride: ProsaApoderadoOverride | null;
  onSaved: (override: ProsaApoderadoOverride | null) => void;
}

const MAX_NOTAS = 2000;

export function ProsaApoderadoModal({
  open,
  onOpenChange,
  cancelacionId,
  baseContext,
  currentOverride,
  onSaved,
}: Props) {
  const [notas, setNotas] = useState(currentOverride?.notas_adicionales ?? "");
  const [reformaActa, setReformaActa] = useState(
    currentOverride?.campos_editados?.sociedad_constitucion?.reforma_acta_numero ?? "",
  );
  const [razonAnterior, setRazonAnterior] = useState(
    currentOverride?.campos_editados?.sociedad_constitucion?.razon_social_anterior ?? "",
  );
  const [rlCargo, setRlCargo] = useState(
    currentOverride?.campos_editados?.representante_legal_cargo ?? "",
  );
  const [rlCiudad, setRlCiudad] = useState(
    currentOverride?.campos_editados?.representante_legal_cedula_expedida_en ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset local state cuando abre con otro trámite.
  useEffect(() => {
    if (!open) return;
    setNotas(currentOverride?.notas_adicionales ?? "");
    setReformaActa(currentOverride?.campos_editados?.sociedad_constitucion?.reforma_acta_numero ?? "");
    setRazonAnterior(currentOverride?.campos_editados?.sociedad_constitucion?.razon_social_anterior ?? "");
    setRlCargo(currentOverride?.campos_editados?.representante_legal_cargo ?? "");
    setRlCiudad(currentOverride?.campos_editados?.representante_legal_cedula_expedida_en ?? "");
  }, [open, currentOverride]);

  const buildOverride = (): ProsaApoderadoOverride => ({
    notas_adicionales: notas.trim() || null,
    campos_editados: {
      sociedad_constitucion: {
        reforma_acta_numero: reformaActa.trim() || null,
        razon_social_anterior: razonAnterior.trim() || null,
      },
      representante_legal_cargo: rlCargo.trim() || null,
      representante_legal_cedula_expedida_en: rlCiudad.trim() || null,
    },
    fuente_referencia: "manual",
    actualizado_en: new Date().toISOString(),
  });

  const previewOverride = buildOverride();

  const handleSave = async () => {
    try {
      const parsed = OverrideSchema.parse(previewOverride);
      setSaving(true);
      const isEmpty =
        !parsed.notas_adicionales &&
        !parsed.campos_editados?.sociedad_constitucion?.reforma_acta_numero &&
        !parsed.campos_editados?.sociedad_constitucion?.razon_social_anterior &&
        !parsed.campos_editados?.representante_legal_cargo &&
        !parsed.campos_editados?.representante_legal_cedula_expedida_en;
      const payload = isEmpty ? null : parsed;
      const { error } = await supabase
        .from("cancelaciones")
        .update({ prosa_apoderado_override: payload as never })
        .eq("id", cancelacionId);
      if (error) throw error;
      toast.success(isEmpty ? "Personalización eliminada" : "Personalización guardada");
      onSaved(payload);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al guardar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setNotas("");
    setReformaActa("");
    setRazonAnterior("");
    setRlCargo("");
    setRlCiudad("");
  };

  const handleFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Archivo excede 8 MB");
      return;
    }
    setAiLoading(true);
    try {
      const b64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("adaptar-estilo-prosa", {
        body: {
          fileBase64: b64,
          mimeType: file.type || "application/octet-stream",
          fileName: file.name,
          baseContext,
        },
      });
      if (error) throw error;
      const notasSug = (data as { notas_sugeridas?: string })?.notas_sugeridas ?? "";
      if (!notasSug.trim()) {
        toast.info("La IA no detectó notas útiles en el documento");
        return;
      }
      setNotas(notasSug.slice(0, MAX_NOTAS));
      toast.success("Sugerencia aplicada — revísala antes de guardar");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de IA";
      toast.error(msg);
    } finally {
      setAiLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const notasLen = notas.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <DialogTitle>Personalizar prosa del Apoderado — Davivienda</DialogTitle>
            <Badge variant="outline" className="text-[10px]">v5 · Modal Híbrido</Badge>
          </div>
          <DialogDescription className="text-xs">
            La estructura canónica es inmutable. Solo puedes ajustar campos permitidos y añadir notas.
            Los cambios se guardan <span className="font-semibold">solo en este trámite</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 flex-1 min-h-0 overflow-hidden">
          {/* Preview canónico — izquierda */}
          <div className="border-r border-border min-h-0 overflow-hidden flex flex-col">
            <div className="px-4 py-2 border-b border-border/60 text-[11px] text-muted-foreground uppercase tracking-wide">
              Vista previa (Parágrafo PRIMERO)
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                    Comparecencia
                  </p>
                  <ProsaLiveRenderer base={baseContext} override={previewOverride} section="comparecencia" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                    Antefirma
                  </p>
                  <ProsaLiveRenderer base={baseContext} override={previewOverride} section="antefirma" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                    Nota de autorización
                  </p>
                  <ProsaLiveRenderer base={baseContext} override={previewOverride} section="nota" />
                </div>
              </div>
            </ScrollArea>
          </div>

          {/* Edición — derecha */}
          <div className="min-h-0 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-5">
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Notas adicionales</Label>
                    <span className={`text-[10px] ${notasLen > MAX_NOTAS ? "text-destructive" : "text-muted-foreground"}`}>
                      {notasLen}/{MAX_NOTAS}
                    </span>
                  </div>
                  <Textarea
                    rows={6}
                    value={notas}
                    onChange={(e) => setNotas(e.target.value.slice(0, MAX_NOTAS))}
                    placeholder="Ej: 'El otorgamiento se realiza en las oficinas del banco por conveniencia operativa.'"
                    className="text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Se anexan al final de la cláusula PRIMERO. Prohibidos:{" "}
                    <code className="text-[10px]">{FORBIDDEN_NOTE_TOKENS.slice(0, 3).join(", ")}</code>{" "}
                    y marcadores canónicos ({FORBIDDEN_CANONICAL_MARKERS.length} bloqueados).
                  </p>
                </section>

                <section className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <p className="text-xs font-semibold">Adaptar estilo desde un documento</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Sube una escritura o borrador de referencia. La IA leerá el estilo y sugerirá
                    notas — no persistimos el archivo, se procesa en memoria y se descarta.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={aiLoading}
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-1.5 text-xs"
                  >
                    {aiLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analizando...</>
                    ) : (
                      <><Upload className="h-3.5 w-3.5" />Subir referencia</>
                    )}
                  </Button>
                </section>

                <section className="space-y-3">
                  <p className="text-xs font-semibold">Campos editables (persona jurídica)</p>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Nº acta de reforma</Label>
                    <Input
                      value={reformaActa}
                      onChange={(e) => setReformaActa(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Ej: 123"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Razón social anterior</Label>
                    <Input
                      value={razonAnterior}
                      onChange={(e) => setRazonAnterior(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Ej: SOCIEDAD FIDUCIARIA XYZ S.A."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Cargo del representante legal del banco</Label>
                    <Input
                      value={rlCargo}
                      onChange={(e) => setRlCargo(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Ej: Vicepresidente Jurídico"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Ciudad expedición cédula del rep. legal</Label>
                    <Input
                      value={rlCiudad}
                      onChange={(e) => setRlCiudad(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Ej: Bogotá D.C."
                    />
                  </div>
                </section>
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="p-4 border-t border-border shrink-0 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleClear} className="text-xs gap-1.5">
            <X className="h-3.5 w-3.5" />Limpiar personalización
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || notasLen > MAX_NOTAS}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Guardando...</> : "Guardar y cerrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default ProsaApoderadoModal;
