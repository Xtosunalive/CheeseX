import { useEffect } from "react";
import { Activity, LoaderCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePipelineStore } from "@/lib/pipeline-store";
import { TERM } from "@/constants/term-const";
import { PipelinePanel } from "./PipelinePanel";

export function GlobalPipelineControl() {
  const job = usePipelineStore((state) => state.job);
  const open = usePipelineStore((state) => state.open);
  const setOpen = usePipelineStore((state) => state.setOpen);
  const initialize = usePipelineStore((state) => state.initialize);
  const refresh = usePipelineStore((state) => state.refresh);
  const running = job?.state === "running" || job?.state === "cancelling";
  const failed = job?.state === "failed";

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void refresh(); }, 700);
    return () => window.clearInterval(timer);
  }, [refresh, running]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={TERM.GRAPH_PIPELINE}
          aria-label={TERM.OPEN_GRAPH_PIPELINE_ACTION}
          aria-expanded={open}
          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-thin transition-colors hover:bg-surface-hover hover:text-text-main ${open ? "bg-accent-bg text-[var(--color-accent-fg)] border-accent-base/40" : "text-text-sub"}`}
        >
          {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          <span aria-hidden className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ${running ? "bg-accent-base" : failed ? "bg-status-error" : job?.state === "succeeded" ? "bg-status-fact" : "bg-text-placeholder"}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label={TERM.GRAPH_PIPELINE} align="end" sideOffset={8} className="w-[min(360px,calc(100vw-24px))] rounded-lg border-border-thin bg-surface-card p-4 shadow-popover">
        <PipelinePanel />
      </PopoverContent>
    </Popover>
  );
}
