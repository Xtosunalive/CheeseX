import { useState } from "react";
import { safeNavigateHash } from "@/lib/navigation";
import type { EntityComplianceResult } from "./entity-compliance-types";
import { ComplianceGroupSection } from "./ComplianceGroupSection";
import { ChevronDown, ChevronRight, ExternalLink, Copy, CircleAlert, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { useEntityComplianceStore } from "./entity-compliance-store";
import { repairableFieldIssues } from "./repairable-fields";
import { fieldLabel as resolveFieldLabel } from "@/lib/domain/entity-repair-api";
import { ObsidianLink } from "@/components/obsidian";
// seq211：本卡片的业务叫法一律取术语常量表，不再就地写死。
// 此前徽标写「实体源文档」、标题写「图谱实体」，两个都是术语规范里没有的自造词且互不一致（PR-021）；
// 权威叫法＝TERM.ENTITY「实体」（docs/terminology-spec.md:155）。
import { TERM } from "@/constants/term-const";
import { ENTITY_COMPLIANCE_COPY, EC_CARD_COPY, ecCompleteFieldsAction, ecDiagnosisScoreLine, ecOpenInObsidianAria, ecRepairFieldsAction } from "./entity-compliance-copy";

export function EntityComplianceCard({ entity }: { entity: EntityComplianceResult }) {
  // 计数/分数为契约 optional 字段（后端缺省=0）：?? 0 显式归一，消除 undefined 比较（undefined>=90 恒 false 的假绿分支）
  const blockerCount = entity.blockerCount ?? 0;
  const warningCount = entity.warningCount ?? 0;
  const infoCount = entity.infoCount ?? 0;
  const score = entity.score ?? 0;
  const [open, setOpen] = useState(blockerCount > 0 || warningCount > 0);
  const displayName = entity.title || entity.fileName || TERM.UNNAMED_ARCH_COMPONENT;
  // seq210：「被诊断的是实体还是文章」只有这一个判定口径（sourceType），
  // 复制诊断标题、类型徽标、补齐按钮三处共用，避免各判各的。
  const isArticle = entity.sourceType === "standard-article";

  const copyDiagnosis = () => {
    // 标准文章不能用「实体」开头——复制出来的诊断书标题必须与被诊断对象一致。
    // seq211：两个分支都从术语常量表取，杜绝再冒出自造词。
    const lines: string[] = [`## ${isArticle ? TERM.STANDARD_ARTICLE : TERM.ENTITY}：${displayName}`];
    lines.push(ecDiagnosisScoreLine(score));
    lines.push("");
    for (const g of entity.groups || []) {
      const bad = g.checks?.filter((c) => !c.passed) || [];
      if (!bad.length) continue;
      lines.push(`### ${g.label}`);
      for (const c of bad) {
        // seq210：后端 EDIT 分支下发的 label 是英文键（= field），复制出来会中英混排，须与页面一致取中文。
        // 只在「下发值就是字段名本身」时才派生——文章域后端已下发中文（label !== field），保持原样，
        // 避免把文章的「标题」误换成实体域的「实体名称」（title 是同名不同义键）。
        const checkLabel = c.field && c.label === c.field ? resolveFieldLabel(c.field) : c.label || TERM.FIELD_LABEL_FALLBACK;
        lines.push(`- ${checkLabel}: ${c.message}`); // WP-035：剪贴板导出去规则编号（编号对用户无行动价值）
        if (c.hint) lines.push(`  → ${c.hint}`);
      }
      lines.push("");
    }
    navigator.clipboard.writeText(lines.join("\n"));
  };

  const has = { b: blockerCount > 0, w: warningCount > 0, i: infoCount > 0 };
  const openRepair = useEntityComplianceStore((s) => s.openRepair);
  const openCreate = useEntityComplianceStore((s) => s.openCreate);
  // seq205 计数单源 + seq206 徽标口径：徽标只数未通过（真需修复）的字段，全通过隐藏按钮；
  // 抽屉仍渲染全部可编辑字段（编辑面不缩水）。「创建并补齐」是缺失实体入口，不受 failedCount 门控。
  const repairReport = repairableFieldIssues(entity);
  const missingSource = entity.sourceExists === false;
  const repairable = missingSource || repairReport.failedCount > 0;

  return (
    <div className="rounded-lg ring-1 ring-border-thin bg-surface-card/40">
      <div className="flex items-center gap-2 px-4 py-3 hover:bg-surface-card/60">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? TERM.COLLAPSE_ACTION : TERM.EXPAND_ACTION} ${displayName}`}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 text-text-hint shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-hint shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-main truncate">{displayName}</span>
              {/* seq211：徽标是「类型徽标」，与「标准文章」并列分的是对象类型（文章 vs 实体），
                  不是文件类型——文件信息由下一行 entity.fileName 承载，故取 TERM.ENTITY 而非「图谱引用文档」。 */}
              <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-kg-xs ${isArticle ? "bg-blue-2 text-blue-10" : "bg-accent-bg text-accent-base"}`}>{isArticle ? TERM.STANDARD_ARTICLE : TERM.ENTITY}</span>
              {has.b && <CircleAlert className="h-4 w-4 text-status-error shrink-0" />}
              {!has.b && has.w && <AlertTriangle className="h-4 w-4 text-status-warn shrink-0" />}
              {!has.b && !has.w && has.i && <Info className="h-4 w-4 text-sky-10 shrink-0" />}
              {!has.b && !has.w && !has.i && <CheckCircle2 className="h-4 w-4 text-status-fact shrink-0" />}
            </div>
            <p className="text-xs text-text-placeholder truncate">{entity.fileName}</p>
          </div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-sm shrink-0 ${score >= 90 ? "bg-jade-3 text-status-fact" : score >= 70 ? "bg-status-warn-3 text-status-warn" : "bg-ruby-3 text-status-error"}`}>{score}%</span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={copyDiagnosis} className="p-1 rounded hover:bg-surface-hover text-text-hint hover:text-text-sub" title={EC_CARD_COPY.COPY_DIAGNOSIS_TITLE}><Copy className="h-4 w-4" /></button>
          {repairable && <button type="button" onClick={() => missingSource ? openCreate(entity) : openRepair(entity)} className="rounded bg-accent-bg px-2 py-1 text-xs text-accent-base hover:bg-accent-base/25">{missingSource ? ENTITY_COMPLIANCE_COPY.CREATE_AND_COMPLETE : isArticle ? ecCompleteFieldsAction(repairReport.failedCount) : ecRepairFieldsAction(repairReport.failedCount)}</button>}
          {/* 引用随源流转（2026-10-15 Master 批准）：缺失实体模板的第二出口——实体已删且不想重建时，
              跳待处理问题页从 missing_entity 信号改文章引用（module），二选一而非只有补建假设 */}
          {missingSource && <button type="button" onClick={() => { safeNavigateHash("#/anomalies"); }} title={EC_CARD_COPY.ALT_FIX_TITLE} className="rounded px-2 py-1 text-xs text-text-sub ring-1 ring-border-thin hover:bg-surface-hover hover:text-text-main">{EC_CARD_COPY.ALT_FIX_ACTION}</button>}
          {!missingSource && entity.sourceKey && <ObsidianLink sourcePath={entity.sourceKey} aria-label={ecOpenInObsidianAria(displayName)} className="p-1 rounded hover:bg-surface-hover text-text-hint hover:text-text-sub disabled:opacity-50" title={EC_CARD_COPY.OPEN_IN_OBSIDIAN}><ExternalLink className="h-4 w-4" /></ObsidianLink>}
        </div>
      </div>
      {open && (
        <div className="border-t border-border-thin px-4 py-3 space-y-3">
          {entity.groups?.map((g) => <ComplianceGroupSection key={g.id} group={g} sourceValues={entity.sourceValues} />)}
        </div>
      )}
    </div>
  );
}
