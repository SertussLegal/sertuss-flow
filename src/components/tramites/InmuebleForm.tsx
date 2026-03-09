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

interface InmuebleFormProps {
  inmueble: Inmueble;
  onChange: (inmueble: Inmueble) => void;
}

type ScanType = "certificado_tradicion" | "predial" | "escritura_antecedente";

const InmuebleForm = ({ inmueble, onChange }: InmuebleFormProps) => {
  const { profile, credits, refreshCredits } = useAuth();
  const { toast } = useToast();
  const [scanning, setScanning] = useState<ScanType | null>(null);
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set());
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
    onChange({ ...inmueble, [field]: value });
  };

  const markOcrFields = (fields: string[]) => {
    setOcrFields(prev => {
      const next = new Set(prev);
      fields.forEach(f => next.add(f));
      return next;
    });
  };

  const handleScanDocument = async (file: File, type: ScanType) => {
    if (!profile?.organization_id) return;

    const { data: success } = await supabase.rpc("consume_credit", { org_id: profile.organization_id });
    if (!success) {
      toast({ title: "Sin créditos", description: "No hay créditos disponibles para procesar documentos.", variant: "destructive" });
      return;
    }

    setScanning(type);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type },
      });

      if (error) throw new Error(error.message);
      if (data?.data) {
        const d = data.data;
        const filled: string[] = [];

        if (type === "certificado_tradicion") {
          const updated: Partial<Inmueble> = {};
          if (d.matricula_inmobiliaria) { updated.matricula_inmobiliaria = d.matricula_inmobiliaria; filled.push("matricula_inmobiliaria"); }
          if (d.codigo_orip) { updated.codigo_orip = d.codigo_orip; filled.push("codigo_orip"); }
          if (d.direccion) { updated.direccion = d.direccion; filled.push("direccion"); }
          if (d.municipio) { updated.municipio = d.municipio; filled.push("municipio"); }
          if (d.departamento) { updated.departamento = d.departamento; filled.push("departamento"); }
          if (d.linderos) { updated.linderos = d.linderos; filled.push("linderos"); }
          if (d.area) { updated.area = d.area; filled.push("area"); }
          if (d.tipo_predio === "rural") { updated.tipo_predio = "rural"; filled.push("tipo_predio"); }
          if (d.es_propiedad_horizontal != null) { updated.es_propiedad_horizontal = d.es_propiedad_horizontal; filled.push("es_propiedad_horizontal"); }
          if (d.escritura_constitucion_ph) { updated.escritura_ph = d.escritura_constitucion_ph; filled.push("escritura_ph"); }
          if (d.reformas_ph) { updated.reformas_ph = d.reformas_ph; filled.push("reformas_ph"); }
          onChange({ ...inmueble, ...updated });
          toast({ title: "Certificado procesado", description: "Datos del inmueble extraídos correctamente." });
        } else if (type === "predial") {
          const updated: Partial<Inmueble> = {};
          if (d.identificador_predial) { updated.identificador_predial = d.identificador_predial; filled.push("identificador_predial"); }
          if (d.avaluo_catastral) { updated.avaluo_catastral = d.avaluo_catastral; filled.push("avaluo_catastral"); }
          if (d.area) { updated.area = d.area; filled.push("area"); }
          if (d.direccion) { updated.direccion = d.direccion; filled.push("direccion"); }
          onChange({ ...inmueble, ...updated });
          toast({ title: "Predial procesado", description: "Cédula catastral y avalúo extraídos correctamente." });
        } else if (type === "escritura_antecedente") {
          const linderos = [d.linderos_especiales, d.linderos_generales].filter(Boolean).join("\n\n--- Linderos Generales ---\n\n");
          if (linderos) { filled.push("linderos"); }
          onChange({ ...inmueble, linderos: linderos || inmueble.linderos });
          toast({ title: "Escritura procesada", description: "Linderos extraídos correctamente." });
        }

        if (filled.length > 0) markOcrFields(filled);
      }
      await refreshCredits();
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
        disabled={scanning !== null || credits === 0}
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
          <Input value={inmueble.matricula_inmobiliaria} onChange={(e) => update("matricula_inmobiliaria", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Tipo de Identificador Predial *</Label>
          <Select value={inmueble.tipo_identificador_predial} onValueChange={(v) => update("tipo_identificador_predial", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
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
          <Input
            value={inmueble.identificador_predial}
            onChange={(e) => update("identificador_predial", e.target.value)}
            required
            placeholder={inmueble.tipo_identificador_predial === "chip" ? "AAA0000AAAA" : "Cédula catastral"}
          />
        </div>

        <div className="space-y-2">
          <Label>Departamento {ocr("departamento")}</Label>
          <Input value={inmueble.departamento} onChange={(e) => update("departamento", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Municipio {ocr("municipio")}</Label>
          <Input value={inmueble.municipio} onChange={(e) => update("municipio", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Oficina de Registro (ORIP) {ocr("codigo_orip")}</Label>
          <Input value={inmueble.codigo_orip} onChange={(e) => update("codigo_orip", e.target.value)} placeholder="Ej: Oficina de Registro de Instrumentos Públicos de Bogotá Zona Norte" />
        </div>

        <div className="space-y-2">
          <Label>Tipo de Predio {ocr("tipo_predio")}</Label>
          <Select value={inmueble.tipo_predio} onValueChange={(v) => update("tipo_predio", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="urbano">Urbano</SelectItem>
              <SelectItem value="rural">Rural</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Dirección {ocr("direccion")}</Label>
          <Input value={inmueble.direccion} onChange={(e) => update("direccion", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Área (m²) {ocr("area")}</Label>
          <Input value={inmueble.area} onChange={(e) => update("area", e.target.value)} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>Avalúo Catastral (COP) {ocr("avaluo_catastral")}</Label>
          <Input value={inmueble.avaluo_catastral} onChange={(e) => update("avaluo_catastral", e.target.value)} placeholder="Valor del avalúo catastral" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Linderos {ocr("linderos")}</Label>
        <Textarea
          value={inmueble.linderos}
          onChange={(e) => update("linderos", e.target.value)}
          placeholder="Describa los linderos completos del inmueble..."
          className="min-h-[200px] resize-y"
        />
      </div>

      {/* Sección Propiedad Horizontal */}
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
              <Input
                value={inmueble.escritura_ph}
                onChange={(e) => update("escritura_ph", e.target.value)}
                placeholder="No. escritura de constitución"
              />
            </div>
            <div className="space-y-2">
              <Label>Reformas PH {ocr("reformas_ph")}</Label>
              <Input
                value={inmueble.reformas_ph}
                onChange={(e) => update("reformas_ph", e.target.value)}
                placeholder="Reformas a la PH (si aplica)"
              />
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
