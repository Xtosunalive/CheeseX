// WP-037 P7 锚点：检查通过率升主视觉（xl 跨两列），其余 5 项次级——替换旧 6 药丸条
import { ShieldCheck, AlertTriangle, Info, Activity } from "lucide-react";
import { BentoGrid } from "@/components/bento";
import { Statistic } from "@/components/statistic";
import type { ComplianceSummary } from "./entity-compliance-types";
import { ENTITY_COMPLIANCE_COPY, EC_SUMMARY_COPY, ecPassRateSub } from "./entity-compliance-copy";

export function SummaryBar({ summary }: { summary: ComplianceSummary }) {
  const total = summary.totalEntities ?? 0;
  const healthy = summary.healthyCount ?? 0;
  // WP-134 波2 拆口径切换器：三张卡的口径是「源文档数」（hint 原文即此），权威字段只有 *EntityCount 一族。
  // 旧写法 `a || b || 0` 把 0 当缺省——「无阻断文档但仍有 3 个阻断级问题」时静默换成问题数口径，
  // 同标签两个数互换（后端 entity-compliance-service.cjs:281-287 两族字段恒发，回落不是兼容是错数）。
  const blockers = summary.blockerEntityCount ?? null;
  const warnings = summary.warningEntityCount ?? null;
  const infos = summary.infoEntityCount ?? null;
  const averageScore = summary.averageScore ?? 0;
  const passRate = total > 0 ? `${Math.round((healthy / total) * 100)}%` : "—";

  return (
    <BentoGrid data-testid="compliance-summary">
      <Statistic size="xl" className="lg:col-span-2" label={EC_SUMMARY_COPY.PASS_RATE_LABEL} value={passRate} sub={ecPassRateSub(healthy, total)} tone={(blockers ?? 0) > 0 ? "text-status-error" : (warnings ?? 0) > 0 ? "text-status-warn" : "text-status-fact"} hint={EC_SUMMARY_COPY.PASS_RATE_HINT} />
      <Statistic label={ENTITY_COMPLIANCE_COPY.PASSED} value={healthy} icon={<ShieldCheck className="h-4 w-4 text-status-fact" />} tone="text-status-fact" hint={EC_SUMMARY_COPY.PASSED_HINT} />
      <Statistic label={EC_SUMMARY_COPY.BLOCKER_LABEL} value={blockers} icon={<AlertTriangle className="h-4 w-4 text-status-error" />} tone="text-status-error" hint={EC_SUMMARY_COPY.BLOCKER_HINT} />
      <Statistic label={EC_SUMMARY_COPY.WARNING_LABEL} value={warnings} icon={<AlertTriangle className="h-4 w-4 text-status-warn" />} tone="text-status-warn" hint={EC_SUMMARY_COPY.WARNING_HINT} />
      <Statistic label={EC_SUMMARY_COPY.INFO_LABEL} value={infos} icon={<Info className="h-4 w-4 text-sky-10" />} hint={EC_SUMMARY_COPY.INFO_HINT} />
      <Statistic label={EC_SUMMARY_COPY.AVG_SCORE_LABEL} value={averageScore} icon={<Activity className="h-4 w-4 text-accent-base" />} tone="text-accent-base" hint={EC_SUMMARY_COPY.AVG_SCORE_HINT} />
    </BentoGrid>
  );
}
