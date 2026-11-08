// property-gov 文案投影钉（WP-033/PR-148，SPEC-035 C1）。
// 层级：纯单元——验证对象：六检查标签单源 property-gov-copy（七键满配＋派生函数）。
// 改标签口径/删键不动本钉即红（三份并存回潮的第一道闸）。
import { describe, expect, it } from "vitest";
import { CHECK_LABELS, failedCheckLabels } from "@/features/property-gov/property-gov-copy";

const pass = { passed: true };
const fail = { passed: false };

describe("property-gov 文案单源", () => {
  it("七键满配（后端 findings 加检查键不登记即 tsc 红＋本钉红）", () => {
    expect(Object.keys(CHECK_LABELS).sort()).toEqual([
      "document_module_entity",
      "format_artifact",
      "invalid_module",
      "missing_module",
      "mount_diagnostic",
      "mount_mismatch",
      "stale_property",
    ]);
  });

  it("同物多名归一：不带属性键名（「模块未填写」口径，无「module 属性」前缀）", () => {
    expect(CHECK_LABELS.missing_module).toBe("模块未填写");
    expect(CHECK_LABELS.invalid_module).toBe("模块值无效");
    for (const label of Object.values(CHECK_LABELS)) {
      expect(label).not.toMatch(/module|property|artifact/i); // 内部键名不上面
    }
  });

  it("failedCheckLabels 派生——失败检查按固定序出标签，全过为空", () => {
    expect(failedCheckLabels({
      missing_module: fail, invalid_module: fail, mount_mismatch: pass,
      stale_property: fail, format_artifact: pass, document_module_entity: null,
    })).toEqual(["模块未填写", "模块值无效", "属性提取已过期"]);
    expect(failedCheckLabels({
      missing_module: pass, invalid_module: pass, mount_mismatch: pass,
      stale_property: pass, format_artifact: pass, document_module_entity: pass,
    })).toEqual([]);
  });
});
