import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Loader2 } from "lucide-react";
import { z } from "zod";

interface EvidenciaItem {
  tramite_id?: string;
  valor_ia?: unknown;
  valor_final?: unknown;
  contexto?: Record<string, unknown>;
  [k: string]: unknown;
}

interface PropuestaFull {
  id: string;
  titulo: string;
  descripcion: string;
  tipo_acto: string;
  categoria: string;
  nivel_severidad: string;
  regla_deterministica_sugerida: unknown;
  evidencia: EvidenciaItem[] | unknown;
  status: string;
  frecuencia_estimada: number;
  nota_revision: string | null;
}

const reglaSchema = z.object({}).passthrough();

interface Props {
  propuestaId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewed: () => void;
}

const CATEGORIAS = ["formato", "coherencia", "legal", "negocio"];
const SEVERIDADES = ["error", "advertencia", "sugerencia"];

export default function PropuestaDetalleModal({
  propuestaId,
  open,
  onOpenChange,
  onReviewed,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<null | "aprobada" | "rechazada" | "pendiente">(null);
  const [data, setData] = useState<PropuestaFull | null>(null);

  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState("");
  const [severidad, setSeveridad] = useState("");
  const [tipoActo, setTipoActo] = useState("");
  const [reglaJson, setReglaJson] = useState("");
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!open || !propuestaId) return;
    setLoading(true);
    (async () => {
      const { data: row, error } = await supabase
        .from("regla_propuesta")
        .select(
          "id, titulo, descripcion, tipo_acto, categoria, nivel_severidad, regla_deterministica_sugerida, evidencia, status, frecuencia_estimada, nota_revision"
        )
        .eq("id", propuestaId)
        .maybeSingle();
      setLoading(false);
      if (error || !row) {
        toast({ title: "No se pudo cargar la propuesta", description: error?.message, variant: "destructive" });
        onOpenChange(false);
        return;
      }
      const p = row as PropuestaFull;
      setData(p);
      setTitulo(p.titulo);
      setDescripcion(p.descripcion);
      setCategoria(p.categoria);
      setSeveridad(p.nivel_severidad);
      setTipoActo(p.tipo_acto);
      setReglaJson(JSON.stringify(p.regla_deterministica_sugerida ?? {}, null, 2));
      setNota(p.nota_revision ?? "");
    })();
  }, [open, propuestaId, toast, onOpenChange]);

  const evidencia = useMemo<EvidenciaItem[]>(() => {
    if (!data) return [];
    return Array.isArray(data.evidencia) ? (data.evidencia as EvidenciaItem[]) : [];
  }, [data]);

  const handleAction = async (nuevo_status: "aprobada" | "rechazada" | "pendiente") => {
    if (!data) return;
    let reglaParsed: unknown = data.regla_deterministica_sugerida;
    try {
      const parsed = JSON.parse(reglaJson);
      reglaSchema.parse(parsed);
      reglaParsed = parsed;
    } catch (err) {
      toast({
        title: "JSON inválido en regla sugerida",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return;
    }

    const cambios: Record<string, unknown> = {
      titulo: titulo.trim(),
      descripcion: descripcion.trim(),
      categoria,
      nivel_severidad: severidad,
      tipo_acto: tipoActo,
      regla_deterministica_sugerida: reglaParsed,
    };

    setSaving(nuevo_status);
    const { error } = await supabase.rpc("admin_review_propuesta", {
      p_id: data.id,
      p_nuevo_status: nuevo_status,
      p_cambios: cambios,
      p_nota: nota.trim() || null,
    });
    setSaving(null);
    if (error) {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title:
        nuevo_status === "aprobada"
          ? "Propuesta aprobada"
          : nuevo_status === "rechazada"
            ? "Propuesta rechazada"
            : "Cambios guardados como pendiente",
    });
    onReviewed();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar propuesta</DialogTitle>
          <DialogDescription>
            Edita los campos si es necesario y decide si aprobar, rechazar o mantener pendiente.
          </DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={categoria} onValueChange={setCategoria}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severidad</Label>
                <Select value={severidad} onValueChange={setSeveridad}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERIDADES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de acto</Label>
                <Input value={tipoActo} onChange={(e) => setTipoActo(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Regla determinística sugerida (JSON)</Label>
              <Textarea
                value={reglaJson}
                onChange={(e) => setReglaJson(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label>Nota de revisión (opcional)</Label>
              <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />
            </div>

            <div className="space-y-2">
              <Label>Evidencia ({evidencia.length} trámite{evidencia.length === 1 ? "" : "s"})</Label>
              <div className="rounded-md border border-border divide-y divide-border max-h-56 overflow-y-auto">
                {evidencia.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">Sin evidencia registrada.</div>
                )}
                {evidencia.map((ev, i) => (
                  <div key={i} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono truncate">{ev.tramite_id ?? "—"}</span>
                      {ev.tramite_id && (
                        <a
                          href={`/tramite/${ev.tramite_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-notarial-blue hover:underline"
                        >
                          Ver trámite <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {(ev.valor_ia !== undefined || ev.valor_final !== undefined) && (
                      <div className="text-muted-foreground">
                        {ev.valor_ia !== undefined && (
                          <div>IA: <span className="text-foreground">{String(ev.valor_ia)}</span></div>
                        )}
                        {ev.valor_final !== undefined && (
                          <div>Final: <span className="text-foreground">{String(ev.valor_final)}</span></div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={!!saving || loading}
            onClick={() => handleAction("rechazada")}
          >
            {saving === "rechazada" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rechazar
          </Button>
          <Button
            variant="secondary"
            disabled={!!saving || loading}
            onClick={() => handleAction("pendiente")}
          >
            {saving === "pendiente" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar como pendiente
          </Button>
          <Button
            className="bg-notarial-green hover:bg-notarial-green/90 text-white"
            disabled={!!saving || loading}
            onClick={() => handleAction("aprobada")}
          >
            {saving === "aprobada" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aprobar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
