import { useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";
import {
  Upload, FileText, CheckCircle, AlertTriangle, Loader2, ArrowRight, ArrowLeft, X, Coins, Plus, Users, ArrowRightLeft,
} from "lucide-react";
import type { NivelConfianza } from "@/lib/types";
import { unwrapConfianza, unwrapConfianzaBool } from "@/lib/types";

type RoleAlert = {
  type: "wrong_role" | "missing_cedula";
  message: string;
  cedula?: string;
  nombre?: string;
  currentRol?: "vendedor" | "comprador";
  suggestedRol?: "vendedor" | "comprador";
  slotIndex?: number;
};

type DocSlot = {
  label: string;
  type: string;
  file: File | null;
  status: "idle" | "uploading" | "done" | "error";
  result: any | null;
  error: string | null;
};

type PersonaSlot = DocSlot & { rol: "vendedor" | "comprador" };

const propertySlots: DocSlot[] = [
  { label: "Certificado de Tradición y Libertad", type: "certificado_tradicion", file: null, status: "idle", result: null, error: null },
  { label: "Cédula Catastral / Boletín Predial", type: "predial", file: null, status: "idle", result: null, error: null },
  { label: "Escritura Antecedente (Linderos)", type: "escritura_antecedente", file: null, status: "idle", result: null, error: null },
];

const makePersonaSlot = (rol: "vendedor" | "comprador", index: number): PersonaSlot => ({
  label: `Cédula ${rol === "vendedor" ? "Vendedor" : "Comprador"} ${index + 1}`,
  type: "cedula_persona",
  file: null,
  status: "idle",
  result: null,
  error: null,
  rol,
});

const DocumentUploadStep = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, credits } = useAuth();

  const [vendedorSlots, setVendedorSlots] = useState<PersonaSlot[]>([makePersonaSlot("vendedor", 0)]);
  const [compradorSlots, setCompradorSlots] = useState<PersonaSlot[]>([makePersonaSlot("comprador", 0)]);
  const [propSlots, setPropSlots] = useState<DocSlot[]>(propertySlots.map(s => ({ ...s })));

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const allSlots = [...vendedorSlots, ...compradorSlots, ...propSlots];
  const completedCount = allSlots.filter(s => s.status === "done").length;
  const totalCount = allSlots.length;
  const hasAny = allSlots.some(s => s.status === "done");
  const isProcessing = allSlots.some(s => s.status === "uploading");

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const processFile = useCallback(async (file: File, type: string): Promise<any> => {
    const base64 = await fileToBase64(file);
    const { data, error } = await monitored.invoke("scan-document", { image: base64, type });
    if (error) throw new Error(error.message);
    return data?.data || null;
  }, []);

  const handlePersonaFile = useCallback(async (
    rol: "vendedor" | "comprador",
    index: number,
    file: File,
  ) => {
    if (!profile?.organization_id) return;
    const setter = rol === "vendedor" ? setVendedorSlots : setCompradorSlots;

    setter(prev => prev.map((s, i) => i === index ? { ...s, file, status: "uploading", error: null } : s));

    try {
      const result = await processFile(file, "cedula");
      setter(prev => prev.map((s, i) => i === index ? { ...s, status: "done", result } : s));
      toast({ title: `Cédula procesada`, description: "Datos extraídos correctamente." });
    } catch (err: any) {
      setter(prev => prev.map((s, i) => i === index ? { ...s, status: "error", error: err.message } : s));
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }, [profile, processFile, toast]);

  const handlePropFile = useCallback(async (index: number, file: File) => {
    if (!profile?.organization_id) return;

    setPropSlots(prev => prev.map((s, i) => i === index ? { ...s, file, status: "uploading", error: null } : s));

    try {
      const result = await processFile(file, propSlots[index].type);
      setPropSlots(prev => prev.map((s, i) => i === index ? { ...s, status: "done", result } : s));
      toast({ title: `${propSlots[index].label} procesado`, description: "Datos extraídos correctamente." });
    } catch (err: any) {
      setPropSlots(prev => prev.map((s, i) => i === index ? { ...s, status: "error", error: err.message } : s));
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }, [profile, processFile, propSlots, toast]);

  const removePersonaSlot = (rol: "vendedor" | "comprador", index: number) => {
    const setter = rol === "vendedor" ? setVendedorSlots : setCompradorSlots;
    setter(prev => {
      if (prev.length <= 1) return [makePersonaSlot(rol, 0)];
      return prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, label: `Cédula ${rol === "vendedor" ? "Vendedor" : "Comprador"} ${i + 1}` }));
    });
  };

  const removePropFile = (index: number) => {
    setPropSlots(prev => prev.map((s, i) => i === index ? { ...propertySlots[index] } : s));
  };

  const addPersonaSlot = (rol: "vendedor" | "comprador") => {
    const setter = rol === "vendedor" ? setVendedorSlots : setCompradorSlots;
    setter(prev => [...prev, makePersonaSlot(rol, prev.length)]);
  };

  // Cross-validate roles against certificado de tradición
  const certSlot = propSlots.find(s => s.type === "certificado_tradicion" && s.status === "done");
  const propietariosCert: { nombre: string; cedula: string }[] = useMemo(() => {
    if (!certSlot?.result?.personas) return [];
    const ENTITY_PATTERNS = /\b(S\.?A\.?S?\.?|LTDA|BANCO|BANCOLOMBIA|DAVIVIENDA|BBVA|FIDUCIARIA|CONSTRUCTORA|FONDO|LEASING|CORP|INC|FUNDACION|E\.?S\.?P)\b/i;
    const deduped = new Map<string, { nombre: string; cedula: string }>();
    for (const p of certSlot.result.personas as any[]) {
      const nombre = p.nombre_completo || p.nombre || "";
      const cedula = String(p.numero_identificacion ?? p.numero_cedula ?? "").replace(/\D/g, "");
      if (!cedula || ENTITY_PATTERNS.test(nombre)) continue;
      if (!deduped.has(cedula)) deduped.set(cedula, { nombre, cedula });
    }
    return Array.from(deduped.values());
  }, [certSlot?.result]);

  const roleAlerts = useMemo((): RoleAlert[] => {
    if (propietariosCert.length === 0) return [];
    const alerts: RoleAlert[] = [];
    const cedulasPropietarios = new Set(propietariosCert.map(p => p.cedula.replace(/\D/g, "")));
    const allCedulasLoaded = new Set<string>();

    // Check compradores that are actually propietarios (should be vendedores)
    compradorSlots.forEach((slot, i) => {
      if (slot.status !== "done" || !slot.result) return;
      const cedula = String(slot.result.numero_identificacion ?? slot.result.numero_cedula ?? "").replace(/\D/g, "");
      if (cedula) allCedulasLoaded.add(cedula);
      if (cedula && cedulasPropietarios.has(cedula)) {
        alerts.push({
          type: "wrong_role",
          message: "Esta persona aparece como propietaria en el certificado de tradición. Debería ser vendedor.",
          cedula, nombre: slot.result.nombre_completo || slot.result.nombre || "",
          currentRol: "comprador", suggestedRol: "vendedor", slotIndex: i,
        });
      }
    });

    // Check vendedores that are NOT propietarios (might be compradores)
    vendedorSlots.forEach((slot, i) => {
      if (slot.status !== "done" || !slot.result) return;
      const cedula = String(slot.result.numero_identificacion ?? slot.result.numero_cedula ?? "").replace(/\D/g, "");
      if (cedula) allCedulasLoaded.add(cedula);
      if (cedula && !cedulasPropietarios.has(cedula)) {
        alerts.push({
          type: "wrong_role",
          message: "Esta persona no aparece como propietaria en el certificado. ¿Debería ser comprador?",
          cedula, nombre: slot.result.nombre_completo || slot.result.nombre || "",
          currentRol: "vendedor", suggestedRol: "comprador", slotIndex: i,
        });
      }
    });

    // Check missing propietarios
    propietariosCert.forEach(p => {
      const normalized = p.cedula.replace(/\D/g, "");
      if (!allCedulasLoaded.has(normalized)) {
        alerts.push({
          type: "missing_cedula",
          message: `Falta cédula del propietario: ${p.nombre} (CC ${p.cedula})`,
          cedula: p.cedula, nombre: p.nombre,
        });
      }
    });

    return alerts;
  }, [propietariosCert, vendedorSlots, compradorSlots]);

  const moveSlot = (fromRol: "vendedor" | "comprador", toRol: "vendedor" | "comprador", index: number) => {
    const fromSetter = fromRol === "vendedor" ? setVendedorSlots : setCompradorSlots;
    const toSetter = toRol === "vendedor" ? setVendedorSlots : setCompradorSlots;

    let slotToMove: PersonaSlot | null = null;
    fromSetter(prev => {
      slotToMove = prev[index] ? { ...prev[index], rol: toRol } : null;
      const remaining = prev.filter((_, i) => i !== index);
      if (remaining.length === 0) return [makePersonaSlot(fromRol, 0)];
      return remaining.map((s, i) => ({ ...s, label: `Cédula ${fromRol === "vendedor" ? "Vendedor" : "Comprador"} ${i + 1}` }));
    });

    if (slotToMove) {
      const captured = slotToMove;
      toSetter(prev => {
        const newSlot: PersonaSlot = { ...captured, label: `Cédula ${toRol === "vendedor" ? "Vendedor" : "Comprador"} ${prev.length + 1}` };
        return [...prev, newSlot];
      });
      toast({ title: "Movido", description: `Cédula movida a ${toRol === "vendedor" ? "Vendedores" : "Compradores"}.` });
    }
  };

  const wrongRoleAlerts = roleAlerts.filter(a => a.type === "wrong_role");
  const missingAlerts = roleAlerts.filter(a => a.type === "missing_cedula");

  const getSlotAlert = (rol: "vendedor" | "comprador", index: number) =>
    wrongRoleAlerts.find(a => a.currentRol === rol && a.slotIndex === index);

  // Build pre-populated state and navigate to validation
  const handleContinue = async () => {
    if (!profile?.organization_id || !profile?.id) return;

    const confianzaMap: Record<string, NivelConfianza> = {};
    const extractedInmueble: Record<string, any> = {};
    const extractedPersonas: any[] = [];
    const extractedDocumento: Record<string, any> = {};

    // Process persona slots (cédulas)
    for (const slot of [...vendedorSlots, ...compradorSlots]) {
      if (slot.status !== "done" || !slot.result) continue;
      const d = slot.result;
      const rawNombre = d.nombre_completo || d.nombre || "";
      const rawCedula = d.numero_identificacion || d.numero_cedula || "";
      const rawLugar = d.lugar_expedicion || "";
      extractedPersonas.push({
        nombre_completo: unwrapConfianza(rawNombre).valor,
        numero_identificacion: unwrapConfianza(rawCedula).valor,
        tipo_identificacion: d.tipo_identificacion || "CC",
        lugar_expedicion: unwrapConfianza(rawLugar).valor,
        confianza: d.confianza || "alta",
        rol: slot.rol,
      });
    }

    // Process property slots
    for (const slot of propSlots) {
      if (slot.status !== "done" || !slot.result) continue;
      const d = slot.result;

      if (slot.type === "certificado_tradicion") {
        if (d.inmueble) {
          for (const [key, val] of Object.entries(d.inmueble)) {
            if (val && typeof val === "object" && "valor" in (val as any)) {
              const { valor, confianza } = unwrapConfianza(val as any);
              if (valor) {
                extractedInmueble[key] = valor;
                confianzaMap[`inmueble.${key}`] = confianza;
              }
            } else if (val != null) {
              extractedInmueble[key] = val;
            }
          }
        }
        if (d.documento) {
          for (const [key, val] of Object.entries(d.documento)) {
            const { valor, confianza } = unwrapConfianza(val as any);
            if (valor) {
              extractedDocumento[key] = valor;
              confianzaMap[`documento.${key}`] = confianza;
            }
          }
        }
        // Don't merge persona data from certificado - only cédulas provide full data.
        // Instead, create empty placeholders for propietarios without uploaded cédulas.
        // (handled below after processing all slots)
      } else if (slot.type === "predial") {
        const extractedPredialData: Record<string, any> = {};
        for (const [key, val] of Object.entries(d)) {
          const { valor, confianza } = unwrapConfianza(val as any);
          if (valor) {
            extractedInmueble[key] = valor;
            extractedPredialData[key] = valor;
            confianzaMap[`inmueble.${key}`] = confianza;
          }
        }
        // Will be added to metadata below
        (extractedInmueble as any).__predial_data = extractedPredialData;
      } else if (slot.type === "escritura_antecedente") {
        const le = unwrapConfianza(d.linderos_especiales);
        const lg = unwrapConfianza(d.linderos_generales);
        const linderos = [le.valor, lg.valor].filter(Boolean).join("\n\n--- Linderos Generales ---\n\n");
        if (linderos) {
          extractedInmueble.linderos = linderos;
          confianzaMap["inmueble.linderos"] = le.confianza === "baja" || lg.confianza === "baja" ? "baja" : le.confianza;
        }
      }
    }

    // Propietarios del certificado son solo informacionales.
    // No se crean vendedores automáticos — solo las cédulas cargadas generan personas.

    // Extract predial data before building metadata
    const extractedPredialSeparate = (extractedInmueble as any).__predial_data;
    delete (extractedInmueble as any).__predial_data;

    const metadata: Record<string, any> = {
      extracted_inmueble: extractedInmueble,
      extracted_personas: extractedPersonas,
      extracted_documento: extractedDocumento,
      confianza_map: confianzaMap,
      progress: 0,
      ...(extractedPredialSeparate ? { extracted_predial: extractedPredialSeparate } : {}),
    };

    const { data: tramite, error } = await supabase.from("tramites").insert({
      tipo: "Compraventa",
      organization_id: profile.organization_id,
      created_by: profile.id,
      status: "pendiente" as any,
      metadata: metadata as any,
    }).select().single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    navigate(`/tramite/${tramite.id}`);
  };

  const statusIcon = (status: DocSlot["status"]) => {
    switch (status) {
      case "uploading": return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "done": return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "error": return <AlertTriangle className="h-5 w-5 text-destructive" />;
      default: return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const lowConfCount = allSlots.reduce((count, slot) => {
    if (slot.status !== "done" || !slot.result) return count;
    const countLow = (obj: any): number => {
      let c = 0;
      if (!obj || typeof obj !== "object") return 0;
      for (const val of Object.values(obj)) {
        if (val && typeof val === "object" && "confianza" in (val as any)) {
          if ((val as any).confianza === "baja") c++;
        } else if (val && typeof val === "object") {
          c += countLow(val);
        }
      }
      return c;
    };
    return count + countLow(slot.result);
  }, 0);

  const renderSlotCard = (
    slot: DocSlot,
    refKey: string,
    onFile: (file: File) => void,
    onRemove: () => void,
    alert?: RoleAlert | undefined,
  ) => (
    <Card key={refKey} className={`p-4 ${alert ? "border-amber-400 dark:border-amber-600" : ""}`}>
      <div className="flex items-center gap-3">
        {statusIcon(slot.status)}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{slot.label}</p>
          {slot.file && <p className="text-xs text-muted-foreground truncate">{slot.file.name}</p>}
          {slot.error && <p className="text-xs text-destructive">{slot.error}</p>}
          {slot.status === "uploading" && (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {slot.status === "done" && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
              <X className="h-4 w-4" />
            </Button>
          )}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            ref={(el) => { fileInputRefs.current[refKey] = el; }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
          <Button
            variant={slot.status === "idle" ? "default" : "outline"}
            size="sm"
            disabled={slot.status === "uploading"}
            onClick={() => fileInputRefs.current[refKey]?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            {slot.status === "idle" ? "Subir" : slot.status === "error" ? "Reintentar" : "Reemplazar"}
          </Button>
        </div>
      </div>
      {alert && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-200 flex-1">{alert.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-xs"
            onClick={() => moveSlot(alert.currentRol!, alert.suggestedRol!, alert.slotIndex!)}
          >
            <ArrowRightLeft className="mr-1 h-3 w-3" />
            Mover a {alert.suggestedRol === "vendedor" ? "Vendedores" : "Compradores"}
          </Button>
        </div>
      )}
    </Card>
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="border-b bg-notarial-dark text-white shrink-0">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost-dark" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
          </Button>
          <span className="text-sm font-medium">Nuevo Trámite — Carga de Documentos</span>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="outline" className="border-notarial-gold/30 text-notarial-gold">
              <Coins className="mr-1 h-3 w-3" /> {credits} créditos
            </Badge>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container max-w-2xl py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Sube los documentos del expediente</h1>
            <p className="text-muted-foreground mt-1">
              La IA extraerá automáticamente los datos relevantes. Los campos con baja confianza se resaltarán en ámbar para tu verificación.
            </p>
          </div>

          <Progress value={(completedCount / totalCount) * 100} className="h-2" />

          {/* Cédulas de Vendedores */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cédulas de Vendedores</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => addPersonaSlot("vendedor")}>
                <Plus className="mr-1 h-3 w-3" /> Agregar vendedor
              </Button>
            </div>
            {vendedorSlots.map((slot, i) =>
              renderSlotCard(
                slot,
                `vendedor-${i}`,
                (file) => handlePersonaFile("vendedor", i, file),
                () => removePersonaSlot("vendedor", i),
                getSlotAlert("vendedor", i),
              )
            )}
          </div>

          {/* Cédulas de Compradores */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cédulas de Compradores</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => addPersonaSlot("comprador")}>
                <Plus className="mr-1 h-3 w-3" /> Agregar comprador
              </Button>
            </div>
            {compradorSlots.map((slot, i) =>
              renderSlotCard(
                slot,
                `comprador-${i}`,
                (file) => handlePersonaFile("comprador", i, file),
                () => removePersonaSlot("comprador", i),
                getSlotAlert("comprador", i),
              )
            )}
          </div>

          {/* Documentos del Inmueble */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Documentos del Inmueble</h2>
            </div>
            {propSlots.map((slot, i) =>
              renderSlotCard(
                slot,
                `prop-${i}`,
                (file) => handlePropFile(i, file),
                () => removePropFile(i),
              )
            )}
          </div>

          {/* Missing cédulas alert */}
          {missingAlerts.length > 0 && (
            <Alert className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">Cédulas faltantes según el certificado de tradición:</p>
                <ul className="list-disc list-inside space-y-1">
                  {missingAlerts.map((a, i) => (
                    <li key={i} className="text-sm">{a.nombre} (CC {a.cedula})</li>
                  ))}
                </ul>
                <p className="text-xs mt-2 text-amber-700 dark:text-amber-300">Puedes continuar sin estas cédulas. Los campos correspondientes quedarán en blanco en la escritura para completar manualmente en la notaría.</p>
              </AlertDescription>
            </Alert>
          )}

          {lowConfCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                <strong>{lowConfCount} campo(s)</strong> con baja confianza. Se resaltarán en ámbar en el formulario para que los verifiques.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              Cancelar
            </Button>
            <Button
              onClick={handleContinue}
              disabled={!hasAny || isProcessing}
              className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
            >
              {isProcessing ? (
                <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Procesando...</>
              ) : (
                <><ArrowRight className="mr-1 h-4 w-4" /> Continuar a Validación</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DocumentUploadStep;
