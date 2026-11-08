// ADR-008 D2 / SPEC-017 W4：fields-write-service 三件套＋投影联动。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");
const { createFieldsWriteService } = require("../fields-write-service.cjs");

const META_ENUMS = `domains:
  tech: 技术域
layers:
  - id: service
    label: 服务
    color: cyan
    layout: central
`;
const FIELDS = [{ name: "title", label: "显示名", type: "string", required: "是", scope: ["entity", "article"], layer: "内容属性", description: "标题" }];

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fields-svc-")); process.env.THESCHEMA_DIR = path.join(dir, "知识库", "TheSchema"); // SPEC-023 波 3 钉扎
  const schemaDir = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), META_ENUMS, "utf8");
  fs.writeFileSync(path.join(schemaDir, "fields.yaml"), "schema_version: 1\nfields: []\n", "utf8");
  return dir;
}

test("W4·三件套：严格校验拒畸形（缺 name）→400 不落盘", async () => {
  const vault = makeVault();
  const svc = createFieldsWriteService({ vaultPath: vault });
  await assert.rejects(
    () => svc.writeFields({ fields: [{ label: "无名字段", type: "string", required: "是", scope: ["entity"], layer: "内容属性" }], expectedRevision: svc.readFields().revision }),
    (e) => e.code === "VALIDATION_ERROR" && e.status === 400,
  );
  assert.equal(YAML.parse(fs.readFileSync(path.join(vault, "知识库/TheSchema/fields.yaml"), "utf8")).fields.length, 0, "原文件未动");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("W4·三件套：哈希乐观锁——过期 revision →409 FIELDS_REVISION_CONFLICT", async () => {
  const vault = makeVault();
  const svc = createFieldsWriteService({ vaultPath: vault });
  await svc.writeFields({ fields: FIELDS, expectedRevision: svc.readFields().revision });
  const stale = (await import("node:crypto")).createHash("sha256").update("old").digest("hex");
  await assert.rejects(
    () => svc.writeFields({ fields: FIELDS, expectedRevision: "sha256:" + stale }),
    (e) => e.code === "FIELDS_REVISION_CONFLICT" && e.status === 409,
  );
  fs.rmSync(vault, { recursive: true, force: true });
});

test("W4·三件套＋投影联动：合法写入落盘/快照留档/投影重生成", async () => {
  const vault = makeVault();
  const svc = createFieldsWriteService({ vaultPath: vault });
  const result = await svc.writeFields({ fields: FIELDS, expectedRevision: svc.readFields().revision });
  assert.equal(result.projectionSynced, true, "投影同步成功");
  const written = YAML.parse(fs.readFileSync(path.join(vault, "知识库/TheSchema/fields.yaml"), "utf8"));
  assert.equal(written.fields[0].name, "title");
  assert.match(fs.readFileSync(path.join(vault, "知识库/TheSchema/fields.yaml"), "utf8"), /^# fields\.yaml/, "头部说明注释保留");
  // SPEC-023 波 3：fs 快照退役——git 即账（不再产生 history/fields）
  const histDir = path.join(vault, "知识库", "TheSchema", "history");
  assert.ok(!fs.existsSync(histDir) || fs.readdirSync(histDir).length === 0, "不得再产生 fs 快照");
  const projection = fs.readFileSync(path.join(vault, "知识库/TheSchema/entity-frontmatter-schema.md"), "utf8");
  assert.match(projection, /派生物标记/, "投影头部标记在");
  assert.match(projection, /title/, "投影含字段");
  // 读回 revision 一致
  assert.equal(svc.readFields().revision, result.revision);
  fs.rmSync(vault, { recursive: true, force: true });
});
