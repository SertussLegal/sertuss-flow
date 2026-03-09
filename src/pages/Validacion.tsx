import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Eye, AlertTriangle } from "lucide-react";
import PersonaForm from "@/components/tramites/PersonaForm";
import InmuebleForm from "@/components/tramites/InmuebleForm";
import ActosForm from "@/components/tramites/ActosForm";
import DocxPreview from "@/components/tramites/DocxPreview";
import PreviewModal from "@/components/tramites/PreviewModal";
import { createEmptyPersona, createEmptyInmueble, createEmptyActos } from "@/lib/types";
import type { Persona, Inmueble, Actos, CustomVariable } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Maps template field names back to the form state they control
const FIELD_TO_INMUEBLE: Record<string, keyof Inmueble> = {
  matricula_inmobiliaria: "matricula_inmobiliaria",
  "inmueble.matricula": "matricula_inmobiliaria",
  identificador_predial: "identificador_predial",
  "inmueble.cedula_catastral": "identificador_predial",
  direccion_inmueble: "direccion",
  "inmueble.direccion": "direccion",
  municipio: "municipio",
  departamento: "departamento",
  area: "area",
  linderos: "linderos",
  "inmueble.linderos_especiales": "linderos",
  "inmueble.linderos_generales": "linderos",
  avaluo_catastral: "avaluo_catastral",
  codigo_orip: "codigo_orip",
  "inmueble.orip_ciudad": "codigo_orip",
};

const FIELD_TO_ACTOS: Record<string, keyof Actos> = {
  tipo_acto: "tipo_acto",
  valor_compraventa_letras: "valor_compraventa",
  "actos.cuantia_compraventa_letras": "valor_compraventa",
  "actos.cuantia_compraventa_numero": "valor_compraventa",
  entidad_bancaria: "entidad_bancaria",
  "actos.entidad_bancaria": "entidad_bancaria",
  valor_hipoteca_letras: "valor_hipoteca",
};

