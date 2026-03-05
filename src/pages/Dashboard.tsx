import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Search, LogOut, Scale } from "lucide-react";
import type { Tramite } from "@/lib/types";

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  validado: "bg-notarial-green/10 text-notarial-green border-notarial-green/30",
  word_generado: "bg-notarial-blue/10 text-notarial-blue border-notarial-blue/30",
};

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  validado: "Validado",
  word_generado: "Word Generado",
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Mock data for now — will be replaced with Supabase queries
  const [tramites] = useState<Tramite[]>([
    {
      id: "1",
      radicado: "2026-001",
      tipo: "Compraventa",
      fecha: "2026-03-05",
      status: "pendiente",
      vendedores: [],
      compradores: [],
      inmueble: {} as any,
      actos: {} as any,
    },
    {
      id: "2",
      radicado: "2026-002",
      tipo: "Compraventa con Hipoteca",
      fecha: "2026-03-04",
      status: "validado",
      vendedores: [],
      compradores: [],
      inmueble: {} as any,
      actos: {} as any,
    },
  ]);

  const filtered = tramites.filter((t) => {
    const matchSearch =
      t.radicado.toLowerCase().includes(search.toLowerCase()) ||
      t.tipo.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-notarial-gold" />
            <span className="text-lg font-bold">Sertuss</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-white hover:bg-white/10">
            <LogOut className="mr-2 h-4 w-4" />
            Salir
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="container py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">Escrituras</h1>
          <Button onClick={() => navigate("/tramite/nuevo")} className="bg-notarial-green hover:bg-notarial-green/90">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Trámite
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por radicado o tipo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
                <SelectItem value="word_generado">Word Generado</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Trámites</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Radicado</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tramite/${t.id}`)}>
                    <TableCell className="font-medium">{t.radicado}</TableCell>
                    <TableCell>{t.tipo}</TableCell>
                    <TableCell>{t.fecha}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[t.status]}>
                        {statusLabels[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm">
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No se encontraron trámites
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;
