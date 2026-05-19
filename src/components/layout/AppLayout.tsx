import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Coins } from "lucide-react";

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
  const { loadingModules } = useModules();
  const { organization } = useAuth();
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
            {loadingModules ? (
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
