// rebuild trigger v2
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, ProtectedRoute } from "@/contexts/AuthContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { ModuleGate } from "@/components/layout/ModuleGate";
import { LegacyTramiteRedirect } from "@/components/layout/LegacyTramiteRedirect";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import AdminOrgEdit from "./pages/AdminOrgEdit";
import Validacion from "./pages/Validacion";
import Team from "./pages/Team";
import NotFound from "./pages/NotFound";
import ResetPassword from "./pages/ResetPassword";
import NotariaSettings from "./pages/NotariaSettings";
import DocumentUploadStep from "./components/tramites/DocumentUploadStep";
import CreditsBlockedModal from "./components/CreditsBlockedModal";
import Cancelaciones from "./pages/Cancelaciones";
import CancelacionNueva from "./pages/CancelacionNueva";
import CancelacionValidar from "./pages/CancelacionValidar";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ModuleProvider>
            <CreditsBlockedModal />
            <Routes>
              {/* Públicas */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* App protegida con layout global */}
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                {/* Default: index del shell protegido → /escrituras */}
                <Route index element={<Navigate to="/escrituras" replace />} />
                <Route path="/dashboard" element={<Navigate to="/escrituras" replace />} />

                {/* MÓDULO: Escrituras */}
                <Route
                  path="/escrituras"
                  element={
                    <ModuleGate slug="escrituras" moduleName="Escrituras">
                      <Dashboard />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/escrituras/nuevo"
                  element={
                    <ModuleGate slug="escrituras" moduleName="Escrituras">
                      <DocumentUploadStep />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/escrituras/:id"
                  element={
                    <ModuleGate slug="escrituras" moduleName="Escrituras">
                      <Validacion />
                    </ModuleGate>
                  }
                />

                {/* MÓDULO: Cancelaciones */}
                <Route
                  path="/cancelaciones"
                  element={
                    <ModuleGate slug="cancelaciones" moduleName="Cancelaciones">
                      <Cancelaciones />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/cancelaciones/nueva"
                  element={
                    <ModuleGate slug="cancelaciones" moduleName="Cancelaciones">
                      <CancelacionNueva />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/cancelaciones/:id/validar"
                  element={
                    <ModuleGate slug="cancelaciones" moduleName="Cancelaciones">
                      <CancelacionValidar />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/cancelaciones/:id"
                  element={
                    <ModuleGate slug="cancelaciones" moduleName="Cancelaciones">
                      <Cancelaciones />
                    </ModuleGate>
                  }
                />


                {/* Administración / cuenta (siempre visibles) */}
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/entidad/:id" element={<AdminOrgEdit />} />
                <Route path="/notaria" element={<NotariaSettings />} />
                <Route path="/equipo" element={<Team />} />
              </Route>

              {/* Redirects de compatibilidad (URLs antiguas) */}
              <Route path="/nuevo-tramite" element={<Navigate to="/escrituras/nuevo" replace />} />
              <Route path="/tramite/nuevo" element={<Navigate to="/escrituras/nuevo" replace />} />
              <Route
                path="/tramite/:id"
                element={
                  <ProtectedRoute>
                    <LegacyTramiteRedirect />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </ModuleProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
