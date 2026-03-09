import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScanLine, Loader2 } from "lucide-react";
import type { Inmueble } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface InmuebleFormProps {
  inmueble: Inmueble;
  onChange: (inmueble: Inmueble) => void;
}

const InmuebleForm = ({ inmueble, onChange }: InmuebleFormProps) => {
  const { profile, credits, refreshCredits } = useAuth();
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof Inmueble, value: string) => {
    onChange({ ...inmueble, [field]: value });
  };

  const handleScanCertificado = async (file: File) => {
    if (!profile?.organization_id) return;

    const { data: success } = await supabase.rpc("consume_credit", { org_id: profile.organization_id });
    if (!success) {
      toast({ title: "Sin créditos", description: "No hay créditos disponibles para escanear.", variant: "destructive" });
      return;
    }

    setScanning(true);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type: "certificado_tradicion" },
      });

      if (error) throw new Error(error.message);
      if (data?.data) {
        const d = data.data;
        onChange({
          ...inmueble,
          matricula_inmobiliaria: d.matricula_inmobiliaria || inmueble.matricula_inmobiliaria,
          codigo_orip: d.codigo_orip || inmueble.codigo_orip,
          direccion: d.direccion || inmueble.direccion,
          municipio: d.municipio || inmueble.municipio,
          departamento: d.departamento || inmueble.departamento,
          linderos: d.linderos || inmueble.linderos,
          area: d.area || inmueble.area,
        });
        toast({ title: "Certificado escaneado", description: "Datos del inmueble extraídos correctamente." });
      }
      await refreshCredits();
    } catch (err: any) {
      toast({ title: "Error al escanear", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Inmueble</h3>
        <div>
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleScanCertificado(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={scanning || credits === 0}
            onClick={() => fileInputRef.current?.click()}
          >
            {scanning ? (
              <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Procesando con Gemini IA...</>
            ) : (
              <><ScanLine className="mr-1 h-4 w-4" /> Escanear Certificado</>
            )}
          </Button>
        </div>
      </div>

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
              <SelectItem value="cedula_catastral">Cédula Catastral</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>
            Identificador Predial *
            {inmueble.tipo_identificador_predial === "chip" && (
              <span className="ml-2 text-xs text-muted-foreground">(Formato: AAA0000AAAA)</span>
            )}
            {inmueble.tipo_identificador_predial === "cedula_catastral" && (
              <span className="ml-2 text-xs text-muted-foreground">(Número predial)</span>
            )}
          </Label>
          <Input
            value={inmueble.identificador_predial}
            onChange={(e) => update("identificador_predial", e.target.value)}
            required
            placeholder={inmueble.tipo_identificador_predial === "chip" ? "AAA0000AAAA" : "Número predial"}
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
          <Label>Oficina de Registro (ORIP)</Label>
          <Input value={inmueble.codigo_orip} onChange={(e) => update("codigo_orip", e.target.value)} placeholder="Nombre o código de la ORIP" />
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

        <div className="space-y-2">
          <Label>Avalúo Catastral (COP)</Label>
          <Input value={inmueble.avaluo_catastral} onChange={(e) => update("avaluo_catastral", e.target.value)} placeholder="Valor del avalúo catastral" />
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

      {/* Sección Propiedad Horizontal */}
      <div className="space-y-4 rounded-lg border p-4">
        <h4 className="text-sm font-semibold text-muted-foreground">Propiedad Horizontal (PH)</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Escritura de Constitución PH</Label>
            <Input
              value={inmueble.escritura_ph}
              onChange={(e) => update("escritura_ph", e.target.value)}
              placeholder="No. escritura de constitución"
            />
          </div>
          <div className="space-y-2">
            <Label>Reformas PH</Label>
            <Input
              value={inmueble.reformas_ph}
              onChange={(e) => update("reformas_ph", e.target.value)}
              placeholder="Reformas a la PH (si aplica)"
            />
          </div>
        </div>
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
