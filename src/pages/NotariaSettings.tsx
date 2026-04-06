import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Scale, Loader2, Plus, Trash2, Edit2, MapPin, Building2, Ruler } from "lucide-react";

const ESTILO_LINDEROS = [
  { value: "estandar", label: "Estándar — puntos cardinales" },
  { value: "tecnico", label: "Técnico — coordenadas y medidas" },
  { value: "narrativo", label: "Narrativo — descripción literaria" },
];

const FORMATO_FECHA = [
  { value: "notarial", label: "Notarial — 'los quince (15) días del mes de marzo'" },
  { value: "estandar", label: "Estándar — '15 de marzo de 2026'" },
];

const LINDEROS_FORMATO = [
  { value: "bloque", label: "En bloque — texto continuo" },
  { value: "desglosado", label: "Desglosado — línea por lindero" },
];

const MARGIN_PRESETS = [
  { value: "estandar", label: "Estándar (30 líneas)", top: 30, bottom: 25, left: 35, right: 25, lineHeight: 18, lineas: 30 },
  { value: "compacto", label: "Compacto (35 líneas)", top: 25, bottom: 20, left: 30, right: 20, lineHeight: 15, lineas: 35 },
  { value: "personalizado", label: "Personalizado", top: 30, bottom: 25, left: 35, right: 25, lineHeight: 18, lineas: 30 },
];

interface Clausula { nombre: string; texto: string; }

interface NotariaForm {
  id?: string;
  nombre_notaria: string;
  ciudad: string;
  notario_titular: string;
  estilo_linderos: string;
  margin_top_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  margin_right_mm: number;
  line_height_pt: number;
  lineas_por_pagina: number;
  precios_mayusculas: boolean;
  formato_fecha: string;
  linderos_formato: string;
  clausulas: Clausula[];
}

const emptyForm = (): NotariaForm => ({
  nombre_notaria: "", ciudad: "", notario_titular: "", estilo_linderos: "estandar",
  margin_top_mm: 30, margin_bottom_mm: 25, margin_left_mm: 35, margin_right_mm: 25,
  line_height_pt: 18, lineas_por_pagina: 30, precios_mayusculas: true,
  formato_fecha: "notarial", linderos_formato: "bloque", clausulas: [],
});

