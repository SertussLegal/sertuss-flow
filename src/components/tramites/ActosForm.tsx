import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Actos</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Tipo de Acto</Label>
          <Select value={actos.tipo_acto} onValueChange={(v) => update("tipo_acto", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccione tipo de acto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Compraventa">Compraventa</SelectItem>
              <SelectItem value="Hipoteca">Hipoteca</SelectItem>
              <SelectItem value="Afectación a Vivienda Familiar">Afectación a Vivienda Familiar</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Valor de Compraventa (COP)</Label>
          <Input value={actos.valor_compraventa} onChange={(e) => update("valor_compraventa", e.target.value)} placeholder="$0" />
        </div>
      </div>

      {/* Hipoteca */}
      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Switch checked={actos.es_hipoteca} onCheckedChange={(v) => update("es_hipoteca", v)} />
          <Label className="text-base font-medium">Acto de Hipoteca</Label>
        </div>

        {actos.es_hipoteca && (
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
        )}
      </div>

      {/* Afectación Vivienda Familiar */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Switch checked={actos.afectacion_vivienda_familiar} onCheckedChange={(v) => update("afectacion_vivienda_familiar", v)} />
          <Label className="text-base font-medium">Afectación a Vivienda Familiar</Label>
        </div>
      </div>
    </div>
  );
};

export default ActosForm;
