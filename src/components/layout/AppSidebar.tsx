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
  slug: string | null; // null = always visible (admin/account)
  label: string;
  icon: LucideIcon;
  path: string;
  superAdminOnly?: boolean;
}

const MODULE_NAV: NavItem[] = [
  { slug: "escrituras", label: "Escrituras", icon: FileText, path: "/escrituras" },
  { slug: "cancelaciones", label: "Cancelaciones", icon: FileX, path: "/cancelaciones" },
];

const ACCOUNT_NAV: NavItem[] = [
  { slug: null, label: "Equipo", icon: Users, path: "/equipo" },
  { slug: null, label: "Notaría", icon: Settings, path: "/notaria" },
  { slug: null, label: "Administración", icon: Shield, path: "/admin", superAdminOnly: true },
];

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { isModuleEnabled, loadingModules } = useModules();
  const { profile } = useAuth();

  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(`${path}/`);

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.path}>
      <SidebarMenuButton
        asChild
        isActive={isActive(item.path)}
        tooltip={item.label}
      >
        <NavLink to={item.path} className="flex items-center gap-2">
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

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
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
              Módulos
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            {loadingModules ? (
              <div className="space-y-2 px-2 py-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <SidebarMenu>
                {MODULE_NAV.filter((m) => !m.slug || isModuleEnabled(m.slug)).map(renderItem)}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground">
              Cuenta
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {ACCOUNT_NAV.filter((i) => !i.superAdminOnly || isSuperAdmin(profile?.email)).map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-slate-100 p-2">
        <SidebarTrigger className="w-full justify-center" />
      </SidebarFooter>
    </Sidebar>
  );
};
