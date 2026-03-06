import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Persona, Inmueble, Actos } from "@/lib/types";

interface PreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendedores: Persona[];
  compradores: Persona[];
  inmueble: Inmueble;
  actos: Actos;
  onConfirm: () => void;
  generating?: boolean;
}

const PersonaPreview = ({ persona, label }: { persona: Persona; label: string }) => (
  <div className="rounded border bg-muted/50 p-3 text-sm">
    <p className="font-medium">{label}</p>
    {persona.es_persona_juridica ? (
      <>
        <p>Razón Social: {persona.razon_social}</p>
        <p>NIT: {persona.nit}</p>
        <p>Rep. Legal: {persona.representante_legal_nombre} — C.C. {persona.representante_legal_cedula}</p>
      </>
    ) : (
      <>
        <p>Nombre: {persona.nombre_completo}</p>
        <p>Cédula: {persona.numero_cedula}</p>
        <p>Estado Civil: {persona.estado_civil}</p>
      </>
    )}
    <p>Dirección: {persona.direccion}</p>
    {persona.es_pep && (
      <Badge variant="outline" className="mt-1 border-accent text-accent">PEP — SARLAFT</Badge>
    )}
  </div>
);

const PreviewModal = ({ open, onOpenChange, vendedores, compradores, inmueble, actos, onConfirm, generating }: PreviewModalProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl max-h-[90vh]">
      <DialogHeader>
        <DialogTitle>Previsualización del Trámite</DialogTitle>
        <DialogDescription>Revise los datos antes de generar el documento Word.</DialogDescription>
      </DialogHeader>

      <ScrollArea className="h-[60vh] pr-4">
        <div className="space-y-6">
          {/* Vendedores */}
          <div>
            <h4 className="mb-2 font-semibold">Vendedores</h4>
            <div className="space-y-2">
              {vendedores.map((v, i) => (
                <PersonaPreview key={v.id} persona={v} label={`Vendedor ${i + 1}`} />
              ))}
            </div>
          </div>

          <Separator />

          {/* Compradores */}
          <div>
            <h4 className="mb-2 font-semibold">Compradores</h4>
            <div className="space-y-2">
              {compradores.map((c, i) => (
                <PersonaPreview key={c.id} persona={c} label={`Comprador ${i + 1}`} />
              ))}
            </div>
          </div>

          <Separator />

          {/* Inmueble */}
          <div>
            <h4 className="mb-2 font-semibold">Inmueble</h4>
            <div className="rounded border bg-muted/50 p-3 text-sm space-y-1">
              <p>Matrícula: {inmueble.matricula_inmobiliaria}</p>
              <p>Identificador ({inmueble.tipo_identificador_predial === "chip" ? "CHIP" : "Predial Nacional"}): {inmueble.identificador_predial}</p>
              <p>Ubicación: {inmueble.municipio}, {inmueble.departamento}</p>
              <p>ORIP: {inmueble.codigo_orip} | Predio: {inmueble.tipo_predio}</p>
              <p>Dirección: {inmueble.direccion} | Estrato: {inmueble.estrato} | Área: {inmueble.area} m²</p>
              {inmueble.valorizacion && <p>Valorización: {inmueble.valorizacion}</p>}
              {inmueble.linderos && (
                <div>
                  <p className="font-medium mt-2">Linderos:</p>
                  <p className="whitespace-pre-wrap text-xs">{inmueble.linderos}</p>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Actos */}
          <div>
            <h4 className="mb-2 font-semibold">Actos</h4>
            <div className="rounded border bg-muted/50 p-3 text-sm space-y-1">
              <p>Tipo: {actos.tipo_acto}</p>
              <p>Valor Compraventa: {actos.valor_compraventa}</p>
              {actos.es_hipoteca && (
                <>
                  <Badge variant="outline" className="my-1">Hipoteca</Badge>
                  <p>Valor Hipoteca: {actos.valor_hipoteca}</p>
                  <p>Entidad: {actos.entidad_bancaria}</p>
                  <p>Apoderado: {actos.apoderado_nombre} — C.C. {actos.apoderado_cedula}</p>
                </>
              )}
              {actos.afectacion_vivienda_familiar && (
                <Badge variant="outline" className="mt-1 border-secondary text-secondary">Afectación Vivienda Familiar</Badge>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>Volver a Editar</Button>
        <Button onClick={onConfirm} disabled={generating} className="bg-notarial-green hover:bg-notarial-green/90">
          {generating ? "Generando..." : "Confirmar y Generar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default PreviewModal;
