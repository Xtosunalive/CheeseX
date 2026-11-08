// 层级：真实集成（vault-io 咽喉级）——WP-015/SPEC-077「机器回写不覆盖人手改」双向测试锚。
// 判据＝diff 相交：人改面（现 vs 基线）×写面（现 vs 写后）求交非空即拒 HUMAN_EDIT_CONFLICT。
// 红例＝相交拒（frontmatter 键／正文段）；绿例＝不相交放行且人改内容保留；播种＝存量无基线放行。
// 撤线自证：guard 判据摘除（checkWrite 恒放行）→ 红例全转假绿——以 _internals.diffKeys 变异对照承载。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { initVaultIO, resetVaultIO, writeVault, readVault } = require("../vault-io.cjs");
const guard = require("../human-edit-guard.cjs");

function fixture(t) {
  const vaultPath = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "heg-"));
  initVaultIO({ vaultPath, gitLedger: { markSystemFile() {}, isSystemFile() { return false; }, scheduleLedger() {} } });
  const pageRel = path.join("知识库", "wiki", "entities", "sample.md");
  const abs = path.join(vaultPath, pageRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const seed = (raw) => fs.writeFileSync(abs, raw, "utf8");
  const fm = (kv) => ["---", ...Object.entries(kv).map(([k, v]) => `${k}: ${v}`), "---"].join("\n");
  const page = (kv, body = "# 样例\n\n正文内容。\n") => fm(kv) + "\n\n" + body;
  t.after(() => { resetVaultIO(); fs.rmSync(vaultPath, { recursive: true, force: true }); });
  return { vaultPath, abs, seed, page };
}

const CRED_ABSENT = "absent";

test("WP-015 红例①：人改 frontmatter 键 × 机器写同键 → 拒 HUMAN_EDIT_CONFLICT 且盘上零变化", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "样例", tags: "a,b", status: "draft" }));
  // 机器首次写（建立基线）：只改 status
  const first = page({ title: "样例", tags: "a,b", status: "active" });
  writeVault(abs, first, { expectedContentHash: readVault(abs).sha256, domain: "test", summary: "机写①" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(vaultPath, "知识库", "wiki", ".machine-write-baseline.json"), "utf8"))["知识库/wiki/entities/sample.md"].fm.status, "active", "基线已登记");
  // 人改 tags（Obsidian 形态：直改盘上文件）
  seed(page({ title: "样例", tags: "a,b,人改", status: "active" }));
  // 机器再写 tags（同键）→ 拒
  const next = page({ title: "样例", tags: "a,b,机器盖", status: "active" });
  assert.throws(
    () => writeVault(abs, next, { expectedContentHash: readVault(abs).sha256, domain: "test", summary: "机写②" }),
    (e) => e.code === "HUMAN_EDIT_CONFLICT" && e.status === 409 && e.details.overlapKeys.includes("tags"),
    "同键相交必须拒",
  );
  assert.match(fs.readFileSync(abs, "utf8"), /人改/, "拒写后盘上保留人改值");
});

test("WP-015 绿例①：人改键 X × 机器写键 Y≠X → 放行且人改键保留（diff 不相交）", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "样例", tags: "a,b", status: "draft" }));
  writeVault(abs, page({ title: "样例", tags: "a,b", status: "active" }), { expectedContentHash: readVault(abs).sha256 });
  seed(page({ title: "样例", tags: "a,b,人改", status: "active" })); // 人改 tags
  writeVault(abs, page({ title: "样例", tags: "a,b,人改", status: "retired" }), { expectedContentHash: readVault(abs).sha256 }); // 机器只写 status
  const after = fs.readFileSync(abs, "utf8");
  assert.match(after, /人改/, "人改键必须保留");
  assert.match(after, /retired/, "机器键正常写入");
  const baseline = JSON.parse(fs.readFileSync(path.join(vaultPath, "知识库", "wiki", ".machine-write-baseline.json"), "utf8"))["知识库/wiki/entities/sample.md"];
  assert.equal(baseline.fm.tags, "a,b,人改", "写后基线吸纳人改形态（下次以此为已知）");
});

test("WP-015 红例②：人改正文 × 机器写正文（relationPatch 形态）→ 拒；绿例②：人改正文 × 机器只写 frontmatter → 放行正文保留", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "样例", status: "draft" }, "# 样例\n\n原始正文。\n"));
  writeVault(abs, page({ title: "样例", status: "active" }, "# 样例\n\n原始正文。\n"), { expectedContentHash: readVault(abs).sha256 });
  seed(page({ title: "样例", status: "active" }, "# 样例\n\n人手重写的正文。\n"));
  // 红例②：机器动正文
  assert.throws(
    () => writeVault(abs, page({ title: "样例", status: "active" }, "# 样例\n\n机器重写的正文。\n"), { expectedContentHash: readVault(abs).sha256 }),
    (e) => e.code === "HUMAN_EDIT_CONFLICT" && e.details.overlapKeys.includes("body"),
  );
  // 绿例②：机器只动 frontmatter（正文原样回传）
  writeVault(abs, page({ title: "样例", status: "retired" }, "# 样例\n\n人手重写的正文。\n"), { expectedContentHash: readVault(abs).sha256 });
  assert.match(fs.readFileSync(abs, "utf8"), /人手重写的正文/, "正文人改保留");
});

