import { useEffect, useState, type ReactNode } from "react";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import { Forbidden403 } from "./Forbidden403";
import { Skeleton } from "@/components/ui/skeleton";

interface ModuleGateProps {
  slug: string;
  moduleName?: string;
  children: ReactNode;
}

const GRACE_MS = 1500;

const LoadingSkeleton = () => (
  <div className="p-6 space-y-4">
    <Skeleton className="h-8 w-1/3" />
    <Skeleton className="h-64 w-full" />
  </div>
);

export const ModuleGate = ({ slug, moduleName, children }: ModuleGateProps) => {
  const { isModuleEnabled, loadingModules, enabledModules } = useModules();
  const { activeOrgId } = useAuth();
  const [graceElapsed, setGraceElapsed] = useState(false);

  // Defensive grace window: if RLS hasn't returned data yet, wait before showing 403.
  useEffect(() => {
    if (!activeOrgId) return;
    if (enabledModules.length > 0) {
      setGraceElapsed(true);
      return;
    }
    setGraceElapsed(false);
    const timeout = setTimeout(() => setGraceElapsed(true), GRACE_MS);
    return () => clearTimeout(timeout);
  }, [activeOrgId, enabledModules.length]);

  if (loadingModules) return <LoadingSkeleton />;

  // Avoid false 403 right after login while modules query is still settling.
  if (!isModuleEnabled(slug) && activeOrgId && enabledModules.length === 0 && !graceElapsed) {
    return <LoadingSkeleton />;
  }

  if (!isModuleEnabled(slug)) {
    return <Forbidden403 moduleName={moduleName} />;
  }

  return <>{children}</>;
};
