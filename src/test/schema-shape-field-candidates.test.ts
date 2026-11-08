// schema-shape 候选投影测试——复用域 schema-shape 守护测试（SCHEMA-IA-001 批16 扩域）
// 面覆盖：实体字段候选投影（双形态词条/双形态 modules/版本注册表双形态/total 空输入/纯函数）＋野生值呈现谓词
// 收编背景：EntityComplianceView 与 AnomalyEntityRepairDrawer 原各自拍平 enums（两份实现健壮度已分叉——
// 异常侧有 layers/subdomains 双形态加固、合规侧没有）；批16 单源化，本测试钉住加固版语义为基线。
import { describe, expect, it } from "vitest";
import { entityFieldCandidates, isWildChoice, type ShapeEnumsInput } from "@/lib/schema-shape";
import type { NormalizedEnumsData } from "@/features/schema-manager/schema-manager-types";

// 编译期直通钉子：候选投影入参面必须结构性可赋值特征侧归一类型（复用契约"零 feature 依赖"的类型面执法）
const _candidatesInputAssignable: ShapeEnumsInput = {} as NormalizedEnumsData;
void _candidatesInputAssignable;

const ALL_KEYS = ["arch_layer", "arch_category", "arch_subdomain", "module", "tags", "status", "arch_since", "arch_until"] as const;

describe("entityFieldCandidates（实体字段候选投影）", () => {
  it("total：空/缺输入返回全键空数组不抛错", () => {
    for (const input of [null, undefined, {}]) {
      const result = entityFieldCandidates(input, undefined);
      expect(Object.keys(result).sort()).toEqual([...ALL_KEYS].sort());
      for (const key of ALL_KEYS) expect(result[key]).toEqual([]);
    }
  });

  it("layers 双形态取 id（裸标量 legacy｜{id,…} 对象——对象被过滤=静默漏词，禁止）", () => {
    const objectForm: { id: string; label: string } = { id: "edge", label: "边缘" };
    const result = entityFieldCandidates({ layers: ["data-lake", objectForm] });
    expect(result.arch_layer).toEqual(["data-lake", "edge"]);
  });

  it("categories 仅字符串词条；subdomains 跨域去重", () => {
    const result = entityFieldCandidates({
      categories: ["runtime", "concept"],
      subdomains: {
        data: [{ id: "storage" }, "compute"],
        app: [{ id: "storage" }, { id: "gateway" }],
      },
    });
    expect(result.arch_category).toEqual(["runtime", "concept"]);
    expect(result.arch_subdomain).toEqual(["storage", "compute", "gateway"]);
  });

  it("modules 双形态：记录表取键｜数组取词条 id", () => {
    expect(entityFieldCandidates({ modules: { mysql: { subdomain: "storage" }, kafka: {} } }).module).toEqual(["mysql", "kafka"]);
    expect(entityFieldCandidates({ modules: ["mysql", { id: "kafka" }] }).module).toEqual(["mysql", "kafka"]);
  });

  it("tags 拍平去重；status 透传", () => {
    const result = entityFieldCandidates({ tags: { scene: ["备份", "容灾"], infra: ["备份"] }, lifecycle_status: ["draft", "online"] });
    expect(result.tags).toEqual(["备份", "容灾"]);
    expect(result.status).toEqual(["draft", "online"]);
  });

  it("版本注册表双形态（products 数组｜记录表；版本条目 {id,…}｜裸标量），arch_since/arch_until 同源", () => {
    const arrayForm = { products: [{ name: "a", versions: [{ id: "7.0.0" }, "7.1.0"] }] };
    const recordForm = { products: { a: { versions: [{ id: "7.0.0" }] } } };
    expect(entityFieldCandidates({}, arrayForm).arch_since).toEqual(["7.0.0", "7.1.0"]);
    expect(entityFieldCandidates({}, recordForm).arch_until).toEqual(["7.0.0"]);
    const result = entityFieldCandidates({}, arrayForm);
    expect(result.arch_since).toEqual(result.arch_until);
  });

  it("版本注册表缺席/畸形 → 空数组（total）", () => {
    for (const registry of [undefined, null, "x", { products: "y" }, { products: [null, { versions: null }] }]) {
      expect(entityFieldCandidates({}, registry).arch_since).toEqual([]);
    }
  });

  it("纯函数纪律：同输入两次调用 deepEqual", () => {
    const enums: ShapeEnumsInput = { layers: ["a"], tags: { g: ["t"] } };
    const registry = { products: [{ versions: [{ id: "v1" }] }] };
    expect(entityFieldCandidates(enums, registry)).toEqual(entityFieldCandidates(enums, registry));
  });
});

describe("isWildChoice（野生值呈现谓词）", () => {
  it("非字符串/空串恒非野生（表单未填不算）", () => {
    expect(isWildChoice(undefined, ["a"])).toBe(false);
    expect(isWildChoice(null, ["a"])).toBe(false);
    expect(isWildChoice("", ["a"])).toBe(false);
    expect(isWildChoice(42, ["a"])).toBe(false);
  });
  it("在册=非野生；不在册=野生", () => {
    expect(isWildChoice("a", ["a", "b"])).toBe(false);
    expect(isWildChoice("c", ["a", "b"])).toBe(true);
    expect(isWildChoice("c", [])).toBe(true);
  });
  it("与候选投影联动：拍平结果作候选集判野生", () => {
    const candidates = entityFieldCandidates({ layers: ["data-lake"] });
    expect(isWildChoice("edge", candidates.arch_layer)).toBe(true);
    expect(isWildChoice("data-lake", candidates.arch_layer)).toBe(false);
  });
});
