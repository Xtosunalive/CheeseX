import { forwardRef, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { toast } from "@/components/ui/sonner";
import { openObsidianFile } from "@/lib/obsidian";
import { LIB_REQUEST_COPY } from "@/lib/lib-copy";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  sourcePath: string;
};

export const ObsidianLink = forwardRef<HTMLButtonElement, Props>(function ObsidianLink(
  { sourcePath, disabled, children, onClick, ...props },
  ref,
) {
  const [opening, setOpening] = useState(false);
  const unavailable = disabled || opening || !sourcePath.trim();

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || unavailable) return;
    setOpening(true);
    try {
      await openObsidianFile(sourcePath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : LIB_REQUEST_COPY.OBSIDIAN_OPEN_FAILED);
    } finally {
      setOpening(false);
    }
  };

  return <button ref={ref} type="button" disabled={unavailable} aria-busy={opening} onClick={(event) => void handleClick(event)} {...props}>{children}</button>;
});
