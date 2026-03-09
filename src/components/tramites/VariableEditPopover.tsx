import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pencil, Check, X } from "lucide-react";

interface VariableEditPopoverProps {
  fieldName: string;
  currentValue: string;
  position: { top: number; left: number };
  onApply: (value: string) => void;
  onClose: () => void;
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
  codigo_orip: "ORIP",
  "inmueble.orip_ciudad": "ORIP Ciudad",
  valor_compraventa_letras: "Valor Compraventa",
  "actos.cuantia_compraventa_letras": "Cuantía Letras",
  "actos.cuantia_compraventa_numero": "Cuantía Número",
  tipo_acto: "Tipo de Acto",
  entidad_bancaria: "Entidad Bancaria",
  "actos.entidad_bancaria": "Entidad Bancaria",
  valor_hipoteca_letras: "Valor Hipoteca",
  comparecientes_vendedor: "Vendedor(es)",
  comparecientes_comprador: "Comprador(es)",
};

const VariableEditPopover = ({ fieldName, currentValue, position, onApply, onClose }: VariableEditPopoverProps) => {
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

  return (
    <div
      ref={popoverRef}
      className="fixed z-[100] w-72 rounded-lg border bg-popover p-3 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      </div>
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
    </div>
  );
};

export default VariableEditPopover;