const NotariaSettings = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notarias, setNotarias] = useState<(NotariaForm & { id: string; tramite_count: number })[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NotariaForm>(emptyForm());
  const [marginPreset, setMarginPreset] = useState("estandar");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadNotarias = async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    const { data } = await supabase
      .from("notaria_styles")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: true });

    if (data) {
      // Count tramites per notaria
      const { data: tramites } = await supabase
        .from("tramites")
        .select("notaria_style_id")
        .eq("organization_id", profile.organization_id)
        .not("notaria_style_id", "is", null);

      const countMap: Record<string, number> = {};
      (tramites || []).forEach((t: any) => {
        if (t.notaria_style_id) countMap[t.notaria_style_id] = (countMap[t.notaria_style_id] || 0) + 1;
      });

      setNotarias(data.map((n: any) => {
        const raw = n.clausulas_personalizadas as Record<string, string> | null;
        const clausulas = raw && typeof raw === "object"
          ? Object.entries(raw).map(([nombre, texto]) => ({ nombre, texto: String(texto) }))
          : [];
        return {
          id: n.id,
          nombre_notaria: n.nombre_notaria || "",
          ciudad: n.ciudad || "",
          notario_titular: n.notario_titular || "",
          estilo_linderos: n.estilo_linderos || "estandar",
          margin_top_mm: n.margin_top_mm ?? 30,
          margin_bottom_mm: n.margin_bottom_mm ?? 25,
          margin_left_mm: n.margin_left_mm ?? 35,
          margin_right_mm: n.margin_right_mm ?? 25,
          line_height_pt: n.line_height_pt ?? 18,
          lineas_por_pagina: n.lineas_por_pagina ?? 30,
          precios_mayusculas: n.precios_mayusculas ?? true,
          formato_fecha: n.formato_fecha || "notarial",
          linderos_formato: n.linderos_formato || "bloque",
          clausulas,
          tramite_count: countMap[n.id] || 0,
        };
      }));
    }
    setLoading(false);
  };

  useEffect(() => { loadNotarias(); }, [profile?.organization_id]);

  const openNew = () => {
    setForm(emptyForm());
    setMarginPreset("estandar");
    setDialogOpen(true);
  };

  const openEdit = (n: typeof notarias[0]) => {
    setForm({ ...n });
    // Detect preset
    const preset = MARGIN_PRESETS.find(p =>
      p.top === n.margin_top_mm && p.bottom === n.margin_bottom_mm &&
      p.left === n.margin_left_mm && p.right === n.margin_right_mm &&
      p.lineHeight === n.line_height_pt && p.lineas === n.lineas_por_pagina
    );
    setMarginPreset(preset?.value || "personalizado");
    setDialogOpen(true);
  };

  const applyPreset = (presetValue: string) => {
    setMarginPreset(presetValue);
    const preset = MARGIN_PRESETS.find(p => p.value === presetValue);
    if (preset && presetValue !== "personalizado") {
      setForm(f => ({
        ...f,
        margin_top_mm: preset.top, margin_bottom_mm: preset.bottom,
        margin_left_mm: preset.left, margin_right_mm: preset.right,
        line_height_pt: preset.lineHeight, lineas_por_pagina: preset.lineas,
      }));
    }
  };

  const handleSave = async () => {
    if (!profile?.organization_id) return;
    if (!form.nombre_notaria.trim() || !form.ciudad.trim() || !form.notario_titular.trim()) {
      toast({ title: "Campos requeridos", description: "Nombre, ciudad y notario titular son obligatorios.", variant: "destructive" });
      return;
    }

    const clausulasObj = Object.fromEntries(
      form.clausulas.filter(c => c.nombre.trim()).map(c => [c.nombre.trim(), c.texto.trim()])
    );

    setSaving(true);
    const payload = {
      organization_id: profile.organization_id,
      nombre_notaria: form.nombre_notaria.trim(),
      ciudad: form.ciudad.trim(),
      notario_titular: form.notario_titular.trim(),
      estilo_linderos: form.estilo_linderos,
      margin_top_mm: form.margin_top_mm,
      margin_bottom_mm: form.margin_bottom_mm,
      margin_left_mm: form.margin_left_mm,
      margin_right_mm: form.margin_right_mm,
      line_height_pt: form.line_height_pt,
      lineas_por_pagina: form.lineas_por_pagina,
      precios_mayusculas: form.precios_mayusculas,
      formato_fecha: form.formato_fecha,
      linderos_formato: form.linderos_formato,
      clausulas_personalizadas: clausulasObj,
      updated_at: new Date().toISOString(),
    };

    const { error } = form.id
      ? await supabase.from("notaria_styles").update(payload).eq("id", form.id)
      : await supabase.from("notaria_styles").insert(payload);

    setSaving(false);
    if (error) {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: form.id ? "Notaría actualizada" : "Notaría agregada" });
      setDialogOpen(false);
      await loadNotarias();
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("notaria_styles").delete().eq("id", deleteId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Notaría eliminada" });
      await loadNotarias();
    }
    setDeleteId(null);
  };

  const addClausula = () => setForm(f => ({ ...f, clausulas: [...f.clausulas, { nombre: "", texto: "" }] }));
  const removeClausula = (idx: number) => setForm(f => ({ ...f, clausulas: f.clausulas.filter((_, i) => i !== idx) }));
  const updateClausula = (idx: number, field: keyof Clausula, value: string) =>
    setForm(f => ({ ...f, clausulas: f.clausulas.map((c, i) => i === idx ? { ...c, [field]: value } : c) }));

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

      <main className="container max-w-4xl py-8">
        <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver al Dashboard
        </Button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Directorio de Notarías</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Gestiona las notarías con las que trabajas. Cada trámite se asocia a una notaría específica.
            </p>
          </div>
          <Button onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Agregar Notaría
          </Button>
        </div>

        {notarias.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-medium mb-1">Sin notarías registradas</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Agrega la primera notaría para personalizar la redacción de tus escrituras.
              </p>
              <Button onClick={openNew}>
                <Plus className="mr-1 h-4 w-4" /> Agregar Notaría
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {notarias.map((n) => (
              <Card key={n.id} className="group hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{n.nombre_notaria}</CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" /> {n.ciudad}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(n)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(n.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground mb-3">Notario: {n.notario_titular}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs">
                      {n.tramite_count} trámite{n.tramite_count !== 1 ? "s" : ""}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Ruler className="h-3 w-3 mr-1" />
                      {n.lineas_por_pagina} líneas/pág
                    </Badge>
                    {n.clausulas.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {n.clausulas.length} cláusula{n.clausulas.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar Notaría" : "Agregar Notaría"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            {/* Section 1: Identity */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Identidad</h4>
              <div className="space-y-1.5">
                <Label>Nombre de la Notaría *</Label>
                <Input value={form.nombre_notaria} onChange={e => setForm(f => ({ ...f, nombre_notaria: e.target.value }))} placeholder="Ej: Notaría 32 de Bogotá D.C." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Ciudad *</Label>
                  <Input value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} placeholder="Ej: Bogotá D.C." />
                </div>
                <div className="space-y-1.5">
                  <Label>Notario Titular *</Label>
                  <Input value={form.notario_titular} onChange={e => setForm(f => ({ ...f, notario_titular: e.target.value }))} placeholder="Ej: Dr. Juan Pérez" />
                </div>
              </div>
            </div>

            <Separator />

            {/* Section 2: Page Geometry */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                <Ruler className="h-4 w-4 inline mr-1" />
                Geometría de Página (Papel Sellado)
              </h4>
              <div className="space-y-1.5">
                <Label>Preset</Label>
                <Select value={marginPreset} onValueChange={applyPreset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MARGIN_PRESETS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {marginPreset === "personalizado" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Margen superior (mm)</Label>
                    <Input type="number" value={form.margin_top_mm} onChange={e => setForm(f => ({ ...f, margin_top_mm: +e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Margen inferior (mm)</Label>
                    <Input type="number" value={form.margin_bottom_mm} onChange={e => setForm(f => ({ ...f, margin_bottom_mm: +e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Margen izquierdo (mm)</Label>
                    <Input type="number" value={form.margin_left_mm} onChange={e => setForm(f => ({ ...f, margin_left_mm: +e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Margen derecho (mm)</Label>
                    <Input type="number" value={form.margin_right_mm} onChange={e => setForm(f => ({ ...f, margin_right_mm: +e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Interlineado (pt)</Label>
                    <Input type="number" value={form.line_height_pt} onChange={e => setForm(f => ({ ...f, line_height_pt: +e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Líneas por página</Label>
                    <Input type="number" value={form.lineas_por_pagina} onChange={e => setForm(f => ({ ...f, lineas_por_pagina: +e.target.value }))} />
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Section 3: Redaction Preferences */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Preferencias de Redacción</h4>
              <div className="space-y-1.5">
                <Label>Estilo de Linderos</Label>
                <Select value={form.estilo_linderos} onValueChange={v => setForm(f => ({ ...f, estilo_linderos: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESTILO_LINDEROS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Formato de Linderos</Label>
                <Select value={form.linderos_formato} onValueChange={v => setForm(f => ({ ...f, linderos_formato: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LINDEROS_FORMATO.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Formato de Fecha</Label>
                <Select value={form.formato_fecha} onValueChange={v => setForm(f => ({ ...f, formato_fecha: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMATO_FECHA.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.precios_mayusculas} onCheckedChange={v => setForm(f => ({ ...f, precios_mayusculas: v }))} />
                <Label>Precios en letras mayúsculas</Label>
              </div>
            </div>

            <Separator />

            {/* Section 4: Custom Clauses */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cláusulas Personalizadas</h4>
              {form.clausulas.map((c, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Nombre</Label>
                      <Input value={c.nombre} onChange={e => updateClausula(idx, "nombre", e.target.value)} placeholder="Ej: Paz y salvo" />
                    </div>
                    <Button variant="ghost" size="icon" className="mt-5 text-destructive" onClick={() => removeClausula(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Texto</Label>
                    <Textarea rows={3} value={c.texto} onChange={e => updateClausula(idx, "texto", e.target.value)} placeholder="Texto de la cláusula..." />
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addClausula} className="w-full">
                <Plus className="mr-1 h-4 w-4" /> Agregar cláusula
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {form.id ? "Guardar Cambios" : "Agregar Notaría"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar esta notaría?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Los trámites que la usaban conservarán sus datos, pero no podrán referenciarla en el futuro.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NotariaSettings;
