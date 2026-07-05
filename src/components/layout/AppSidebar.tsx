import { useState } from "react";
import {
  FileText,
  FileX,
  Users,
  Shield,
  LogOut,
  Building2,
  User,
  ChevronsUpDown,
  Check,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/lib/superAdmin";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

const roleLabel = (role: string) =>
  role === "owner" ? "Propietario" : role === "admin" ? "Administrador" : "Operador";

export const AppSidebar = () => {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isModuleEnabled, loadingModules, enabledModules } = useModules();
  // Cold-start sólo cuando NO tenemos módulos previos en memoria.
  const moduleColdStart = loadingModules && enabledModules.length === 0;
  const { profile, memberships, activeOrgId, organization, switchContext } = useAuth();
  const [switching, setSwitching] = useState(false);

  const activeMembership =
    memberships.find((m) => m.organization_id === activeOrgId) ??
    memberships.find((m) => m.organization_id === organization?.id) ??
    memberships[0];
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

  const handleSwitch = async (orgId: string) => {
    if (!activeMembership || orgId === activeMembership.organization_id) return;
    setSwitching(true);
    try {
      await switchContext(orgId);
      toast({ title: "Perfil cambiado", description: "Contexto actualizado." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSwitching(false);
    }
  };

  const showWorkGroup = moduleColdStart || visibleWorkModules.length > 0;
  const showOfficeGroup = isOwnerOfActiveOrg && OFFICE_NAV.length > 0;
  const showPlatformGroup = superAdmin && PLATFORM_NAV.length > 0;

  const ActiveIcon = activeMembership?.is_personal ? User : Building2;

  const switcherContent = activeMembership ? (
    <DropdownMenuContent
      align="start"
      side={collapsed ? "right" : "top"}
      className="w-64 bg-popover"
    >
      <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
        Cambiar organización
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {memberships.map((m) => {
        const Icon = m.is_personal ? User : Building2;
        const active = m.organization_id === activeMembership.organization_id;
        return (
          <DropdownMenuItem
            key={m.organization_id}
            onClick={() => handleSwitch(m.organization_id)}
            className="flex items-center gap-2 py-2"
          >
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{m.organization.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {roleLabel(m.role)}
                {m.is_personal && " · Personal"}
              </div>
            </div>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
              {m.organization.credit_balance}
            </span>
            {active && <Check className="h-4 w-4 text-notarial-green" />}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  ) : null;

  return (
    <Sidebar collapsible="icon" className="border-r border-slate-100">
      <SidebarHeader className="border-b border-slate-100 px-3 py-4">
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded bg-notarial-blue text-white text-sm font-bold">
            S
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="text-lg font-semibold tracking-tight">Sertuss</div>
            {superAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-notarial-gold/15 px-2 py-0.5 text-[10px] font-semibold text-notarial-gold">
                <ShieldCheck className="h-3 w-3" />
                SuperAdmin
              </span>
            )}
          </div>
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
              {moduleColdStart && !superAdmin ? (
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

      <SidebarFooter className="border-t border-slate-100 p-2 gap-1">
        {activeMembership && (
          <>
            {collapsed ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={switching}
                        className="w-full"
                      >
                        <ActiveIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    Cambiar organización · {activeMembership.organization.name}
                  </TooltipContent>
                </Tooltip>
                {switcherContent}
              </DropdownMenu>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    disabled={switching}
                    className="w-full h-auto justify-between gap-2 px-2 py-2 hover:bg-muted"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ActiveIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col items-start min-w-0">
                        <span className="text-sm font-medium truncate max-w-[150px]">
                          {activeMembership.organization.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {roleLabel(activeMembership.role)}
                          {activeMembership.is_personal && " · Personal"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="rounded bg-notarial-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-notarial-blue">
                        {activeMembership.organization.credit_balance}
                      </span>
                      <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                {switcherContent}
              </DropdownMenu>
            )}
          </>
        )}

        {!collapsed ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span>Cerrar sesión</span>
          </Button>
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
