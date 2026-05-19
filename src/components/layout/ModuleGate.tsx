import type { ReactNode } from "react";
import { useModules } from "@/contexts/ModuleContext";
import { Forbidden403 } from "./Forbidden403";
import { Skeleton } from "@/components/ui/skeleton";

interface ModuleGateProps {
  slug: string;
  moduleName?: string;
  children: ReactNode;
}

export const ModuleGate = ({ slug, moduleName, children }: ModuleGateProps) => {
  const { isModuleEnabled, loadingModules } = useModules();

  if (loadingModules) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isModuleEnabled(slug)) {
    return <Forbidden403 moduleName={moduleName} />;
  }

  return <>{children}</>;
};
