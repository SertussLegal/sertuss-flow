import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Upload, FileText, CheckCircle, AlertTriangle, Loader2, ArrowRight, ArrowLeft, X, Coins,
} from "lucide-react";
import type { NivelConfianza } from "@/lib/types";
import { unwrapConfianza, unwrapConfianzaBool } from "@/lib/types";

type DocSlot = {
  label: string;
  type: string;
  file: File | null;
  status: "idle" | "uploading" | "done" | "error";
  result: any | null;
  error: string | null;
};

const defaultSlots: DocSlot[] = [
  { label: "Certificado de Tradición y Libertad", type: "certificado_tradicion", file: null, status: "idle", result: null, error: null },
  { label: "Cédula Catastral / Boletín Predial", type: "predial", file: null, status: "idle", result: null, error: null },
  { label: "Escritura Antecedente (Linderos)", type: "escritura_antecedente", file: null, status: "idle", result: null, error: null },
];

const DocumentUploadStep = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, credits, refreshCredits } = useAuth();
  const [slots, setSlots] = useState<DocSlot[]>(defaultSlots.map(s => ({ ...s })));
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const completedCount = slots.filter(s => s.status === "done").length;
  const hasAny = slots.some(s => s.status === "done");
  const isProcessing = slots.some(s => s.status === "uploading");

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFileSelect = useCallback(async (index: number, file: File) => {
    if (!profile?.organization_id) return;

    setSlots(prev => prev.map((s, i) => i === index ? { ...s, file, status: "uploading", error: null } : s));

    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type: slots[index].type },
      });

      if (error) throw new Error(error.message);

      setSlots(prev => prev.map((s, i) => i === index ? { ...s, status: "done", result: data?.data || null } : s));
      toast({ title: `${slots[index].label} procesado`, description: "Datos extraídos correctamente." });
    } catch (err: any) {
      setSlots(prev => prev.map((s, i) => i === index ? { ...s, status: "error", error: err.message } : s));
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }, [profile, slots, toast]);

  const removeFile = (index: number) => {
    setSlots(prev => prev.map((s, i) => i === index ? { ...defaultSlots[index] } : s));
  };

  // Build pre-populated state and navigate to validation
  const handleContinue = async () => {
    if (!profile?.organization_id || !profile?.id) return;

    // Build metadata from extracted results with confidence info
    const confianzaMap: Record<string, NivelConfianza> = {};
    const extractedInmueble: Record<string, any> = {};
    const extractedPersonas: any[] = [];
    const extractedDocumento: Record<string, any> = {};

    for (const slot of slots) {
      if (slot.status !== "done" || !slot.result) continue;
      const d = slot.result;

      if (slot.type === "certificado_tradicion") {
        // Process inmueble fields with confidence
        if (d.inmueble) {
          for (const [key, val] of Object.entries(d.inmueble)) {
            if (val && typeof val === "object" && "valor" in (val as any)) {
              const { valor, confianza } = unwrapConfianza(val as any);
              if (valor) {
                extractedInmueble[key] = valor;
                confianzaMap[`inmueble.${key}`] = confianza;
              }
            } else if (val && typeof val === "object" && "valor" in (val as any)) {
              const { valor, confianza } = unwrapConfianzaBool(val as any);
              extractedInmueble[key] = valor;
              confianzaMap[`inmueble.${key}`] = confianza;
            } else if (val != null) {
              extractedInmueble[key] = val;
            }
          }
        }
        if (d.documento) {
          for (const [key, val] of Object.entries(d.documento)) {
            const { valor, confianza } = unwrapConfianza(val as any);
            if (valor) {
              extractedDocumento[key] = valor;
              confianzaMap[`documento.${key}`] = confianza;
            }
          }
        }
        if (d.personas && Array.isArray(d.personas)) {
          for (const p of d.personas) {
            extractedPersonas.push({
              nombre_completo: p.nombre_completo,
              numero_identificacion: p.numero_identificacion,
              tipo_identificacion: p.tipo_identificacion,
              lugar_expedicion: p.lugar_expedicion,
              confianza: p.confianza || "alta",
            });
          }
        }
      } else if (slot.type === "predial") {
        for (const [key, val] of Object.entries(d)) {
          const { valor, confianza } = unwrapConfianza(val as any);
          if (valor) {
            extractedInmueble[key] = valor;
            confianzaMap[`inmueble.${key}`] = confianza;
          }
        }
      } else if (slot.type === "escritura_antecedente") {
        const le = unwrapConfianza(d.linderos_especiales);
        const lg = unwrapConfianza(d.linderos_generales);
        const linderos = [le.valor, lg.valor].filter(Boolean).join("\n\n--- Linderos Generales ---\n\n");
        if (linderos) {
          extractedInmueble.linderos = linderos;
          confianzaMap["inmueble.linderos"] = le.confianza === "baja" || lg.confianza === "baja" ? "baja" : le.confianza;
        }
      }
    }

    // Create draft tramite with extracted metadata
    const metadata: Record<string, any> = {
      extracted_inmueble: extractedInmueble,
      extracted_personas: extractedPersonas,
      extracted_documento: extractedDocumento,
      confianza_map: confianzaMap,
      progress: 0,
    };

    const { data: tramite, error } = await supabase.from("tramites").insert({
      tipo: "Compraventa",
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: "pendiente" as any,
      metadata: metadata as any,
    }).select().single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    navigate(`/tramite/${tramite.id}`);
  };

  const statusIcon = (status: DocSlot["status"]) => {
    switch (status) {
      case "uploading": return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "done": return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "error": return <AlertTriangle className="h-5 w-5 text-destructive" />;
      default: return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  // Count low confidence fields
  const lowConfCount = slots.reduce((count, slot) => {
    if (slot.status !== "done" || !slot.result) return count;
    const countLow = (obj: any): number => {
      let c = 0;
      if (!obj || typeof obj !== "object") return 0;
      for (const val of Object.values(obj)) {
        if (val && typeof val === "object" && "confianza" in (val as any)) {
          if ((val as any).confianza === "baja") c++;
        } else if (val && typeof val === "object") {
          c += countLow(val);
        }
      }
      return c;
    };
    return count + countLow(slot.result);
  }, 0);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="border-b bg-notarial-dark text-white shrink-0">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost-dark" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
          </Button>
          <span className="text-sm font-medium">Nuevo Trámite — Carga de Documentos</span>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="outline" className="border-notarial-gold/30 text-notarial-gold">
              <Coins className="mr-1 h-3 w-3" /> {credits} créditos
            </Badge>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container max-w-2xl py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Sube los documentos del expediente</h1>
            <p className="text-muted-foreground mt-1">
              La IA extraerá automáticamente los datos relevantes. Los campos con baja confianza se resaltarán en ámbar para tu verificación.
            </p>
          </div>

          <Progress value={(completedCount / slots.length) * 100} className="h-2" />

          <div className="space-y-3">
            {slots.map((slot, index) => (
              <Card key={index} className="p-4">
                <div className="flex items-center gap-3">
                  {statusIcon(slot.status)}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{slot.label}</p>
                    {slot.file && (
                      <p className="text-xs text-muted-foreground truncate">{slot.file.name}</p>
                    )}
                    {slot.error && (
                      <p className="text-xs text-destructive">{slot.error}</p>
                    )}
                    {slot.status === "uploading" && (
                      <div className="mt-2 space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {slot.status === "done" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeFile(index)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      ref={(el) => { fileInputRefs.current[index] = el; }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(index, file);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant={slot.status === "idle" ? "default" : "outline"}
                      size="sm"
                      disabled={slot.status === "uploading"}
                      onClick={() => fileInputRefs.current[index]?.click()}
                    >
                      <Upload className="mr-1 h-4 w-4" />
                      {slot.status === "idle" ? "Subir" : slot.status === "error" ? "Reintentar" : "Reemplazar"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {lowConfCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <strong>{lowConfCount} campo(s)</strong> con baja confianza. Se resaltarán en ámbar en el formulario para que los verifiques.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => navigate("/tramite/nuevo")}>
              Saltar (formulario vacío)
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!hasAny || isProcessing}
              className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
            >
              {isProcessing ? (
                <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Procesando...</>
              ) : (
                <><ArrowRight className="mr-1 h-4 w-4" /> Continuar a Validación</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentUploadStep;
