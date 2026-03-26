import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Scale, Loader2, Plus, Trash2, Eye } from "lucide-react";

const ESTILO_OPTIONS = [
  { value: "estandar", label: "Estándar — puntos cardinales" },
  { value: "tecnico", label: "Técnico — coordenadas y medidas" },
  { value: "narrativo", label: "Narrativo — descripción literaria" },
];

const ESTILO_EXAMPLES: Record<string, string> = {
  estandar: "Ejemplo: \"Por el NORTE, con la calle 80; por el SUR, con el lote 5; por el ORIENTE, con la carrera 7...\"",
  tecnico: "Ejemplo: \"Del punto 1 al punto 2: N 45°30' E, 12.50 m; del punto 2 al punto 3: S 30°15' E, 8.20 m...\"",
  narrativo: "Ejemplo: \"El predio limita al costado norte con la vía principal que conduce al municipio, extendiéndose...\"",
};

interface Clausula {
  nombre: string;
  texto: string;
}

const NotariaSettings = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);

  const [nombreNotaria, setNombreNotaria] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [notarioTitular, setNotarioTitular] = useState("");
  const [estiloLinderos, setEstiloLinderos] = useState("estandar");
  const [clausulas, setClausulas] = useState<Clausula[]>([]);

  useEffect(() => {
    if (!profile?.organization_id) return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("notaria_styles")
        .select("*")
        .eq("organization_id", profile.organization_id)
        .maybeSingle();
      if (data) {
        setExistingId(data.id);
        setNombreNotaria(data.nombre_notaria || "");
        setCiudad(data.ciudad || "");
        setNotarioTitular(data.notario_titular || "");
        setEstiloLinderos(data.estilo_linderos || "estandar");
        const raw = data.clausulas_personalizadas as Record<string, string> | null;
        if (raw && typeof raw === "object") {
          setClausulas(Object.entries(raw).map(([nombre, texto]) => ({ nombre, texto: String(texto) })));
        }
      }
      setLoading(false);
    };
    load();
  }, [profile?.organization_id]);

  const handleSave = async () => {
    if (!profile?.organization_id) return;
    if (!nombreNotaria.trim() || !ciudad.trim() || !notarioTitular.trim()) {
      toast({ title: "Campos requeridos", description: "Nombre, ciudad y notario titular son obligatorios.", variant: "destructive" });
      return;
    }

    const clausulasObj = Object.fromEntries(
      clausulas.filter(c => c.nombre.trim()).map(c => [c.nombre.trim(), c.texto.trim()])
    );

    setSaving(true);
    const payload = {
      organization_id: profile.organization_id,
      nombre_notaria: nombreNotaria.trim(),
      ciudad: ciudad.trim(),
      notario_titular: notarioTitular.trim(),
      estilo_linderos: estiloLinderos,
      clausulas_personalizadas: clausulasObj,
      updated_at: new Date().toISOString(),
    };

    const { error } = existingId
      ? await supabase.from("notaria_styles").update(payload).eq("id", existingId)
      : await supabase.from("notaria_styles").insert(payload);

    setSaving(false);
    if (error) {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Configuración guardada" });
      if (!existingId) {
        const { data } = await supabase
          .from("notaria_styles")
          .select("id")
          .eq("organization_id", profile.organization_id)
          .maybeSingle();
        if (data) setExistingId(data.id);
      }
    }
  };

  const addClausula = () => setClausulas(prev => [...prev, { nombre: "", texto: "" }]);
  const removeClausula = (idx: number) => setClausulas(prev => prev.filter((_, i) => i !== idx));
  const updateClausula = (idx: number, field: keyof Clausula, value: string) =>
    setClausulas(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const previewCiudad = ciudad.trim() || "________";
  const previewNotaria = nombreNotaria.trim() || "________";
  const previewNotario = notarioTitular.trim() || "________";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-16 items-center gap-3">
          <Scale className="h-6 w-6 text-notarial-gold" />
          <span className="text-lg font-bold">Sertuss</span>
        </div>
      </header>

      <main className="container max-w-2xl py-8">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver al Dashboard
        </Button>

        {/* Vista previa dinámica */}
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Vista previa del documento</CardTitle>
            </div>
            <CardDescription>Así se verán tus datos en las escrituras generadas</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm italic text-muted-foreground leading-relaxed">
              "En la ciudad de <strong className="text-foreground not-italic">{previewCiudad}</strong>, ante la{" "}
              <strong className="text-foreground not-italic">{previewNotaria}</strong>, compareció…
              Ante mí, <strong className="text-foreground not-italic">{previewNotario}</strong>, Notario…"
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuración de Notaría</CardTitle>
            <CardDescription>
              Estos datos personalizan la redacción automática de sus escrituras.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Nombre */}
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre de la Notaría *</Label>
              <Input id="nombre" value={nombreNotaria} onChange={(e) => setNombreNotaria(e.target.value)} placeholder="Ej: Notaría 32 de Bogotá D.C." />
              <p className="text-xs text-muted-foreground">Aparecerá en el encabezado: "…ante la <strong>Notaría 32 de Bogotá D.C.</strong>…"</p>
            </div>

            {/* Ciudad */}
            <div className="space-y-1.5">
              <Label htmlFor="ciudad">Ciudad *</Label>
              <Input id="ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ej: Bogotá D.C." />
              <p className="text-xs text-muted-foreground">Se usará en la comparecencia: "En la ciudad de <strong>Bogotá D.C.</strong>…"</p>
            </div>

            {/* Notario */}
            <div className="space-y-1.5">
              <Label htmlFor="notario">Notario Titular *</Label>
              <Input id="notario" value={notarioTitular} onChange={(e) => setNotarioTitular(e.target.value)} placeholder="Ej: Dr. Juan Pérez García" />
              <p className="text-xs text-muted-foreground">Firmará como: "Ante mí, <strong>Dr. Juan Pérez García</strong>, Notario…" al cierre del documento.</p>
            </div>

            {/* Estilo de Linderos */}
            <div className="space-y-1.5">
              <Label>Estilo de Linderos</Label>
              <Select value={estiloLinderos} onValueChange={setEstiloLinderos}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESTILO_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ESTILO_EXAMPLES[estiloLinderos]}</p>
            </div>

            <Separator />

            {/* Cláusulas dinámicas */}
            <div className="space-y-3">
              <div>
                <Label>Cláusulas Personalizadas</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Agregue cláusulas propias de su notaría que se incluirán automáticamente en las escrituras. Por ejemplo, una cláusula de paz y salvo o de entrega material del inmueble.
                </p>
              </div>

              {clausulas.map((c, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Nombre de la cláusula</Label>
                      <Input
                        value={c.nombre}
                        onChange={(e) => updateClausula(idx, "nombre", e.target.value)}
                        placeholder="Ej: Paz y salvo"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-5 text-destructive hover:text-destructive"
                      onClick={() => removeClausula(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Texto de la cláusula</Label>
                    <Textarea
                      rows={3}
                      value={c.texto}
                      onChange={(e) => updateClausula(idx, "texto", e.target.value)}
                      placeholder="Ej: El vendedor declara que se encuentra a paz y salvo con la administración del conjunto..."
                    />
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addClausula} className="w-full">
                <Plus className="mr-1 h-4 w-4" /> Agregar cláusula
              </Button>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full bg-notarial-green hover:bg-notarial-green/90">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar Configuración
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default NotariaSettings;