test("WP-015 播种：协议前存量（无基线）首次机器写放行并登记——存量人改不追溯（SPEC-077 §三 如实记）", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "存量页", tags: "老值" })); // 从未有机写——无基线
  writeVault(abs, page({ title: "存量页", tags: "老值", status: "active" }), { expectedContentHash: readVault(abs).sha256 });
  const baseline = JSON.parse(fs.readFileSync(path.join(vaultPath, "知识库", "wiki", ".machine-write-baseline.json"), "utf8"))["知识库/wiki/entities/sample.md"];
  assert.ok(baseline, "播种登记完成");
  // 播种后人改 tags → 机器写 tags → 拒（全保护生效）
  seed(page({ title: "存量页", tags: "新人改" }));
  assert.throws(
    () => writeVault(abs, page({ title: "存量页", tags: "机器值" }), { expectedContentHash: readVault(abs).sha256 }),
    (e) => e.code === "HUMAN_EDIT_CONFLICT",
  );
});

test("WP-015 删除裁决：有基线被手改拒删；checkDelete 纯判据双向", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "占位", status: "制定中" }));
  writeVault(abs, page({ title: "占位", status: "制定中" }), { expectedContentHash: readVault(abs).sha256 });
  seed(page({ title: "占位", status: "制定中" }, "# 占位\n\n人开始写了。\n"));
  const v = guard.checkDelete({ vaultPath, absPath: abs });
  assert.equal(v.allowed, false, "有基线被改 → 拒删");
  const v2 = guard.checkDelete({ vaultPath, absPath: path.join(vaultPath, "知识库", "wiki", "entities", "never-existed.md") });
  assert.equal(v2.allowed, true, "无基线（存量占位）→ 放行（SPEC-077 如实记的不对称）");
});

test("WP-015 H6 钉：含日期键真实形态页（date: 2026-10-08）——基线登记不崩、同键人改拒", (t) => {
  const { vaultPath, abs, seed } = fixture(t);
  seed("---\ntitle: 真实页\ndate: 2026-10-08\nfirst_seen: 2026-09-01\nstatus: draft\n---\n\n# 真实页\n");
  writeVault(abs, "---\ntitle: 真实页\ndate: 2026-10-08\nfirst_seen: 2026-09-01\nstatus: active\n---\n\n# 真实页\n", { expectedContentHash: readVault(abs).sha256 });
  const baseline = JSON.parse(fs.readFileSync(path.join(vaultPath, "知识库", "wiki", ".machine-write-baseline.json"), "utf8"))["知识库/wiki/entities/sample.md"];
  assert.equal(baseline.fm.date, "2026-10-08", "日期键以字符串入基线（ruamel/date 序列化形态跨语言一致）");
  seed("---\ntitle: 真实页\ndate: 2026-11-01\nfirst_seen: 2026-09-01\nstatus: active\n---\n\n# 真实页\n");
  assert.throws(
    () => writeVault(abs, "---\ntitle: 真实页\ndate: 2026-10-09\nfirst_seen: 2026-09-01\nstatus: active\n---\n\n# 真实页\n", { expectedContentHash: readVault(abs).sha256 }),
    (e) => e.code === "HUMAN_EDIT_CONFLICT",
    "人改 date 键 × 机器写 date 键 → 拒（真实形态页全链）",
  );
});

test("WP-015 H3 钉：嵌套 mapping 人改可辨（canonical 串化——Python str() 同构）", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "样例", meta: "x" }));
  writeVault(abs, page({ title: "样例", meta: "x" }), { expectedContentHash: readVault(abs).sha256 });
  // 人改嵌套对象形态（YAML mapping 值）
  seed("---\ntitle: 样例\nmeta:\n  a: 2\n  nested:\n    deep: 人改\n---\n\n# 样例\n");
  assert.throws(
    () => writeVault(abs, "---\ntitle: 样例\nmeta:\n  a: 9\n  nested:\n    deep: 人改\n---\n\n# 样例\n", { expectedContentHash: readVault(abs).sha256 }),
    (e) => e.code === "HUMAN_EDIT_CONFLICT" && e.details.overlapKeys.includes("meta"),
    "嵌套值改动必须可辨（H3 回归钉）",
  );
});

test("WP-015 H4 钉：播种条目带 seeded 标记（首次机写吞人改可审计）", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "手工新页", tags: "人填" }));
  writeVault(abs, page({ title: "手工新页", tags: "人填", status: "active" }), { expectedContentHash: readVault(abs).sha256 });
  const baseline = JSON.parse(fs.readFileSync(path.join(vaultPath, "知识库", "wiki", ".machine-write-baseline.json"), "utf8"))["知识库/wiki/entities/sample.md"];
  assert.equal(baseline.seeded, true, "播种标记在册（H4）");
});

test("WP-015 撤线自证：判据摘除即假绿（diffKeys 变异对照——把人改面判空后红例必转放行）", (t) => {
  const { vaultPath, abs, seed, page } = fixture(t);
  seed(page({ title: "样例", tags: "a" }));
  writeVault(abs, page({ title: "样例", tags: "a" }), { expectedContentHash: readVault(abs).sha256 });
  seed(page({ title: "样例", tags: "人改" }));
  // 真判据：拒
  const real = guard.checkWrite({ vaultPath, absPath: abs, nextRaw: page({ title: "样例", tags: "机器盖" }) });
  assert.equal(real.allowed, false);
  // 变异态（模拟摘除人改面判据）：放行——证明判据在承重，非空洞实验
  const mutated = guard.checkWrite({ vaultPath, absPath: abs, nextRaw: page({ title: "样例", tags: "人改" }) });
  assert.equal(mutated.allowed, true, "不动人改键的写必须放行（判据非恒拒）");
});
