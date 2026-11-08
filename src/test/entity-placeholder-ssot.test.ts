import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import { PLACEHOLDERS } from "@/features/entity-compliance/repair-field-config";

// seq190 P3c 等价锁：示例文案 2→1 归一后由冻结快照逐字符锁定；母版 ④ 的 placeholder 同锁（漂移机器可见，fail-closed）。

const MASTER_PLACEHOLDERS: Record<string, string> = {
  // WP-113 M2：身份由系统铸造——母版文案随 control 改托管同批改写（快照显式更新，漂移机器可见）
  "architecture-node-id": "由系统生成，创建后不可修改",
  arch_since: "例如 7.0.0.0",
  arch_until: "例如 8.0.0.0",
  arch_version_overrides: '[{"version":"7.0.0.0","arch_layer":"service"}]',
  tags: "回车或失焦添加一个标签",
};

const SUPERSET_PLACEHOLDERS: Record<string, string> = {
  aliases: "多个别名用英文逗号分隔",
  article_id: "例如 mysql-force-primary",
  version: "例如 7.0.0.0",
  "category-path": "例如 ops:deploy:nginx-502",
};

function readRepo(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("entity placeholder SSOT locks (seq190 P3c)", () => {
  it("master spec.placeholders match frozen snapshot verbatim", () => {
    for (const [field, text] of Object.entries(MASTER_PLACEHOLDERS)) {
      const spec = ENTITY_CREATE_FIELDS.find((item) => item.field === field);
      expect(spec?.placeholder, `master placeholder for ${field}`).toBe(text);
    }
    expect(ENTITY_CREATE_FIELDS.filter((spec) => spec.placeholder).length).toBe(5);
  });

  it("PLACEHOLDERS = master derive + declared superset, size 9", () => {
    expect(Object.keys(PLACEHOLDERS).sort()).toEqual([...Object.keys(MASTER_PLACEHOLDERS), ...Object.keys(SUPERSET_PLACEHOLDERS)].sort());
    expect(Object.keys(PLACEHOLDERS).length).toBe(9);
    for (const [field, text] of [...Object.entries(MASTER_PLACEHOLDERS), ...Object.entries(SUPERSET_PLACEHOLDERS)]) {
      expect(PLACEHOLDERS[field], `placeholder for ${field}`).toBe(text);
    }
  });

  it("drift texts are resolved to master canonical (2→1 unification locked)", () => {
    expect(PLACEHOLDERS["architecture-node-id"]).toBe("由系统生成，创建后不可修改");
    expect(PLACEHOLDERS.tags).toBe("回车或失焦添加一个标签");
    const drawer = readRepo("src/features/entity-compliance/EntityRepairDrawer.tsx");
    expect(drawer).not.toContain("例如 mysql-primary");
    expect(drawer).not.toContain("多个标签用英文逗号分隔");
  });

  it("drawer derives placeholders from master (no literal drift map)", () => {
    // F5 拆分后派生式随配置迁至 repair-field-config.ts（组件文件只留组件），锚点随之：
    const config = readRepo("src/features/entity-compliance/repair-field-config.ts");
    expect(config).toContain("ENTITY_CREATE_FIELDS.filter((spec) => spec.placeholder)");
    expect(config).toContain("export const PLACEHOLDERS: Record<string, string>");
    expect(config).not.toContain('"architecture-node-id": "例如');
  });
});
