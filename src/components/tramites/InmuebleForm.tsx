import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Loader2 } from "lucide-react";
import type { Inmueble } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import OcrBadge from "./OcrBadge";
import OcrSuggestion from "./OcrSuggestion";

export interface ExtractedPersona {
  nombre_completo: string;
  numero_identificacion: string;
  tipo_identificacion?: string;
  lugar_expedicion?: string;
}

export interface ExtractedDocumento {
  fecha_documento?: string;
  notaria_origen?: string;
  numero_escritura?: string;
}

interface InmuebleFormProps {
  inmueble: Inmueble;
  onChange: (inmueble: Inmueble) => void;
  onPersonasExtracted?: (personas: ExtractedPersona[]) => void;
  onDocumentoExtracted?: (documento: ExtractedDocumento) => void;
}

type ScanType = "certificado_tradicion" | "predial" | "escritura_antecedente";

const InmuebleForm = ({ inmueble, onChange }: InmuebleFormProps) => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [scanning, setScanning] = useState<ScanType | null>(null);
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Map<string, string>>(new Map());
  const certInputRef = useRef<HTMLInputElement | null>(null);
  const predialInputRef = useRef<HTMLInputElement | null>(null);
  const escrituraInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof Inmueble, value: string | boolean) => {
    setOcrFields(prev => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
    // Clear any pending suggestion for this field when user edits manually
    setSuggestions(prev => {
      if (!prev.has(field)) return prev;
      const next = new Map(prev);
      next.delete(field);
      return next;
    });
    onChange({ ...inmueble, [field]: value });
  };

  const markOcrFields = (fields: string[]) => {
    setOcrFields(prev => {
      const next = new Set(prev);
      fields.forEach(f => next.add(f));
      return next;
    });
  };

  const applyOcrResults = (results: Record<string, string | boolean | undefined>, currentInmueble: Inmueble) => {
    const updated: Partial<Inmueble> = {};
    const filled: string[] = [];
    const newSuggestions = new Map(suggestions);

    for (const [field, value] of Object.entries(results)) {
      if (value == null) continue;
      const currentVal = currentInmueble[field as keyof Inmueble];
      const hasExistingValue = typeof currentVal === "string" ? currentVal.length > 0 : false;

      if (hasExistingValue && typeof value === "string") {
        // Field already has content → show suggestion instead of overwriting
        newSuggestions.set(field, value);
      } else {
        (updated as any)[field] = value;
        filled.push(field);
      }
    }

    setSuggestions(newSuggestions);
    if (Object.keys(updated).length > 0) {
      onChange({ ...currentInmueble, ...updated });
    }
    if (filled.length > 0) markOcrFields(filled);
    return filled;
  };

  const confirmSuggestion = (field: string) => {
    const value = suggestions.get(field);
    if (!value) return;
    setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
    markOcrFields([field]);
    onChange({ ...inmueble, [field]: value });
  };

  const ignoreSuggestion = (field: string) => {
    setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
  };

  const handleScanDocument = async (file: File, type: ScanType) => {
    if (!profile?.organization_id) return;

    setScanning(type);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type },
      });

      if (error) throw new Error(error.message);
      if (data?.data) {
        const d = data.data;

        if (type === "certificado_tradicion") {
          // Map NUPRE → identificador_predial if starts with AAA
          const nupreMapping: Record<string, string | boolean> = {};
          if (d.nupre && typeof d.nupre === "string" && d.nupre.startsWith("AAA")) {
            nupreMapping.identificador_predial = d.nupre;
            nupreMapping.tipo_identificador_predial = "chip";
          }

          applyOcrResults({
            matricula_inmobiliaria: d.matricula_inmobiliaria,
            codigo_orip: d.codigo_orip,
            direccion: d.direccion,
            municipio: d.municipio,
            departamento: d.departamento,
            linderos: d.linderos,
            ...(d.area_construida ? { area_construida: d.area_construida } : {}),
            ...(d.area_privada ? { area_privada: d.area_privada } : {}),
            ...nupreMapping,
            ...(d.tipo_predio === "rural" ? { tipo_predio: "rural" } : {}),
            ...(d.es_propiedad_horizontal != null ? { es_propiedad_horizontal: d.es_propiedad_horizontal } : {}),
            ...(d.escritura_constitucion_ph ? { escritura_ph: d.escritura_constitucion_ph } : {}),
            ...(d.reformas_ph ? { reformas_ph: d.reformas_ph } : {}),
          }, inmueble);
          toast({ title: "Certificado procesado", description: "Datos del inmueble extraídos correctamente." });
        } else if (type === "predial") {
          applyOcrResults({
            identificador_predial: d.identificador_predial,
            avaluo_catastral: d.avaluo_catastral,
            area: d.area,
            direccion: d.direccion,
          }, inmueble);
          toast({ title: "Predial procesado", description: "Cédula catastral y avalúo extraídos correctamente." });
        } else if (type === "escritura_antecedente") {
          const linderos = [d.linderos_especiales, d.linderos_generales].filter(Boolean).join("\n\n--- Linderos Generales ---\n\n");
          if (linderos) {
            applyOcrResults({ linderos }, inmueble);
          }
          toast({ title: "Escritura procesada", description: "Linderos extraídos correctamente." });
        }
      }
    } catch (err: any) {
      toast({ title: "Error al procesar", description: err.message, variant: "destructive" });
    } finally {
      setScanning(null);
    }
  };

  const renderUploadButton = (
    label: string,
    type: ScanType,
    ref: React.RefObject<HTMLInputElement | null>,
    processingLabel: string
  ) => (
    <>
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        ref={ref}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleScanDocument(file, type);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={scanning !== null}
        onClick={() => ref.current?.click()}
      >
        {scanning === type ? (
          <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> {processingLabel}</>
        ) : (
          <><Upload className="mr-1 h-4 w-4" /> {label}</>
        )}
      </Button>
    </>
  );

  const ocr = (field: string) => ocrFields.has(field) ? <OcrBadge /> : null;

  const wrapWithSuggestion = (field: string, input: React.ReactNode) => {
    const suggested = suggestions.get(field);
    if (!suggested) return input;
    return (
      <OcrSuggestion value={suggested} onConfirm={() => confirmSuggestion(field)} onIgnore={() => ignoreSuggestion(field)}>
        <div>{input}</div>
      </OcrSuggestion>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Inmueble</h3>
        <div className="flex flex-wrap gap-2">
          {renderUploadButton("Cargar Certificado", "certificado_tradicion", certInputRef, "Procesando...")}
          {renderUploadButton("Cargar Predial", "predial", predialInputRef, "Procesando...")}
          {renderUploadButton("Cargar Escritura", "escritura_antecedente", escrituraInputRef, "Procesando...")}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Matrícula Inmobiliaria {ocr("matricula_inmobiliaria")}</Label>
          {wrapWithSuggestion("matricula_inmobiliaria",
            <Input value={inmueble.matricula_inmobiliaria} onChange={(e) => update("matricula_inmobiliaria", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Tipo de Identificador Predial *</Label>
          <Select value={inmueble.tipo_identificador_predial} onValueChange={(v) => update("tipo_identificador_predial", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="chip">CHIP</SelectItem>
              <SelectItem value="cedula_catastral">Cédula Catastral</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>
            Identificador Predial * {ocr("identificador_predial")}
            {inmueble.tipo_identificador_predial === "chip" && (
              <span className="ml-2 text-xs text-muted-foreground">(Formato: AAA0000AAAA)</span>
            )}
            {inmueble.tipo_identificador_predial === "cedula_catastral" && (
              <span className="ml-2 text-xs text-muted-foreground">(Cédula catastral)</span>
            )}
          </Label>
          {wrapWithSuggestion("identificador_predial",
            <Input
              value={inmueble.identificador_predial}
              onChange={(e) => update("identificador_predial", e.target.value)}
              required
              placeholder={inmueble.tipo_identificador_predial === "chip" ? "AAA0000AAAA" : "Cédula catastral"}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label>Departamento {ocr("departamento")}</Label>
          {wrapWithSuggestion("departamento",
            <Input value={inmueble.departamento} onChange={(e) => update("departamento", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Municipio {ocr("municipio")}</Label>
          {wrapWithSuggestion("municipio",
            <Input value={inmueble.municipio} onChange={(e) => update("municipio", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Oficina de Registro (ORIP) {ocr("codigo_orip")}</Label>
          {wrapWithSuggestion("codigo_orip",
            <Input value={inmueble.codigo_orip} onChange={(e) => update("codigo_orip", e.target.value)} placeholder="Ej: Oficina de Registro de Instrumentos Públicos de Bogotá Zona Norte" />
          )}
        </div>

        <div className="space-y-2">
          <Label>Tipo de Predio {ocr("tipo_predio")}</Label>
          <Select value={inmueble.tipo_predio} onValueChange={(v) => update("tipo_predio", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="urbano">Urbano</SelectItem>
              <SelectItem value="rural">Rural</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Dirección {ocr("direccion")}</Label>
          {wrapWithSuggestion("direccion",
            <Input value={inmueble.direccion} onChange={(e) => update("direccion", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Área Construida (m²) {ocr("area_construida")}</Label>
          {wrapWithSuggestion("area_construida",
            <Input value={inmueble.area_construida} onChange={(e) => update("area_construida", e.target.value)} placeholder="Ej: 269.18" />
          )}
        </div>

        <div className="space-y-2">
          <Label>Área Privada (m²) {ocr("area_privada")}</Label>
          {wrapWithSuggestion("area_privada",
            <Input value={inmueble.area_privada} onChange={(e) => update("area_privada", e.target.value)} placeholder="Ej: 243.65" />
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>Avalúo Catastral (COP) {ocr("avaluo_catastral")}</Label>
          {wrapWithSuggestion("avaluo_catastral",
            <Input value={inmueble.avaluo_catastral} onChange={(e) => update("avaluo_catastral", e.target.value)} placeholder="Valor del avalúo catastral" />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Linderos {ocr("linderos")}</Label>
        {wrapWithSuggestion("linderos",
          <Textarea
            value={inmueble.linderos}
            onChange={(e) => update("linderos", e.target.value)}
            placeholder="Describa los linderos completos del inmueble..."
            className="min-h-[200px] resize-y"
          />
        )}
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={inmueble.es_propiedad_horizontal}
            onCheckedChange={(v) => update("es_propiedad_horizontal", v)}
          />
          <Label className="text-base font-medium">¿Cuenta con Reglamento de Propiedad Horizontal? {ocr("es_propiedad_horizontal")}</Label>
        </div>

        {inmueble.es_propiedad_horizontal && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Escritura de Constitución PH {ocr("escritura_ph")}</Label>
              {wrapWithSuggestion("escritura_ph",
                <Input value={inmueble.escritura_ph} onChange={(e) => update("escritura_ph", e.target.value)} placeholder="No. escritura de constitución" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Reformas PH {ocr("reformas_ph")}</Label>
              {wrapWithSuggestion("reformas_ph",
                <Input value={inmueble.reformas_ph} onChange={(e) => update("reformas_ph", e.target.value)} placeholder="Reformas a la PH (si aplica)" />
              )}
            </div>
          </div>
        )}
      </div>
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

export default InmuebleForm;
