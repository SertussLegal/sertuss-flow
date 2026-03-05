import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Inmueble } from "@/lib/types";

interface InmuebleFormProps {
  inmueble: Inmueble;
  onChange: (inmueble: Inmueble) => void;
}

const InmuebleForm = ({ inmueble, onChange }: InmuebleFormProps) => {
  const update = (field: keyof Inmueble, value: string) => {
    onChange({ ...inmueble, [field]: value });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Inmueble</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Matrícula Inmobiliaria</Label>
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
              <SelectItem value="predial_nacional">Número Predial Nacional (30 dígitos)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>
            Identificador Predial *
            {inmueble.tipo_identificador_predial === "predial_nacional" && (
              <span className="ml-2 text-xs text-muted-foreground">(30 dígitos)</span>
            )}
          </Label>
          <Input
            value={inmueble.identificador_predial}
            onChange={(e) => update("identificador_predial", e.target.value)}
            required
            maxLength={inmueble.tipo_identificador_predial === "predial_nacional" ? 30 : undefined}
            placeholder={inmueble.tipo_identificador_predial === "chip" ? "AAA0000AAAA" : "000000000000000000000000000000"}
          />
        </div>

        <div className="space-y-2">
          <Label>Departamento</Label>
          <Input value={inmueble.departamento} onChange={(e) => update("departamento", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Municipio</Label>
          <Input value={inmueble.municipio} onChange={(e) => update("municipio", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Círculo Registral / ORIP</Label>
          <Input value={inmueble.codigo_orip} onChange={(e) => update("codigo_orip", e.target.value)} placeholder="Código de Oficina de Registro" />
        </div>

        <div className="space-y-2">
          <Label>Tipo de Predio</Label>
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
          <Label>Dirección</Label>
          <Input value={inmueble.direccion} onChange={(e) => update("direccion", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Estrato</Label>
          <Input value={inmueble.estrato} onChange={(e) => update("estrato", e.target.value)} type="number" min="1" max="6" />
        </div>

        <div className="space-y-2">
          <Label>Área (m²)</Label>
          <Input value={inmueble.area} onChange={(e) => update("area", e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Valorización</Label>
          <Input value={inmueble.valorizacion} onChange={(e) => update("valorizacion", e.target.value)} placeholder="Valor en COP" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Linderos</Label>
        <Textarea
          value={inmueble.linderos}
          onChange={(e) => update("linderos", e.target.value)}
          placeholder="Describa los linderos completos del inmueble..."
          className="min-h-[200px] resize-y"
        />
      </div>
    </div>
  );
};

export default InmuebleForm;
