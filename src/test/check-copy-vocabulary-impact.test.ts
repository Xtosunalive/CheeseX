import { describe, expect, it } from "vitest";
// checker: check-copy-vocabulary（quality-gates 清册登记 #1406）
import { issueImpactText } from "@/features/anomaly-workbench/anomaly-workbench-copy";

// #1405 影响族诚实化（AWS Impact 语义）：按轨陈述真实后果，替代假执法"阻止动作"。
// 边界负例：警告类返回 null（不渲染行）——原 blockedActions 空表的显式弃置语义保留。
describe("issueImpactText · 按轨诚实影响", () => {
  it("文章轨：缺字段/版本/过期 → 文章无法进入正式版本", () => {
    for (const kind of ["missing_field", "version_scope", "stale_source"] as const) {
      expect(issueImpactText({ issueKind: kind })).toMatch(/文章无法进入正式版本/);
    }
  });
  it("图谱轨：六类质量问题 → 阻断项拦对应操作，可能随版本进入正式消费", () => {
    for (const kind of ["relation_conflict", "unrecognized_entity", "missing_entity", "missing_lineage", "article_association"] as const) {
      expect(issueImpactText({ issueKind: kind })).toMatch(/其中的阻断项会拦住对应操作/);
    }
  });
  it("管道失败 → 派生数据停留上一成功状态", () => {
    expect(issueImpactText({ issueKind: "pipeline_failure" })).toMatch(/上一成功状态/);
  });
  it("发布失败 → 继续服务上一合法 Release", () => {
    expect(issueImpactText({ issueKind: "release_publication_failure" })).toMatch(/上一合法 Release/);
  });
  it("边界负例：标准化警告 → null（显式弃置，不渲染）", () => {
    expect(issueImpactText({ issueKind: "standardization_warning" })).toBeNull();
  });
});
