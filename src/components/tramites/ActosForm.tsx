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
import OcrSuggestion from "./OcrSuggestion";

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
  const [suggestions, setSuggestions] = useState<Map<string, string>>(new Map());
  const poderInputRef = useRef<HTMLInputElement | null>(null);
  const cartaInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof Actos, value: any) => {
    setOcrFields(prev => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
    setSuggestions(prev => {
      if (!prev.has(field)) return prev;
      const next = new Map(prev);
      next.delete(field);
      return next;
    });
    onChange({ ...actos, [field]: value });
  };

  const handleTipoActoChange = (value: string) => {
    const esHipoteca = value === "Compraventa con Hipoteca";
    onChange({ ...actos, tipo_acto: value, es_hipoteca: esHipoteca });
  };

  const applyOcrResults = (results: Record<string, string | undefined>) => {
    const updated: Partial<Actos> = {};
    const filled: string[] = [];
    const newSuggestions = new Map(suggestions);

    for (const [field, value] of Object.entries(results)) {
      if (!value) continue;
      const current = actos[field as keyof Actos];
      const hasValue = typeof current === "string" && current.length > 0;
      if (hasValue) {
        newSuggestions.set(field, value);
      } else {
        (updated as any)[field] = value;
        filled.push(field);
      }
    }

    setSuggestions(newSuggestions);
    if (Object.keys(updated).length > 0) onChange({ ...actos, ...updated });
    if (filled.length > 0) {
      setOcrFields(prev => {
        const next = new Set(prev);
        filled.forEach(f => next.add(f));
        return next;
      });
    }
  };

  const confirmSuggestion = (field: string) => {
    const value = suggestions.get(field);
    if (!value) return;
    setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
    setOcrFields(prev => { const n = new Set(prev); n.add(field); return n; });
    onChange({ ...actos, [field]: value });
  };

  const ignoreSuggestion = (field: string) => {
    setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
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

        if (type === "poder_banco") {
          applyOcrResults({
            entidad_bancaria: d.entidad_bancaria,
            apoderado_nombre: d.apoderado_nombre,
            apoderado_cedula: d.apoderado_cedula,
            apoderado_expedida_en: d.apoderado_expedida_en,
            apoderado_escritura_poder: d.escritura_poder_num,
            apoderado_fecha_poder: d.fecha_poder,
            apoderado_notaria_poder: d.notaria_poder,
            apoderado_notaria_ciudad: d.notaria_poder_ciudad,
            apoderado_email: d.apoderado_email,
          });
          toast({ title: "Poder procesado", description: "Datos del apoderado bancario extraídos." });
        } else if (type === "carta_credito") {
          applyOcrResults({
            valor_hipoteca: d.valor_credito,
            entidad_bancaria: d.entidad_bancaria,
          });
          toast({ title: "Carta procesada", description: "Valor del crédito extraído." });
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
      <h3 className="text-lg font-semibold">Actos</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Tipo de Acto</Label>
          <Select value={actos.tipo_acto} onValueChange={handleTipoActoChange}>
            <SelectTrigger><SelectValue placeholder="Seleccione tipo de acto" /></SelectTrigger>
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
              {wrapWithSuggestion("valor_hipoteca",
                <Input value={actos.valor_hipoteca} onChange={(e) => update("valor_hipoteca", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Entidad Bancaria {ocr("entidad_bancaria")}</Label>
              {wrapWithSuggestion("entidad_bancaria",
                <Input value={actos.entidad_bancaria} onChange={(e) => update("entidad_bancaria", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>NIT del Banco</Label>
              <Input value={actos.entidad_nit || ""} onChange={(e) => update("entidad_nit", e.target.value)} placeholder="NIT de la entidad bancaria" />
            </div>
            <div className="space-y-2">
              <Label>Domicilio del Banco</Label>
              <Input value={actos.entidad_domicilio || ""} onChange={(e) => update("entidad_domicilio", e.target.value)} placeholder="Ciudad principal de la entidad" />
            </div>
            <div className="space-y-2">
              <Label>Pago Inicial (COP)</Label>
              <Input value={actos.pago_inicial || ""} onChange={(e) => update("pago_inicial", e.target.value)} placeholder="Valor del pago inicial" />
            </div>
            <div className="space-y-2">
              <Label>Saldo Financiado (COP)</Label>
              <Input value={actos.saldo_financiado || ""} onChange={(e) => update("saldo_financiado", e.target.value)} placeholder="Auto-calculado o manual" />
            </div>
            <div className="space-y-2">
              <Label>Fecha del Crédito</Label>
              <Input type="date" value={actos.fecha_credito || ""} onChange={(e) => update("fecha_credito", e.target.value)} />
            </div>
          </div>

          <h4 className="text-sm font-semibold text-muted-foreground mt-4">Apoderado del Banco</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nombre {ocr("apoderado_nombre")}</Label>
              {wrapWithSuggestion("apoderado_nombre",
                <Input value={actos.apoderado_nombre} onChange={(e) => update("apoderado_nombre", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Cédula {ocr("apoderado_cedula")}</Label>
              {wrapWithSuggestion("apoderado_cedula",
                <Input value={actos.apoderado_cedula} onChange={(e) => update("apoderado_cedula", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Expedida en {ocr("apoderado_expedida_en")}</Label>
              {wrapWithSuggestion("apoderado_expedida_en",
                <Input value={actos.apoderado_expedida_en || ""} onChange={(e) => update("apoderado_expedida_en", e.target.value)} placeholder="Lugar de expedición cédula" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Email {ocr("apoderado_email")}</Label>
              {wrapWithSuggestion("apoderado_email",
                <Input value={actos.apoderado_email || ""} onChange={(e) => update("apoderado_email", e.target.value)} placeholder="Correo del apoderado" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Escritura del Poder No. {ocr("apoderado_escritura_poder")}</Label>
              {wrapWithSuggestion("apoderado_escritura_poder",
                <Input value={actos.apoderado_escritura_poder || ""} onChange={(e) => update("apoderado_escritura_poder", e.target.value)} placeholder="No. escritura del poder" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Fecha del Poder {ocr("apoderado_fecha_poder")}</Label>
              {wrapWithSuggestion("apoderado_fecha_poder",
                <Input value={actos.apoderado_fecha_poder || ""} onChange={(e) => update("apoderado_fecha_poder", e.target.value)} placeholder="DD-MM-AAAA" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Notaría del Poder {ocr("apoderado_notaria_poder")}</Label>
              {wrapWithSuggestion("apoderado_notaria_poder",
                <Input value={actos.apoderado_notaria_poder || ""} onChange={(e) => update("apoderado_notaria_poder", e.target.value)} placeholder="Notaría donde se otorgó el poder" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Ciudad Notaría Poder {ocr("apoderado_notaria_ciudad")}</Label>
              {wrapWithSuggestion("apoderado_notaria_ciudad",
                <Input value={actos.apoderado_notaria_ciudad || ""} onChange={(e) => update("apoderado_notaria_ciudad", e.target.value)} placeholder="Ciudad de la notaría del poder" />
              )}
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
