import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import type { Persona, Inmueble, Actos } from "@/lib/types";

interface DocxPreviewProps {
  vendedores: Persona[];
  compradores: Persona[];
  inmueble: Inmueble;
  actos: Actos;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_PADDING_X = 72;
const PAGE_PADDING_Y = 72;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING_Y * 2;
const NAV_BAR_HEIGHT = 56;

const DocxPreview = ({ vendedores, compradores, inmueble, actos }: DocxPreviewProps) => {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseHtml, setBaseHtml] = useState<string>("");
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [scale, setScale] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Observe container size for responsive scaling (both width and height)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height - NAV_BAR_HEIGHT;
      setScale(Math.min(1, (w - 32) / PAGE_WIDTH, (h - 32) / PAGE_HEIGHT));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        const newPageCount = Math.max(1, Math.ceil(totalHeight / CONTENT_HEIGHT));
        setPageCount(newPageCount);
        setCurrentPage((prev) => Math.min(prev, newPageCount - 1));
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

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-muted">
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

      {/* Single page view */}
      <div className="flex-1 overflow-auto p-4 flex justify-center items-start">
        <div
          className="shrink-0"
          style={{
            height: `${PAGE_HEIGHT * scale}px`,
            width: `${PAGE_WIDTH * scale}px`,
            marginTop: "8px",
            marginBottom: "8px",
          }}
        >
          <div
            className="bg-white rounded shadow-md"
            style={{
              width: `${PAGE_WIDTH}px`,
              height: `${PAGE_HEIGHT}px`,
              padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
              overflow: "hidden",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <div style={{ height: `${CONTENT_HEIGHT}px`, overflow: "hidden" }}>
              <div
                className="prose prose-sm max-w-none"
                style={{
                  fontFamily: "'Times New Roman', serif",
                  fontSize: "13px",
                  lineHeight: "1.8",
                  color: "#1a1a1a",
                  transform: `translateY(-${currentPage * CONTENT_HEIGHT}px)`,
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation bar */}
      <div
        className="flex items-center justify-center gap-3 border-t border-border bg-background px-4"
        style={{ height: `${NAV_BAR_HEIGHT}px` }}
      >
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          disabled={currentPage === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-muted-foreground min-w-[120px] text-center">
          Página {currentPage + 1} de {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={currentPage === pageCount - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default DocxPreview;
