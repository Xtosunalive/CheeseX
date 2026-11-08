// Component: RulesChannelSection（ADR-007 波3 · SPEC-008 §3.3：规则通道——Steward Queue 规则类+台账）
// @responsible: ①规则候选信号卡（issueKind×ruleId 聚类，count≥2）+「立为规则」（携信号预填 propose）
//               ②规则台账（现有规则清单只读；存量=sealed 标注「切换须呈对账」——治理纪律，先例波4 F06；新立规则可退役）。
// @inputs: discovery.ruleCandidates + GET/POST /api/rules/lifecycle
// @outputs: 规则通道区块组件
// @context: SPEC-008 §3.3；术语（设计 §10）：Policy registry / enforcement mode。
//           波3 红线：存量 severity/gates 只读——UI 侧不提供任何切换入口（后端 409 双保险）。
import { useEffect, useState } from "react";
import { TERM } from "@/constants/term-const";
import type { DiscoveryResponse } from "./schema-manager-types";
import { apiFetchEnvelope } from "@/lib/api";
import { navigate } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { ISSUE_KIND_LABELS } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { RULES_CHANNEL_COPY, RULES_CHECK_LABELS, RULES_GATE_LABELS, RULES_FAMILIES } from "./schema-manager-copy";

/** 违规计数聚合的最小面（AnomalyIssue 里与规则相关的两处——evidence[0].ruleId / ruleRevision） */
type AnomalyIssueForCount = { evidence?: Array<{ ruleId?: string | null }>; expectedRevisions?: { ruleRevision?: string | null } | null };

type RuleCandidates = NonNullable<DiscoveryResponse["ruleCandidates"]>;
type Signal = NonNullable<RuleCandidates["signals"]>[number];

type LedgerEntry = {
  id: string;
  severity: "error" | "warn" | "info";
  gates: string[];
  field: string | null;
  check: string | null;
  message: string | null;
  retired?: boolean;
  indexed?: boolean;
  sealed: boolean;
};

// ── 人话卡目录（2026-10-27 降档批）：check/gate token → 中文——闭集单源 RULES_CHECK/RULES_GATE_LABELS（WP-149 搬迁）──
const gateLabel = (g: string) => RULES_GATE_LABELS[g] ?? g;
const checkLabel = (c: string | null) => (c ? RULES_CHECK_LABELS[c] ?? c : null);

const SEVERITY_BADGE: Record<LedgerEntry["severity"], string> = {
  error: "bg-status-error-3 text-status-error",
  warn: "bg-status-inferred/20 text-status-inferred",
  info: "bg-surface-card text-text-hint",
};
// severity→徽章文案：查表渲染（消费契约值本身），禁字面量比较——语义判断归后端
// entity-compliance-severity.cjs 单源（eslint seq182/seq201 两条拦截形状，本行原违例）。
const SEVERITY_LABEL: Record<LedgerEntry["severity"], string> = {
  error: "Enforce",
  warn: "Advise",
  info: "Retired",
};

// 规则族：闭集单源 RULES_FAMILIES（WP-149 搬迁，分组纯派生——与问题台 issueKind 族同构）
function familyOf(id: string) {
  return RULES_FAMILIES.find((f) => id.startsWith(f.prefix)) ?? null;
}

interface Props {
  candidates: RuleCandidates | undefined;
  /** 波3b（Master 02:57 令）：信号门槛旋钮变更 → 宿主重取 discovery（?minCount=N） */
  onMinCountChange: (minCount: number) => void;
}

