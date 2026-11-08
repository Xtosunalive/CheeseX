import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { documentClearChipAria } from "../document-inventory-copy";

export function FilterChipBar({ chips, onClear }: { chips: Array<{ key: string; label: string }>; onClear: (key: string) => void }) {
  if (!chips.length) return null;
  return <div className="flex flex-wrap gap-2">{chips.map((chip) => <Badge key={chip.key} variant="secondary" className="gap-1">{chip.label}<button aria-label={documentClearChipAria(chip.label)} onClick={() => onClear(chip.key)}><X className="h-3 w-3" /></button></Badge>)}</div>;
}
