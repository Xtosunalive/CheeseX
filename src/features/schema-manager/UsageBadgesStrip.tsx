// Component: UsageBadgesStrip（§3.3.1 实施项②：B 域结构编辑器的只读使用徽章——治"编辑是盲的"）
// @responsible: 在 domains/layers 等结构编辑器顶部呈现该维度词表健康概览
//               （Seed/Growing/Verified 计数+死词数），数据消费 discovery 词表画像（波2 既有）。
// @inputs: discovery 响应 vocabularyProfile.dimensions[dimension]
// @outputs: 一行徽章条（无数据静默 null——画像未加载不阻塞编辑）
// @context: 设计文档 §3.3.1（2026-10-09 勘误版）——B 域加只读使用徽章，编辑权不动（手编=正确形态）。
import { useEffect } from "react";
import { USAGE_BADGES_COPY } from "./schema-manager-copy";
import { useSchemaManagerStore } from "./schema-manager-store";
import type { DiscoveryResponse } from "./schema-manager-types";

type Profile = NonNullable<DiscoveryResponse["vocabularyProfile"]>;
type DimensionKey = keyof Profile["dimensions"];
type Dim = Profile["dimensions"]["layer"]; // 五维度同构（契约保证同构）

interface Props {
  dimension: DimensionKey;
  label: string;
}

export function UsageBadgesStrip({ dimension, label }: Props) {
  const store = useSchemaManagerStore();
  // 徽章数据来自 discovery 词表画像；未加载过则轻触发一次（只读，不阻塞编辑）
  useEffect(() => { if (!store.discovery && store.discoveryRequest.status !== "loading") void store.loadDiscovery(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dims = store.discovery?.vocabularyProfile?.dimensions as Record<DimensionKey, Dim> | undefined;
  const dim = dims?.[dimension];
  if (!dim) return null; // 画像未加载（旧响应/异常）静默跳过——增量不破坏
  const summary: Record<"seed" | "growing" | "verified", number> = { seed: 0, growing: 0, verified: 0 };
  dim.words.forEach((w: { stage: "seed" | "growing" | "verified" }) => { summary[w.stage] += 1; });
  return <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg ring-1 ring-border-thin bg-surface-card/40 px-3 py-2 text-xs text-text-hint" data-testid={`usage-badges-${dimension}`}>
    <span className="font-medium text-text-main">{label}{USAGE_BADGES_COPY.OVERVIEW_SUFFIX}</span>
    <span className="rounded bg-surface-card px-1.5 py-0.5">Seed {summary.seed}</span>
    <span className="rounded bg-status-inferred/20 px-1.5 py-0.5 text-status-inferred">Growing {summary.growing}</span>
    <span className="rounded bg-status-fact-3 px-1.5 py-0.5 text-status-fact">Verified {summary.verified}</span>
    {dim.deadWords.length > 0 && <span className="rounded bg-status-warn-3 px-1.5 py-0.5 text-status-warn" title={USAGE_BADGES_COPY.DEAD_WORDS_TITLE}>{`${USAGE_BADGES_COPY.DEAD_WORDS_PREFIX}${dim.deadWords.length}`}</span>}
    <span className="ml-auto">{USAGE_BADGES_COPY.DATA_SOURCE_NOTE}</span>
  </div>;
}
