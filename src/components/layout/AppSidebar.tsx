import { FileText, FileX, Settings, Users, Shield, type LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/lib/superAdmin";

interface NavItem {
  slug?: string; // feature flag (módulos de trabajo)
  label: string;
  icon: LucideIcon;
  path: string;
}

const WORK_MODULES: NavItem[] = [
  { slug: "escrituras", label: "Escrituras", icon: FileText, path: "/escrituras" },
  { slug: "cancelaciones", label: "Cancelaciones", icon: FileX, path: "/cancelaciones" },
];

const OFFICE_NAV: NavItem[] = [
  { label: "Equipo", icon: Users, path: "/equipo" },
  { label: "Configuración", icon: Settings, path: "/notaria" },
];

const PLATFORM_NAV: NavItem[] = [
  { label: "Administración", icon: Shield, path: "/admin" },
];

const GROUP_LABEL_CLS =
  "text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-medium";

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { isModuleEnabled, loadingModules } = useModules();
  const { profile, memberships, activeOrgId } = useAuth();

  // Rol dentro de la org activa. El SuperAdmin NO obtiene bypass aquí:
  // "Mi notaría" solo se muestra cuando realmente es owner del contexto actual.
  const activeMembership = memberships.find((m) => m.organization_id === activeOrgId);
  const isOwnerOfActiveOrg = activeMembership?.role === "owner";
  const superAdmin = isSuperAdmin(profile?.email);

  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(`${path}/`);

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.path}>
      <SidebarMenuButton asChild isActive={isActive(item.path)} tooltip={item.label}>
        <NavLink to={item.path} className="flex items-center gap-2">
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const visibleWorkModules = WORK_MODULES.filter((m) => !m.slug || isModuleEnabled(m.slug));

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-100">
      <SidebarHeader className="border-b border-slate-100 px-3 py-4">
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-notarial-blue text-white text-sm font-bold">
            S
          </div>
        ) : (
          <div className="text-lg font-semibold tracking-tight">Sertuss</div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {/* Grupo 1 — Módulos de trabajo. Para SuperAdmin nunca se oculta. */}
        {(loadingModules || visibleWorkModules.length > 0 || superAdmin) && (
          <SidebarGroup>
            {!collapsed && (
              <SidebarGroupLabel className={GROUP_LABEL_CLS}>
                Módulos de trabajo
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              {loadingModules && !superAdmin ? (
                <div className="space-y-2 px-2 py-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <SidebarMenu>{visibleWorkModules.map(renderItem)}</SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Grupo 2 — Mi notaría: solo si la membresía activa es owner */}
        {isOwnerOfActiveOrg && (
          <SidebarGroup>
            {!collapsed && (
              <SidebarGroupLabel className={GROUP_LABEL_CLS}>
                Mi notaría
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>{OFFICE_NAV.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Grupo 3 — Plataforma: exclusivo info@sertuss.com */}
        {superAdmin && (
          <SidebarGroup>
            {!collapsed && (
              <SidebarGroupLabel className={GROUP_LABEL_CLS}>
                Plataforma
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>{PLATFORM_NAV.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-slate-100 p-2">
        <SidebarTrigger className="w-full justify-center" />
      </SidebarFooter>
    </Sidebar>
  );
};
