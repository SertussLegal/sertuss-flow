import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Loader2 } from "lucide-react";
import type { Actos } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import OcrBadge from "./OcrBadge";

interface ActosFormProps {
  actos: Actos;
  onChange: (actos: Actos) => void;
}

type HipotecaScanType = "poder_banco" | "carta_credito";

const ActosForm = ({ actos, onChange }: ActosFormProps) => {
  const { profile, credits, refreshCredits } = useAuth();
  const { toast } = useToast();
  const [scanning, setScanning] = useState<HipotecaScanType | null>(null);
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set());
  const poderInputRef = useRef<HTMLInputElement | null>(null);
  const cartaInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof Actos, value: any) => {
    setOcrFields(prev => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
    onChange({ ...actos, [field]: value });
  };

  const handleTipoActoChange = (value: string) => {
    const esHipoteca = value === "Compraventa con Hipoteca";
    onChange({ ...actos, tipo_acto: value, es_hipoteca: esHipoteca });
  };

  const handleScanHipoteca = async (file: File, type: HipotecaScanType) => {
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

        if (type === "poder_banco") {
          const updated: Partial<Actos> = {};
          if (d.entidad_bancaria) { updated.entidad_bancaria = d.entidad_bancaria; filled.push("entidad_bancaria"); }
          if (d.apoderado_nombre) { updated.apoderado_nombre = d.apoderado_nombre; filled.push("apoderado_nombre"); }
          if (d.apoderado_cedula) { updated.apoderado_cedula = d.apoderado_cedula; filled.push("apoderado_cedula"); }
          onChange({ ...actos, ...updated });
          toast({ title: "Poder procesado", description: "Datos del apoderado bancario extraídos." });
        } else if (type === "carta_credito") {
          const updated: Partial<Actos> = {};
          if (d.valor_credito) { updated.valor_hipoteca = d.valor_credito; filled.push("valor_hipoteca"); }
          if (d.entidad_bancaria) { updated.entidad_bancaria = d.entidad_bancaria; filled.push("entidad_bancaria"); }
          onChange({ ...actos, ...updated });
          toast({ title: "Carta procesada", description: "Valor del crédito extraído." });
        }

        if (filled.length > 0) {
          setOcrFields(prev => {
            const next = new Set(prev);
            filled.forEach(f => next.add(f));
            return next;
          });
        }
      }
      await refreshCredits();
    } catch (err: any) {
      await supabase.rpc("restore_credit", { org_id: profile.organization_id });
      await refreshCredits();
      toast({ title: "Error al procesar", description: err.message, variant: "destructive" });
    } finally {
      setScanning(null);
    }
  };

  const renderUploadButton = (
    label: string,
    type: HipotecaScanType,
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
          if (file) handleScanHipoteca(file, type);
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
      <h3 className="text-lg font-semibold">Actos</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Tipo de Acto</Label>
          <Select value={actos.tipo_acto} onValueChange={handleTipoActoChange}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccione tipo de acto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Compraventa">Compraventa</SelectItem>
              <SelectItem value="Compraventa con Hipoteca">Compraventa con Hipoteca</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Valor de Compraventa (COP)</Label>
          <Input value={actos.valor_compraventa} onChange={(e) => update("valor_compraventa", e.target.value)} placeholder="$0" />
        </div>
      </div>

      {actos.es_hipoteca && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-muted-foreground">Datos de Hipoteca</h4>
            <div className="flex flex-wrap gap-2">
              {renderUploadButton("Cargar Poder", "poder_banco", poderInputRef, "Procesando...")}
              {renderUploadButton("Cargar Carta", "carta_credito", cartaInputRef, "Procesando...")}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Valor de Crédito (COP) {ocr("valor_hipoteca")}</Label>
              <Input value={actos.valor_hipoteca} onChange={(e) => update("valor_hipoteca", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Entidad Bancaria {ocr("entidad_bancaria")}</Label>
              <Input value={actos.entidad_bancaria} onChange={(e) => update("entidad_bancaria", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Apoderado del Banco — Nombre {ocr("apoderado_nombre")}</Label>
              <Input value={actos.apoderado_nombre} onChange={(e) => update("apoderado_nombre", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Apoderado del Banco — Cédula {ocr("apoderado_cedula")}</Label>
              <Input value={actos.apoderado_cedula} onChange={(e) => update("apoderado_cedula", e.target.value)} />
            </div>
          </div>
        </div>
      )}
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

export default ActosForm;
