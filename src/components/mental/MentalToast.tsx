import { useEffect } from "react";
import { toast } from "@/components/ui/sonner";

type MentalToastTone = "info" | "warning";

interface MentalToastProps {
  eventId: number;
  message: string;
  description?: string;
  tone?: MentalToastTone;
  onShown?: () => void;
}

export function MentalToast({ eventId, message, description, tone = "info", onShown }: MentalToastProps) {
  useEffect(() => {
    toast[tone](message, { description });
    onShown?.();
  }, [description, eventId, message, onShown, tone]);

  return null;
}
