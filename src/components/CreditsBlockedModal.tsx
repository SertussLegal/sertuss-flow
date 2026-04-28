import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreditCard, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CREDITS_BLOCKED_EVENT,
  type CreditsBlockedDetail,
} from "@/lib/creditsBus";

const sourceLabel = (source: string): string => {
  switch (source) {
    case "scan-document":
      return "extracción OCR";
    case "process-expediente":
    case "generate-document":
      return "generación del documento";
    case "validar-con-claude":
      return "validación con IA";
    default:
      return "esta operación";
  }
};

const CreditsBlockedModal = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<CreditsBlockedDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<CreditsBlockedDetail>;
      setDetail(ce.detail || { source: "otro" });
      setOpen(true);
    };
    window.addEventListener(CREDITS_BLOCKED_EVENT, handler);
    return () => window.removeEventListener(CREDITS_BLOCKED_EVENT, handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-2">
            <div className="h-12 w-12 rounded-full bg-notarial-gold/15 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-notarial-gold" />
            </div>
          </div>
          <DialogTitle className="text-center">Sin créditos disponibles</DialogTitle>
          <DialogDescription className="text-center">
            {detail?.message
              ? detail.message
              : `Necesitas créditos adicionales para continuar con ${sourceLabel(
                  detail?.source ?? "otro",
                )}. Recarga tu balance para retomar el trámite donde lo dejaste.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              navigate("/equipo");
            }}
            className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
          >
            <CreditCard className="h-4 w-4 mr-2" />
            Ver planes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreditsBlockedModal;
