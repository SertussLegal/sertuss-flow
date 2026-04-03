import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Loader2, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Inmueble, NivelConfianza } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import OcrBadge from "./OcrBadge";
import OcrSuggestion from "./OcrSuggestion";

export interface ExtractedPersona {
  nombre_completo: string;
  numero_identificacion: string;
  tipo_identificacion?: string;
  lugar_expedicion?: string;
}

export interface ExtractedDocumento {
  fecha_documento?: string;
  notaria_origen?: string;
  numero_escritura?: string;
  titulo_antecedente?: {
    tipo_documento?: string;
    numero_documento?: string;
    fecha_documento?: string;
    notaria_documento?: string;
    ciudad_documento?: string;
    adquirido_de?: string;
  };
}

interface InmuebleFormProps {
  inmueble: Inmueble;
  onChange: (inmueble: Inmueble) => void;
  onPersonasExtracted?: (personas: ExtractedPersona[]) => void;
  onDocumentoExtracted?: (documento: ExtractedDocumento) => void;
  onPredialExtracted?: (data: { numero_recibo?: string; anio_gravable?: string; valor_pagado?: string; estrato?: string }) => void;
  onActosExtracted?: (actos: Record<string, any>) => void;
  confianzaFields?: Map<string, NivelConfianza>;
  onConfianzaChange?: (field: string, confianza: NivelConfianza) => void;
}

type ScanType = "certificado_tradicion" | "predial" | "escritura_antecedente";

