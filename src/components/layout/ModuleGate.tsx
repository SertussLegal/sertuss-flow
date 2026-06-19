import { useEffect, useRef, useState, type ReactNode } from "react";
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
  <div data-testid="page-skeleton" className="p-6 space-y-4">
    <Skeleton className="h-8 w-1/3" />
    <Skeleton className="h-64 w-full" />
  </div>
);

export const ModuleGate = ({ slug, moduleName, children }: ModuleGateProps) => {
  const { isModuleEnabled, loadingModules, enabledModules } = useModules();
  const { activeOrgId } = useAuth();

  // Fix D: estado derivado en lugar de useState/useEffect que se desfasaba.
  // mountedAt es estable; el tick programado solo re-evalúa el render una vez
  // si el cold start excede GRACE_MS, sin loops y con cleanup automático.
  const mountedAt = useRef(Date.now());
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (loadingModules && enabledModules.length === 0) {
      const timer = setTimeout(() => forceUpdate({}), GRACE_MS);
      return () => clearTimeout(timer);
    }
  }, [loadingModules, enabledModules.length]);

  if (loadingModules) return <LoadingSkeleton />;

  const elapsed = Date.now() - mountedAt.current;
  const graceElapsed = enabledModules.length > 0 || elapsed >= GRACE_MS;

  // Avoid false 403 right after login while modules query is still settling.
  if (!isModuleEnabled(slug) && activeOrgId && enabledModules.length === 0 && !graceElapsed) {
    return <LoadingSkeleton />;
  }

  if (!isModuleEnabled(slug)) {
    return <Forbidden403 moduleName={moduleName} />;
  }

  return <>{children}</>;
};
