// theschema-writer-scan 红绿夹具（check:schema-writers 检查面⑨——写者反向对账，2026-10-22）：
// 反例①实存写者未登记→红；正例②登记∪豁免→绿；③repoWrite 调用方即写者（通道豁免不误伤）；
// ④vault 通道×TheSchema 解析点共现才判写者（纯 vault 写不命中）；⑤writers 指针条目解析。
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegisteredWriters, scanTheSchemaWriters, reconcileActualWriters, CHANNEL_BASENAMES , scanChannelThroatBypass, reconcileChannelThroat} from "../shared/theschema-writer-scan.mjs";

const FILES = [
  { rel: "server/services/schema-manager/enums-write-service.cjs", content: 'const { repoWrite } = require("../../shared/repo-schema-io.cjs");\nrepoWrite(p, raw);' },
  { rel: "server/services/article-workflow/article-association-service.cjs", content: 'const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");\nwriteVault(target, raw);' },
  { rel: "server/services/release-governance/entity-parent-service.cjs", content: 'const { writeVault } = require("../../shared/vault-io.cjs");\nwriteVault(dest, raw);' },
  { rel: "server/shared/repo-schema-io.cjs", content: "function repoWrite(absPath, content) {}" },
  { rel: "scripts/quality/shared/theschema-writer-scan.mjs", content: "// 注释提及 repoWrite（ 与 vault 通道——扫描器自身豁免" },
];

test("绿：repoWrite 调用方即写者；vault×解析点共现才判写者；通道与扫描器豁免不误伤", () => {
  const scanned = scanTheSchemaWriters(FILES);
  assert.deepEqual(scanned.map((h) => h.file), [
    "server/services/schema-manager/enums-write-service.cjs",
    "server/services/article-workflow/article-association-service.cjs",
  ]);
});

test("红：实存写者未登记（反向对账——write_protocol 违约信号有执法面）", () => {
  const scanned = scanTheSchemaWriters(FILES);
  const errors = reconcileActualWriters({ scanned, registered: ["enums-write-service.cjs"] });
  assert.ok(errors.some((e) => e.includes("写者未登记") && e.includes("article-association-service.cjs")));
  assert.equal(errors.length, 1);
});

test("绿：登记∪豁免全放行（豁免须显式列名）", () => {
  const scanned = scanTheSchemaWriters(FILES);
  assert.deepEqual(reconcileActualWriters({ scanned, registered: ["enums-write-service.cjs", "article-association-service.cjs"] }), []);
  assert.deepEqual(reconcileActualWriters({ scanned, registered: [], exempt: ["enums-write-service.cjs", "article-association-service.cjs"] }), []);
});

test("writers 指针条目解析（file:line（说明）形取文件名；无指针条目跳过）", () => {
  const registered = parseRegisteredWriters([
    "schema-write-service.cjs:121-131（页面写，经 enums-write-service）",
    "AI 会话文件编辑（2026-10-10 归因确认）",
    "scripts/vault-runtime/archive-enums-legacy.py",
  ]);
  assert.deepEqual([...registered], ["schema-write-service.cjs", "archive-enums-legacy.py"]);
});

test("通道豁免集含仓内两通道与扫描器自身", () => {
  assert.deepEqual(CHANNEL_BASENAMES, ["repo-schema-io.cjs", "vault-io.cjs", "theschema-writer-scan.mjs"]);
});

// ── WP-079 面⑩：TheSchema 写通道唯一门（形状谓词＋默认拒绝＋空转即摘）──
const F = (rel, content) => ({ rel, content });

test("面⑩ 谓词 A：直连仓内通道的模块即红，咽喉与通道本体不红", () => {
  const files = [
    F("server/services/x/a-service.cjs", 'const { repoWrite } = require("../../shared/repo-schema-io.cjs");\nrepoWrite(p, raw);'),
    F("server/shared/theschema-write.cjs", "repoWrite(p, raw);"),
    F("server/shared/repo-schema-io.cjs", "function repoWrite() {}\nrepoWrite(p);"),
    F("server/services/x/__tests__/a.test.cjs", "repoWrite(p);"),
  ];
  const hits = scanChannelThroatBypass(files);
  assert.deepEqual(hits.map((h) => h.file), ["server/services/x/a-service.cjs"], "只咬自判通道的服务侧模块");
  assert.equal(hits[0].pred, "A");
});

test("面⑩ 谓词 B：resolver 路径喂 vault 通道且不经咽喉即红（tr_504310b2 形状）", () => {
  const bad = F("server/services/y/b-service.cjs", 'const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");\nwriteVault(path, raw, {});');
  const okThroat = F("server/services/y/c-service.cjs", 'const { writeTheSchemaFile } = require("../../shared/theschema-write.cjs");\nconst d = resolveTheSchemaDir(v);\nwriteTheSchemaFile(d, raw, {});\nwriteVault(other, x, {});');
  const onlyVault = F("server/services/z/d-service.cjs", "writeVault(vaultFile, raw, {});");
  const hits = scanChannelThroatBypass([bad, okThroat, onlyVault]);
  assert.deepEqual(hits.map((h) => h.file), ["server/services/y/b-service.cjs"]);
  assert.equal(hits[0].pred, "B");
});

test("面⑩ 对账：命中不在豁免集即红；豁免条目不再命中＝空转即摘（只减不增）", () => {
  const scanned = [{ file: "server/services/e/e-service.cjs", pred: "B", text: "x" }];
  assert.equal(reconcileChannelThroat({ scanned, exempt: [] }).length, 1, "缺豁免即红");
  assert.equal(reconcileChannelThroat({ scanned, exempt: [["server/services/e/e-service.cjs", "理由"]] }).length, 0, "附因豁免即绿");
  const idle = reconcileChannelThroat({ scanned: [], exempt: [["server/services/e/e-service.cjs", "理由"]] });
  assert.equal(idle.length, 1, "豁免空转必须红");
  assert.match(idle[0], /空转/);
});

test("面⑩ 报错须指向唯一门与出口（操作者据此改代码，不是猜）", () => {
  const [msg] = reconcileChannelThroat({ scanned: [{ file: "server/services/f/f.cjs", pred: "A", text: "直连" }], exempt: [] });
  assert.match(msg, /theschema-write\.cjs/, "点名唯一门");
  assert.match(msg, /登记理由/, "给合法出口");
});
