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
  const [baseHtml, setBaseHtml] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load template once and convert to HTML with mammoth
  useEffect(() => {
    const loadTemplate = async () => {
      try {
        setLoading(true);
        const response = await fetch("/template_venta_hipoteca.docx");
        if (!response.ok) {
          setError("No se pudo cargar la plantilla");
          return;
        }
        const buffer = await response.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        setBaseHtml(result.value);
      } catch (err: any) {
        console.error("Template load error:", err);
        setError("Error al cargar plantilla: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    loadTemplate();
  }, []);

  // Build replacement map from form state
  const buildReplacements = (): Record<string, string> => {
    const formatPersona = (p: Persona) => {
      if (p.es_persona_juridica) {
        return `${p.razon_social || "___________"}, NIT ${p.nit || "___________"}, representada legalmente por ${p.representante_legal_nombre || "___________"}, identificado(a) con cédula de ciudadanía No. ${p.representante_legal_cedula || "___________"}`;
      }
      return `${p.nombre_completo || "___________"}, mayor de edad, identificado(a) con cédula de ciudadanía No. ${p.numero_cedula || "___________"}, de estado civil ${p.estado_civil || "___________"}, domiciliado(a) en ${p.municipio_domicilio || "___________"}`;
    };

    return {
      "comparecientes_vendedor": vendedores.map(formatPersona).join("; y ") || "___________",
      "comparecientes_comprador": compradores.map(formatPersona).join("; y ") || "___________",
      "matricula_inmobiliaria": inmueble.matricula_inmobiliaria || "___________",
      "identificador_predial": inmueble.identificador_predial || "___________",
      "direccion_inmueble": inmueble.direccion || "___________",
      "inmueble.direccion": inmueble.direccion || "___________",
      "inmueble.matricula": inmueble.matricula_inmobiliaria || "___________",
      "inmueble.cedula_catastral": inmueble.identificador_predial || "___________",
      "inmueble.linderos_especiales": inmueble.linderos || "___________",
      "inmueble.linderos_generales": inmueble.linderos || "___________",
      "municipio": inmueble.municipio || "___________",
      "departamento": inmueble.departamento || "___________",
      "area": inmueble.area || "___________",
      "linderos": inmueble.linderos || "___________",
      "valor_compraventa_letras": actos.valor_compraventa || "___________",
      "actos.cuantia_compraventa_letras": actos.valor_compraventa || "___________",
      "actos.cuantia_compraventa_numero": actos.valor_compraventa || "___________",
      "tipo_acto": actos.tipo_acto || "___________",
      "entidad_bancaria": actos.entidad_bancaria || "___________",
      "actos.entidad_bancaria": actos.entidad_bancaria || "___________",
      "valor_hipoteca_letras": actos.valor_hipoteca || "___________",
      "avaluo_catastral": inmueble.avaluo_catastral || "___________",
      "codigo_orip": inmueble.codigo_orip || "___________",
      "inmueble.orip_ciudad": inmueble.codigo_orip || "___________",
    };
  };

  // Apply replacements to base HTML
  useEffect(() => {
    if (!baseHtml) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let result = baseHtml;
      const replacements = buildReplacements();

      // Replace {tag} patterns with values
      for (const [key, value] of Object.entries(replacements)) {
        // Escape special regex chars in key
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(`\\{${escaped}\\}`, "g"), `<strong>${value}</strong>`);
      }

      // Strip remaining loop syntax: {#tag}, {/tag}, {^tag}, {/}
      result = result.replace(/\{[#/^][^}]*\}/g, "");
      // Replace remaining {tag} with placeholder
      result = result.replace(/\{[a-zA-Z_][a-zA-Z0-9_.]*\}/g, "<em>___________</em>");

      setHtml(result);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [baseHtml, vendedores, compradores, inmueble, actos]);

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
