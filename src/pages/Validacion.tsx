import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Eye, Cloud, CloudOff, Loader2 } from "lucide-react";
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
  area_construida: "area_construida",
  area_privada: "area_privada",
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

type SyncStatus = "saved" | "saving" | "unsaved" | "idle";

const Validacion = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const { user, profile, organization, credits, refreshCredits } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [tramiteId, setTramiteId] = useState<string | null>(id ?? null);
  const [vendedores, setVendedores] = useState<Persona[]>([createEmptyPersona()]);
  const [compradores, setCompradores] = useState<Persona[]>([createEmptyPersona()]);
  const [inmueble, setInmueble] = useState<Inmueble>(createEmptyInmueble());
  const [actos, setActos] = useState<Actos>(createEmptyActos());
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const isLoadingRef = useRef(false);
  const tramiteIdRef = useRef<string | null>(tramiteId);

  // Keep ref in sync
  useEffect(() => { tramiteIdRef.current = tramiteId; }, [tramiteId]);

  useEffect(() => {
    if (id) {
      isLoadingRef.current = true;
      loadTramite(id).finally(() => { isLoadingRef.current = false; });
    }
  }, [id]);

  // Mark dirty when data changes (skip during initial load)
  useEffect(() => {
    if (!isLoadingRef.current) {
      setIsDirty(true);
      setSyncStatus("unsaved");
    }
  }, [vendedores, compradores, inmueble, actos, customVariables]);

  // Auto-save debounce: 30 seconds
  useEffect(() => {
    if (!isDirty || !profile?.organization_id) return;
    const timer = setTimeout(() => {
      handleAutoSave();
    }, 30000);
    return () => clearTimeout(timer);
  }, [isDirty, vendedores, compradores, inmueble, actos, customVariables, profile?.organization_id]);

  // beforeunload: attempt save
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        // Attempt a final sync save using sendBeacon isn't practical with Supabase SDK,
        // so we just warn the user
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const loadTramite = async (tid: string) => {
    const { data: t } = await supabase.from("tramites").select("*").eq("id", tid).single();
    if (!t) return;

    setIsUnlocked(!!(t as any).is_unlocked);

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

    setSyncStatus("saved");
    setIsDirty(false);
  };

  const handleAutoSave = async () => {
    if (!profile?.organization_id) return;
    setSyncStatus("saving");
    try {
      let tid = tramiteIdRef.current;
      const metadata = {
        last_saved: new Date().toISOString(),
        custom_variables: customVariables.map(cv => ({ ...cv })),
      } as Record<string, unknown>;

      if (!tid) {
        // Create new draft
        const { data, error } = await supabase
          .from("tramites")
          .insert({
            tipo: actos.tipo_acto || "Compraventa",
            organization_id: profile.organization_id,
            created_by: profile.id,
            status: "pendiente" as any,
            metadata: metadata as any,
          })
          .select()
          .single();
        if (error) throw error;
        tid = data.id;
        setTramiteId(tid);
        navigate(`/tramite/${tid}`, { replace: true });
      } else {
        await supabase.from("tramites").update({
          updated_at: new Date().toISOString(),
          metadata: metadata as any,
          tipo: actos.tipo_acto || "Compraventa",
        }).eq("id", tid);
      }

      // Upsert related data: delete and re-insert
      await supabase.from("personas").delete().eq("tramite_id", tid!);
      await supabase.from("inmuebles").delete().eq("tramite_id", tid!);
      await supabase.from("actos").delete().eq("tramite_id", tid!);

      const personasToInsert = [
        ...vendedores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "vendedor" as any })),
        ...compradores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "comprador" as any })),
      ];
      if (personasToInsert.length) {
        await supabase.from("personas").insert(personasToInsert);
      }
      await supabase.from("inmuebles").insert({ ...inmuebleToRow(inmueble), tramite_id: tid! });
      await supabase.from("actos").insert({ ...actosToRow(actos), tramite_id: tid! });

      setIsDirty(false);
      setSyncStatus("saved");
    } catch {
      setSyncStatus("unsaved");
    }
  };

  // Bidirectional sync: preview → form data
  const handleFieldEdit = useCallback((field: string, value: string) => {
    if (field.startsWith("__custom__")) {
      const cvId = field.replace("__custom__", "");
      setCustomVariables((prev) =>
        prev.map((cv) => (cv.id === cvId ? { ...cv, value } : cv))
      );
      return;
    }
    if (FIELD_TO_INMUEBLE[field]) {
      setInmueble((prev) => ({ ...prev, [FIELD_TO_INMUEBLE[field]]: value }));
      return;
    }
    if (FIELD_TO_ACTOS[field]) {
      setActos((prev) => ({ ...prev, [FIELD_TO_ACTOS[field]]: value }));
      return;
    }
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
    setSyncStatus("saving");
    try {
      let tid = tramiteId;

      const metadata = {
        last_saved: new Date().toISOString(),
        custom_variables: customVariables.map(cv => ({ ...cv })),
      } as Record<string, unknown>;

      if (!tid) {
        const { data, error } = await supabase
          .from("tramites")
          .insert({
            tipo: actos.tipo_acto || "Compraventa",
            organization_id: profile.organization_id,
            created_by: profile.id,
            status: "validado" as any,
            metadata: metadata as any,
          })
          .select()
          .single();
        if (error) throw error;
        tid = data.id;
        setTramiteId(tid);
        navigate(`/tramite/${tid}`, { replace: true });
      } else {
        await supabase.from("tramites").update({ status: "validado" as any, updated_at: new Date().toISOString(), metadata: metadata as any }).eq("id", tid);
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

      setIsDirty(false);
      setSyncStatus("saved");
      toast({ title: "Trámite guardado", description: "Estado actualizado a Validado." });
    } catch (err: any) {
      setSyncStatus("unsaved");
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const [generating, setGenerating] = useState(false);

  const ensureUnlocked = async (): Promise<boolean> => {
    if (isUnlocked) return true;
    if (!tramiteId || !profile?.organization_id || !user) return false;

    const { data: success } = await supabase.rpc("unlock_expediente", {
      p_org_id: profile.organization_id,
      p_tramite_id: tramiteId,
      p_user_id: user.id,
    });

    if (!success) {
      toast({
        title: "Créditos insuficientes",
        description: "Necesitas al menos 2 créditos para activar este expediente.",
        variant: "destructive",
      });
      return false;
    }

    setIsUnlocked(true);
    await refreshCredits();
    toast({
      title: "Trámite activado",
      description: "2 créditos consumidos. OCR y generación ilimitada habilitada.",
    });
    return true;
  };

  const handleConfirmGenerate = async () => {
    if (!tramiteId || !profile?.organization_id) {
      toast({ title: "Error", description: "Guarda el trámite primero.", variant: "destructive" });
      return;
    }

    if (!organization?.nit || !organization?.name) {
      toast({ title: "Datos legales incompletos", description: "La Razón Social y el NIT de tu entidad deben estar registrados antes de generar documentos.", variant: "destructive" });
      return;
    }

    const unlocked = await ensureUnlocked();
    if (!unlocked) return;

    setGenerating(true);
    try {

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
      setIsDirty(false);
      setSyncStatus("saved");
      toast({ title: "¡Éxito!", description: "Documento generado correctamente." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const syncIndicator = () => {
    switch (syncStatus) {
      case "saved":
        return (
          <span className="flex items-center gap-1 text-xs text-secondary">
            <Cloud className="h-3.5 w-3.5" /> Guardado
          </span>
        );
      case "saving":
        return (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...
          </span>
        );
      case "unsaved":
        return (
          <span className="flex items-center gap-1 text-xs text-accent">
            <CloudOff className="h-3.5 w-3.5" /> Sin guardar
          </span>
        );
      default:
        return null;
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
          <div className="ml-auto flex items-center gap-3">
            {syncIndicator()}
            <Button variant="ghost-dark" size="sm" onClick={handleSave} disabled={saving} className="border border-white/30">
              <Save className="mr-1 h-4 w-4" /> {saving ? "Guardando..." : "Guardar"}
            </Button>
            <Button
              size="sm"
              onClick={() => setPreviewOpen(true)}
              className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
            >
              <Eye className="mr-1 h-4 w-4" /> Previsualizar
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
  area_construida: i.area_construida,
  area_privada: i.area_privada,
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
