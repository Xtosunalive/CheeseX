// Component: vocabulary-lineage Tests（A1 归位回归）
// @responsible: 断言三件事——①recordGrowth 写入 resolveTheSchemaDir 解析目录（钉扎世界＝钉扎目录），
//               vault 侧不再重建 知识库/TheSchema；②迁移窗翻回（vault 侧 enums.yaml 在场且未钉扎）时
//               lineage 写 fail-closed（repo-schema-io 目的地执法同款），不在 vault 册外落任何文件；
//               ③幂等与缺省空账本语义保持（ADR-007 方案 B 原契约）。
// @inputs: vocabulary-lineage.cjs + 临时目录夹具（THESCHEMA_DIR 钉扎——schema-write-service.test 先例）
// @outputs: node:test 断言
// @context: 数据域治理批 A1（docs/plans/数据域治理全貌核查 §3 A1）
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { readLineage, recordGrowth, LINEAGE_BASENAME } = require("../vocabulary-lineage.cjs");

function fixture({ pinned, vaultSideEnums } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineage-"));
  const priorDir = process.env.THESCHEMA_DIR;
  let dir = null;
  if (pinned) {
    dir = path.join(root, "theschema");
    fs.mkdirSync(dir, { recursive: true });
    process.env.THESCHEMA_DIR = dir;
  }
  if (vaultSideEnums) {
    fs.mkdirSync(path.join(root, "vault", "知识库", "TheSchema"), { recursive: true });
    fs.writeFileSync(path.join(root, "vault", "知识库", "TheSchema", "enums.yaml"), "domains:\n  arch: 架构\n", "utf8");
  }
  return {
    root,
    vaultRoot: path.join(root, "vault"),
    pinnedDir: dir,
    restore() {
      if (priorDir === undefined) delete process.env.THESCHEMA_DIR;
      else process.env.THESCHEMA_DIR = priorDir;
    },
  };
}

test("A1-1 晋升登记落 resolver 解析目录，vault 侧不重建 TheSchema", () => {
  const { vaultRoot, pinnedDir, restore } = fixture({ pinned: true });
  try {
    fs.mkdirSync(vaultRoot, { recursive: true });
    const result = recordGrowth(vaultRoot, { dimension: "tag", word: "可观测性", route: "discovery-absorb" });
    assert.ok(fs.existsSync(path.join(pinnedDir, LINEAGE_BASENAME)), "账本应落在钉扎 TheSchema 目录");
    assert.ok(!fs.existsSync(path.join(vaultRoot, "知识库")), "vault 侧不得出现知识库/TheSchema（册外重建引线）");
    assert.equal(result.path, LINEAGE_BASENAME);
    assert.equal(readLineage(vaultRoot).tag["可观测性"].route, "discovery-absorb");
  } finally {
    restore();
  }
});

test("A1-2 迁移窗翻回（vault 侧 enums.yaml 在场、未钉扎）→ 写 fail-closed，册外零落盘", () => {
  const { vaultRoot, restore } = fixture({ vaultSideEnums: true });
  try {
    assert.throws(
      () => recordGrowth(vaultRoot, { dimension: "subdomain", word: "observability", route: "discovery-absorb" }),
      (err) => err.code === "REPO_SCHEMA_DESTINATION",
      "resolver 指向 vault 侧时 repoWrite 须拒绝（与 enums 写同款 fail-closed）",
    );
    assert.ok(!fs.existsSync(path.join(vaultRoot, "知识库", "TheSchema", LINEAGE_BASENAME)), "vault 侧不得落账本文件");
  } finally {
    restore();
  }
});

test("A1-3 幂等：同词重复晋升刷新时间戳不追加垃圾行（原契约保持）", () => {
  const { vaultRoot, restore } = fixture({ pinned: true });
  try {
    recordGrowth(vaultRoot, { dimension: "layer", word: "gateway", route: "discovery-absorb" });
    recordGrowth(vaultRoot, { dimension: "layer", word: "gateway", route: "discovery-absorb" });
    const lineage = readLineage(vaultRoot);
    assert.equal(Object.keys(lineage.layer).length, 1);
  } finally {
    restore();
  }
});

test("A1-4 缺省空账本（fail-open 读——文件不存在返全空维度表）", () => {
  const { vaultRoot, restore } = fixture({ pinned: true });
  try {
    const lineage = readLineage(vaultRoot);
    assert.deepEqual(lineage.tag, {});
    assert.deepEqual(lineage.layer, {});
  } finally {
    restore();
  }
});
