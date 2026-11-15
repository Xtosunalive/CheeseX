// AdmissionView — 实体准入 (Module 1)
// （WP-037 P7 准入规模统计卡——待准入/已准入实体/已准入文档——已随 2026-11-15 Master 裁决退役，
//   Master 裁「这两个值出现的毫无意义」；卡片口径的历史轨迹存于 SPEC-074 §6.5 口径表＋
//   admission-statistics-direct-read.test.tsx 的 store 级差分钉。）
import { useEffect } from "react";
import { EntityRegistryTable } from "./EntityRegistryTable";
import { ArticleDrawer } from "./ArticleDrawer";
import { useLoadTopology } from "@/lib/topology-store";
import { useCanvasAdmissionStore } from "./admission-store";
import { PageContainer } from "@/components/page-container";
import { Panel } from "@/components/panel";

export function AdmissionView() {
  // 断点修复：页面独立打开时必须触发拓扑数据加载（此前依赖先访问 dashboard，直接打开显示 0 条）
  const loadTopology = useLoadTopology();
  // WP-030/PR-145：同批拉取后端权威准入判定——注册表行的准入状态以 canvas-admission 为准
  // （规模卡退役后本页不再消费 totals，load 仍为注册表数据源）
  const loadCanvasAdmission = useCanvasAdmissionStore((s) => s.load);
  useEffect(() => {
    void loadTopology();
    void loadCanvasAdmission();
  }, [loadTopology, loadCanvasAdmission]);
  return (
    <PageContainer>
      <Panel>
        <EntityRegistryTable />
      </Panel>
      <ArticleDrawer />
    </PageContainer>
  );
}
