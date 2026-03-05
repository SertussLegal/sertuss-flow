import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, FileText, Save, Eye } from "lucide-react";
import PersonaForm from "@/components/tramites/PersonaForm";
import InmuebleForm from "@/components/tramites/InmuebleForm";
import ActosForm from "@/components/tramites/ActosForm";
import PreviewModal from "@/components/tramites/PreviewModal";
import { createEmptyPersona, createEmptyInmueble, createEmptyActos } from "@/lib/types";
import type { Persona, Inmueble, Actos } from "@/lib/types";

const Validacion = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [vendedores, setVendedores] = useState<Persona[]>([createEmptyPersona()]);
  const [compradores, setCompradores] = useState<Persona[]>([createEmptyPersona()]);
  const [inmueble, setInmueble] = useState<Inmueble>(createEmptyInmueble());
  const [actos, setActos] = useState<Actos>(createEmptyActos());
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleSave = () => {
    if (!inmueble.identificador_predial) {
      toast({ title: "Error", description: "El Identificador Predial es obligatorio.", variant: "destructive" });
      return;
    }
    // Status changes to "validado" on save
    toast({ title: "Trámite guardado", description: "Estado actualizado a Validado." });
  };

  const handleConfirmGenerate = () => {
    setPreviewOpen(false);
    // Status changes to "word_generado"
    toast({ title: "Documento generado", description: "Estado actualizado a Word Generado." });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="text-white hover:bg-white/10">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Button>
          <span className="text-sm font-medium">Validación de Escritura</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSave} className="border-white/20 text-white hover:bg-white/10">
              <Save className="mr-1 h-4 w-4" />
              Guardar
            </Button>
            <Button size="sm" onClick={() => setPreviewOpen(true)} className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90">
              <Eye className="mr-1 h-4 w-4" />
              Previsualizar
            </Button>
          </div>
        </div>
      </header>

      {/* Side by side */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF Viewer placeholder */}
        <div className="hidden w-1/2 border-r bg-muted/30 lg:flex lg:flex-col lg:items-center lg:justify-center">
          <FileText className="h-16 w-16 text-muted-foreground/40" />
          <p className="mt-4 text-sm text-muted-foreground">Visor de Documento PDF</p>
          <p className="text-xs text-muted-foreground">(Próximamente)</p>
        </div>

        {/* Form */}
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
      />
    </div>
  );
};

export default Validacion;
