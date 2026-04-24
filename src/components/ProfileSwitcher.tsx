import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building2, Check, ChevronDown, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  /** "dark" matches the dark notarial header; "light" for white-on-light pages. */
  variant?: "dark" | "light";
}

const ProfileSwitcher = ({ variant = "dark" }: Props) => {
  const { memberships, activeOrgId, switchContext, organization } = useAuth();
  const { toast } = useToast();
  const [switching, setSwitching] = useState(false);

  if (memberships.length === 0) return null;

  const active =
    memberships.find((m) => m.organization_id === activeOrgId) ??
    memberships.find((m) => m.organization_id === organization?.id) ??
    memberships[0];

  const handleSwitch = async (orgId: string) => {
    if (orgId === active.organization_id) return;
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

  const triggerCls =
    variant === "dark"
      ? "h-8 gap-2 border-white/10 bg-white/5 px-3 text-sm text-white hover:bg-white/10"
      : "h-9 gap-2";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === "dark" ? "ghost-dark" : "outline"}
          className={triggerCls}
          disabled={switching}
        >
          {active.is_personal ? (
            <User className="h-4 w-4 shrink-0" />
          ) : (
            <Building2 className="h-4 w-4 shrink-0" />
          )}
          <span className="max-w-[140px] truncate">{active.organization.name}</span>
          <span
            className={
              variant === "dark"
                ? "rounded bg-notarial-gold/20 px-1.5 py-0.5 text-[10px] font-medium text-notarial-gold"
                : "rounded bg-notarial-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-notarial-blue"
            }
          >
            {active.organization.credit_balance}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 bg-popover">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          Cambiar perfil
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => {
          const isActive = m.organization_id === active.organization_id;
          return (
            <DropdownMenuItem
              key={m.organization_id}
              onClick={() => handleSwitch(m.organization_id)}
              className="flex items-center gap-2 py-2"
            >
              {m.is_personal ? (
                <User className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Building2 className="h-4 w-4 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.organization.name}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {m.role === "owner" ? "Propietario" : m.role === "admin" ? "Administrador" : "Operador"}
                  {m.is_personal && " · Personal"}
                </div>
              </div>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                {m.organization.credit_balance}
              </span>
              {isActive && <Check className="h-4 w-4 text-notarial-green" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProfileSwitcher;
