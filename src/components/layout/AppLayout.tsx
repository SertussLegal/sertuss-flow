import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Coins, Loader2 } from "lucide-react";
import { useSaveStatus } from "@/contexts/SaveStatusContext";

const SECTION_TITLES: Array<{ match: RegExp; title: string }> = [
  { match: /^\/escrituras\/nuevo/, title: "Nueva escritura" },
  { match: /^\/escrituras\/[^/]+/, title: "Validación de expediente" },
  { match: /^\/escrituras/, title: "Escrituras" },
  { match: /^\/cancelaciones/, title: "Cancelaciones" },
  { match: /^\/equipo/, title: "Mi equipo" },
  { match: /^\/notaria/, title: "Configuración" },
  { match: /^\/admin\/entidad/, title: "Editar entidad" },
  { match: /^\/admin/, title: "Panel de administración" },
];

const resolveTitle = (pathname: string) =>
  SECTION_TITLES.find((s) => s.match.test(pathname))?.title ?? "";

export const AppLayout = () => {
  const { loadingModules, enabledModules } = useModules();
  // Cold-start: sólo mostramos skeleton si no tenemos módulos previos.
  // Los refetches en segundo plano mantienen el shell montado y eliminan el parpadeo.
  const coldStart = loadingModules && enabledModules.length === 0;
  const { organization } = useAuth();
  const { status: saveStatus } = useSaveStatus();
  const { pathname } = useLocation();
  const title = resolveTitle(pathname);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-slate-100 px-4 bg-background/95 backdrop-blur-md">
            <SidebarTrigger />
            {title && (
              <span className="text-sm font-medium text-muted-foreground">
                {title}
              </span>
            )}
            <div className="flex-1" />
            {saveStatus === "saving" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 border border-border rounded-full px-2.5 py-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Guardando…</span>
              </div>
            )}
            {saveStatus === "dirty" && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/40 rounded-full px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span>Sin guardar</span>
              </div>
            )}
            {saveStatus === "saved" && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/40 rounded-full px-2.5 py-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>Guardado</span>
              </div>
            )}
            {organization && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Coins className="h-4 w-4 text-notarial-gold" />
                <span className="font-medium text-foreground">
                  {organization.credit_balance}
                </span>
                <span>créditos</span>
              </div>
            )}
          </header>

          <main className="flex-1 min-w-0">
            {coldStart ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};
