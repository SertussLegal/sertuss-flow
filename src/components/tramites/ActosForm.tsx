import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Actos } from "@/lib/types";

interface ActosFormProps {
  actos: Actos;
  onChange: (actos: Actos) => void;
}

const ActosForm = ({ actos, onChange }: ActosFormProps) => {
  const update = (field: keyof Actos, value: any) => {
    onChange({ ...actos, [field]: value });
  };

  const handleTipoActoChange = (value: string) => {
    const esHipoteca = value === "Compraventa con Hipoteca";
    onChange({ ...actos, tipo_acto: value, es_hipoteca: esHipoteca });
  };

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

      {/* Hipoteca — se muestra automáticamente al seleccionar "Compraventa con Hipoteca" */}
      {actos.es_hipoteca && (
        <div className="space-y-4 rounded-lg border p-4">
          <h4 className="text-sm font-semibold text-muted-foreground">Datos de Hipoteca</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Valor de Crédito (COP)</Label>
              <Input value={actos.valor_hipoteca} onChange={(e) => update("valor_hipoteca", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Entidad Bancaria</Label>
              <Input value={actos.entidad_bancaria} onChange={(e) => update("entidad_bancaria", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Apoderado del Banco — Nombre</Label>
              <Input value={actos.apoderado_nombre} onChange={(e) => update("apoderado_nombre", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Apoderado del Banco — Cédula</Label>
              <Input value={actos.apoderado_cedula} onChange={(e) => update("apoderado_cedula", e.target.value)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActosForm;
