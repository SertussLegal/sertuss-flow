import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Scale, Loader2 } from "lucide-react";

const ESTILO_OPTIONS = [
  { value: "estandar", label: "Estándar — puntos cardinales" },
  { value: "tecnico", label: "Técnico — coordenadas y medidas" },
  { value: "narrativo", label: "Narrativo — descripción literaria" },
];

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
  const [clausulasRaw, setClausulasRaw] = useState("");

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
        setClausulasRaw(
          data.clausulas_personalizadas
            ? JSON.stringify(data.clausulas_personalizadas, null, 2)
            : ""
        );
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

    let clausulas: Record<string, unknown> = {};
    if (clausulasRaw.trim()) {
      try {
        clausulas = JSON.parse(clausulasRaw);
      } catch {
        toast({ title: "JSON inválido", description: "Las cláusulas personalizadas deben ser JSON válido.", variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    const payload = {
      organization_id: profile.organization_id,
      nombre_notaria: nombreNotaria.trim(),
      ciudad: ciudad.trim(),
      notario_titular: notarioTitular.trim(),
      estilo_linderos: estiloLinderos,
      clausulas_personalizadas: clausulas,
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

        <Card>
          <CardHeader>
            <CardTitle>Configuración de Notaría</CardTitle>
            <CardDescription>
              Estos datos se usarán para personalizar la redacción de los documentos generados por la IA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre de la Notaría *</Label>
              <Input id="nombre" value={nombreNotaria} onChange={(e) => setNombreNotaria(e.target.value)} placeholder="Ej: Notaría 32 de Bogotá D.C." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ciudad">Ciudad *</Label>
              <Input id="ciudad" value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ej: Bogotá D.C." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notario">Notario Titular *</Label>
              <Input id="notario" value={notarioTitular} onChange={(e) => setNotarioTitular(e.target.value)} placeholder="Ej: Dr. Juan Pérez García" />
            </div>

            <div className="space-y-2">
              <Label>Estilo de Linderos</Label>
              <Select value={estiloLinderos} onValueChange={setEstiloLinderos}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESTILO_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clausulas">Cláusulas Personalizadas (JSON, opcional)</Label>
              <Textarea
                id="clausulas"
                rows={6}
                value={clausulasRaw}
                onChange={(e) => setClausulasRaw(e.target.value)}
                placeholder='{ "clausula_paz_y_salvo": "El vendedor declara..." }'
                className="font-mono text-xs"
              />
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
