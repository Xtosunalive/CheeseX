import { useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArticleUploadRequest } from "@/features/article-workflow/article-workflow-types";
// WP-138 R5c：上传扩展名值域单源（shared/article-upload-extensions.mjs，seq209 形态前后端共用）——
// 原本文件手抄一份字面量 Set 已退役；accept 属性与入队预校验同源消费，与服务端 415 值域对齐。
import { ARTICLE_UPLOAD_EXTENSIONS } from "../../../../shared/article-upload-extensions.mjs";
import {
  ARTICLE_UPLOAD_DOCK_COPY,
  uploadDuplicateError,
  uploadEmptyFileError,
  uploadQueueLimitError,
  uploadQueueSummary,
  uploadRemoveEntryLabel,
  uploadSubmitLabel,
  uploadSubmitShortLabel,
  uploadTooLargeError,
  uploadTypeUnsupportedError,
} from "../article-workflow-copy";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_QUEUE_FILES = 20;
const ACCEPT_ATTRIBUTE = ARTICLE_UPLOAD_EXTENSIONS.join(",");

type QueueStatus = "queued" | "uploading" | "succeeded" | "failed";
type QueueEntry = { id: string; file: File; status: QueueStatus; error: string | null };
type Props = { submitting: boolean; onSubmit: (payload: ArticleUploadRequest) => Promise<boolean> };

