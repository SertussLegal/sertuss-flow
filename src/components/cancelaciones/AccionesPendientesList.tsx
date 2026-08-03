import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Alerta, CategoriaAlerta, SeccionAlerta } from "@shared/alertasCancelacion";
import { INSTRUCCIONES_PRIORITARIAS } from "@shared/alertasCancelacion";

/**
 * Listado de alertas del trámite, agrupadas por categoría.
 *
 * Componente autocontenido y reutilizable: en Fase 1 se monta dentro del
 * popover del botón principal; en Fase 2 se reutiliza tal cual dentro del
 * panel lateral del diseño de referencia. No conoce el layout que lo
 * contiene ni hace fetching — recibe `alertas` ya calculadas.
 */
export interface AccionesPendientesListProps {
  alertas: Alerta[];
  /** Navegación opcional a la sección del formulario que resuelve la alerta. */
  onIrASeccion?: (seccion: SeccionAlerta) => void;
  /** Si se pasa, sólo se renderizan estas categorías (usado por las pestañas). */
  categorias?: CategoriaAlerta[];
  className?: string;
}

const META: Record<
  CategoriaAlerta,
  { titulo: string; icono: typeof AlertTriangle; clase: string }
> = {
  prioritaria: {
    titulo: "Decisiones pendientes",
    icono: ShieldAlert,
    clase: "border-destructive/40 bg-destructive/5 text-destructive",
  },
  importante: {
    titulo: "Verifica contra el documento",
    icono: AlertTriangle,
    clase: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  informativa: {
    titulo: "Información",
    icono: Info,
    clase: "border-border bg-muted/50 text-muted-foreground",
  },
};

const ORDEN: CategoriaAlerta[] = ["prioritaria", "importante", "informativa"];

const SECCION_LABEL: Record<SeccionAlerta, string> = {
  poder: "Poder del banco",
  inmueble: "Inmueble",
  hipoteca: "Hipoteca anterior",
  partes: "Partes",
  documento: "Documento",
};

export function AccionesPendientesList({
  alertas,
  onIrASeccion,
  categorias,
  className,
}: AccionesPendientesListProps) {
  const orden = categorias ? ORDEN.filter((c) => categorias.includes(c)) : ORDEN;
  const visibles = alertas.filter((a) => orden.includes(a.categoria));

  if (visibles.length === 0) {
    return (
      <p className={cn("px-1 py-3 text-sm text-muted-foreground", className)}>
        {categorias ? "Sin alertas en esta categoría." : "No hay alertas en este trámite."}
      </p>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {orden.map((categoria) => {
        const grupo = alertas.filter((a) => a.categoria === categoria);
        if (grupo.length === 0) return null;
        const { titulo, icono: Icono, clase } = META[categoria];
        return (
          <section key={categoria} aria-label={titulo}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {titulo} ({grupo.length})
            </h3>
            <ul className="space-y-1.5">
              {grupo.map((a) => (
                <li
                  key={a.codigo}
                  className={cn("rounded-md border px-2.5 py-2", clase)}
                >
                  <div className="flex items-start gap-2">
                    <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{a.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug opacity-90">
                        {INSTRUCCIONES_PRIORITARIAS[a.codigo] ?? a.descripcion}
                      </p>
                      {onIrASeccion && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="mt-1 h-auto p-0 text-[11px]"
                          onClick={() => onIrASeccion(a.seccion)}
                        >
                          Ir a {SECCION_LABEL[a.seccion]}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default AccionesPendientesList;
