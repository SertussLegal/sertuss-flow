import { useState, useEffect, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Loader2 } from "lucide-react";
import type { Persona, Inmueble, Actos } from "@/lib/types";

interface DocxPreviewProps {
  vendedores: Persona[];
  compradores: Persona[];
  inmueble: Inmueble;
  actos: Actos;
}

const PAGE_WIDTH = 612; // 8.5in * 72dpi
const PAGE_HEIGHT = 792; // 11in * 72dpi
const PAGE_PADDING_X = 72; // 1in margins
const PAGE_PADDING_Y = 72;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING_Y * 2; // 648px

const DocxPreview = ({ vendedores, compradores, inmueble, actos }: DocxPreviewProps) => {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseHtml, setBaseHtml] = useState<string>("");
  const [pageCount, setPageCount] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // Load template once
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

  // Build replacement map
  const buildReplacements = useCallback((): Record<string, string> => {
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
  }, [vendedores, compradores, inmueble, actos]);

  // Apply replacements
  useEffect(() => {
    if (!baseHtml) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      let result = baseHtml;
      const replacements = buildReplacements();

      for (const [key, value] of Object.entries(replacements)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(`\\{${escaped}\\}`, "g"), `<strong>${value}</strong>`);
      }

      result = result.replace(/\{[#/^][^}]*\}/g, "");
      result = result.replace(/\{[a-zA-Z_][a-zA-Z0-9_.]*\}/g, "<em>___________</em>");

      setHtml(result);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [baseHtml, buildReplacements]);

  // Measure content and compute pages
  useEffect(() => {
    if (!html || !measureRef.current) return;

    const frame = requestAnimationFrame(() => {
      if (measureRef.current) {
        const totalHeight = measureRef.current.scrollHeight;
        setPageCount(Math.max(1, Math.ceil(totalHeight / CONTENT_HEIGHT)));
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [html]);

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

  const pages = Array.from({ length: pageCount }, (_, i) => i);

  return (
    <ScrollArea className="h-full bg-muted">
      {/* Hidden measuring container */}
      <div
        ref={measureRef}
        className="prose prose-sm max-w-none absolute opacity-0 pointer-events-none"
        style={{
          width: `${PAGE_WIDTH - PAGE_PADDING_X * 2}px`,
          fontFamily: "'Times New Roman', serif",
          fontSize: "13px",
          lineHeight: "1.8",
          color: "#1a1a1a",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Visible paginated pages */}
      <div className="flex flex-col items-center gap-6 py-8 px-4">
        {pages.map((pageIndex) => (
          <div
            key={pageIndex}
            className="bg-white rounded shadow-md flex-shrink-0"
            style={{
              width: `${PAGE_WIDTH}px`,
              height: `${PAGE_HEIGHT}px`,
              padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: `${CONTENT_HEIGHT}px`,
                overflow: "hidden",
              }}
            >
              <div
                className="prose prose-sm max-w-none"
                style={{
                  fontFamily: "'Times New Roman', serif",
                  fontSize: "13px",
                  lineHeight: "1.8",
                  color: "#1a1a1a",
                  transform: `translateY(-${pageIndex * CONTENT_HEIGHT}px)`,
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        ))}

        {/* Page counter */}
        <p className="text-xs text-muted-foreground pb-4">
          {pageCount} {pageCount === 1 ? "página" : "páginas"}
        </p>
      </div>
    </ScrollArea>
  );
};

export default DocxPreview;
