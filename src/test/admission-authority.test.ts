// admission 页准入权威装配测试（WP-030/PR-145 批2——SPEC-032 C1 对应用例）。
// 验证对象：useRegistryItems 的准入状态派生——后端 canvas-admission 权威优先，
// 权威缺席降级前端缓存。关键反例＝带 sourcePath（无 file_path）的实体：
// 后端三源口径判 APPROVED，前端单源缓存判 PENDING——漂移治好后必须显示后端判定。
// 层级标注：纯单元（store＋selector 装配，mock 拓扑数据）。
import { beforeEach, describe, expect, it } from "vitest";
import { useTopologyStore } from "@/lib/topology-store";
import { useCanvasAdmissionStore } from "@/features/admission/admission-store";
import { useRegistryItems } from "@/lib/entity-registry-selectors";
import { renderHook } from "@testing-library/react";

const nodeWithSourcePathOnly = {
  id: "comp:svc-a",
  label: "服务A",
  category: "服务",
  properties: { sourcePath: "wiki/articles/svc-a.md", arch_layer: "应用" },
} as never;
const nodeWithFilePath = {
  id: "comp:svc-b",
  label: "服务B",
  category: "服务",
  properties: { file_path: "wiki/articles/svc-b.md" },
} as never;
const nodeNoSource = {
  id: "comp:svc-c",
  label: "服务C",
  category: "服务",
  properties: {},
} as never;

describe("准入权威装配（canvas-admission 为唯一事实源）", () => {
  beforeEach(() => {
    useTopologyStore.setState({ admittedNodes: [nodeWithSourcePathOnly, nodeWithFilePath, nodeNoSource] });
  });

  it("权威面在场：sourcePath-only 实体按后端三源口径判 APPROVED（漂移治好）", () => {
    useCanvasAdmissionStore.setState({
      componentsById: new Map([
        ["comp:svc-a", { admitted: true, blockedReasons: [], kind: "entity" as const }],
        ["comp:svc-b", { admitted: true, blockedReasons: [], kind: "entity" as const }],
        ["comp:svc-c", { admitted: false, blockedReasons: ["missing_source_article"], kind: "entity" as const }],
      ]),
      status: "ready",
    });
    const items = renderHook(() => useRegistryItems()).result.current;
    expect(items.find((i) => i.entityId === "comp:svc-a")?.admissionStatus).toBe("APPROVED");
    expect(items.find((i) => i.entityId === "comp:svc-c")?.admissionStatus).toBe("PENDING");
  });

  it("权威面缺席（未加载/失败）：降级三键缓存镜像权威口径（红队跟进项②——sourcePath-only 不再回落单键）", () => {
    useCanvasAdmissionStore.setState({ componentsById: null, status: "error" });
    const items = renderHook(() => useRegistryItems()).result.current;
    expect(items.find((i) => i.entityId === "comp:svc-a")?.admissionStatus).toBe("APPROVED");
    expect(items.find((i) => i.entityId === "comp:svc-b")?.admissionStatus).toBe("APPROVED");
    expect(items.find((i) => i.entityId === "comp:svc-c")?.admissionStatus).toBe("PENDING");
  });

  it("registry 条目无合成百分比（coverageRate 已删——无 per-item 真值不伪造）", () => {
    useCanvasAdmissionStore.setState({
      componentsById: new Map([["comp:svc-a", { admitted: true, blockedReasons: [], kind: "entity" as const }]]),
      status: "ready",
    });
    const items = renderHook(() => useRegistryItems()).result.current;
    for (const item of items) {
      expect("coverageRate" in item).toBe(false);
      expect(JSON.stringify(item)).not.toMatch(/\d+%/);
    }
  });
});
