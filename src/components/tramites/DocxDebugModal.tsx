import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Bug, Copy, Download } from "lucide-react";
import type { DocxAuditPayload, FlatEntry } from "@/lib/docxDebug";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: DocxAuditPayload | null;
}

const formatValue = (v: unknown, max = 120): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > max ? `${s.slice(0, max)}…` : s;
    } catch {
      return String(v);
    }
  }
  const s = String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export default function DocxDebugModal({ open, onOpenChange, payload }: Props) {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");

  const allEntries = useMemo<FlatEntry[]>(
    () => (payload ? Object.values(payload.flat) : []),
    [payload],
  );

  const filtered = (rows: FlatEntry[]) =>
    filter.trim()
      ? rows.filter((r) => r.key.toLowerCase().includes(filter.toLowerCase()))
      : rows;

  const filterStrings = (arr: string[]) =>
    filter.trim()
      ? arr.filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
      : arr;

  const handleCopyJson = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast({ title: "Auditoría copiada al portapapeles" });
    } catch {
      toast({ title: "No se pudo copiar", variant: "destructive" });
    }
  };

  const handleDownloadJson = () => {
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `docx-audit_${payload.tramiteId.slice(0, 8)}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!payload) return null;

  const mapped = filterStrings(payload.diff.mapped);
  const empty = filterStrings(payload.diff.empty);
  const missing = filterStrings(payload.diff.missing);
  const unused = filterStrings(payload.diff.unused);
  const allRows = filtered(allEntries);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-primary" />
            Auditoría de variables del .docx
          </DialogTitle>
          <DialogDescription>
            Trámite{" "}
            <span className="font-mono text-xs">
              {payload.tramiteId.slice(0, 8)}…
            </span>{" "}
            · {payload.template} · render {payload.renderMs ?? "?"} ms
          </DialogDescription>
        </DialogHeader>

        {/* Resumen */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
          <Stat label="Tags plantilla" value={payload.counts.tags} />
          <Stat label="Claves data" value={payload.counts.flatKeys} />
          <Stat
            label="Mapeados"
            value={payload.counts.mapped}
            tone="success"
          />
          <Stat label="Vacíos" value={payload.counts.empty} tone="warning" />
          <Stat
            label="Missing"
            value={payload.counts.missing}
            tone="danger"
          />
          <Stat label="Sin uso" value={payload.counts.unused} tone="muted" />
          <Stat
            label="Rescatados"
            value={payload.counts.rescued}
            tone={payload.counts.rescued > 0 ? "success" : "muted"}
          />
          <Stat
            label="Cross-párrafo"
            value={payload.counts.crossParagraph}
            tone={payload.counts.crossParagraph > 0 ? "danger" : "muted"}
          />
        </div>

        {payload.crossParagraph.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1.5">
            <div className="font-semibold text-destructive flex items-center gap-1.5">
              ⚠️ La plantilla necesita corrección manual
            </div>
            <p className="text-muted-foreground">
              Se detectaron {payload.crossParagraph.length} tag(s) potencialmente
              cortados entre párrafos (saltos de línea dentro de <code>{"{...}"}</code>).
              El normalizador no puede repararlos automáticamente; abre la plantilla
              en Word y une cada tag en un solo párrafo.
            </p>
            <ul className="space-y-0.5 font-mono text-[11px] text-foreground/80">
              {payload.crossParagraph.slice(0, 5).map((c, i) => (
                <li key={i}>
                  · <span className="text-destructive">{c.hint}</span> en{" "}
                  {c.file}#p{c.paragraphIndex}
                  {c.inTable ? " (tabla)" : ""}
                </li>
              ))}
              {payload.crossParagraph.length > 5 && (
                <li className="text-muted-foreground">
                  …y {payload.crossParagraph.length - 5} más
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder="Filtrar por nombre de variable…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyJson}
          >
            <Copy className="h-4 w-4 mr-1" /> Copiar JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadJson}
          >
            <Download className="h-4 w-4 mr-1" /> Descargar
          </Button>
        </div>

        <Tabs defaultValue="all" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="all">
              Todas <Badge variant="secondary" className="ml-1">{allRows.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="mapped">
              Mapeados <Badge variant="secondary" className="ml-1">{mapped.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="empty">
              Vacíos <Badge variant="secondary" className="ml-1">{empty.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="missing">
              Missing <Badge variant="destructive" className="ml-1">{missing.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="unused">
              Sin uso <Badge variant="secondary" className="ml-1">{unused.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="rescued">
              Rescatados{" "}
              <Badge
                variant={payload.counts.rescued > 0 ? "default" : "secondary"}
                className="ml-1"
              >
                {payload.counts.rescued}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-2 border rounded-md">
            <TabsContent value="all" className="m-0">
              <DataTable rows={allRows} />
            </TabsContent>
            <TabsContent value="mapped" className="m-0">
              <TagList items={mapped} hint="Tag de la plantilla con valor utilizable" />
            </TabsContent>
            <TabsContent value="empty" className="m-0">
              <TagList
                items={empty}
                tone="warning"
                hint="Tag presente pero su valor está vacío o es ___________"
              />
            </TabsContent>
            <TabsContent value="missing" className="m-0">
              <TagList
                items={missing}
                tone="danger"
                hint="La plantilla espera este tag pero no existe en structuredData → renderiza ___________"
              />
            </TabsContent>
            <TabsContent value="unused" className="m-0">
              <TagList
                items={unused}
                tone="muted"
                hint="Clave enviada en structuredData que ningún tag de la plantilla consume (alias muerto o redundante)"
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  const toneCls =
    tone === "danger"
      ? "text-destructive border-destructive/40"
      : tone === "warning"
        ? "text-orange-500 border-orange-500/40"
        : tone === "success"
          ? "text-emerald-500 border-emerald-500/40"
          : tone === "muted"
            ? "text-muted-foreground border-muted"
            : "border-border";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function DataTable({ rows }: { rows: FlatEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Sin resultados.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40%]">Clave</TableHead>
          <TableHead className="w-[45%]">Valor</TableHead>
          <TableHead className="w-[10%]">Tipo</TableHead>
          <TableHead className="w-[5%]">∅</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key} className={r.isEmpty ? "opacity-60" : ""}>
            <TableCell className="font-mono text-xs">{r.key}</TableCell>
            <TableCell className="font-mono text-xs">{formatValue(r.value)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{r.type}</TableCell>
            <TableCell>
              {r.isEmpty ? (
                <Badge variant="outline" className="text-orange-500 border-orange-500/40">
                  vacío
                </Badge>
              ) : (
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/40">
                  ok
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TagList({
  items,
  hint,
  tone,
}: {
  items: string[];
  hint: string;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  const toneCls =
    tone === "danger"
      ? "border-destructive/40 text-destructive"
      : tone === "warning"
        ? "border-orange-500/40 text-orange-500"
        : tone === "muted"
          ? "border-muted text-muted-foreground"
          : "border-border";
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-muted-foreground italic">{hint}</p>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Sin entradas.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <code
              key={item}
              className={`text-xs px-2 py-1 rounded border ${toneCls} bg-background/40`}
            >
              {item}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
