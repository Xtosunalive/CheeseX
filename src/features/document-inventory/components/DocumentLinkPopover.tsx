import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ObsidianLink } from "@/components/obsidian";
import { documentOpenInObsidianTitle } from "../document-inventory-copy";

export function DocumentLinkPopover({ relativePath, title }: { relativePath: string; title: string }) {
  return <Button asChild variant="ghost" size="sm"><ObsidianLink sourcePath={relativePath} title={documentOpenInObsidianTitle(relativePath)}><ExternalLink className="h-4 w-4" />{title}</ObsidianLink></Button>;
}