async function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(ARTICLE_UPLOAD_DOCK_COPY.READ_FAILED));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error(ARTICLE_UPLOAD_DOCK_COPY.READ_RESULT_INVALID));
      const comma = reader.result.indexOf(",");
      if (comma < 0) return reject(new Error(ARTICLE_UPLOAD_DOCK_COPY.ENCODE_FAILED));
      resolve(reader.result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function extension(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

function queueId(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function useMainContentBounds() {
  const [bounds, setBounds] = useState({ left: 16, right: 16 });
  useLayoutEffect(() => {
    const container = document.querySelector<HTMLElement>("[data-main-scroll-container]");
    if (!container) return;
    function update() {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const padding = window.innerWidth < 640 ? 16 : 24;
      setBounds({ left: Math.max(padding, rect.left + padding), right: Math.max(padding, window.innerWidth - rect.right + padding) });
    }
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  return bounds;
}

export function ArticleUploadDock({ submitting, onSubmit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const bounds = useMainContentBounds();
  const retryable = entries.filter((entry) => entry.status === "queued" || entry.status === "failed");
  const succeededCount = entries.filter((entry) => entry.status === "succeeded").length;

  function addFiles(fileList: FileList | File[]) {
    const next = [...entries];
    const names = new Set(next.map((entry) => entry.file.name));
    const errors: string[] = [];
    for (const file of Array.from(fileList)) {
      if (next.length >= MAX_QUEUE_FILES) { errors.push(uploadQueueLimitError(MAX_QUEUE_FILES)); break; }
      if (!ARTICLE_UPLOAD_EXTENSIONS.includes(extension(file.name))) { errors.push(uploadTypeUnsupportedError(file.name)); continue; }
      if (file.size === 0) { errors.push(uploadEmptyFileError(file.name)); continue; }
      if (file.size > MAX_UPLOAD_BYTES) { errors.push(uploadTooLargeError(file.name)); continue; }
      if (names.has(file.name)) { errors.push(uploadDuplicateError(file.name)); continue; }
      next.push({ id: queueId(file), file, status: "queued", error: null });
      names.add(file.name);
    }
    setEntries(next);
    setLocalError(errors[0] || null);
  }

  function updateEntry(id: string, patch: Partial<QueueEntry>) {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  }

  async function submit() {
    if (retryable.length === 0 || processing) return;
    setProcessing(true);
    setLocalError(null);
    for (const entry of retryable) {
      updateEntry(entry.id, { status: "uploading", error: null });
      try {
        const success = await onSubmit({ fileName: entry.file.name, contentBase64: await fileBase64(entry.file) });
        updateEntry(entry.id, { status: success ? "succeeded" : "failed", error: success ? null : ARTICLE_UPLOAD_DOCK_COPY.TRANSFER_FAILED });
      } catch (error) {
        updateEntry(entry.id, { status: "failed", error: error instanceof Error ? error.message : ARTICLE_UPLOAD_DOCK_COPY.FILE_READ_FAILED });
      }
    }
    setProcessing(false);
  }

  return (
    <section
      role="region"
      aria-label={ARTICLE_UPLOAD_DOCK_COPY.DOCK_ARIA}
      className={`fixed bottom-4 z-docked overflow-hidden rounded-xl border bg-surface-card/95 shadow-card backdrop-blur-xl transition-colors ${dragging ? "border-cyan-9" : "border-border-thin"}`}
      style={{ left: bounds.left, right: bounds.right }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
    >
      {entries.length > 0 && <div className="flex max-h-16 gap-2 overflow-x-auto border-b border-border-thin px-3 py-2">{entries.map((entry) => (
        <div key={entry.id} className="flex min-w-52 max-w-72 shrink-0 items-center gap-2 border border-border-thin bg-surface-root px-2 py-1.5">
          {entry.status === "uploading" ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-status-loading" /> : entry.status === "succeeded" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-status-fact" /> : entry.status === "failed" ? <AlertCircle className="h-4 w-4 shrink-0 text-status-error" /> : <FileText className="h-4 w-4 shrink-0 text-text-hint" />}
          <div className="min-w-0 flex-1"><p className="truncate text-xs text-text-main" title={entry.file.name}>{entry.file.name}</p><p className={`truncate text-kg-xs ${entry.status === "failed" ? "text-status-error" : "text-text-hint"}`}>{entry.error || `${Math.ceil(entry.file.size / 1024)} KiB · ${entry.status === "succeeded" ? ARTICLE_UPLOAD_DOCK_COPY.ENTRY_SUCCEEDED : entry.status === "uploading" ? ARTICLE_UPLOAD_DOCK_COPY.ENTRY_UPLOADING : ARTICLE_UPLOAD_DOCK_COPY.ENTRY_QUEUED}`}</p></div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={entry.status === "uploading"} title={uploadRemoveEntryLabel(entry.file.name)} aria-label={uploadRemoveEntryLabel(entry.file.name)} onClick={() => setEntries((current) => current.filter((candidate) => candidate.id !== entry.id))}><X className="h-4 w-4" /></Button>
        </div>
      ))}</div>}
      <div className="flex min-h-14 items-center gap-3 px-3 py-2">
        <Button type="button" variant="outline" size="icon" title={ARTICLE_UPLOAD_DOCK_COPY.PICK_FILES} aria-label={ARTICLE_UPLOAD_DOCK_COPY.PICK_FILES} disabled={processing} onClick={() => inputRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
        <input ref={inputRef} className="hidden" type="file" multiple accept={ACCEPT_ATTRIBUTE} aria-label={ARTICLE_UPLOAD_DOCK_COPY.PICK_INPUT_ARIA} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
        <div className="min-w-0 flex-1"><p className="truncate text-sm text-text-sub">{entries.length > 0 ? uploadQueueSummary(retryable.length, succeededCount, entries.length) : ARTICLE_UPLOAD_DOCK_COPY.PICK_PROMPT}</p><p className="hidden truncate text-xs text-text-hint sm:block">{ARTICLE_UPLOAD_DOCK_COPY.TARGET_HINT}</p></div>
        {/* N=0 时降为次要禁用样式（灰描边），N>0 时主色——纯样式条件，逻辑不动 */}
        <Button type="button" variant={retryable.length > 0 ? "default" : "outline"} disabled={retryable.length === 0 || processing || submitting} title={uploadSubmitLabel(retryable.length)} aria-label={uploadSubmitLabel(retryable.length)} onClick={() => void submit()}><Send className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">{uploadSubmitShortLabel(retryable.length)}</span></Button>
      </div>
      {localError && <p role="alert" className="border-t border-red-6 px-3 py-1.5 text-xs text-status-error">{localError}</p>}
    </section>
  );
}
