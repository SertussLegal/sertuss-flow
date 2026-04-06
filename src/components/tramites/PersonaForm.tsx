import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Info, Upload, Loader2, AlertTriangle, FileWarning } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Persona, NivelConfianza } from "@/lib/types";
import { createEmptyPersona } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import OcrBadge from "./OcrBadge";
import OcrSuggestion from "./OcrSuggestion";

interface PersonaFormProps {
  title: string;
  personas: Persona[];
  onChange: (personas: Persona[]) => void;
  confianzaFields?: Map<string, NivelConfianza>;
  onConfianzaChange?: (field: string, confianza: NivelConfianza) => void;
  hasEscrituraProcessed?: boolean;
}

const PersonaForm = ({ title, personas, onChange, confianzaFields, onConfianzaChange, hasEscrituraProcessed }: PersonaFormProps) => {
  const { profile, credits, refreshCredits } = useAuth();
  const { toast } = useToast();
  const [scanningIndex, setScanningIndex] = useState<number | null>(null);
  const [ocrFields, setOcrFields] = useState<Map<number, Set<string>>>(new Map());
  const [suggestions, setSuggestions] = useState<Map<string, string>>(new Map());
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const suggestionKey = (index: number, field: string) => `${index}:${field}`;

  const updatePersona = (index: number, field: keyof Persona, value: any) => {
    setOcrFields(prev => {
      const personaSet = prev.get(index);
      if (!personaSet?.has(field)) return prev;
      const next = new Map(prev);
      const newSet = new Set(personaSet);
      newSet.delete(field);
      next.set(index, newSet);
      return next;
    });
    const sk = suggestionKey(index, field);
    setSuggestions(prev => {
      if (!prev.has(sk)) return prev;
      const next = new Map(prev);
      next.delete(sk);
      return next;
    });
    // Auto-promote confidence on manual edit
    const confKey = `persona.${index}.${field}`;
    if (confianzaFields?.get(confKey) === "baja" && onConfianzaChange) {
      onConfianzaChange(confKey, "alta");
    }
    const updated = [...personas];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const addPersona = () => onChange([...personas, createEmptyPersona()]);

  const removePersona = (index: number) => {
    if (personas.length <= 1) return;
    onChange(personas.filter((_, i) => i !== index));
    setOcrFields(prev => {
      const next = new Map<number, Set<string>>();
      prev.forEach((v, k) => {
        if (k < index) next.set(k, v);
        else if (k > index) next.set(k - 1, v);
      });
      return next;
    });
  };

  const confirmSuggestion = (index: number, field: string) => {
    const sk = suggestionKey(index, field);
    const value = suggestions.get(sk);
    if (!value) return;
    setSuggestions(prev => { const n = new Map(prev); n.delete(sk); return n; });
    setOcrFields(prev => {
      const next = new Map(prev);
      const existing = next.get(index) || new Set<string>();
      existing.add(field);
      next.set(index, existing);
      return next;
    });
    const updated = [...personas];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const ignoreSuggestion = (index: number, field: string) => {
    const sk = suggestionKey(index, field);
    setSuggestions(prev => { const n = new Map(prev); n.delete(sk); return n; });
  };

  const handleScanCedula = async (index: number, file: File) => {
    if (!profile?.organization_id) return;

    const { data: success } = await supabase.rpc("consume_credit", { org_id: profile.organization_id });
    if (!success) {
      toast({ title: "Sin créditos", description: "No hay créditos disponibles para procesar documentos.", variant: "destructive" });
      return;
    }

    setScanningIndex(index);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type: "cedula" },
      });

      if (error) throw new Error(error.message);
      if (data?.data) {
        const extracted = data.data;
        const updated = [...personas];
        const filled: string[] = [];
        const newSuggestions = new Map(suggestions);

        const tryApply = (ocrField: string, personaField: keyof Persona, ocrRaw: any) => {
          // Unwrap confidence wrapper
          let ocrValue: string | undefined;
          if (ocrRaw && typeof ocrRaw === "object" && "valor" in ocrRaw) {
            ocrValue = ocrRaw.valor;
            if (ocrRaw.confianza && onConfianzaChange) {
              onConfianzaChange(`persona.${index}.${personaField}`, ocrRaw.confianza);
            }
          } else if (typeof ocrRaw === "string") {
            ocrValue = ocrRaw;
          }
          if (!ocrValue) return;
          
          const current = updated[index][personaField];
          const hasValue = typeof current === "string" && current.length > 0;
          if (hasValue) {
            newSuggestions.set(suggestionKey(index, personaField), ocrValue);
          } else {
            updated[index] = { ...updated[index], [personaField]: ocrValue };
            filled.push(personaField);
          }
        };

        tryApply("nombre_completo", "nombre_completo", extracted.nombre_completo);
        tryApply("numero_cedula", "numero_cedula", extracted.numero_cedula);
        tryApply("municipio_domicilio", "municipio_domicilio", extracted.municipio_expedicion);

        setSuggestions(newSuggestions);
        onChange(updated);

        if (filled.length > 0) {
          setOcrFields(prev => {
            const next = new Map(prev);
            const existing = next.get(index) || new Set<string>();
            filled.forEach(f => existing.add(f));
            next.set(index, existing);
            return next;
          });
        }
        toast({ title: "Cédula procesada", description: "Datos extraídos correctamente." });
      }
      await refreshCredits();
    } catch (err: any) {
      await supabase.rpc("restore_credit", { org_id: profile.organization_id });
      await refreshCredits();
      toast({ title: "Error al procesar", description: err.message, variant: "destructive" });
    } finally {
      setScanningIndex(null);
    }
  };

  const ocr = (index: number, field: string) =>
    ocrFields.get(index)?.has(field) ? <OcrBadge /> : null;

  const wrapWithSuggestion = (index: number, field: string, input: React.ReactNode) => {
    const sk = suggestionKey(index, field);
    const suggested = suggestions.get(sk);
    if (!suggested) return input;
    return (
      <OcrSuggestion value={suggested} onConfirm={() => confirmSuggestion(index, field)} onIgnore={() => ignoreSuggestion(index, field)}>
        <div>{input}</div>
      </OcrSuggestion>
    );
  };

  const fieldClassName = (index: number, field: string) => {
    const confKey = `persona.${index}.${field}`;
    const conf = confianzaFields?.get(confKey);
    if (conf === "baja") return "border-amber-400 ring-1 ring-amber-300";
    return "";
  };

  const confBadge = (index: number, field: string) => {
    const confKey = `persona.${index}.${field}`;
    const conf = confianzaFields?.get(confKey);
    if (conf !== "baja") return null;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertTriangle className="inline h-3.5 w-3.5 text-amber-500 ml-1" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          Verificación requerida — la IA tiene baja confianza en este dato
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{title}</h3>
        <Button type="button" variant="outline" size="sm" onClick={addPersona}>
          <Plus className="mr-1 h-4 w-4" />
          Agregar
        </Button>
      </div>

      {!hasEscrituraProcessed && personas.some(p => p.nombre_completo && (!p.estado_civil || !p.direccion)) && (
        <Alert className="border-dashed border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
            Para completar <strong>estado civil</strong> y <strong>dirección</strong>, sube la <strong>Escritura Antecedente</strong> en la pestaña Inmueble.
          </AlertDescription>
        </Alert>
      )}

      {personas.map((persona, index) => (
        <div key={persona.id} className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {title.slice(0, -2).replace(/e$/, "")}or {index + 1}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                ref={(el) => { fileInputRefs.current[index] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleScanCedula(index, file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={scanningIndex !== null || credits === 0}
                onClick={() => fileInputRefs.current[index]?.click()}
              >
                {scanningIndex === index ? (
                  <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Procesando documento...</>
                ) : (
                  <><Upload className="mr-1 h-4 w-4" /> Cargar Cédula</>
                )}
              </Button>
              {personas.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removePersona(index)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>

          {/* Banner when no cédula data loaded */}
          {!persona.nombre_completo && !persona.numero_cedula && (
            <Alert className="border-dashed border-muted-foreground/40 bg-muted/30">
              <FileWarning className="h-4 w-4 text-muted-foreground" />
              <AlertDescription className="text-sm text-muted-foreground">
                No se cargó cédula para esta persona. Puede cargarla aquí o llenar los datos manualmente.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3">
            <Switch
              checked={persona.es_persona_juridica}
              onCheckedChange={(v) => updatePersona(index, "es_persona_juridica", v)}
            />
            <Label>¿Es Persona Jurídica?</Label>
          </div>

          {persona.es_persona_juridica ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Razón Social</Label>
                <Input value={persona.razon_social} onChange={(e) => updatePersona(index, "razon_social", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>NIT</Label>
                <Input value={persona.nit} onChange={(e) => updatePersona(index, "nit", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Representante Legal — Nombre</Label>
                <Input value={persona.representante_legal_nombre} onChange={(e) => updatePersona(index, "representante_legal_nombre", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Representante Legal — Cédula</Label>
                <Input value={persona.representante_legal_cedula} onChange={(e) => updatePersona(index, "representante_legal_cedula", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Municipio de Domicilio</Label>
                <Input value={persona.municipio_domicilio} onChange={(e) => updatePersona(index, "municipio_domicilio", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Dirección</Label>
                <Input value={persona.direccion} onChange={(e) => updatePersona(index, "direccion", e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre Completo {ocr(index, "nombre_completo")} {confBadge(index, "nombre_completo")}</Label>
                {wrapWithSuggestion(index, "nombre_completo",
                  <Input data-field-input={`${title.toLowerCase().includes("vendedor") ? "vendedor" : "comprador"}_${index}_nombre_completo`} className={fieldClassName(index, "nombre_completo")} value={persona.nombre_completo} onChange={(e) => updatePersona(index, "nombre_completo", e.target.value)} />
                )}
              </div>
              <div className="space-y-2">
                <Label>Número de Cédula {ocr(index, "numero_cedula")} {confBadge(index, "numero_cedula")}</Label>
                {wrapWithSuggestion(index, "numero_cedula",
                  <Input data-field-input={`${title.toLowerCase().includes("vendedor") ? "vendedor" : "comprador"}_${index}_numero_cedula`} className={fieldClassName(index, "numero_cedula")} value={persona.numero_cedula} onChange={(e) => updatePersona(index, "numero_cedula", e.target.value)} />
                )}
              </div>
              <div className="space-y-2">
                <Label>Estado Civil</Label>
                <Input data-field-input={`${title.toLowerCase().includes("vendedor") ? "vendedor" : "comprador"}_${index}_estado_civil`} value={persona.estado_civil} onChange={(e) => updatePersona(index, "estado_civil", e.target.value)} />
                {persona.nombre_completo && persona.numero_cedula && !persona.estado_civil && (
                  <span className="text-xs text-muted-foreground italic">ⓘ Se extrae de la escritura antecedente</span>
                )}
              </div>
              <div className="space-y-2">
                <Label>Municipio de Domicilio {ocr(index, "municipio_domicilio")} {confBadge(index, "municipio_domicilio")}</Label>
                {wrapWithSuggestion(index, "municipio_domicilio",
                  <Input data-field-input={`${title.toLowerCase().includes("vendedor") ? "vendedor" : "comprador"}_${index}_municipio_domicilio`} className={fieldClassName(index, "municipio_domicilio")} value={persona.municipio_domicilio} onChange={(e) => updatePersona(index, "municipio_domicilio", e.target.value)} />
                )}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Dirección</Label>
                <Input data-field-input={`${title.toLowerCase().includes("vendedor") ? "vendedor" : "comprador"}_${index}_direccion`} value={persona.direccion} onChange={(e) => updatePersona(index, "direccion", e.target.value)} />
                {persona.nombre_completo && persona.numero_cedula && !persona.direccion && (
                  <span className="text-xs text-muted-foreground italic">ⓘ Se extrae de la escritura antecedente</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={persona.actua_mediante_apoderado}
                onCheckedChange={(v) => updatePersona(index, "actua_mediante_apoderado", v)}
              />
              <Label className="text-base font-medium">¿Actúa mediante Apoderado?</Label>
            </div>
            {persona.actua_mediante_apoderado && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nombre del Apoderado</Label>
                  <Input value={persona.apoderado_persona_nombre} onChange={(e) => updatePersona(index, "apoderado_persona_nombre", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cédula del Apoderado</Label>
                  <Input value={persona.apoderado_persona_cedula} onChange={(e) => updatePersona(index, "apoderado_persona_cedula", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Municipio de Domicilio del Apoderado</Label>
                  <Input value={persona.apoderado_persona_municipio} onChange={(e) => updatePersona(index, "apoderado_persona_municipio", e.target.value)} placeholder="Ej: Bogotá D.C." />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-md border border-dashed border-accent bg-accent/5 p-3">
            <Checkbox
              checked={persona.es_pep}
              onCheckedChange={(v) => updatePersona(index, "es_pep", !!v)}
            />
            <Label className="cursor-pointer text-sm">¿Persona Expuesta Políticamente (PEP)?</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Según circular SARLAFT — Persona que desempeña o ha desempeñado funciones públicas destacadas
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  );
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default PersonaForm;
