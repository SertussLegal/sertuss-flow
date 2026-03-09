import { Badge } from "@/components/ui/badge";
import { ScanLine } from "lucide-react";

const OcrBadge = () => (
  <Badge variant="secondary" className="ml-1.5 gap-1 px-1.5 py-0 text-[10px] font-medium">
    <ScanLine className="h-3 w-3" />
    OCR
  </Badge>
);

export default OcrBadge;
