import { useState, useMemo, useEffect } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bug, Copy, Download, BookOpen, ClipboardCopy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isDebugDocxEnabled, setDebugDocx } from "@/lib/docxDebug";
import type { DocxAuditPayload, FlatEntry, RescuedTagEntry } from "@/lib/docxDebug";
import {
  buildTagCatalog,
  type TagSection,
  type TagCardData,
  type LoopBlock as CatalogLoopBlock,
} from "@/lib/docxTagCatalog";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: DocxAuditPayload | null;
  /** Pestaña inicial al abrir el modal. Si se omite, se decide por rol. */
  initialTab?: string;
  /** Notifica al padre cuando admin activa/desactiva el diagnóstico visual. */
  onDebugVisualChange?: (on: boolean) => void;
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

export default function DocxDebugModal({ open, onOpenChange, payload, initialTab, onDebugVisualChange }: Props) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const isAdvanced = profile?.role === "owner" || profile?.role === "admin";
  const canExport = isAdvanced;
  const [filter, setFilter] = useState("");

  const tagSections = useMemo<TagSection[]>(() => {
    if (!payload) return [];
    return buildTagCatalog(payload.tags, payload.flat, payload.diff);
  }, [payload]);

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

  const resolvedInitialTab = initialTab ?? (isAdvanced ? "all" : "guia");

  if (!payload) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-notarial-gold" />
              {isAdvanced ? "Auditoría de variables del .docx" : "Guía de tags de tu plantilla Word"}
            </DialogTitle>
            <DialogDescription className="pt-2 text-white/70">
              Aún no se ha generado ningún documento en esta sesión. Genera el .docx
              (Previsualizar o Descargar Word) para auditar las variables y ver la guía
              completa de tags.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Entendido
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }


  const mapped = filterStrings(payload.diff.mapped);
  const empty = filterStrings(payload.diff.empty);
  const missing = filterStrings(payload.diff.missing);
  const unused = filterStrings(payload.diff.unused);
  const scoped = filterStrings(payload.diff.scoped ?? []);
  const sectionsResolved = payload.diff.sectionsResolved ?? {};
  const allRows = filtered(allEntries);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAdvanced ? (
              <Bug className="h-5 w-5 text-primary" />
            ) : (
              <BookOpen className="h-5 w-5 text-notarial-gold" />
            )}
            {isAdvanced ? "Auditoría de variables del .docx" : "Guía de tags de tu plantilla Word"}
          </DialogTitle>
          <DialogDescription>
            {isAdvanced ? (
              <>
                Trámite{" "}
                <span className="font-mono text-xs">
                  {payload.tramiteId.slice(0, 8)}…
                </span>{" "}
                · {payload.template} · render {payload.renderMs ?? "?"} ms
              </>
            ) : (
              <>Copia los <code className="font-mono">{"{{tags}}"}</code> y pégalos en tu plantilla de Word donde quieras que aparezca cada dato.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {isAdvanced && (
          <>
            {/* Resumen */}
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 text-xs">
              <Stat label="Tags plantilla" value={payload.counts.tags} />
              <Stat label="Claves data" value={payload.counts.flatKeys} />
              <Stat label="Mapeados" value={payload.counts.mapped} tone="success" />
              <Stat
                label="Por loop"
                value={payload.counts.scoped}
                tone={payload.counts.scoped > 0 ? "success" : "muted"}
              />
              <Stat label="Vacíos" value={payload.counts.empty} tone="warning" />
              <Stat label="Missing" value={payload.counts.missing} tone="danger" />
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
          </>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder={isAdvanced ? "Filtrar por nombre de variable…" : "Buscar dato (ej: matrícula, vendedor, precio)…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9"
          />
          {canExport && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleCopyJson}
                    aria-label="Copiar JSON de auditoría"
                    className="h-9 w-9 shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Copiar JSON</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleDownloadJson}
                    aria-label="Descargar reporte de auditoría"
                    className="h-9 w-9 shrink-0"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Descargar reporte</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <Tabs
          key={`${open}-${resolvedInitialTab}`}
          defaultValue={resolvedInitialTab}
          className="flex-1 overflow-hidden flex flex-col"
        >
          <TabsList
            className={cn(
              "w-full grid",
              isAdvanced ? "grid-cols-8" : "grid-cols-1",
            )}
          >
            <TabsTrigger value="guia" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Guía
              <Badge variant="secondary" className="ml-1">
                {tagSections.reduce((n, s) => n + s.blocks.length, 0)}
              </Badge>
            </TabsTrigger>
            {isAdvanced && (
              <>
                <TabsTrigger value="all">
                  Todas <Badge variant="secondary" className="ml-1">{allRows.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="mapped">
                  Mapeados <Badge variant="secondary" className="ml-1">{mapped.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="scoped">
                  Por loop <Badge variant="secondary" className="ml-1">{scoped.length}</Badge>
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
              </>
            )}
          </TabsList>

          <ScrollArea className="flex-1 mt-2 border rounded-md">
            <TabsContent value="guia" className="m-0">
              <TagCatalogView sections={tagSections} filter={filter} toast={toast} />
            </TabsContent>
            {isAdvanced && (
              <>
                <TabsContent value="all" className="m-0">
                  <DataTable rows={allRows} />
                </TabsContent>
                <TabsContent value="mapped" className="m-0">
                  <TagList items={mapped} hint="Tag de la plantilla con valor utilizable (incluye los resueltos por loop scoped)." />
                </TabsContent>
                <TabsContent value="scoped" className="m-0">
                  <div className="p-3 space-y-3">
                    <p className="text-xs text-muted-foreground italic">
                      Tags resueltos dentro de un loop <code>{"{#sección}…{/sección}"}</code>.
                      Docxtemplater los lee del scope local de cada item del array.
                    </p>
                    {Object.keys(sectionsResolved).length === 0 ? (
                      <div className="text-sm text-muted-foreground py-4 text-center">
                        Sin loops detectados.
                      </div>
                    ) : (
                      Object.entries(sectionsResolved).map(([section, keys]) => (
                        <div key={section} className="space-y-1.5">
                          <div className="text-xs font-semibold text-emerald-500">
                            {"{#"}{section}{"}"} <span className="text-muted-foreground font-normal">({keys.length} sub-tags)</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {keys.map((k) => (
                              <code
                                key={`${section}-${k}`}
                                className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-500 bg-background/40"
                              >
                                {k}
                              </code>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
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
                <TabsContent value="rescued" className="m-0">
                  <RescuedList items={payload.rescued} />
                </TabsContent>
              </>
            )}
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

function RescuedList({ items }: { items: RescuedTagEntry[] }) {
  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No se rescató ningún tag fragmentado en esta plantilla. ✅
      </div>
    );
  }
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-muted-foreground italic">
        Tags que Word había partido entre múltiples runs y que el normalizador
        consolidó automáticamente antes del render. Si la cantidad es alta,
        considera regenerar la plantilla.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Tag</TableHead>
            <TableHead className="w-[35%]">Ubicación</TableHead>
            <TableHead className="w-[15%]">Contexto</TableHead>
            <TableHead className="w-[10%]">Runs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((r, i) => (
            <TableRow key={`${r.file}-${r.paragraphIndex}-${i}`}>
              <TableCell className="font-mono text-xs">{r.raw}</TableCell>
              <TableCell className="font-mono text-[11px] text-muted-foreground">
                {r.file}#p{r.paragraphIndex}
              </TableCell>
              <TableCell className="text-xs">
                {r.inTable ? (
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    tabla
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">párrafo</span>
                )}
              </TableCell>
              <TableCell className="text-xs">{r.runsFused + 1}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Pestaña "Guía" — diccionario amigable de tags ────────────────────────

function statusBadge(status: TagCardData["status"]) {
  switch (status) {
    case "scoped":
      return { label: "Por loop", cls: "border-notarial-gold/40 text-notarial-gold" };
    case "empty":
      return { label: "Vacío", cls: "border-orange-500/40 text-orange-500" };
    case "missing":
      return { label: "Faltante", cls: "border-destructive/40 text-destructive" };
    case "mapped":
    default:
      return { label: "Listo", cls: "border-emerald-500/40 text-emerald-500" };
  }
}

function matchesFilter(card: TagCardData, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    card.friendlyLabel.toLowerCase().includes(needle) ||
    card.tag.toLowerCase().includes(needle) ||
    card.rawKey.toLowerCase().includes(needle) ||
    card.exampleValue.toLowerCase().includes(needle)
  );
}

function TagCatalogView({
  sections,
  filter,
  toast,
}: {
  sections: TagSection[];
  filter: string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  // Filtrado: una sección se muestra si tiene al menos un block que matchee.
  const filtered = sections
    .map((sec) => {
      const blocks = sec.blocks
        .map((b) => {
          if (b.kind === "loop") {
            const items = b.items.filter((i) => matchesFilter(i, filter));
            return items.length > 0 ? { ...b, items } : null;
          }
          return matchesFilter(b.card, filter) ? b : null;
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
      return { ...sec, blocks };
    })
    .filter((s) => s.blocks.length > 0);

  if (filtered.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Sin coincidencias para tu búsqueda.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-3 space-y-5">
        {filtered.map((sec) => (
          <section key={sec.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{sec.title}</h3>
                <p className="text-xs text-muted-foreground">{sec.description}</p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {sec.blocks.reduce(
                  (n, b) => n + (b.kind === "loop" ? b.items.length : 1),
                  0,
                )}{" "}
                tags
              </Badge>
            </div>

            <div className="space-y-3">
              {sec.blocks.map((b, i) =>
                b.kind === "loop" ? (
                  <LoopBlockView key={`loop-${sec.id}-${i}`} block={b} toast={toast} />
                ) : (
                  <TagCardView key={`tag-${sec.id}-${b.card.rawKey}`} card={b.card} toast={toast} />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </TooltipProvider>
  );
}

function LoopBlockView({
  block,
  toast,
}: {
  block: CatalogLoopBlock;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const handleCopyAll = async () => {
    const all = block.items.map((it) => it.tag).join("\n");
    const text = `{#${block.loopName}}\n${all}\n{/${block.loopName}}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Bloque {#${block.loopName}} copiado` });
    } catch {
      toast({ title: "No se pudo copiar", variant: "destructive" });
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-notarial-gold/40 bg-notarial-gold/[0.04] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <code className="text-xs font-mono text-notarial-gold">
          {`{#${block.loopName}}`}
        </code>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopyAll}
              aria-label={`Copiar bloque {#${block.loopName}}`}
              className="h-7 w-7 text-notarial-gold hover:bg-notarial-gold/10"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Copiar bloque completo</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        Todo lo que esté dentro de este bloque se repite automáticamente por cada{" "}
        <span className="text-notarial-gold/80">{block.loopName.replace(/s$/, "")}</span> del trámite.
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        {block.items.map((card) => (
          <TagCardView key={card.rawKey} card={card} toast={toast} />
        ))}
      </div>
      <code className="block text-xs font-mono text-notarial-gold">
        {`{/${block.loopName}}`}
      </code>
    </div>
  );
}

function TagCardView({
  card,
  toast,
}: {
  card: TagCardData;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const badge = statusBadge(card.status);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(card.tag);
      toast({ title: "Tag copiado", description: card.tag });
    } catch {
      toast({ title: "No se pudo copiar", variant: "destructive" });
    }
  };
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] backdrop-blur-sm hover:border-notarial-gold/30 transition-colors p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-foreground leading-snug">
          {card.friendlyLabel}
        </span>
        <Badge variant="outline" className={cn("text-[10px] shrink-0", badge.cls)}>
          {badge.label}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[11px] font-mono px-2 py-1 rounded border border-white/10 bg-background/60 text-foreground/90 truncate">
          {card.tag}
        </code>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              aria-label={`Copiar ${card.tag}`}
              className="h-7 w-7 shrink-0 text-foreground/70 hover:text-notarial-gold hover:bg-notarial-gold/10"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Copiar tag</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Ejemplo:{" "}
        <span className={cn("font-mono", card.exampleValue === "—" && "italic opacity-60")}>
          {card.exampleValue}
        </span>
      </p>
    </div>
  );
}
