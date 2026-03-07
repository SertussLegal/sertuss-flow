import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, FileText, Save, Eye, AlertTriangle } from "lucide-react";
import PersonaForm from "@/components/tramites/PersonaForm";
import InmuebleForm from "@/components/tramites/InmuebleForm";
import ActosForm from "@/components/tramites/ActosForm";
import PreviewModal from "@/components/tramites/PreviewModal";
import { createEmptyPersona, createEmptyInmueble, createEmptyActos } from "@/lib/types";
import type { Persona, Inmueble, Actos } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const Validacion = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const { profile, credits, refreshCredits } = useAuth();

  const [tramiteId, setTramiteId] = useState<string | null>(id ?? null);
  const [vendedores, setVendedores] = useState<Persona[]>([createEmptyPersona()]);
  const [compradores, setCompradores] = useState<Persona[]>([createEmptyPersona()]);
  const [inmueble, setInmueble] = useState<Inmueble>(createEmptyInmueble());
  const [actos, setActos] = useState<Actos>(createEmptyActos());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load existing tramite
  useEffect(() => {
    if (id) loadTramite(id);
  }, [id]);

  const loadTramite = async (tid: string) => {
    const { data: t } = await supabase.from("tramites").select("*").eq("id", tid).single();
    if (!t) return;

    const { data: personas } = await supabase.from("personas").select("*").eq("tramite_id", tid);
    const { data: inm } = await supabase.from("inmuebles").select("*").eq("tramite_id", tid).single();
    const { data: act } = await supabase.from("actos").select("*").eq("tramite_id", tid).single();

    if (personas) {
      const v = personas.filter((p: any) => p.rol === "vendedor").map((p: any) => ({ ...p } as Persona));
      const c = personas.filter((p: any) => p.rol === "comprador").map((p: any) => ({ ...p } as Persona));
      if (v.length) setVendedores(v);
      if (c.length) setCompradores(c);
    }
    if (inm) setInmueble(inm as any);
    if (act) setActos(act as any);
  };

  const handleSave = async () => {
    if (!inmueble.identificador_predial) {
      toast({ title: "Error", description: "El Identificador Predial es obligatorio.", variant: "destructive" });
      return;
    }
    if (!profile?.organization_id) {
      toast({ title: "Error", description: "No se encontró tu organización.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      let tid = tramiteId;

      if (!tid) {
        // Create new tramite
        const { data, error } = await supabase
          .from("tramites")
          .insert({
            tipo: actos.tipo_acto || "Compraventa",
            organization_id: profile.organization_id,
            created_by: profile.id,
            status: "validado" as any,
          })
          .select()
          .single();
        if (error) throw error;
        tid = data.id;
        setTramiteId(tid);
      } else {
        await supabase.from("tramites").update({ status: "validado" as any, updated_at: new Date().toISOString() }).eq("id", tid);
        // Clear old related data
        await supabase.from("personas").delete().eq("tramite_id", tid);
        await supabase.from("inmuebles").delete().eq("tramite_id", tid);
        await supabase.from("actos").delete().eq("tramite_id", tid);
      }

      // Insert personas
      const personasToInsert = [
        ...vendedores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "vendedor" as any })),
        ...compradores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "comprador" as any })),
      ];
      if (personasToInsert.length) {
        const { error } = await supabase.from("personas").insert(personasToInsert);
        if (error) throw error;
      }

      // Insert inmueble
      const { error: inmError } = await supabase.from("inmuebles").insert({ ...inmuebleToRow(inmueble), tramite_id: tid! });
      if (inmError) throw inmError;

      // Insert actos
      const { error: actError } = await supabase.from("actos").insert({ ...actosToRow(actos), tramite_id: tid! });
      if (actError) throw actError;

      toast({ title: "Trámite guardado", description: "Estado actualizado a Validado." });
    } catch (err: any) {
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const [generating, setGenerating] = useState(false);

  const handleConfirmGenerate = async () => {
    if (!tramiteId || !profile?.organization_id) {
      toast({ title: "Error", description: "Guarda el trámite primero.", variant: "destructive" });
      return;
    }
  
    setGenerating(true);
    try {
      // Paso 1: Consumir crédito (Plan item 1)
      const { data: success } = await supabase.rpc("consume_credit", { org_id: profile.organization_id });
      if (!success) {
        toast({ title: "Sin créditos", description: "Bolsa agotada.", variant: "destructive" });
        return;
      }
  
      // Paso 2: Invocar Edge Function (Capa de enriquecimiento legal)
      const { data: enrichedData, error: aiError } = await supabase.functions.invoke("generate-document", {
        body: { vendedores, compradores, inmueble, actos },
      });
      if (aiError) throw new Error("Error en la IA legal: " + aiError.message);
  
      // Paso 3: Cargar plantilla y procesar con docxtemplater
      const response = await fetch("/template_venta_hipoteca.docx");
      const content = await response.arrayBuffer();
      
      const PizZip = (await import("pizzip")).default;
      const Docxtemplater = (await import("docxtemplater")).default;
  
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        // Cambiado a llaves simples según tu referencia de tags (Imagen 11)
        delimiters: { start: "{", end: "}" },
      });
  
      // Usamos el failsafe rule: si un campo está vacío, pone una línea ____
      const templateFields = enrichedData.templateData || enrichedData;
      const safeData = Object.fromEntries(
        Object.entries(templateFields).map(([k, v]) => [k, typeof v === 'string' ? (v || "__________") : v])
      );
  
      doc.render(safeData);
  
      // Paso 4: Generar Blob y descargar
      const out = doc.getZip().generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
  
      const fileName = `Escritura_${actos.tipo_acto || 'Tramite'}_${tramiteId.slice(0, 8)}.docx`;
      const url = window.URL.createObjectURL(out);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
  
      // Paso 5: Actualización y Log de Auditoría (Plan item 4a y 4b)
      await supabase.from("tramites").update({ status: "word_generado" }).eq("id", tramiteId);
      
      // Audit log is handled automatically by the log_word_generated trigger

      await refreshCredits();
      toast({ title: "¡Éxito!", description: "Documento generado correctamente." });
  
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="text-white hover:bg-white/10">
            <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
          </Button>
          <span className="text-sm font-medium">Validación de Escritura</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="border-white/20 text-white hover:bg-white/10">
              <Save className="mr-1 h-4 w-4" /> {saving ? "Guardando..." : "Guardar"}
            </Button>
            <Button
              size="sm"
              onClick={() => setPreviewOpen(true)}
              disabled={credits === 0}
              className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
            >
              {credits === 0 ? (
                <><AlertTriangle className="mr-1 h-4 w-4" /> Sin créditos</>
              ) : (
                <><Eye className="mr-1 h-4 w-4" /> Previsualizar</>
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-1/2 border-r bg-muted/30 lg:flex lg:flex-col lg:items-center lg:justify-center">
          <FileText className="h-16 w-16 text-muted-foreground/40" />
          <p className="mt-4 text-sm text-muted-foreground">Visor de Documento PDF</p>
          <p className="text-xs text-muted-foreground">(Próximamente)</p>
        </div>

        <ScrollArea className="flex-1">
          <div className="container max-w-2xl py-6">
            <Tabs defaultValue="vendedores" className="w-full">
              <TabsList className="mb-6 w-full">
                <TabsTrigger value="vendedores" className="flex-1">Vendedores</TabsTrigger>
                <TabsTrigger value="compradores" className="flex-1">Compradores</TabsTrigger>
                <TabsTrigger value="inmueble" className="flex-1">Inmueble</TabsTrigger>
                <TabsTrigger value="actos" className="flex-1">Actos</TabsTrigger>
              </TabsList>

              <TabsContent value="vendedores">
                <PersonaForm title="Vendedores" personas={vendedores} onChange={setVendedores} />
              </TabsContent>
              <TabsContent value="compradores">
                <PersonaForm title="Compradores" personas={compradores} onChange={setCompradores} />
              </TabsContent>
              <TabsContent value="inmueble">
                <InmuebleForm inmueble={inmueble} onChange={setInmueble} />
              </TabsContent>
              <TabsContent value="actos">
                <ActosForm actos={actos} onChange={setActos} />
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </div>

      <PreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        vendedores={vendedores}
        compradores={compradores}
        inmueble={inmueble}
        actos={actos}
        onConfirm={handleConfirmGenerate}
        generating={generating}
      />
    </div>
  );
};

// Helper functions to strip client-only fields
const personaToRow = (p: Persona) => ({
  nombre_completo: p.nombre_completo,
  numero_cedula: p.numero_cedula,
  estado_civil: p.estado_civil,
  direccion: p.direccion,
  es_persona_juridica: p.es_persona_juridica,
  razon_social: p.razon_social,
  nit: p.nit,
  representante_legal_nombre: p.representante_legal_nombre,
  representante_legal_cedula: p.representante_legal_cedula,
  es_pep: p.es_pep,
});

const inmuebleToRow = (i: Inmueble) => ({
  matricula_inmobiliaria: i.matricula_inmobiliaria,
  tipo_identificador_predial: i.tipo_identificador_predial,
  identificador_predial: i.identificador_predial,
  departamento: i.departamento,
  municipio: i.municipio,
  codigo_orip: i.codigo_orip,
  tipo_predio: i.tipo_predio,
  direccion: i.direccion,
  estrato: i.estrato,
  area: i.area,
  linderos: i.linderos,
  valorizacion: i.valorizacion,
});

const actosToRow = (a: Actos) => ({
  tipo_acto: a.tipo_acto,
  valor_compraventa: a.valor_compraventa,
  es_hipoteca: a.es_hipoteca,
  valor_hipoteca: a.valor_hipoteca,
  entidad_bancaria: a.entidad_bancaria,
  apoderado_nombre: a.apoderado_nombre,
  apoderado_cedula: a.apoderado_cedula,
  afectacion_vivienda_familiar: a.afectacion_vivienda_familiar,
});

export default Validacion;
