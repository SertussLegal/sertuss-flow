// ============================================================================
// ProsaApoderadoModal — Edición y personalización de la prosa del apoderado
// (Modal Híbrido v5). Split-view: preview canónico (izq) + notas + IA (der).
//
// - Sanitiza con OverrideSchema antes de guardar.
// - Persiste en cancelaciones.prosa_apoderado_override (JSONB).
// - Adjuntar archivo de referencia → edge `adaptar-estilo-prosa` → sugiere notas.
// - Rescate desde textarea (marcador canónico pegado) → punto de decisión
//   explícito con `pendingSuggestion` antes de aplicar.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload, Sparkles, X, ChevronDown, ChevronRight, Check, RotateCw } from "lucide-react";

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
  classifyOverrideError,
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
const MAX_RETRY_COMMENT = 240;
const MAX_RAW_TEXT = 8000;

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
  const [rescueText, setRescueText] = useState<string | null>(null);
  // Punto de decisión IA: la sugerencia queda parqueada hasta que el usuario
  // decida (Aplicar / Descartar / Reintentar). NO reemplaza `notas` sola.
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);
  const [retryComment, setRetryComment] = useState("");
  const [lastRawText, setLastRawText] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset local state cuando abre con otro trámite.
  useEffect(() => {
    if (!open) return;
    setNotas(currentOverride?.notas_adicionales ?? "");
    setReformaActa(currentOverride?.campos_editados?.sociedad_constitucion?.reforma_acta_numero ?? "");
    setRazonAnterior(currentOverride?.campos_editados?.sociedad_constitucion?.razon_social_anterior ?? "");
    setRlCargo(currentOverride?.campos_editados?.representante_legal_cargo ?? "");
    setRlCiudad(currentOverride?.campos_editados?.representante_legal_cedula_expedida_en ?? "");
    setRescueText(null);
    setPendingSuggestion(null);
    setRetryComment("");
    setLastRawText(null);
    setShowOriginal(false);
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
  // Cuando hay una sugerencia pendiente, la vista previa refleja cómo QUEDARÍA
  // si el usuario la aplicara — sin tocar el estado real de `notas`.
  const displayOverride: ProsaApoderadoOverride = pendingSuggestion
    ? { ...previewOverride, notas_adicionales: pendingSuggestion }
    : previewOverride;

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
      // Orden: cerrar primero (evita race con pointer-events de Radix cuando
      // el padre invalida queries), luego notificar al padre, luego toast
      // (Sonner vive fuera del árbol del Dialog en App.tsx, sobrevive el desmontaje).
      onOpenChange(false);
      onSaved(payload);
      toast.success(isEmpty ? "Personalización eliminada" : "Personalización guardada");
    } catch (err) {
      const info = classifyOverrideError(err);
      if (info?.kind === "canonical_marker") {
        // Ofrecemos rescatar el texto pegado como referencia de estilo.
        setRescueText(notas);
        toast.error("Ese texto contiene estructura canónica del banco. Úsalo como referencia de estilo.");
        return;
      }
      const msg = info?.message ?? (err instanceof Error ? err.message : "Error al guardar");
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRescueAsReference = async () => {
    const src = rescueText?.trim();
    if (!src) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("adaptar-estilo-prosa", {
        body: { rawText: src, baseContext },
      });
      if (error) throw error;
      const notasSug = (data as { notas_sugeridas?: string; warning?: string })?.notas_sugeridas ?? "";
      if (!notasSug.trim()) {
        toast.info("La IA no extrajo notas reutilizables del texto");
        return;
      }
      // Parqueamos la sugerencia — NO tocamos `notas` hasta que el usuario decida.
      setPendingSuggestion(notasSug.slice(0, MAX_NOTAS));
      setLastRawText(src);
      setRescueText(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de IA";
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplySuggestion = () => {
    if (!pendingSuggestion) return;
    setNotas(pendingSuggestion);
    setPendingSuggestion(null);
    setRetryComment("");
    setLastRawText(null);
    setShowOriginal(false);
    toast.success("Sugerencia aplicada — revísala antes de guardar");
  };

  const handleDiscardSuggestion = () => {
    setPendingSuggestion(null);
    setRetryComment("");
    setLastRawText(null);
    setShowOriginal(false);
  };

  const handleRetryWithComment = async () => {
    const comment = retryComment.trim();
    if (!comment || !lastRawText) return;
    const combined = `${lastRawText}\n\n---\nAjuste solicitado por el usuario: ${comment}`.slice(0, MAX_RAW_TEXT);
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("adaptar-estilo-prosa", {
        body: { rawText: combined, baseContext },
      });
      if (error) throw error;
      const notasSug = (data as { notas_sugeridas?: string; warning?: string })?.notas_sugeridas ?? "";
      if (!notasSug.trim()) {
        // Puede ser que la sanitización de la edge haya rechazado la propuesta
        // (marcador canónico, token prohibido, etc.). No mostramos JSON crudo —
        // conservamos la propuesta previa visible y el comentario editable.
        toast.info("La IA propuso algo inválido — intenta con otro comentario");
        return;
      }
      setPendingSuggestion(notasSug.slice(0, MAX_NOTAS));
      setRetryComment("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error de IA";
      toast.error(msg);
    } finally {
      setAiLoading(false);
    }
  };

  const handleClear = () => {
    setNotas("");
    setReformaActa("");
    setRazonAnterior("");
    setRlCargo("");
    setRlCiudad("");
    setRescueText(null);
    setPendingSuggestion(null);
    setRetryComment("");
    setLastRawText(null);
    setShowOriginal(false);
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
      // Rutas de archivo van directo a `notas` — no vienen de un intento fallido
      // de pegar canónico, así que no requieren el punto de decisión con preview.
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

  // Interceptor de cierre: si hay sugerencia pendiente, exigimos confirmación
  // antes de descartarla silenciosamente. Cubre X, ESC y click fuera del modal.
  const handleOpenChange = (next: boolean) => {
    if (!next && pendingSuggestion !== null) {
      const ok = window.confirm(
        "Tienes una sugerencia de la IA sin decidir. Si cierras ahora, se descartará.",
      );
      if (!ok) return;
      setPendingSuggestion(null);
      setRetryComment("");
      setLastRawText(null);
      setShowOriginal(false);
    }
    onOpenChange(next);
  };

  const notasLen = notas.length;
  const saveBlockedBySuggestion = pendingSuggestion !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            <div className="px-4 py-2 border-b border-border/60 text-[11px] text-muted-foreground uppercase tracking-wide flex items-center justify-between">
              <span>Vista previa (Parágrafo PRIMERO)</span>
              {pendingSuggestion && (
                <Badge variant="outline" className="text-[9px] border-amber-500/60 text-amber-400">
                  Simulando sugerencia IA
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                    Comparecencia
                  </p>
                  <ProsaLiveRenderer base={baseContext} override={displayOverride} section="comparecencia" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                    Antefirma
                  </p>
                  <ProsaLiveRenderer base={baseContext} override={displayOverride} section="antefirma" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                    Nota de autorización
                  </p>
                  <ProsaLiveRenderer base={baseContext} override={displayOverride} section="nota" />
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
                    <Label className="text-xs font-semibold">
                      Notas adicionales <span className="font-normal text-muted-foreground">(se anexan al final del Parágrafo PRIMERO)</span>
                    </Label>
                    <span className={`text-[10px] ${notasLen > MAX_NOTAS ? "text-destructive" : "text-muted-foreground"}`}>
                      {notasLen}/{MAX_NOTAS}
                    </span>
                  </div>
                  <Textarea
                    rows={6}
                    value={notas}
                    onChange={(e) => {
                      setNotas(e.target.value.slice(0, MAX_NOTAS));
                      if (rescueText !== null) setRescueText(null);
                    }}
                    placeholder="Ej: 'El otorgamiento se realiza en las oficinas del banco por conveniencia operativa.'"
                    className="text-sm"
                    disabled={pendingSuggestion !== null}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Texto <span className="font-semibold">corto</span> que se añade al final del párrafo PRIMERO — no es la comparecencia completa.
                    Si quieres imitar un estilo largo, usa <span className="font-semibold">"Subir referencia"</span> abajo y la IA extraerá solo el estilo.
                    Prohibidos: <code className="text-[10px]">{FORBIDDEN_NOTE_TOKENS.slice(0, 3).join(", ")}</code> y marcadores canónicos ({FORBIDDEN_CANONICAL_MARKERS.length} bloqueados).
                  </p>

                  {/* Banda de rescate: aparece SOLO si el guardado falló por marcador canónico
                      y aún no hay una sugerencia pendiente. */}
                  {rescueText && !pendingSuggestion && (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 flex items-start gap-2">
                      <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <p className="text-[11px] leading-snug">
                          Detectamos estructura canónica (<code className="text-[10px]">COMPARECIÓ:</code>, <code className="text-[10px]">PRIMERO.-</code>, etc.) en tu nota.
                          Esos marcadores están reservados. ¿Quieres que la IA extraiga solo el <span className="font-semibold">estilo</span> del texto pegado y proponga una nota compatible?
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={aiLoading}
                          onClick={handleRescueAsReference}
                          className="gap-1.5 text-xs h-7"
                        >
                          {aiLoading ? (
                            <><Loader2 className="h-3 w-3 animate-spin" />Procesando...</>
                          ) : (
                            <><Sparkles className="h-3 w-3" />Usar como referencia de estilo</>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Punto de decisión IA */}
                  {pendingSuggestion && (
                    <div
                      className="rounded-md border p-3 space-y-3"
                      style={{ borderColor: "hsl(45 100% 45% / 0.6)", background: "hsl(45 100% 45% / 0.06)" }}
                      aria-label="Sugerencia de la IA pendiente de decisión"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-400" />
                        <p className="text-xs font-semibold">Sugerencia de la IA — pendiente de tu decisión</p>
                      </div>

                      {lastRawText && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowOriginal((v) => !v)}
                            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            {showOriginal ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {showOriginal ? "Ocultar" : "Ver"} texto original que pegaste
                          </button>
                          {showOriginal && (
                            <pre className="mt-1.5 text-[10px] leading-snug whitespace-pre-wrap bg-muted/40 rounded p-2 max-h-32 overflow-y-auto text-muted-foreground">
                              {lastRawText}
                            </pre>
                          )}
                        </div>
                      )}

                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                          Propuesta IA
                        </p>
                        <div className="text-[12px] leading-snug whitespace-pre-wrap bg-background/60 rounded border border-border/60 p-2 max-h-40 overflow-y-auto">
                          {pendingSuggestion}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Mira el panel izquierdo para ver cómo quedaría aplicada al Parágrafo PRIMERO.
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleApplySuggestion}
                          disabled={aiLoading}
                          className="gap-1.5 text-xs h-7"
                        >
                          <Check className="h-3 w-3" />Aplicar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleDiscardSuggestion}
                          disabled={aiLoading}
                          className="gap-1.5 text-xs h-7"
                        >
                          <X className="h-3 w-3" />Descartar
                        </Button>
                      </div>

                      {lastRawText && (
                        <div className="space-y-1.5 pt-1 border-t border-border/40">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                            Reintentar con un comentario
                          </p>
                          <div className="flex items-center gap-2">
                            <Input
                              value={retryComment}
                              onChange={(e) => setRetryComment(e.target.value.slice(0, MAX_RETRY_COMMENT))}
                              placeholder="Ej: más formal, menciona el poder..."
                              className="h-8 text-xs"
                              disabled={aiLoading}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && retryComment.trim() && !aiLoading) {
                                  e.preventDefault();
                                  void handleRetryWithComment();
                                }
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={aiLoading || !retryComment.trim()}
                              onClick={handleRetryWithComment}
                              className="gap-1.5 text-xs h-8 shrink-0"
                            >
                              {aiLoading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCw className="h-3 w-3" />
                              )}
                              Reintentar
                            </Button>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {retryComment.length}/{MAX_RETRY_COMMENT}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <p className="text-xs font-semibold">Adaptar estilo desde un documento</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Sube una escritura o borrador de referencia. La IA leerá el estilo y sugerirá
                    notas — no persistimos el archivo, se procesa en memoria y se descarta.
                    También puedes pegar un párrafo largo arriba: si detectamos estructura canónica te
                    ofreceremos usarlo como referencia automáticamente.
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
                    disabled={aiLoading || pendingSuggestion !== null}
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
            {saveBlockedBySuggestion && (
              <span className="text-[10px] text-muted-foreground max-w-[220px] leading-tight">
                Decide qué hacer con la sugerencia antes de guardar
              </span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || notasLen > MAX_NOTAS || saveBlockedBySuggestion}
              title={saveBlockedBySuggestion ? "Decide qué hacer con la sugerencia antes de guardar" : undefined}
            >
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