const Validacion = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const { profile, organization, credits, refreshCredits } = useAuth();

  const [tramiteId, setTramiteId] = useState<string | null>(id ?? null);
  const [vendedores, setVendedores] = useState<Persona[]>([createEmptyPersona()]);
  const [compradores, setCompradores] = useState<Persona[]>([createEmptyPersona()]);
  const [inmueble, setInmueble] = useState<Inmueble>(createEmptyInmueble());
  const [actos, setActos] = useState<Actos>(createEmptyActos());
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) loadTramite(id);
  }, [id]);

  const loadTramite = async (tid: string) => {
    const { data: t } = await supabase.from("tramites").select("*").eq("id", tid).single();
    if (!t) return;

    // Restore custom variables from metadata
    const meta = (t as any).metadata;
    if (meta?.custom_variables) {
      setCustomVariables(meta.custom_variables);
    }

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

  // Bidirectional sync: preview → form data
  const handleFieldEdit = useCallback((field: string, value: string) => {
    // Handle custom variables
    if (field.startsWith("__custom__")) {
      const cvId = field.replace("__custom__", "");
      setCustomVariables((prev) =>
        prev.map((cv) => (cv.id === cvId ? { ...cv, value } : cv))
      );
      return;
    }

    // Map to inmueble
    if (FIELD_TO_INMUEBLE[field]) {
      setInmueble((prev) => ({ ...prev, [FIELD_TO_INMUEBLE[field]]: value }));
      return;
    }

    // Map to actos
    if (FIELD_TO_ACTOS[field]) {
      setActos((prev) => ({ ...prev, [FIELD_TO_ACTOS[field]]: value }));
      return;
    }

    // Composite fields (personas) — these are read-only from preview since they combine multiple fields
  }, []);

  const handleCreateCustomVariable = useCallback((originalText: string, variableName: string) => {
    const newVar: CustomVariable = {
      id: crypto.randomUUID(),
      originalText,
      variableName,
      value: "",
    };
    setCustomVariables((prev) => [...prev, newVar]);
    toast({
      title: "Variable creada",
      description: `"${originalText.slice(0, 30)}${originalText.length > 30 ? "…" : ""}" → {${variableName}}`,
    });
  }, [toast]);

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

      const metadata = {
        last_saved: new Date().toISOString(),
        custom_variables: customVariables.map(cv => ({ ...cv })) as unknown as Record<string, unknown>[],
      } as Record<string, unknown>;
        last_saved: new Date().toISOString(),
        custom_variables: customVariables,
      };

      if (!tid) {
        const { data, error } = await supabase
          .from("tramites")
          .insert({
            tipo: actos.tipo_acto || "Compraventa",
            organization_id: profile.organization_id,
            created_by: profile.id,
            status: "validado" as any,
            metadata,
          })
          .select()
          .single();
        if (error) throw error;
        tid = data.id;
        setTramiteId(tid);
      } else {
        await supabase.from("tramites").update({ status: "validado" as any, updated_at: new Date().toISOString(), metadata }).eq("id", tid);
        await supabase.from("personas").delete().eq("tramite_id", tid);
        await supabase.from("inmuebles").delete().eq("tramite_id", tid);
        await supabase.from("actos").delete().eq("tramite_id", tid);
      }

      const personasToInsert = [
        ...vendedores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "vendedor" as any })),
        ...compradores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "comprador" as any })),
      ];
      if (personasToInsert.length) {
        const { error } = await supabase.from("personas").insert(personasToInsert);
        if (error) throw error;
      }

      const { error: inmError } = await supabase.from("inmuebles").insert({ ...inmuebleToRow(inmueble), tramite_id: tid! });
      if (inmError) throw inmError;

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

    if (!organization?.nit || !organization?.name) {
      toast({ title: "Datos legales incompletos", description: "La Razón Social y el NIT de tu entidad deben estar registrados antes de generar documentos.", variant: "destructive" });
      return;
    }

    setGenerating(true);
    try {
      const { data: success } = await supabase.rpc("consume_credit", { org_id: profile.organization_id });
      if (!success) {
        toast({ title: "Sin créditos", description: "Bolsa agotada.", variant: "destructive" });
        return;
      }

      const { data: enrichedData, error: aiError } = await supabase.functions.invoke("generate-document", {
        body: { vendedores, compradores, inmueble, actos, customVariables },
      });
      if (aiError) throw new Error("Error en la IA legal: " + aiError.message);

      const response = await fetch("/template_venta_hipoteca.docx");
      const content = await response.arrayBuffer();

      const PizZip = (await import("pizzip")).default;
      const Docxtemplater = (await import("docxtemplater")).default;

      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{", end: "}" },
        nullGetter: () => "___________",
      });

      const templateFields = enrichedData.templateData || enrichedData;
      const safeData = Object.fromEntries(
        Object.entries(templateFields).map(([k, v]) => [k, typeof v === "string" ? (v || "__________") : v])
      );

      doc.render(safeData);

      // Apply custom variables as text replacements on the generated XML
      let outZip = doc.getZip();
      if (customVariables.length > 0) {
        const docXml = outZip.file("word/document.xml");
        if (docXml) {
          let xmlContent = docXml.asText();
          for (const cv of customVariables) {
            if (cv.value && cv.originalText) {
              xmlContent = xmlContent.split(cv.originalText).join(cv.value);
            }
          }
          outZip.file("word/document.xml", xmlContent);
        }
      }

      const out = outZip.generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const fileName = `Escritura_${actos.tipo_acto || "Tramite"}_${tramiteId.slice(0, 8)}.docx`;
      const url = window.URL.createObjectURL(out);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();

      await supabase.from("tramites").update({ status: "word_generado" }).eq("id", tramiteId);
      await refreshCredits();
      toast({ title: "¡Éxito!", description: "Documento generado correctamente." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const renderTabs = () => (
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
  );

  return (
    <div className="flex h-dvh flex-col bg-background lg:overflow-hidden overflow-auto">
      <header className="border-b bg-notarial-dark text-white shrink-0">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost-dark" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
          </Button>
          <span className="text-sm font-medium">Validación de Escritura</span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost-dark" size="sm" onClick={handleSave} disabled={saving} className="border border-white/30">
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

      {/* Desktop: split view */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 hidden lg:flex">
        <ResizablePanel defaultSize={50} minSize={30} className="min-h-0 overflow-hidden">
          <DocxPreview
            vendedores={vendedores}
            compradores={compradores}
            inmueble={inmueble}
            actos={actos}
            customVariables={customVariables}
            onFieldEdit={handleFieldEdit}
            onCreateCustomVariable={handleCreateCustomVariable}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={35} className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full" style={{ overscrollBehavior: 'contain' }}>
            <div className="container max-w-2xl py-6">
              {renderTabs()}
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Mobile: stacked column */}
      <div className="flex-1 flex flex-col lg:hidden">
        <div className="container max-w-2xl py-6">
          {renderTabs()}
        </div>
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

const personaToRow = (p: Persona) => ({
  nombre_completo: p.nombre_completo,
  numero_cedula: p.numero_cedula,
  estado_civil: p.estado_civil,
  direccion: p.direccion,
  municipio_domicilio: p.municipio_domicilio,
  es_persona_juridica: p.es_persona_juridica,
  razon_social: p.razon_social,
  nit: p.nit,
  representante_legal_nombre: p.representante_legal_nombre,
  representante_legal_cedula: p.representante_legal_cedula,
  es_pep: p.es_pep,
  actua_mediante_apoderado: p.actua_mediante_apoderado,
  apoderado_persona_nombre: p.apoderado_persona_nombre,
  apoderado_persona_cedula: p.apoderado_persona_cedula,
  apoderado_persona_municipio: p.apoderado_persona_municipio,
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
  estrato: "",
  area: i.area,
  linderos: i.linderos,
  valorizacion: "",
  avaluo_catastral: i.avaluo_catastral,
  escritura_ph: i.escritura_ph,
  reformas_ph: i.reformas_ph,
  es_propiedad_horizontal: i.es_propiedad_horizontal,
});

const actosToRow = (a: Actos) => ({
  tipo_acto: a.tipo_acto,
  valor_compraventa: a.valor_compraventa,
  es_hipoteca: a.es_hipoteca,
  valor_hipoteca: a.valor_hipoteca,
  entidad_bancaria: a.entidad_bancaria,
  apoderado_nombre: a.apoderado_nombre,
  apoderado_cedula: a.apoderado_cedula,
  afectacion_vivienda_familiar: false,
});

export default Validacion;
