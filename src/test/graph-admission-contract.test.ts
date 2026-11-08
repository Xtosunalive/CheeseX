// 图准入契约对账钉（WP-030/PR-145）。
// 前端 GraphAdmissionService.ENTITY_LABELS 是 contracts/graph-admission.json 的镜像副本
// （contracts 目录前端读不到——entity-readiness-rules 同款裁决），本钉锁死两份不漂移：
// 改契约不同步前端副本（或反之）即红。
// 层级标注：纯单元（对账钉）——验证对象：前端副本与契约单源的一致性。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GraphAdmissionService } from "@/lib/domain/GraphAdmissionService";
import { SOURCE_ARTICLE_KEYS } from "@/lib/entity-registry-selectors";

// vitest root＝仓库根（import.meta.url 非 file 协议不可用——实测教训）
const contractPath = join(process.cwd(), "contracts", "graph-admission.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
  entityLabels: string[];
  sourceArticleKeys: string[];
};

describe("图准入契约对账钉（graph-admission.json ↔ 前端副本）", () => {
  it("前端 ENTITY_LABELS 与契约 entityLabels 全等（含顺序）", () => {
    expect([...GraphAdmissionService.ENTITY_LABELS]).toEqual(contract.entityLabels);
  });

  it("契约 sourceArticleKeys 键序在位（server 源文档判定单源——键集变化必须过本钉）", () => {
    expect(contract.sourceArticleKeys).toEqual(["file_path", "sourcePath", "source_path"]);
  });

  it("前端降级缓存键序副本与契约 sourceArticleKeys 全等（降级镜像权威——红队跟进项②）", () => {
    expect([...SOURCE_ARTICLE_KEYS]).toEqual(contract.sourceArticleKeys);
  });
});
