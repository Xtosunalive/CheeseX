// Component: VocabularyProfileSection（ADR-007 波2 · SPEC-007 §3.3：词表画像区——Steward Queue 词表类）
// @responsible: 呈现五维度（layer/category/subdomain/module/tag）使用计数+阶段徽章（Seed/Growing/Verified）
//               +死词标记 +来源徽章（Grown=经发现通道晋升 / Blueprint=蓝图声明，波5 方案B）；
//               阈值旋钮（verifiedThreshold 查询参数透传——2026-10-08 22:06 Master 裁决的页面配置项）。
//               纯展示+重取，无写操作（prune/升格按钮属后波）。
// @inputs: discovery 响应 vocabularyProfile + onThresholdChange（触发 ?verifiedThreshold=N 重取）
// @outputs: 词表画像区块组件
// @context: SPEC-007 §3.3；样式沿用 EntityGrowthCards 卡片先例；类型从 openapi 契约投影（单源）。
import type { DiscoveryResponse } from "./schema-manager-types";
import { VOCAB_PROFILE_COPY } from "./schema-manager-copy";

type Profile = NonNullable<DiscoveryResponse["vocabularyProfile"]>;
type DimensionKey = keyof Profile["dimensions"];
type Word = Profile["dimensions"][DimensionKey]["words"][number];

const DIMENSIONS: Array<{ key: DimensionKey; label: string }> = [
  { key: "layer", label: VOCAB_PROFILE_COPY.DIM_LAYER },
  { key: "category", label: VOCAB_PROFILE_COPY.DIM_CATEGORY },
  { key: "subdomain", label: VOCAB_PROFILE_COPY.DIM_SUBDOMAIN },
  { key: "module", label: VOCAB_PROFILE_COPY.DIM_MODULE },
  { key: "tag", label: VOCAB_PROFILE_COPY.DIM_TAG },
];

const STAGE_BADGE: Record<Word["stage"], { label: string; cls: string }> = {
  seed: { label: VOCAB_PROFILE_COPY.STAGE_SEED, cls: "bg-surface-card text-text-hint" },
  growing: { label: VOCAB_PROFILE_COPY.STAGE_GROWING, cls: "bg-status-inferred/20 text-status-inferred" },
  verified: { label: VOCAB_PROFILE_COPY.STAGE_VERIFIED, cls: "bg-status-fact-3 text-status-fact" },
};

// 波5 方案B：origin=来源血缘（grown=经发现通道晋升 / blueprint=蓝图声明·默认）。
// 只标注不删——蓝图规划词本身不劣，区分即可，删属内容裁定区。
const ORIGIN_BADGE: Record<NonNullable<Word["origin"]>, { label: string; cls: string; hint: string }> = {
  grown: { label: VOCAB_PROFILE_COPY.ORIGIN_GROWN, cls: "bg-status-fact-3 text-status-fact", hint: VOCAB_PROFILE_COPY.ORIGIN_GROWN_HINT },
  blueprint: { label: VOCAB_PROFILE_COPY.ORIGIN_BLUEPRINT, cls: "bg-surface-card text-text-hint/80", hint: VOCAB_PROFILE_COPY.ORIGIN_BLUEPRINT_HINT },
};

interface Props {
  profile: Profile;
  /** 阈值旋钮变更 → 宿主重取 discovery（?verifiedThreshold=N） */
  onThresholdChange: (threshold: number) => void;
}

export function VocabularyProfileSection({ profile, onThresholdChange }: Props) {
  const threshold = profile.summary.verifiedThreshold;
  return <div className="space-y-4" data-testid="vocabulary-profile-section">
    <section className="rounded-lg ring-1 ring-border-thin bg-surface-card/60 p-3" data-testid="vocabulary-profile-header">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{VOCAB_PROFILE_COPY.HEADER}</h3>
        <span className="text-xs text-text-hint">
          {VOCAB_PROFILE_COPY.SUMMARY_TOTAL_PREFIX}{profile.summary.totalWords}{VOCAB_PROFILE_COPY.SUMMARY_TOTAL_MIDDLE}{profile.summary.totalDead}{VOCAB_PROFILE_COPY.SUMMARY_WILD_PREFIX}{Object.values(profile.summary.dimensions as Record<string, { total: number; wild?: number }>).reduce((n, d) => n + (d.wild ?? 0), 0)}
          {profile.summary.totalGrown ? <span className="ml-2 text-status-fact-11">{VOCAB_PROFILE_COPY.SUMMARY_GROWN_PREFIX}{profile.summary.totalGrown}</span> : null}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs text-text-hint" title={VOCAB_PROFILE_COPY.THRESHOLD_TITLE}>
          {VOCAB_PROFILE_COPY.THRESHOLD_LABEL}
          <input
            type="number"
            min={1}
            max={99}
            value={threshold}
            data-testid="verified-threshold-input"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 99) onThresholdChange(n);
            }}
            className="w-16 rounded-lg ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main"
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-text-hint">{VOCAB_PROFILE_COPY.STAGE_RULE_NOTE(threshold)}</p>
    </section>

    {DIMENSIONS.map(({ key, label }) => {
      const dim = profile.dimensions[key];
      const s = (profile.summary.dimensions as Record<string, { total: number; seed: number; growing: number; verified: number; grown?: number; unlabeled?: number } | undefined>)[key];
      if (!s || s.total === 0) return null;
      return <section key={key} className="space-y-2" data-testid={`vocabulary-dim-${key}`}>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">
          {label} · Seed {s.seed} / Growing {s.growing} / Verified {s.verified}
          {typeof s.unlabeled === "number" && s.unlabeled > 0 && <span className="ml-2 text-status-inferred/80">{VOCAB_PROFILE_COPY.DIM_UNLABELED_PREFIX}{s.unlabeled}</span>}
          {s.grown ? <span className="ml-2 text-status-fact-11">{VOCAB_PROFILE_COPY.DIM_GROWN_PREFIX}{s.grown}</span> : null}
          {dim.deadWords.length > 0 && <span className="ml-2 text-text-hint/80">{VOCAB_PROFILE_COPY.DIM_DEAD_PREFIX}{dim.deadWords.length}</span>}
        </h3>
        <div className="flex flex-wrap gap-2">
          {dim.words.map((w) => <div
            key={w.word}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ${w.usageCount === 0 ? "ring-border-thin bg-transparent opacity-70" : "ring-border-thin bg-surface-card/60"}`}
            data-stage={w.stage}
            data-origin={w.origin ?? "blueprint"}
            title={`${ORIGIN_BADGE[w.origin ?? "blueprint"].hint}${w.usageCount === 0 ? VOCAB_PROFILE_COPY.WORD_HINT_DEAD : `${VOCAB_PROFILE_COPY.WORD_HINT_USAGE_PREFIX}${w.usageCount}${VOCAB_PROFILE_COPY.WORD_HINT_USAGE_SUFFIX}`}`}
          >
            <code className="text-xs text-text-main">{w.word}</code>
            {"label" in w && w.label ? <span className="text-[10px] text-text-hint">{w.label}</span> : null}
            <span className="text-[10px] text-text-hint">{w.usageCount}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STAGE_BADGE[w.stage].cls}`}>{STAGE_BADGE[w.stage].label}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${ORIGIN_BADGE[w.origin ?? "blueprint"].cls}`}>{ORIGIN_BADGE[w.origin ?? "blueprint"].label}</span>
            {w.usageCount === 0 && <span className="text-[10px] text-text-hint">dead</span>}
          </div>)}
        </div>
      </section>;
    })}
  </div>;
}