const InmuebleForm = ({ inmueble, onChange, onPersonasExtracted, onDocumentoExtracted, onPredialExtracted, onActosExtracted, confianzaFields, onConfianzaChange }: InmuebleFormProps) => {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [scanning, setScanning] = useState<ScanType | null>(null);
  const [ocrFields, setOcrFields] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Map<string, string>>(new Map());
  const certInputRef = useRef<HTMLInputElement | null>(null);
  const predialInputRef = useRef<HTMLInputElement | null>(null);
  const escrituraInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof Inmueble, value: string | boolean) => {
    setOcrFields(prev => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
    setSuggestions(prev => {
      if (!prev.has(field)) return prev;
      const next = new Map(prev);
      next.delete(field);
      return next;
    });
    // Auto-promote confidence to "alta" on manual edit
    if (confianzaFields?.get(field) === "baja" && onConfianzaChange) {
      onConfianzaChange(field, "alta");
    }
    onChange({ ...inmueble, [field]: value });
  };

  const markOcrFields = (fields: string[]) => {
    setOcrFields(prev => {
      const next = new Set(prev);
      fields.forEach(f => next.add(f));
      return next;
    });
  };

  const applyOcrResults = (results: Record<string, string | boolean | undefined>, currentInmueble: Inmueble) => {
    const updated: Partial<Inmueble> = {};
    const filled: string[] = [];
    const newSuggestions = new Map(suggestions);

    for (const [field, value] of Object.entries(results)) {
      if (value == null) continue;
      const currentVal = currentInmueble[field as keyof Inmueble];
      const hasExistingValue = typeof currentVal === "string" ? currentVal.length > 0 : false;

      if (hasExistingValue && typeof value === "string") {
        newSuggestions.set(field, value);
      } else {
        (updated as any)[field] = value;
        filled.push(field);
      }
    }

    setSuggestions(newSuggestions);
    if (Object.keys(updated).length > 0) {
      onChange({ ...currentInmueble, ...updated });
    }
    if (filled.length > 0) markOcrFields(filled);
    return filled;
  };

  const confirmSuggestion = (field: string) => {
    const value = suggestions.get(field);
    if (!value) return;
    setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
    markOcrFields([field]);
    onChange({ ...inmueble, [field]: value });
  };

  const ignoreSuggestion = (field: string) => {
    setSuggestions(prev => { const n = new Map(prev); n.delete(field); return n; });
  };

  const handleScanDocument = async (file: File, type: ScanType) => {
    if (!profile?.organization_id) return;

    setScanning(type);
    try {
      const base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type },
      });

      if (error) throw new Error(error.message);
      if (data?.data) {
        const d = data.data;

        if (type === "certificado_tradicion") {
          const inmData = d.inmueble || d;
          const docData = d.documento;
          const personasData = d.personas;

          // Unwrap confidence wrappers for inmueble fields
          const unwrapped: Record<string, string | boolean> = {};
          for (const [key, val] of Object.entries(inmData || {})) {
            if (val && typeof val === "object" && "valor" in (val as any)) {
              unwrapped[key] = (val as any).valor;
              if ((val as any).confianza && onConfianzaChange) {
                onConfianzaChange(key, (val as any).confianza);
              }
            } else if (val != null) {
              unwrapped[key] = val as string | boolean;
            }
          }

          // Separate NUPRE/CHIP from cédula catastral
          // CHIP starts with "AAA" and is exclusive to Bogotá
          const nupre = unwrapped.nupre;
          const chipMapping: Record<string, string | boolean> = {};
          if (nupre && typeof nupre === "string" && nupre.startsWith("AAA")) {
            chipMapping.nupre = nupre;
            chipMapping.tipo_identificador_predial = "chip";
          }
          // If cedula_catastral comes from OCR (long numeric), use it as identificador_predial
          const cedulaCatastral = unwrapped.cedula_catastral;
          if (cedulaCatastral && typeof cedulaCatastral === "string") {
            const cleanCedula = cedulaCatastral.replace(/[\s.\-]/g, "");
            if (/^\d{10,}$/.test(cleanCedula)) {
              chipMapping.identificador_predial = cleanCedula;
              chipMapping.tipo_identificador_predial = "cedula_catastral";
            }
          }

          applyOcrResults({
            matricula_inmobiliaria: unwrapped.matricula_inmobiliaria as string,
            codigo_orip: unwrapped.codigo_orip as string,
            direccion: unwrapped.direccion as string,
            municipio: unwrapped.municipio as string,
            departamento: unwrapped.departamento as string,
            linderos: unwrapped.linderos as string,
            ...(unwrapped.area_construida ? { area_construida: unwrapped.area_construida as string } : {}),
            ...(unwrapped.area_privada ? { area_privada: unwrapped.area_privada as string } : {}),
            ...chipMapping,
            ...(unwrapped.tipo_predio === "rural" ? { tipo_predio: "rural" } : {}),
            ...(unwrapped.es_propiedad_horizontal != null ? { es_propiedad_horizontal: unwrapped.es_propiedad_horizontal as boolean } : {}),
            ...(unwrapped.escritura_constitucion_ph ? { escritura_ph: unwrapped.escritura_constitucion_ph as string } : {}),
            ...(unwrapped.reformas_ph ? { reformas_ph: unwrapped.reformas_ph as string } : {}),
            ...(unwrapped.nombre_conjunto_edificio ? { nombre_edificio_conjunto: unwrapped.nombre_conjunto_edificio as string } : {}),
            ...(unwrapped.escritura_ph_numero ? { escritura_ph_numero: unwrapped.escritura_ph_numero as string } : {}),
            ...(unwrapped.escritura_ph_fecha ? { escritura_ph_fecha: unwrapped.escritura_ph_fecha as string } : {}),
            ...(unwrapped.escritura_ph_notaria ? { escritura_ph_notaria: unwrapped.escritura_ph_notaria as string } : {}),
            ...(unwrapped.escritura_ph_ciudad ? { escritura_ph_ciudad: unwrapped.escritura_ph_ciudad as string } : {}),
            ...(unwrapped.matricula_matriz ? { matricula_matriz: unwrapped.matricula_matriz as string } : {}),
            ...(unwrapped.coeficiente_copropiedad ? { coeficiente_copropiedad: unwrapped.coeficiente_copropiedad as string } : {}),
          }, inmueble);

          if (personasData && Array.isArray(personasData) && onPersonasExtracted) {
            onPersonasExtracted(personasData);
          }

          // Unwrap documento confidence
          if (docData && onDocumentoExtracted) {
            const unwrappedDoc: Record<string, any> = {};
            for (const [key, val] of Object.entries(docData)) {
              if (val && typeof val === "object" && "valor" in (val as any)) {
                unwrappedDoc[key] = (val as any).valor;
              } else if (typeof val === "string") {
                unwrappedDoc[key] = val;
              }
            }
            // Unwrap titulo_antecedente if present
            if (d.titulo_antecedente) {
              const ta: Record<string, string> = {};
              for (const [key, val] of Object.entries(d.titulo_antecedente)) {
                if (val && typeof val === "object" && "valor" in (val as any)) {
                  ta[key] = (val as any).valor;
                } else if (typeof val === "string") {
                  ta[key] = val;
                }
              }
              unwrappedDoc.titulo_antecedente = ta;
            }
            onDocumentoExtracted(unwrappedDoc as ExtractedDocumento);
          }

          // Extract and emit actos data from certificado
          if (d.actos && onActosExtracted) {
            onActosExtracted(d.actos);
          }

          toast({ title: "Certificado procesado", description: "Datos del inmueble, personas, documento y actos extraídos correctamente." });
        } else if (type === "predial") {
          // Unwrap confidence for predial
          const unwrapped: Record<string, string> = {};
          for (const [key, val] of Object.entries(d)) {
            if (val && typeof val === "object" && "valor" in (val as any)) {
              unwrapped[key] = (val as any).valor;
              if ((val as any).confianza && onConfianzaChange) {
                onConfianzaChange(key, (val as any).confianza);
              }
            } else if (typeof val === "string") {
              unwrapped[key] = val;
            }
          }

          // Separate CHIP/NUPRE from cédula catastral in predial
          const predialId = unwrapped.identificador_predial || unwrapped.chip_nupre || "";
          const predialCedula = unwrapped.cedula_catastral || "";
          const inmuebleUpdates: Record<string, string> = {};
          
          if (predialId.startsWith("AAA")) {
            inmuebleUpdates.nupre = predialId;
          } else {
            const cleanPredialId = predialId.replace(/[\s.\-]/g, "");
            if (/^\d{10,}$/.test(cleanPredialId)) {
              inmuebleUpdates.identificador_predial = cleanPredialId;
            }
          }
          if (predialCedula) {
            const cleanPredialCedula = predialCedula.replace(/[\s.\-]/g, "");
            if (/^\d{10,}$/.test(cleanPredialCedula)) {
              inmuebleUpdates.identificador_predial = cleanPredialCedula;
              inmuebleUpdates.tipo_identificador_predial = "cedula_catastral";
            }
          }

          applyOcrResults({
            ...inmuebleUpdates,
            avaluo_catastral: unwrapped.avaluo_catastral,
            area: unwrapped.area,
            direccion: unwrapped.direccion,
            ...(unwrapped.estrato ? { estrato: unwrapped.estrato } : {}),
            ...(unwrapped.valorizacion ? { valorizacion: unwrapped.valorizacion } : {}),
          }, inmueble);

          // Emit predial data to parent for metadata persistence
          if (onPredialExtracted) {
            onPredialExtracted({
              numero_recibo: unwrapped.numero_recibo,
              anio_gravable: unwrapped.anio_gravable,
              valor_pagado: unwrapped.valor_pagado,
              estrato: unwrapped.estrato,
            });
          }

          toast({ title: "Predial procesado", description: "Cédula catastral, avalúo y datos adicionales extraídos." });
        } else if (type === "escritura_antecedente") {
          // Unwrap confidence for escritura
          const leRaw = d.linderos_especiales;
          const lgRaw = d.linderos_generales;
          const le = (leRaw && typeof leRaw === "object" && "valor" in leRaw) ? leRaw.valor : (typeof leRaw === "string" ? leRaw : "");
          const lg = (lgRaw && typeof lgRaw === "object" && "valor" in lgRaw) ? lgRaw.valor : (typeof lgRaw === "string" ? lgRaw : "");

          if (leRaw?.confianza && onConfianzaChange) onConfianzaChange("linderos", leRaw.confianza);

          const linderos = [le, lg].filter(Boolean).join("\n\n--- Linderos Generales ---\n\n");
          if (linderos) {
            applyOcrResults({ linderos }, inmueble);
          }

          // Emit comparecientes with estado_civil, direccion, municipio for reconciliation
          if (d.comparecientes && Array.isArray(d.comparecientes) && onDocumentoExtracted) {
            const unwrappedDoc: Record<string, any> = {};
            // Pass comparecientes through to Validacion for reconciliation
            unwrappedDoc.comparecientes = d.comparecientes;
            onDocumentoExtracted(unwrappedDoc as ExtractedDocumento);
          }

          toast({ title: "Escritura procesada", description: "Linderos y comparecientes extraídos correctamente." });
        }
      }
    } catch (err: any) {
      toast({ title: "Error al procesar", description: err.message, variant: "destructive" });
    } finally {
      setScanning(null);
    }
  };

  const renderUploadButton = (
    label: string,
    type: ScanType,
    ref: React.RefObject<HTMLInputElement | null>,
    processingLabel: string
  ) => (
    <>
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        ref={ref}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleScanDocument(file, type);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={scanning !== null}
        onClick={() => ref.current?.click()}
      >
        {scanning === type ? (
          <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> {processingLabel}</>
        ) : (
          <><Upload className="mr-1 h-4 w-4" /> {label}</>
        )}
      </Button>
    </>
  );

  const ocr = (field: string) => ocrFields.has(field) ? <OcrBadge /> : null;

  const wrapWithSuggestion = (field: string, input: React.ReactNode) => {
    const suggested = suggestions.get(field);
    if (!suggested) return input;
    return (
      <OcrSuggestion value={suggested} onConfirm={() => confirmSuggestion(field)} onIgnore={() => ignoreSuggestion(field)}>
        <div>{input}</div>
      </OcrSuggestion>
    );
  };

  // Confidence-aware field styling
  const fieldClassName = (field: string, base: string = "") => {
    const conf = confianzaFields?.get(field);
    if (conf === "baja") return `${base} border-amber-400 ring-1 ring-amber-300`;
    return base;
  };

  const confBadge = (field: string) => {
    const conf = confianzaFields?.get(field);
    if (conf !== "baja") return null;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertTriangle className="inline h-3.5 w-3.5 text-amber-500 ml-1" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          Verificación requerida — la IA tiene baja confianza en este dato
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Inmueble</h3>
        <div className="flex flex-wrap gap-2">
          {renderUploadButton("Cargar Certificado", "certificado_tradicion", certInputRef, "Procesando...")}
          {renderUploadButton("Cargar Predial", "predial", predialInputRef, "Procesando...")}
          {renderUploadButton("Cargar Escritura", "escritura_antecedente", escrituraInputRef, "Procesando...")}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Matrícula Inmobiliaria {ocr("matricula_inmobiliaria")} {confBadge("matricula_inmobiliaria")}</Label>
          {wrapWithSuggestion("matricula_inmobiliaria",
            <Input data-field-input="matricula_inmobiliaria" className={fieldClassName("matricula_inmobiliaria")} value={inmueble.matricula_inmobiliaria} onChange={(e) => update("matricula_inmobiliaria", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Tipo de Identificador Predial *</Label>
          <Select value={inmueble.tipo_identificador_predial} onValueChange={(v) => update("tipo_identificador_predial", v)}>
            <SelectTrigger data-field-input="tipo_identificador_predial"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="chip">CHIP</SelectItem>
              <SelectItem value="cedula_catastral">Cédula Catastral</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>
            Identificador Predial * {ocr("identificador_predial")} {confBadge("identificador_predial")}
            {inmueble.tipo_identificador_predial === "chip" && (
              <span className="ml-2 text-xs text-muted-foreground">(Formato: AAA0000AAAA)</span>
            )}
            {inmueble.tipo_identificador_predial === "cedula_catastral" && (
              <span className="ml-2 text-xs text-muted-foreground">(Cédula catastral)</span>
            )}
          </Label>
          {wrapWithSuggestion("identificador_predial",
            <Input
              data-field-input="identificador_predial"
              className={fieldClassName("identificador_predial")}
              value={inmueble.identificador_predial}
              onChange={(e) => update("identificador_predial", e.target.value)}
              required
              placeholder={inmueble.tipo_identificador_predial === "chip" ? "AAA0000AAAA" : "Cédula catastral"}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label>Departamento {ocr("departamento")} {confBadge("departamento")}</Label>
          {wrapWithSuggestion("departamento",
            <Input data-field-input="departamento" className={fieldClassName("departamento")} value={inmueble.departamento} onChange={(e) => update("departamento", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Municipio {ocr("municipio")} {confBadge("municipio")}</Label>
          {wrapWithSuggestion("municipio",
            <Input data-field-input="municipio" className={fieldClassName("municipio")} value={inmueble.municipio} onChange={(e) => update("municipio", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Oficina de Registro (ORIP) {ocr("codigo_orip")} {confBadge("codigo_orip")}</Label>
          {wrapWithSuggestion("codigo_orip",
            <Input data-field-input="codigo_orip" className={fieldClassName("codigo_orip")} value={inmueble.codigo_orip} onChange={(e) => update("codigo_orip", e.target.value)} placeholder="Ej: Oficina de Registro de Instrumentos Públicos de Bogotá Zona Norte" />
          )}
        </div>

        <div className="space-y-2">
          <Label>Tipo de Predio {ocr("tipo_predio")}</Label>
          <Select value={inmueble.tipo_predio} onValueChange={(v) => update("tipo_predio", v)}>
            <SelectTrigger data-field-input="tipo_predio"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="urbano">Urbano</SelectItem>
              <SelectItem value="rural">Rural</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Dirección {ocr("direccion")} {confBadge("direccion")}</Label>
          {wrapWithSuggestion("direccion",
            <Input data-field-input="direccion_inmueble" className={fieldClassName("direccion")} value={inmueble.direccion} onChange={(e) => update("direccion", e.target.value)} />
          )}
        </div>

        <div className="space-y-2">
          <Label>Área Construida (m²) {ocr("area_construida")} {confBadge("area_construida")}</Label>
          {wrapWithSuggestion("area_construida",
            <Input data-field-input="area_construida" className={fieldClassName("area_construida")} value={inmueble.area_construida} onChange={(e) => update("area_construida", e.target.value)} placeholder="Ej: 269.18" />
          )}
        </div>

        <div className="space-y-2">
          <Label>Área Privada (m²) {ocr("area_privada")} {confBadge("area_privada")}</Label>
          {wrapWithSuggestion("area_privada",
            <Input data-field-input="area_privada" className={fieldClassName("area_privada")} value={inmueble.area_privada} onChange={(e) => update("area_privada", e.target.value)} placeholder="Ej: 243.65" />
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>Avalúo Catastral (COP) {ocr("avaluo_catastral")} {confBadge("avaluo_catastral")}</Label>
          {wrapWithSuggestion("avaluo_catastral",
            <Input data-field-input="avaluo_catastral" className={fieldClassName("avaluo_catastral")} value={inmueble.avaluo_catastral} onChange={(e) => update("avaluo_catastral", e.target.value)} placeholder="Valor del avalúo catastral" />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Linderos {ocr("linderos")} {confBadge("linderos")}</Label>
        {wrapWithSuggestion("linderos",
          <Textarea
            className={fieldClassName("linderos", "min-h-[200px] resize-y")}
            value={inmueble.linderos}
            onChange={(e) => update("linderos", e.target.value)}
            placeholder="Describa los linderos completos del inmueble..."
          />
        )}
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={inmueble.es_propiedad_horizontal}
            onCheckedChange={(v) => update("es_propiedad_horizontal", v)}
          />
          <Label className="text-base font-medium">¿Cuenta con Reglamento de Propiedad Horizontal? {ocr("es_propiedad_horizontal")}</Label>
        </div>

        {inmueble.es_propiedad_horizontal && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Escritura de Constitución PH {ocr("escritura_ph")} {confBadge("escritura_ph")}</Label>
              {wrapWithSuggestion("escritura_ph",
                <Input className={fieldClassName("escritura_ph")} value={inmueble.escritura_ph} onChange={(e) => update("escritura_ph", e.target.value)} placeholder="No. escritura de constitución" />
              )}
            </div>
            <div className="space-y-2">
              <Label>Reformas PH {ocr("reformas_ph")} {confBadge("reformas_ph")}</Label>
              {wrapWithSuggestion("reformas_ph",
                <Input className={fieldClassName("reformas_ph")} value={inmueble.reformas_ph} onChange={(e) => update("reformas_ph", e.target.value)} placeholder="Reformas a la PH (si aplica)" />
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Matrícula Matriz</Label>
              <Input value={inmueble.matricula_matriz || ""} onChange={(e) => update("matricula_matriz", e.target.value)} placeholder="Matrícula inmobiliaria del lote o edificio matriz" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default InmuebleForm;
