import { useMemo } from "react";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { displayTitle, issueKindLabel, ANOMALY_LIST_COPY, ANOMALY_OWNER_UNASSIGNED, anomalyRowAriaLabel, anomalyRowSelectAriaLabel } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { Avatar } from "@/components/ui/avatar";

/**
 * Linear 风行列表（task/anomaly-workbench-linear-shell WP2）。
 * 44px 行/8px 圆角/命名网格列：勾选·阻断·ID·标题·类型+来源芯片·处理人·检出时间。
 * 处置模式不在行内出图标（Master 裁）：分组页签＋peek 面板已承载，行内不重复。
 * 甲案（Master 14:41 裁）：布局密度照原型，色彩全走 L1 语义 token（零裸色值）。
 * 阻断图标三档（C.2 派生规则）：publish_graph→高三横 / 全局诊断→中 / 无→空心。
 * 勾选粒度=文章组 key（与 groupIssuesByArticle 同规则本地提键——组键提取未导出，不复制
 * 整套聚合逻辑，只复刻 key 规则三行）。
 *
 * W3（表格收敛 §12.1）：本件对 D12「div→语义表」豁免并记录——行即 role=button 的
 * Linear 壳交互契约（单击选中/双击与 Enter 开 peek、原生 input 勾选）是已验收裁决，
 * 且被 anomaly-workbench-view/usability/candidate-decision-form 三处测试以
 * 「问题行 …」角色断言钉死；语义表的行角色与其互斥。单元格件仍随波收敛：
 * 处理人头像走 ui/avatar（D10）；类型家族色芯片（含 cat 色，StatusDot 语气模型
 * 不覆盖）与阻断三横条为甲案专属形态，保留。
 */

function actionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 与 anomaly-article-groups extractSourcePath 同构的提键（candidate > sourcePath > article > diagnostic） */
function articleKeyOf(issue: AnomalyIssue): string {
  const action = actionRecord(issue.proposedAction);
  const candidateId = issue.relationCandidate?.candidateId;
  if (candidateId) return `candidate:${candidateId}`;
  const paths = [...new Set((issue.evidence || [])
    .map((item) => {
      const evidence = actionRecord(item);
      const path = evidence.path || evidence.sourcePath;
      return typeof path === "string" ? path.replace(/\\/g, "/").trim() : "";
    })
    .filter(Boolean))];
  const sourcePath = paths.length === 1 ? paths[0] : (typeof action.sourceKey === "string" ? action.sourceKey.replace(/\\/g, "/").trim() : "");
  const isSystem = sourcePath.startsWith(".ledger/") || sourcePath === "";
  if (sourcePath && !isSystem) return sourcePath;
  const articleId = typeof action.articleId === "string" && action.articleId.trim() ? action.articleId.trim() : "";
  if (articleId) return `article:${articleId}`;
  return `diagnostic:${issue.issueId}`;
}

/**
 * 类型家族色（整改 4——原型 KIND_COLOR 的 L1 语义映射，甲案等价表）：
 * 软底（色系 10% 透明）+同系文字+色点。来源芯片保持中性灰。
 * 映射：字段族/未识别→status-error；missing_entity→fact 成功系；裁决/映射→紫系；
 * wild_tag→橙系；系统事件→sky 系；血缘/污染→青系；提示/审计→placeholder 灰。
 */
const KIND_FAMILY: Record<AnomalyIssue["issueKind"], { chip: string; dot: string }> = {
  missing_field: { chip: "bg-status-error-2 text-status-error ring-status-error-6", dot: "bg-status-error" },
  version_scope: { chip: "bg-status-error-2 text-status-error ring-status-error-6", dot: "bg-status-error" },
  unrecognized_entity: { chip: "bg-status-error-2 text-status-error ring-status-error-6", dot: "bg-status-error" },
  missing_entity: { chip: "bg-status-fact-2 text-status-fact ring-status-fact-6", dot: "bg-status-fact" },
  relation_conflict: { chip: "bg-purple-2 text-purple-9 ring-purple-6", dot: "bg-purple-9" },
  article_association: { chip: "bg-purple-2 text-purple-9 ring-purple-6", dot: "bg-purple-9" },
  wild_tag: { chip: "bg-orange-2 text-orange-9 ring-orange-6", dot: "bg-orange-9" },
  pipeline_failure: { chip: "bg-sky-2 text-sky-9 ring-sky-6", dot: "bg-sky-9" },
  release_publication_failure: { chip: "bg-sky-2 text-sky-9 ring-sky-6", dot: "bg-sky-9" },
  missing_lineage: { chip: "bg-teal-2 text-teal-9 ring-teal-6", dot: "bg-teal-9" },
  standardization_warning: { chip: "bg-surface-hover text-text-sub ring-border-thin", dot: "bg-text-placeholder" },
  stale_source: { chip: "bg-surface-hover text-text-sub ring-border-thin", dot: "bg-text-placeholder" },
};

