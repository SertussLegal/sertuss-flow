import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Info, Upload, Loader2 } from "lucide-react";
import type { Persona } from "@/lib/types";
import { createEmptyPersona } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface PersonaFormProps {
  title: string;
  personas: Persona[];
  onChange: (personas: Persona[]) => void;
}

const PersonaForm = ({ title, personas, onChange }: PersonaFormProps) => {
  const { profile, credits, refreshCredits } = useAuth();
  const { toast } = useToast();
  const [scanningIndex, setScanningIndex] = useState<number | null>(null);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const updatePersona = (index: number, field: keyof Persona, value: any) => {
    const updated = [...personas];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const addPersona = () => onChange([...personas, createEmptyPersona()]);

  const removePersona = (index: number) => {
    if (personas.length <= 1) return;
    onChange(personas.filter((_, i) => i !== index));
  };

  const handleScanCedula = async (index: number, file: File) => {
    if (!profile?.organization_id) return;

    // Consume credit first
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
        updated[index] = {
          ...updated[index],
          nombre_completo: extracted.nombre_completo || updated[index].nombre_completo,
          numero_cedula: extracted.numero_cedula || updated[index].numero_cedula,
          municipio_domicilio: extracted.municipio_expedicion || updated[index].municipio_domicilio,
        };
        onChange(updated);
        toast({ title: "Cédula procesada", description: "Datos extraídos correctamente." });
      }
      await refreshCredits();
    } catch (err: any) {
      toast({ title: "Error al procesar", description: err.message, variant: "destructive" });
    } finally {
      setScanningIndex(null);
    }
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

      {personas.map((persona, index) => (
        <div key={persona.id} className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {title.slice(0, -2).replace(/e$/, "")}or {index + 1}
            </span>
            <div className="flex items-center gap-2">
              {/* Scan button */}
              <input
                type="file"
                accept="image/*"
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

          {/* Switch Persona Jurídica */}
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
                <Label>Nombre Completo</Label>
                <Input value={persona.nombre_completo} onChange={(e) => updatePersona(index, "nombre_completo", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Número de Cédula</Label>
                <Input value={persona.numero_cedula} onChange={(e) => updatePersona(index, "numero_cedula", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Estado Civil</Label>
                <Input value={persona.estado_civil} onChange={(e) => updatePersona(index, "estado_civil", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Municipio de Domicilio</Label>
                <Input value={persona.municipio_domicilio} onChange={(e) => updatePersona(index, "municipio_domicilio", e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Dirección</Label>
                <Input value={persona.direccion} onChange={(e) => updatePersona(index, "direccion", e.target.value)} />
              </div>
            </div>
          )}

          {/* Switch Apoderado */}
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

          {/* PEP Checkbox */}
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
