import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ADR067：dashboard 系页面数据源单一化（工作投影恒为唯一页面数据源）。
// 正式代次横幅退役——任何情况下页面不得出现「正式代次落后」提示；
// 正式存档仅作审计用途保留于 .git/anyshare-releases（restore 端点不变）。
// 形态：零依赖源码断言（规则 28 红灯自包含）；动态 import 断言不可行——vite
// import-analysis 在收集期即拦截，测试文件根本不执行。

const REPO = process.cwd();

describe("ADR067 正式代次横幅退役墙", () => {
  it("R-T1 FormalFreshnessBanner 组件文件已删除", () => {
    expect(existsSync(join(REPO, "src/components/governance/FormalFreshnessBanner.tsx"))).toBe(false);
  });

  it("R-T2 全部视图与 store 不再引用横幅组件或 hook", () => {
    const consumers = [
      "src/features/dashboard/DashboardView.tsx",
      "src/features/data-dashboard/DataDashboardView.tsx",
      "src/features/gap-engine/GapEngineView.tsx",
      "src/features/admission/AdmissionView.tsx",
      "src/lib/topology-store.ts",
    ];
    for (const rel of consumers) {
      const src = readFileSync(join(REPO, rel), "utf8");
      expect(src.includes("FormalFreshnessBanner"), rel).toBe(false);
      expect(src.includes("useFormalFreshness"), rel).toBe(false);
      expect(src.includes("formalFreshness"), rel).toBe(false);
    }
  });

  it("R-T3 后端 dashboard/topology 恒活读（freshnessGate 已摘除）", () => {
    const src = readFileSync(join(REPO, "server/routes/dashboard-routes.cjs"), "utf8");
    expect(src.includes("createFreshnessGate")).toBe(false);
    expect(src.includes("withFreshness")).toBe(false);
  });
});