/**
 * 阻断三横条阶梯（整改 2——原型 PRIO_ICON 形态）：publish=三条实心 / 全局诊断=两条实心
 * +一条空心 / 无=三条空心。条形与处置模式状态圈（圆形）形成形状区分，title 保留说明。
 */
function BlockBars({ filled }: { filled: 3 | 2 | 0 }) {
  const bar = (solid: boolean, y: string, key: string) => (
    <rect key={key} x="2.6" y={y} width="6" height="2.8" rx="1.4" fill={solid ? "currentColor" : "none"} stroke="currentColor" strokeWidth={solid ? 0 : 1.2} />
  );
  // publish=三条实心；全局诊断=上两条实心+底条空心；无=三条空心（原型 PRIO_ICON 同构）
  const solids = filled === 3 ? [true, true, true] : filled === 2 ? [true, true, false] : [false, false, false];
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      {bar(solids[0], "3.1", "top")}
      {bar(solids[1], "6.6", "mid")}
      {bar(solids[2], "10.1", "bot")}
    </svg>
  );
}

function BlockIcon({ blockedActions }: { blockedActions: AnomalyIssue["blockedActions"] }) {
  if (blockedActions.includes("publish_graph")) {
    return (
      <span className="text-status-error" title={ANOMALY_LIST_COPY.BLOCK_PUBLISH_TITLE}>
        <BlockBars filled={3} />
        <span className="sr-only">{ANOMALY_LIST_COPY.BLOCK_PUBLISH_SR}</span>
      </span>
    );
  }
  if (blockedActions.includes("complete_global_diagnostic")) {
    return (
      <span className="text-status-warn" title={ANOMALY_LIST_COPY.BLOCK_DIAGNOSTIC_TITLE}>
        <BlockBars filled={2} />
        <span className="sr-only">{ANOMALY_LIST_COPY.BLOCK_DIAGNOSTIC_SR}</span>
      </span>
    );
  }
  return (
    <span className="text-text-placeholder" title={ANOMALY_LIST_COPY.BLOCK_NONE_TITLE}>
      <BlockBars filled={0} />
      <span className="sr-only">{ANOMALY_LIST_COPY.BLOCK_NONE_SR}</span>
    </span>
  );
}

function DetectedAt({ createdAt }: { createdAt: string | null | undefined }) {
  if (!createdAt) return <span className="text-kg-xs text-text-hint">—</span>;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return <span className="text-kg-xs text-text-hint">—</span>;
  const label = d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  return (
    <span className="text-kg-xs tabular-nums text-text-hint" title={createdAt}>
      {label}
    </span>
  );
}

type RowProps = {
  issue: AnomalyIssue;
  selected: boolean;
  checked: boolean;
  onSelect: (issueId: string) => void;
  onOpenPeek: (issueId: string) => void;
  onToggleCheck: (articleKey: string, issueId: string) => void;
};

/**
 * 长 ID 短显示（整改 3）：issueId 常含整条路径（entity-知识库/…/F11）——截去中段
 * 只留「头段-…-尾段」可识别形态；完整值由调用方放 title 悬浮。
 */
function shortId(issueId: string): string {
  if (issueId.length <= 24) return issueId;
  return `${issueId.slice(0, 8)}…${issueId.slice(-8)}`;
}

