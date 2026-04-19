import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pencil, Check, X, Sparkles, ArrowRight } from "lucide-react";

interface VariableEditPopoverProps {
  fieldName: string;
  currentValue: string;
  position: { top: number; left: number };
  suggestion?: { value: string; source: string };
  onApply: (value: string) => void;
  onClose: () => void;
  onGotoForm?: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  matricula_inmobiliaria: "Matrícula Inmobiliaria",
  identificador_predial: "Identificador Predial",
  direccion_inmueble: "Dirección Inmueble",
  "inmueble.direccion": "Dirección Inmueble",
  "inmueble.matricula": "Matrícula",
  "inmueble.cedula_catastral": "Cédula Catastral",
  "inmueble.linderos_especiales": "Linderos Especiales",
  "inmueble.linderos_generales": "Linderos Generales",
  municipio: "Municipio",
  departamento: "Departamento",
  area: "Área",
  linderos: "Linderos",
  avaluo_catastral: "Avalúo Catastral",
  "inmueble.avaluo_catastral": "Avalúo Catastral",
  "inmueble.estrato": "Estrato",
  estrato: "Estrato",
  codigo_orip: "ORIP",
  "inmueble.orip_ciudad": "ORIP Ciudad",
  valor_compraventa_letras: "Valor Compraventa",
  "actos.cuantia_compraventa_letras": "Cuantía Letras",
  "actos.cuantia_compraventa_numero": "Cuantía Número",
  tipo_acto: "Tipo de Acto",
  entidad_bancaria: "Entidad Bancaria",
  "actos.entidad_bancaria": "Entidad Bancaria",
  "actos.entidad_nit": "NIT Entidad",
  "actos.entidad_domicilio": "Domicilio Entidad",
  valor_hipoteca_letras: "Valor Hipoteca",
  comparecientes_vendedor: "Vendedor(es)",
  comparecientes_comprador: "Comprador(es)",
  notaria_previa_numero: "Notaría Previa",
  "antecedentes.notaria_previa_numero": "Notaría Previa",
  "antecedentes.notaria_previa_circulo": "Círculo Notarial Previo",
  escritura_num_numero: "Número Escritura Antecedente",
  "antecedentes.escritura_num_numero": "Número Escritura Antecedente",
};

const VariableEditPopover = ({
  fieldName,
  currentValue,
  position,
  suggestion,
  onApply,
  onClose,
  onGotoForm,
}: VariableEditPopoverProps) => {
  const [value, setValue] = useState(currentValue === "___________" ? "" : currentValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const label = FIELD_LABELS[fieldName] || fieldName;

  // Clamp position to viewport
  const top = Math.min(position.top, window.innerHeight - 220);
  const left = Math.min(position.left, window.innerWidth - 304);

  return (
    <div
      ref={popoverRef}
      className="fixed z-[100] w-80 rounded-lg border bg-popover p-3 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ top, left }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      </div>

      {suggestion && (
        <div className="mb-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              Sugerencia · {suggestion.source}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium text-foreground truncate" title={suggestion.value}>
              {suggestion.value}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-xs"
              onClick={() => {
                setValue(suggestion.value);
                inputRef.current?.focus();
              }}
            >
              Usar
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onApply(value);
          }}
          className="h-8 text-sm"
          placeholder="Ingrese valor..."
        />
        <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => onApply(value)}>
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {onGotoForm && (
        <button
          type="button"
          onClick={onGotoForm}
          className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Ir al formulario <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export default VariableEditPopover;