export function RulesChannelSection({ candidates, onMinCountChange }: Props) {
  const [ledger, setLedger] = useState<{ rules: LedgerEntry[]; revision: string } | null>(null);
  const [violationCounts, setViolationCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, setProposing] = useState<Signal | null>(null); // proposing 未读（波3遗留）——族分组后仅 set 使用

  const loadLedger = async () => {
    try {
      const env = await apiFetchEnvelope<{ rules: LedgerEntry[]; revision: string }>("/api/rules/lifecycle");
      if (!env.ok || !env.data) throw new Error(env.error ?? RULES_CHANNEL_COPY.LEDGER_LOAD_FAILED);
      setLedger(env.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : RULES_CHANNEL_COPY.LEDGER_LOAD_FAILED);
    }
  };
  useEffect(() => { void loadLedger(); }, []);
  // 违规计数（2026-10-27 补批）：问题台账现算聚合 byRuleId——ruleId 住 evidence[0].ruleId/ruleRevision
  useEffect(() => {
    let cancelled = false;
    void apiFetchEnvelope<{ issues: AnomalyIssueForCount[] }>("/api/anomalies").then((env) => {
      if (cancelled || !env.ok || !env.data) return; // 失败静默：计数缺省 0（不阻断台账）
      const counts: Record<string, number> = {};
      for (const issue of env.data.issues ?? []) {
        const ruleId = issue.evidence?.[0]?.ruleId ?? issue.expectedRevisions?.ruleRevision ?? null;
        if (typeof ruleId === "string" && ruleId) counts[ruleId] = (counts[ruleId] ?? 0) + 1;
      }
      setViolationCounts(counts);
    }).catch(() => { /* 静默：计数面独立于台账面 */ });
    return () => { cancelled = true; };
  }, []);

  const proposeFromSignal = async (signal: Signal) => {
    setBusyId(signal.key ?? null);
    try {
      // PR-201：服务端缺基线即拒（400 SCHEMA_REVISION_REQUIRED）——台账未载时不发写请求，先补读
      if (!ledger?.revision) {
        setError(RULES_CHANNEL_COPY.LEDGER_NOT_READY);
        await loadLedger();
        return;
      }
      const env = await apiFetchEnvelope<unknown>("/api/rules/lifecycle", {
        method: "POST",
        body: JSON.stringify({
          action: "propose",
          revision: ledger.revision,
          check: "enum-ref",
          field: (signal.ruleId ?? "").startsWith("document-") ? "module" : (signal.ruleId ?? "").toLowerCase(),
          message: RULES_CHANNEL_COPY.CANDIDATE_MESSAGE(signal.key ?? "?", signal.count ?? 0),
          issueKind: signal.issueKind,
        }),
      });
      if (!env.ok) throw new Error(env.error ?? RULES_CHANNEL_COPY.PROPOSE_FAILED);
      setProposing(null);
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : RULES_CHANNEL_COPY.PROPOSE_FAILED);
    } finally {
      setBusyId(null);
    }
  };

  const retireRule = async (id: string) => {
    setBusyId(id);
    try {
      // PR-201：同 propose——缺基线不发写请求
      if (!ledger?.revision) {
        setError(RULES_CHANNEL_COPY.LEDGER_NOT_READY);
        await loadLedger();
        return;
      }
      const env = await apiFetchEnvelope<unknown>("/api/rules/lifecycle", {
        method: "POST",
        body: JSON.stringify({ action: "retire", id, revision: ledger.revision }),
      });
      if (!env.ok) throw new Error(env.error ?? RULES_CHANNEL_COPY.RETIRE_FAILED);
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : RULES_CHANNEL_COPY.RETIRE_FAILED);
    } finally {
      setBusyId(null);
    }
  };

  const signals = (candidates?.signals ?? []) as Signal[];
  return <div className="space-y-4" data-testid="rules-channel-section">
    {/* 有信号源数据即渲染本区（candidates 缺省才隐藏）——门槛调高全滤时旋钮必须仍在：
        03:40 Master 报障「调 3 后功能消失」根因=signals.length>0 条件把含旋钮的整块藏了（死锁） */}
    {candidates && <section className="space-y-2" data-testid="rule-candidates">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{RULES_CHANNEL_COPY.SIGNALS_HEADER} ({signals.length})</h3>
        <label className="ml-auto flex items-center gap-2 text-xs text-text-hint" title={RULES_CHANNEL_COPY.THRESHOLD_TITLE}>
          {RULES_CHANNEL_COPY.THRESHOLD_LABEL}
          <input
            type="number"
            min={1}
            max={99}
            value={candidates?.minCount ?? 2}
            data-testid="rule-min-count-input"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 99) onMinCountChange(n);
            }}
            className="w-16 rounded-lg ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main"
          />
        </label>
      </div>
      <p className="text-xs text-text-hint">{RULES_CHANNEL_COPY.SIGNALS_INTRO_PREFIX}{candidates?.minCount ?? 2}{RULES_CHANNEL_COPY.SIGNALS_INTRO_MIDDLE}</p>
      {signals.length === 0 && <p className="text-xs text-text-hint" data-testid="rule-candidates-empty">{RULES_CHANNEL_COPY.EMPTY_SIGNALS_PREFIX}{candidates.totalIssues}{RULES_CHANNEL_COPY.EMPTY_SIGNALS_MIDDLE}{candidates.clusteredIssues}{RULES_CHANNEL_COPY.EMPTY_SIGNALS_SUFFIX}</p>}
      <div className="flex flex-wrap gap-2">
        {signals.map((s) => <div key={s.key} className="rounded-lg ring-1 ring-border-thin bg-surface-card/60 px-2.5 py-1.5">
          {/* 人话主文案（2026-10-27 补批）：样本问题的违规文案=这条信号违反了什么——密文 ruleId 降为次行注记 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-main">{s.sampleTitle ?? `${ISSUE_KIND_LABELS[s.issueKind as keyof typeof ISSUE_KIND_LABELS] ?? s.issueKind}（${s.ruleId}）`}</span>
            <span className="rounded bg-status-warn-3 px-1.5 py-0.5 text-[10px] font-medium text-status-warn">{s.count}×</span>
            <button
              disabled={busyId === s.key}
              onClick={() => void proposeFromSignal(s)}
              className="ml-auto rounded-lg bg-accent-base px-2 py-1 text-[10px] text-accent-contrast hover:bg-accent-base/90 disabled:opacity-40"
              title={RULES_CHANNEL_COPY.PROPOSE_TITLE((s.sampleIssueIds ?? []).slice(0, 2).join(", "))}
            >{busyId === s.key ? RULES_CHANNEL_COPY.PROPOSING : RULES_CHANNEL_COPY.PROPOSE_ACTION}</button>
          </div>
          <p className="mt-0.5 text-[10px] text-text-hint">{ISSUE_KIND_LABELS[s.issueKind as keyof typeof ISSUE_KIND_LABELS] ?? s.issueKind} · {RULES_CHANNEL_COPY.SIGNAL_META_RULE_PREFIX}{s.ruleId} · {s.count}{RULES_CHANNEL_COPY.SIGNAL_META_COUNT_PREFIX}{candidates?.minCount ?? 2}{RULES_CHANNEL_COPY.SIGNAL_META_SUFFIX}</p>
        </div>)}
      </div>
    </section>}

    <section className="space-y-2" data-testid="rules-ledger">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{RULES_CHANNEL_COPY.LEDGER_HEADER}{ledger ? ` (${ledger.rules.length})` : ""}</h3>
      {error && <p className="text-xs text-status-error" role="alert">{error}</p>}
      {!ledger && !error && <p className="text-xs text-text-hint">{TERM.LOADING}</p>}
      {ledger && <div className="space-y-3" data-testid="rules-ledger-groups">
        {RULES_FAMILIES.filter((f) => ledger.rules.some((r) => familyOf(r.id)?.prefix === f.prefix)).map((f) => {
          const famRules = ledger.rules.filter((r) => familyOf(r.id)?.prefix === f.prefix);
          return <details key={f.prefix} className="rounded-lg ring-1 ring-border-thin bg-surface-card/40 p-2" open={famRules.some((r) => !r.retired)} data-testid={`rules-family-${f.prefix}`}>
            <summary className="cursor-pointer text-xs font-medium text-text-main">{f.name}（{famRules.length}）<span className="ml-2 font-normal text-text-hint">{f.desc}</span></summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {famRules.map((r) => <div key={r.id} className={`rounded-lg px-3 py-2 ring-1 ${r.retired ? "ring-border-thin opacity-50" : "ring-border-thin bg-surface-card/60"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs text-text-main">{r.id}</code>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[r.severity]}`}>{SEVERITY_LABEL[r.severity]}</span>
                  {r.field && <span className="text-[10px] text-text-hint">{r.field}</span>}
                  {r.sealed && <span className="text-[10px] text-text-hint" title={RULES_CHANNEL_COPY.SEALED_TITLE}>{RULES_CHANNEL_COPY.SEALED_LABEL}</span>}
                  {!r.retired && !r.sealed && <button
                    disabled={busyId === r.id}
                    onClick={() => void retireRule(r.id)}
                    className="ml-auto rounded px-2 py-0.5 text-[10px] text-text-sub ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40"
                  >{busyId === r.id ? RULES_CHANNEL_COPY.RETIRING : RULES_CHANNEL_COPY.RETIRE_ACTION}</button>}
                </div>
                {/* 人话卡主体：违规文案（这条规则触发时你真实看到的报错）+ 检查类型中文 */}
                {r.message && <p className="mt-1 text-xs text-text-main">{r.message}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-hint">
                  {checkLabel(r.check) && <span>{RULES_CHANNEL_COPY.CHECK_PREFIX}{checkLabel(r.check)}</span>}
                  {r.gates.length > 0
                    ? <span>{RULES_CHANNEL_COPY.GATES_PREFIX}{r.gates.map(gateLabel).join(" · ")}</span>
                    : !r.retired && <span className="text-status-warn" title={RULES_CHANNEL_COPY.NO_GATE_TITLE}>{RULES_CHANNEL_COPY.NO_GATE_LABEL}</span>}
                  {(violationCounts[r.id] ?? 0) > 0
                    ? <Button type="button" variant="ghost" size="sm" onClick={() => navigate("anomalies")} className="h-auto rounded bg-status-warn-3 px-1.5 py-0.5 text-[10px] font-medium text-status-warn hover:bg-status-warn-4" title={RULES_CHANNEL_COPY.VIOLATIONS_TITLE}>{RULES_CHANNEL_COPY.VIOLATIONS_PREFIX}{violationCounts[r.id]}</Button>
                    : <span title={RULES_CHANNEL_COPY.NO_VIOLATIONS_TITLE}>{RULES_CHANNEL_COPY.NO_VIOLATIONS_LABEL}</span>}
                </div>
              </div>)}
            </div>
          </details>;
        })}
        {(() => { const unknown = ledger.rules.filter((r) => !familyOf(r.id)); return unknown.length > 0 ? <details className="rounded-lg ring-1 ring-border-thin bg-surface-card/40 p-2" data-testid="rules-family-unknown">
          <summary className="cursor-pointer text-xs font-medium text-text-main">{RULES_CHANNEL_COPY.UNKNOWN_FAMILY}（{unknown.length}）<span className="ml-2 font-normal text-text-hint">{RULES_CHANNEL_COPY.UNKNOWN_FAMILY_HINT}</span></summary>
          <div className="mt-2 flex flex-wrap gap-2">{unknown.map((r) => <code key={r.id} className="text-xs text-text-hint">{r.id}</code>)}</div>
        </details> : null; })()}
      </div>}
      <p className="text-xs text-text-hint">{RULES_CHANNEL_COPY.FOOTER}</p>
    </section>
  </div>;
}
