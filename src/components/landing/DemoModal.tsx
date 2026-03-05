import { lazy, Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Play } from "lucide-react";

interface DemoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DemoModal = ({ open, onOpenChange }: DemoModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card">
        <DialogHeader>
          <DialogTitle>Demo de Sertuss</DialogTitle>
          <DialogDescription>
            Mira cómo Sertuss automatiza la escrituración notarial en menos de 2 minutos.
          </DialogDescription>
        </DialogHeader>
        <div className="flex aspect-video items-center justify-center rounded-lg bg-muted">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Play className="h-8 w-8 text-primary" />
            </div>
            <p className="text-sm">Video demo próximamente</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DemoModal;
