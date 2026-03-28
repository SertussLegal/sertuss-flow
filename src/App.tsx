// rebuild trigger v2
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, ProtectedRoute } from "@/contexts/AuthContext";
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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/nuevo-tramite" element={<ProtectedRoute><DocumentUploadStep /></ProtectedRoute>} />
            <Route path="/tramite/nuevo" element={<ProtectedRoute><Validacion /></ProtectedRoute>} />
            <Route path="/tramite/:id" element={<ProtectedRoute><Validacion /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/admin/entidad/:id" element={<ProtectedRoute><AdminOrgEdit /></ProtectedRoute>} />
            <Route path="/notaria" element={<ProtectedRoute><NotariaSettings /></ProtectedRoute>} />
            <Route path="/equipo" element={<ProtectedRoute><Team /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
