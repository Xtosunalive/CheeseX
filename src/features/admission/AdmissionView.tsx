// AdmissionView — 实体准入 (Module 1)
import { useEffect } from "react";
import { EntityRegistryTable } from "./EntityRegistryTable";
import { ArticleDrawer } from "./ArticleDrawer";
import { useLoadTopology } from "@/lib/topology-store";
import { useCanvasAdmissionStore } from "./admission-store";
import { BentoGrid } from "@/components/bento";
import { Statistic } from "@/components/statistic";
import { PageContainer } from "@/components/page-container";
import { Panel } from "@/components/panel";
import { ADMISSION_VIEW_COPY, admissionDocsHint, admissionPendingHint } from "./admission-copy";

export function AdmissionView() {
  // 断点修复：页面独立打开时必须触发拓扑数据加载（此前依赖先访问 dashboard，直接打开显示 0 条）
  const loadTopology = useLoadTopology();
  // WP-030/PR-145：同批拉取后端权威准入判定——页面准入状态以 canvas-admission 为准
  const loadCanvasAdmission = useCanvasAdmissionStore((s) => s.load);
  const totals = useCanvasAdmissionStore((s) => s.totals);
  // PR-156 刀三：实体口径单源——注册表混装分类学节点与文档节点，此前全数成「实体」假数
  // （24 待准入实体含全部分类学结构节点）。卡片按 kind 分列：准入语义只对实体/文档成立。
  // WP-134 波1：kind 此前在 store 被丢弃 ⇒ 按类过滤恒空、统计堆整块不渲染（死面，实测见提交）；
  // 「已准入」两卡的数改直读契约 admittedByKind（kg-routes.cjs 权威口径），缺席＝null 渲染「—」。
  // WP-136 a：被减数改直读契约 totalByKind（与 admittedByKind 同管道、同集合、含无 id 条目）——
  // 红队反例①曾要求前端自己按 components 重数一份 kindTotals，那份本地计数连同由它派生的两个
  // 过滤集合一并退役：减法两侧自此都来自后端，本页不再有任何数字是前端重数出来的。
  const registryTotal = totals?.totalByKind?.entity ?? null;
  const admittedCount = totals?.byKind?.entity ?? null;
  const pendingCount = registryTotal === null || admittedCount === null ? null : registryTotal - admittedCount;
  const admittedDocs = totals?.byKind?.document ?? null;
  const candidateDocs = totals?.totalByKind?.document ?? null;
  useEffect(() => {
    void loadTopology();
    void loadCanvasAdmission();
  }, [loadTopology, loadCanvasAdmission]);
  return (
    <PageContainer>
      {/* WP-037 P7 锚点：准入规模（待准入 xl＋已准入 lg）；P5 红队修：注册表空时不渲染 0 值堆 */}
      {(registryTotal ?? 0) > 0 && (
        <BentoGrid>
          <Statistic size="xl" className="lg:col-span-2" label={ADMISSION_VIEW_COPY.PENDING_LABEL} value={pendingCount} tone={pendingCount !== null && pendingCount > 0 ? "text-status-warn" : "text-status-fact"} hint={admissionPendingHint(registryTotal)} />
          <Statistic size="lg" label={ADMISSION_VIEW_COPY.ADMITTED_LABEL} value={admittedCount} tone="text-status-fact" hint={ADMISSION_VIEW_COPY.ADMITTED_HINT} />
          {(candidateDocs ?? 0) > 0 && <Statistic size="lg" label={ADMISSION_VIEW_COPY.ADMITTED_DOCS_LABEL} value={admittedDocs} tone="text-status-fact" hint={admissionDocsHint(candidateDocs)} />}
        </BentoGrid>
      )}

      <Panel>
        <EntityRegistryTable />
      </Panel>
      <ArticleDrawer />
    </PageContainer>
  );
}
