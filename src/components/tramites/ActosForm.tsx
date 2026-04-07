import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Actos } from "@/lib/types";
import OcrBadge from "./OcrBadge";
import OcrSuggestion from "./OcrSuggestion";

interface ActosFormProps {
  actos: Actos;
  onChange: (actos: Actos) => void;
}

const ActosForm = ({ actos, onChange }: ActosFormProps) => {
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Map<string, string>>(new Map());

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

  const ocr = (field: string) => ocrFields.has(field) ? <OcrBadge /> : null;

  const wrapWithSuggestion = (field: string, input: React.ReactNode) => {
    const suggested = suggestions.get(field);
    if (!suggested) return input;
    return (
      <OcrSuggestion
        value={suggested}
        onConfirm={() => {
          const value = suggestions.get(field);
          if (!value) return;
          setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
          setOcrFields(prev => { const n = new Set(prev); n.add(field); return n; });
          onChange({ ...actos, [field]: value });
        }}
        onIgnore={() => {
          setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
        }}
      >
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
            <SelectTrigger data-field-input="tipo_acto"><SelectValue placeholder="Seleccione tipo de acto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Compraventa">Compraventa</SelectItem>
              <SelectItem value="Compraventa con Hipoteca">Compraventa con Hipoteca</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Valor de Compraventa (COP)</Label>
          <Input data-field-input="valor_compraventa" value={actos.valor_compraventa} onChange={(e) => update("valor_compraventa", e.target.value)} placeholder="$0" />
        </div>
      </div>

      {actos.es_hipoteca && (
        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="text-sm font-semibold text-muted-foreground">Datos de Hipoteca</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Valor de Crédito (COP) {ocr("valor_hipoteca")}</Label>
              {wrapWithSuggestion("valor_hipoteca",
                <Input data-field-input="valor_hipoteca" value={actos.valor_hipoteca} onChange={(e) => update("valor_hipoteca", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Entidad Bancaria {ocr("entidad_bancaria")}</Label>
              {wrapWithSuggestion("entidad_bancaria",
                <Input data-field-input="entidad_bancaria" value={actos.entidad_bancaria} onChange={(e) => update("entidad_bancaria", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>NIT del Banco</Label>
              <Input data-field-input="entidad_nit" value={actos.entidad_nit || ""} onChange={(e) => update("entidad_nit", e.target.value)} placeholder="NIT de la entidad bancaria" />
            </div>
            <div className="space-y-2">
              <Label>Domicilio del Banco</Label>
              <Input data-field-input="entidad_domicilio" value={actos.entidad_domicilio || ""} onChange={(e) => update("entidad_domicilio", e.target.value)} placeholder="Ciudad principal de la entidad" />
            </div>
            <div className="space-y-2">
              <Label>Pago Inicial (COP)</Label>
              <Input data-field-input="pago_inicial" value={actos.pago_inicial || ""} onChange={(e) => update("pago_inicial", e.target.value)} placeholder="Valor del pago inicial" />
            </div>
            <div className="space-y-2">
              <Label>Saldo Financiado (COP)</Label>
              <Input data-field-input="saldo_financiado" value={actos.saldo_financiado || ""} onChange={(e) => update("saldo_financiado", e.target.value)} placeholder="Auto-calculado o manual" />
            </div>
            <div className="space-y-2">
              <Label>Fecha del Crédito</Label>
              <Input data-field-input="fecha_credito" type="date" value={actos.fecha_credito || ""} onChange={(e) => update("fecha_credito", e.target.value)} />
            </div>
          </div>

          <h4 className="text-sm font-semibold text-muted-foreground mt-4">Apoderado del Banco</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nombre {ocr("apoderado_nombre")}</Label>
              {wrapWithSuggestion("apoderado_nombre",
                <Input data-field-input="apoderado_nombre" value={actos.apoderado_nombre} onChange={(e) => update("apoderado_nombre", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Cédula {ocr("apoderado_cedula")}</Label>
              {wrapWithSuggestion("apoderado_cedula",
                <Input data-field-input="apoderado_cedula" value={actos.apoderado_cedula} onChange={(e) => update("apoderado_cedula", e.target.value)} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Expedida en {ocr("apoderado_expedida_en")}</Label>
              {wrapWithSuggestion("apoderado_expedida_en",
                <Input data-field-input="apoderado_expedida_en" value={actos.apoderado_expedida_en || ""} onChange={(e) => update("apoderado_expedida_en", e.target.value)} placeholder="Lugar de expedición cédula" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Email {ocr("apoderado_email")}</Label>
              {wrapWithSuggestion("apoderado_email",
                <Input data-field-input="apoderado_email" value={actos.apoderado_email || ""} onChange={(e) => update("apoderado_email", e.target.value)} placeholder="Correo del apoderado" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Escritura del Poder No. {ocr("apoderado_escritura_poder")}</Label>
              {wrapWithSuggestion("apoderado_escritura_poder",
                <Input data-field-input="apoderado_escritura_poder" value={actos.apoderado_escritura_poder || ""} onChange={(e) => update("apoderado_escritura_poder", e.target.value)} placeholder="No. escritura del poder" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Fecha del Poder {ocr("apoderado_fecha_poder")}</Label>
              {wrapWithSuggestion("apoderado_fecha_poder",
                <Input data-field-input="apoderado_fecha_poder" value={actos.apoderado_fecha_poder || ""} onChange={(e) => update("apoderado_fecha_poder", e.target.value)} placeholder="DD-MM-AAAA" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Notaría del Poder {ocr("apoderado_notaria_poder")}</Label>
              {wrapWithSuggestion("apoderado_notaria_poder",
                <Input data-field-input="apoderado_notaria_poder" value={actos.apoderado_notaria_poder || ""} onChange={(e) => update("apoderado_notaria_poder", e.target.value)} placeholder="Notaría donde se otorgó el poder" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Ciudad Notaría Poder {ocr("apoderado_notaria_ciudad")}</Label>
              {wrapWithSuggestion("apoderado_notaria_ciudad",
                <Input data-field-input="apoderado_notaria_ciudad" value={actos.apoderado_notaria_ciudad || ""} onChange={(e) => update("apoderado_notaria_ciudad", e.target.value)} placeholder="Ciudad de la notaría del poder" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActosForm;
