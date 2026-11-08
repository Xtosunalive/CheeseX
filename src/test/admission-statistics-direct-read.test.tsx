// WP-134 波1 差分钉（store 级）＋ WP-136 a 退役钉：准入页三个数全部直读后端权威面。
// 历史轨迹：波1 前 store 丢弃 kind ⇒ AdmissionView 按 kind 过滤恒空、统计堆整块不渲染（死面）；
// 波1 收口为「权威面保留 kind＋汇总字段进 store」，但被减数由前端按 components 重数一份
// （kindTotals，红队反例①要求减法两侧同集合）；WP-136 a 起后端同管道补发 totalByKind，
// 那份本地计数退役——本文件的第 3 例即钉住「不得再回本地重数」。
// 说明：view 级渲染钉未落（渲染 AdmissionView 会拉入注册表真组件致 vitest worker 崩溃）——
// 该缺口已记进 WP-134 合同 coverage，不假装已验；无 id 条目计入分母这件事的证明已上移到
// 后端路由实调（server/routes/__tests__/admission-authority-route.test.cjs）。
import { describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    components: [
      { id: "e1", label: "E1", layer: "L", admitted: true, blockedReasons: [], kind: "entity" },
      { id: "e2", label: "E2", layer: "L", admitted: true, blockedReasons: [], kind: "entity" },
      { id: "e3", label: "E3", layer: "L", admitted: false, blockedReasons: ["missing_source_article"], kind: "entity" },
      { id: "e4", label: "E4", layer: "L", admitted: false, blockedReasons: ["missing_id"], kind: "entity" },
      { id: "d1", label: "D1", layer: "L", admitted: true, blockedReasons: [], kind: "document" },
      { id: "t1", label: "T1", layer: "L", admitted: false, blockedReasons: [], kind: "taxonomy" },
    ] as Array<{ id: string; label: string; layer: string; admitted: boolean; blockedReasons: string[]; kind?: string }>,
    admittedByKind: undefined as undefined | { entity: number; document: number; taxonomy: number },
    totalByKind: undefined as undefined | { entity: number; document: number; taxonomy: number },
  },
}));

vi.mock("@/features/admission/admission-api", () => ({
  fetchCanvasAdmission: () => Promise.resolve({
    data: {
      total: state.components.length,
      admitted: state.components.filter((c) => c.admitted).length,
      blocked: state.components.length - state.components.filter((c) => c.admitted).length,
      components: state.components,
      ...(state.admittedByKind ? { admittedByKind: state.admittedByKind } : {}),
      ...(state.totalByKind ? { totalByKind: state.totalByKind } : {}),
    },
  }),
}));

import { useCanvasAdmissionStore } from "@/features/admission/admission-store";

async function loadFresh() {
  useCanvasAdmissionStore.setState({ componentsById: null, totals: null, status: "idle" });
  await useCanvasAdmissionStore.getState().load();
  return useCanvasAdmissionStore.getState();
}

describe("canvas-admission 权威面（直读收口＋本地重数退役）", () => {
  it("kind 存活：实体/文档/分类学三类各归位（旧 store 丢 kind ⇒ 页面过滤恒空）", async () => {
    state.admittedByKind = { entity: 3, document: 1, taxonomy: 0 };
    state.totalByKind = { entity: 4, document: 1, taxonomy: 1 };
    const s = await loadFresh();
    expect(s.status).toBe("ready");
    expect(s.componentsById?.get("t1")?.kind).toBe("taxonomy");
    expect(s.componentsById?.get("d1")?.kind).toBe("document");
    expect([...s.componentsById!.values()].filter((v) => v.kind === "entity").length).toBe(4);
  });

  it("三个数全直读：byKind 取 admittedByKind、totalByKind 取同名字段，不与本地 filter 结果混用", async () => {
    state.admittedByKind = { entity: 3, document: 1, taxonomy: 0 };
    state.totalByKind = { entity: 4, document: 1, taxonomy: 1 };
    const s = await loadFresh();
    expect(s.totals).toEqual({
      total: 6,
      admitted: 3,
      blocked: 3,
      byKind: { entity: 3, document: 1, taxonomy: 0 },
      totalByKind: { entity: 4, document: 1, taxonomy: 1 },
    });
    // 减法两侧同集合由后端保证：待准入＝4−3＝1（本地按可见 Map 数出来是 2 个未准入实体——
    // 无 id 条目已被剔掉，这正是红队反例①当年要在前端补一份计数的原因）
    expect((s.totals!.totalByKind!.entity ?? 0) - (s.totals!.byKind!.entity ?? 0)).toBe(1);
  });

  it("退役钉：被减数只认后端 totalByKind，绝不回本地重数（后端报 9 就得是 9）", async () => {
    const saved = state.components;
    // 故意让「本地能数出来的」与「后端权威的」不一致：夹具 4 个实体，权威面报 9
    // （真实场景＝无 id 条目、懒加载分批等）。若有人把 kindTotals 那种 components 重数写回来，本例即红。
    state.components = [
      { id: "e1", label: "E1", layer: "L", admitted: true, blockedReasons: [], kind: "entity" },
      { id: "e2", label: "E2", layer: "L", admitted: true, blockedReasons: [], kind: "entity" },
      { id: "e3", label: "E3", layer: "L", admitted: false, blockedReasons: ["missing_id"], kind: "entity" },
      { id: "e4", label: "E4", layer: "L", admitted: false, blockedReasons: ["missing_id"], kind: "entity" },
    ];
    state.admittedByKind = { entity: 2, document: 0, taxonomy: 0 };
    state.totalByKind = { entity: 9, document: 0, taxonomy: 0 };
    try {
      const s = await loadFresh();
      expect(s.totals?.totalByKind).toEqual({ entity: 9, document: 0, taxonomy: 0 });
      expect((s.totals!.totalByKind!.entity ?? 0) - (s.totals!.byKind!.entity ?? 0)).toBe(7);
      // store 面上不存在本地重数产物（kindTotals 已退役——留此断言防「改名复活」）
      expect(Object.keys(s as unknown as Record<string, unknown>)).not.toContain("kindTotals");
    } finally {
      state.components = saved;
    }
  });

  it("契约 optional 缺席＝null，不降级成 0（页面据此渲染「—」）", async () => {
    state.admittedByKind = undefined;
    state.totalByKind = undefined;
    const s = await loadFresh();
    expect(s.totals?.byKind).toBeNull();
    expect(s.totals?.totalByKind).toBeNull();
    expect(s.totals?.total).toBe(6);
  });

  it("payload 未带 kind 的条目保持 null，不伪造成某一类（红队反例④的正面钉）", async () => {
    const saved = state.components;
    // 契约 required，但伪造默认值的代价是把「不知道是哪类」喂进分母——旧写法 ?? "entity" 即此类
    state.components = [{ id: "x1", label: "X1", layer: "L", admitted: true, blockedReasons: [] }];
    state.admittedByKind = { entity: 0, document: 0, taxonomy: 0 };
    state.totalByKind = { entity: 0, document: 0, taxonomy: 0 };
    try {
      const s = await loadFresh();
      expect(s.componentsById?.get("x1")?.kind).toBeNull();
      expect([...s.componentsById!.values()].filter((v) => v.kind === "entity")).toHaveLength(0);
    } finally {
      state.components = saved;
      state.admittedByKind = { entity: 3, document: 1, taxonomy: 0 };
      state.totalByKind = { entity: 4, document: 1, taxonomy: 1 };
    }
  });
});