function IssueRow({ issue, selected, checked, onSelect, onOpenPeek, onToggleCheck }: RowProps) {
  const articleKey = articleKeyOf(issue);
  // 整改5：ID 列显示 ANOM-N（账本序号）；无号回退短 issueId；title 悬浮内部完整键
  const idLabel = issue.displaySeq ? `ANOM-${issue.displaySeq}` : shortId(issue.issueId);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={anomalyRowAriaLabel(issue.issueId, issue.title)}
      className={`grid h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-left transition-colors ${
        selected ? "bg-accent-bg ring-1 ring-border-focus" : checked ? "bg-surface-hover" : "hover:bg-surface-hover"
      }`}
      style={{ gridTemplateColumns: "18px 18px 84px minmax(0,1fr) minmax(0,220px) 28px 48px" }}
      onClick={() => onSelect(issue.issueId)}
      onDoubleClick={() => onOpenPeek(issue.issueId)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenPeek(issue.issueId); }}
    >
      <input
        type="checkbox"
        aria-label={anomalyRowSelectAriaLabel(issue.title)}
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleCheck(articleKey, issue.issueId)}
        className="h-3.5 w-3.5 rounded border-border-thin accent-[var(--color-accent-base)]"
      />
      <BlockIcon blockedActions={issue.blockedActions} />
      <span className="truncate font-mono text-kg-xs text-text-hint" title={issue.issueId}>{idLabel}</span>
      <span className="truncate text-xs text-text-main" title={issue.title}>{displayTitle(issue)}</span>
      {/* 整改2：行内只保留问题类型芯片（家族色）；来源/文章信息由侧栏+peek「来源」承载 */}
      <span className="flex min-w-0 items-center gap-1">
        <span className={`flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-kg-xs ring-1 ${KIND_FAMILY[issue.issueKind].chip}`} title={issue.issueKind}>
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${KIND_FAMILY[issue.issueKind].dot}`} aria-hidden />
          <span className="truncate">{issueKindLabel(issue.issueKind)}</span>
        </span>
      </span>
      <Avatar name={issue.owner} size="sm" title={issue.owner ?? ANOMALY_OWNER_UNASSIGNED} />
      <DetectedAt createdAt={issue.createdAt} />
    </div>
  );
}

export type IssueGroupTab = { key: string; name: string; count: number; hint?: string; dot?: string };

type Props = {
  issues: AnomalyIssue[];
  groups: IssueGroupTab[];
  activeGroup: string;
  onGroupChange: (key: string) => void;
  selectedIssueId: string | null;
  checkedArticleKeys: string[];
  checkedIssueIds: string[];
  onSelect: (issueId: string) => void;
  onOpenPeek: (issueId: string) => void;
  onToggleCheck: (articleKey: string, issueId: string) => void;
};

export function AnomalyIssueList({
  issues, groups, activeGroup, onGroupChange,
  selectedIssueId, checkedArticleKeys, checkedIssueIds,
  onSelect, onOpenPeek, onToggleCheck,
}: Props) {
  const checkedKeySet = useMemo(() => new Set(checkedArticleKeys), [checkedArticleKeys]);
  const checkedIssueSet = useMemo(() => new Set(checkedIssueIds), [checkedIssueIds]);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={ANOMALY_LIST_COPY.GROUP_TABS_ARIA}>
        <button
          type="button"
          role="tab"
          aria-selected={activeGroup === "all"}
          onClick={() => onGroupChange("all")}
          className={`border-b px-2 py-1 text-xs transition-colors ${
            activeGroup === "all" ? "border-accent-base text-text-main" : "border-transparent text-text-sub hover:text-text-main"
          }`}
        >
          {ANOMALY_LIST_COPY.GROUP_ALL_TAB} <span className="tabular-nums opacity-70">{issues.length}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={activeGroup === g.key}
            title={g.hint}
            onClick={() => onGroupChange(g.key)}
            className={`flex items-center gap-1.5 border-b px-2 py-1 text-xs transition-colors ${
              activeGroup === g.key ? "border-accent-base text-text-main" : "border-transparent text-text-sub hover:text-text-main"
            }`}
          >
            {g.dot && <span className={`inline-block h-2 w-2 rounded-full ${g.dot}`} aria-hidden />}
            {g.name} <span className={`tabular-nums ${g.count > 0 ? "opacity-70" : "opacity-40"}`}>{g.count}</span>
          </button>
        ))}
      </div>
      {issues.length === 0 ? (
        <div className="grid place-items-center gap-1 py-16 text-center">
          <p className="text-sm text-text-sub">{ANOMALY_LIST_COPY.EMPTY_NO_MATCH}</p>
          <p className="text-xs text-text-hint">{ANOMALY_LIST_COPY.EMPTY_ADJUST_HINT}</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {issues.map((issue) => (
            <IssueRow
              key={issue.issueId}
              issue={issue}
              selected={issue.issueId === selectedIssueId}
              checked={checkedIssueSet.has(issue.issueId) || checkedKeySet.has(articleKeyOf(issue))}
              onSelect={onSelect}
              onOpenPeek={onOpenPeek}
              onToggleCheck={onToggleCheck}
            />
          ))}
        </div>
      )}
    </div>
  );
}
