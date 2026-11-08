import { describe, expect, it } from "vitest";
import { renameModuleSubdomainReferences } from "@/features/schema-manager/schema-manager-enums";
import { resolveObsidianSourcePath } from "@/lib/obsidian";

describe("subdomain rename reference migration", () => {
  it("updates every module reference without mutating unrelated modules", () => {
    const original = {
      主模块: { subdomain: "test", system: "main", since: "7.0.0", until: "" },
      存储模块: { subdomain: "storage", system: "storage", since: "7.0.0", until: "" },
    };

    const result = renameModuleSubdomainReferences(original, "test", "test1");

    expect(result.moduleNames).toEqual(["主模块"]);
    expect(result.modules["主模块"].subdomain).toBe("test1");
    expect(result.modules["存储模块"]).toEqual(original["存储模块"]);
    expect(original["主模块"].subdomain).toBe("test");
  });
});

describe("entity source deep link", () => {
  it("uses the governed source path instead of the architecture node id", () => {
    const sourcePath = resolveObsidianSourcePath({ properties: {
      file_path: "知识库/wiki/entities/test-pipeline-verification.md",
      architecture_node_id: "test-pipeline-verification",
    } });

    expect(sourcePath).toBe("知识库/wiki/entities/test-pipeline-verification.md");
  });
});
