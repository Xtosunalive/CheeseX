// ReleaseMintCard — 全库定版发布卡（2026-11-15 运行概览退役批自 dashboard 页迁入）。
// WP-017 独立发布入口：人工触发全库定版（不绑文章审批）。铸版语义与文章审批发布同源；
// 新库/无文章场景由此获得首个发布（发布前消费面 404 NO_CURRENT_RELEASE，发布后按 SPEC-029 呈空态或内容）。
// 发布永不自动（pipeline-due-service D6 人 gate）——本卡是全站唯一的全库铸版入口。
import { useState } from "react";
import { apiFetchEnvelope } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { RELEASE_MINT_COPY, releaseMintPublished, releaseMintRequestIncomplete } from "../data-dashboard-copy";

// 信封出口消费（ADR-019 §二）：POST /api/releases/mint 走仓内 api 层信封解析（trace_id 并入错误文案——同页惯例）
async function mintCurrentRelease(): Promise<{ releaseId: string; artifactCount: number }> {
  const envelope = await apiFetchEnvelope<{ releaseId: string; artifactCount: number }>("/api/releases/mint", { method: "POST" });
  if (!envelope.ok || !envelope.data) {
    throw new Error(envelope.error || releaseMintRequestIncomplete(envelope.status));
  }
  return envelope.data;
}

export function ReleaseMintCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // PR-321/WP-178：两段式确认——单击先出后果说明，确认才铸版（铸版＋切 current 指针＋触发全量重建属高危动作）
  const [confirming, setConfirming] = useState(false);
  const onPublish = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const minted = await mintCurrentRelease();
      setResult(releaseMintPublished(minted.artifactCount)); // WP-035：截断哈希不上屏（版本号在版本分析页可查）
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <div className="rounded-lg ring-1 ring-border-thin bg-surface-root px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-sub">{RELEASE_MINT_COPY.DESCRIPTION}</span>
        {!confirming && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
            {busy ? RELEASE_MINT_COPY.PUBLISHING : RELEASE_MINT_COPY.PUBLISH}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-1.5 flex items-center gap-1.5" data-testid="publish-confirm">
          <Button type="button" size="sm" onClick={onPublish} disabled={busy}>{RELEASE_MINT_COPY.CONFIRM_YES}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>{RELEASE_MINT_COPY.CONFIRM_NO}</Button>
        </div>
      )}
      {result && <div className="mt-1 font-mono text-xs text-grass-11" data-testid="publish-result">{result}</div>}
      {error && <div className="mt-1 font-mono text-xs text-status-warn" data-testid="publish-error">{error}</div>}
    </div>
  );
}
