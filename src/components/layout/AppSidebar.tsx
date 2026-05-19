import { FileText, FileX, Users, Shield, LogOut, type LucideIcon } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/lib/superAdmin";
import { supabase } from "@/integrations/supabase/client";
import ProfileSwitcher from "@/components/ProfileSwitcher";

interface NavItem {
  slug?: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

const WORK_MODULES: NavItem[] = [
  { slug: "escrituras", label: "Escrituras", icon: FileText, path: "/escrituras" },
  { slug: "cancelaciones", label: "Cancelaciones", icon: FileX, path: "/cancelaciones" },
];

const OFFICE_NAV: NavItem[] = [
  { label: "Mi Equipo", icon: Users, path: "/equipo" },
];

const PLATFORM_NAV: NavItem[] = [
  { label: "Panel de Administración", icon: Shield, path: "/admin" },
];

const GROUP_LABEL_CLS =
  "text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-medium";

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isModuleEnabled, loadingModules } = useModules();
  const { profile, memberships, activeOrgId } = useAuth();

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

  const visibleWorkModules = WORK_MODULES.filter(
    (m) => !m.slug || isModuleEnabled(m.slug),
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const showWorkGroup = loadingModules || visibleWorkModules.length > 0 || superAdmin;
  const showOfficeGroup = isOwnerOfActiveOrg && OFFICE_NAV.length > 0;
  const showPlatformGroup = superAdmin && PLATFORM_NAV.length > 0;

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
        {showWorkGroup && (
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

        {showOfficeGroup && (
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

        {showPlatformGroup && (
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

      <SidebarFooter className="border-t border-slate-100 p-2 gap-2">
        {!collapsed ? (
          <>
            <div className="px-1">
              <ProfileSwitcher variant="light" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span>Cerrar sesión</span>
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            title="Cerrar sesión"
            className="w-full"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};
