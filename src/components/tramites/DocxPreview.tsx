import { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Loader2 } from "lucide-react";
import type { Persona, Inmueble, Actos } from "@/lib/types";

interface DocxPreviewProps {
  vendedores: Persona[];
  compradores: Persona[];
  inmueble: Inmueble;
  actos: Actos;
}

const DocxPreview = ({ vendedores, compradores, inmueble, actos }: DocxPreviewProps) => {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build template data from form state
  const buildTemplateData = () => {
    const formatPersona = (p: Persona) => {
      if (p.es_persona_juridica) {
        return `${p.razon_social || "___________"}, NIT ${p.nit || "___________"}, representada legalmente por ${p.representante_legal_nombre || "___________"}, identificado(a) con cédula de ciudadanía No. ${p.representante_legal_cedula || "___________"}`;
      }
      return `${p.nombre_completo || "___________"}, mayor de edad, identificado(a) con cédula de ciudadanía No. ${p.numero_cedula || "___________"}, de estado civil ${p.estado_civil || "___________"}, domiciliado(a) en ${p.municipio_domicilio || "___________"}`;
    };

    return {
      comparecientes_vendedor: vendedores.map(formatPersona).join("; y ") || "___________",
      comparecientes_comprador: compradores.map(formatPersona).join("; y ") || "___________",
      matricula_inmobiliaria: inmueble.matricula_inmobiliaria || "___________",
      identificador_predial: inmueble.identificador_predial || "___________",
      direccion_inmueble: inmueble.direccion || "___________",
      municipio: inmueble.municipio || "___________",
      departamento: inmueble.departamento || "___________",
      area: inmueble.area || "___________",
      linderos: inmueble.linderos || "___________",
      valor_compraventa_letras: actos.valor_compraventa || "___________",
      tipo_acto: actos.tipo_acto || "___________",
      entidad_bancaria: actos.entidad_bancaria || "",
      valor_hipoteca_letras: actos.valor_hipoteca || "",
      avaluo_catastral: inmueble.avaluo_catastral || "",
      codigo_orip: inmueble.codigo_orip || "___________",
    };
  };

  const renderPreview = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/template_venta_hipoteca.docx");
      if (!response.ok) {
        setError("No se pudo cargar la plantilla");
        return;
      }
      const content = await response.arrayBuffer();

      const PizZip = (await import("pizzip")).default;
      const Docxtemplater = (await import("docxtemplater")).default;

      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{", end: "}" },
      });

      const templateData = buildTemplateData();
      const safeData = Object.fromEntries(
        Object.entries(templateData).map(([k, v]) => [k, typeof v === "string" ? (v || "___________") : v])
      );

      doc.render(safeData);

      // Generate a new docx buffer and convert to HTML with mammoth
      const outputBlob = doc.getZip().generate({ type: "uint8array" });
      const mammoth = await import("mammoth");
      const buffer = outputBlob.buffer.slice(0) as ArrayBuffer;
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
      setHtml(result.value);
    } catch (err: any) {
      console.error("Preview error:", err);
      setError("Error al generar vista previa: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(renderPreview, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [vendedores, compradores, inmueble, actos]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FileText className="h-12 w-12 text-destructive/40" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (loading && !html) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Generando vista previa…</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[700px] p-8">
        <div
          className="rounded-lg border bg-white p-10 shadow-sm prose prose-sm max-w-none"
          style={{ fontFamily: "'Times New Roman', serif", fontSize: "13px", lineHeight: "1.8", color: "#1a1a1a" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </ScrollArea>
  );
};

export default DocxPreview;
