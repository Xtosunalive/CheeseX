// Component: Entity-Growth-Scanner Tests（SPEC-005 测试计划四层）
// @responsible: ①纯单元（候选提取/噪音排除）②R1R2 断言（只读/两连扫一致/无落盘）
//               ③集成（fixture 全链：候选→已解析→消失；孤儿检测）
// @inputs: entity-growth-scanner + 临时 vault fixture
// @outputs: node:test 断言
// @context: SPEC-005 §测试计划；先例=check-taxonomy-growth.test.mjs（临时目录形态）
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scanEntityCandidates, scanOrphanEntities } = require("../entity-growth-scanner.cjs");
const { buildEntityIndexes } = require("../../entity-compliance/entity-compliance-service.cjs");

function makeVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "growth-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

const indexesOf = (entities) => buildEntityIndexes(entities);

test("A1 纯单元：unresolved wikilink → 候选；已解析 → 非候选（mention 计数）", () => {
  const vault = makeVault({
    "知识库/wiki/articles/a.md": "---\ntitle: A\n---\n看看 [[可观测性]] 与 [[2026-08-16-dikw-communication-gap-mapping]] 的关系。\n",
    "知识库/wiki/entities/observability.md": "---\ntitle: 可观测性\narchitecture-node-id: obs-1\n---\nbody\n",
  });
  const before = fs.statSync(path.join(vault, "知识库/wiki/articles/a.md")).mtimeMs;
  const entities = [{ fileName: "observability.md", sourcePath: "知识库/wiki/entities/observability.md", frontmatter: { title: "可观测性", "architecture-node-id": "obs-1" } }];
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf(entities) });
  // 已解析：可观测性 → entityMentions；未解析：2026-08-16-... 是日期模式被排除？
  // 「2026-08-16-dikw-...」以日期开头——按 DATE_NOTE_RE 排除 → 不进候选。
  // 但我们要验证它是被日期规则排除而「不是候选」，同时「可观测性」被解析为 mention。
  const candNames = r.candidates.map((c) => c.name);
  assert.ok(!candNames.includes("可观测性"), "已解析目标不是候选");
  assert.ok(r.entityMentions.some((m) => m.name === "可观测性" && m.mentionCount === 1), "已解析目标计 mention");
  assert.ok(!candNames.some((n) => DATE_NOTE_OK(n)), "日期模式不进候选");
  assert.equal(fs.statSync(path.join(vault, "知识库/wiki/articles/a.md")).mtimeMs, before, "R1: 扫描不写任何文件（mtime 不变）");
});

function DATE_NOTE_OK(n) { return /^\d{4}-\d{2}-\d{2}/.test(n) === false && n.includes("dikw"); }

test("A1 纯单元：非日期模式的 unresolved → 候选带样例", () => {
  const vault = makeVault({
    "知识库/wiki/articles/b.md": "---\ntitle: B\n---\n文中提到 [[消息队列]] 两次：[[消息队列]] 很重要。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const mq = r.candidates.find((c) => c.name === "消息队列");
  assert.ok(mq, "unresolved 目标成为候选");
  assert.equal(mq.mentionCount, 2, "同文提及计数累积");
  assert.ok(mq.samples.length >= 1 && mq.samples[0].file.includes("b.md"), "样例带来源文件（H2 来源坐标）");
});

test("A1 纯单元：代码块内 wikilink 排除；TheSchema 排除", () => {
  const vault = makeVault({
    "知识库/wiki/articles/c.md": "---\ntitle: C\n---\n```text\n[[代码块里的链接]]\n```\n正文 [[真实候选]]。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const names = r.candidates.map((c) => c.name);
  assert.ok(!names.includes("代码块里的链接"), "代码块内不算提及");
  assert.ok(names.includes("真实候选"), "正文提及成候选");
});

test("R2：两连扫结果一致（纯现算无状态）+ 扫描不产生新文件", () => {
  const vault = makeVault({
    "知识库/wiki/articles/d.md": "---\ntitle: D\n---\n[[候选X]]\n",
  });
  const filesBefore = fs.readdirSync(path.join(vault), { recursive: true }).length;
  const r1 = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const r2 = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  assert.deepEqual(r1.candidates, r2.candidates, "两连扫一致（无状态）");
  assert.equal(fs.readdirSync(path.join(vault), { recursive: true }).length, filesBefore, "R2: 无新文件产生");
});

test("集成：候选→建实体→再扫候选消失（生长闭环传感器侧）", () => {
  const vault = makeVault({
    "知识库/wiki/articles/e.md": "---\ntitle: E\n---\n多次提到 [[知识图谱]]。\n",
  });
  const empty = indexesOf([]);
  const r1 = scanEntityCandidates({ vaultPath: vault, indexes: empty });
  assert.ok(r1.candidates.some((c) => c.name === "知识图谱"), "建实体前是候选");
  // 模拟 A3 建实体后（absorb 通道产物）：实体加入索引
  const grown = [{ fileName: "知识图谱.md", sourcePath: "知识库/wiki/entities/知识图谱.md", frontmatter: { title: "知识图谱", "architecture-node-id": "kg-1", origin: "article-grown" } }];
  const r2 = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf(grown) });
  assert.ok(!r2.candidates.some((c) => c.name === "知识图谱"), "建实体后候选消失（已解析）");
  assert.ok(r2.entityMentions.some((m) => m.name === "知识图谱"), "转为 mention 计数");
});

test("A5：零提及实体 → orphan（只读清单）", () => {
  const entities = [
    { fileName: "孤儿.md", sourcePath: "x/孤儿.md", frontmatter: { title: "孤儿实体", "architecture-node-id": "orphan-1" } },
    { fileName: "活跃.md", sourcePath: "x/活跃.md", frontmatter: { title: "活跃实体", "architecture-node-id": "live-1" } },
  ];
  const orphans = scanOrphanEntities(indexesOf(entities), [{ name: "活跃实体", mentionCount: 3 }]);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].name, "孤儿实体");
});

// ── PR-043B：字段引用信号（frontmatter module → 候选）──
// 背景：module 值在词表内但无实体时，正文 wikilink 通道收不到（值在 frontmatter 不在正文），
// 问题单报缺实体但候选卡不显示——用户被逼手工建页。字段信号补这个洞。

test("PR-043B：module 字段值在词表内且无实体 → 出候选 source=field-reference", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  可观测性:\n    subdomain: observability\n",
    "知识库/raw/precleaned/article.md": "---\ntitle: A\nmodule: 可观测性\n---\n正文不提。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const cand = r.candidates.find((c) => c.name === "可观测性");
  assert.ok(cand, "字段引用产出候选");
  assert.deepEqual(cand.sources, ["field-reference"]);
  assert.equal(cand.samples[0].coordinate, "frontmatter:module");
});

test("PR-043B：module 值已有实体文件 → 不出候选", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  可观测性:\n    subdomain: observability\n",
    "知识库/wiki/entities/可观测性.md": "---\ntitle: 可观测性\n---\n实体在。\n",
    "知识库/raw/precleaned/article.md": "---\ntitle: A\nmodule: 可观测性\n---\n正文。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  assert.ok(!r.candidates.some((c) => c.name === "可观测性"), "实体存在则字段信号静默");
});

test("PR-043B：module 值不在词表 → 不出候选（野生值归 wild_tag 通道）", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  别的模块:\n    subdomain: x\n",
    "知识库/raw/precleaned/article.md": "---\ntitle: A\nmodule: 完全野生值\n---\n正文。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  assert.ok(!r.candidates.some((c) => c.name === "完全野生值"), "词表外不进生长候选");
});

test("PR-043B：同名字段+正文双来源 → 合并为单候选（body-mention 在前）", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  可观测性:\n    subdomain: observability\n",
    "知识库/wiki/articles/b.md": "---\ntitle: B\n---\n正文提到 [[可观测性]]。\n",
    "知识库/raw/precleaned/c.md": "---\ntitle: C\nmodule: 可观测性\n---\n正文不提。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const cand = r.candidates.find((c) => c.name === "可观测性");
  assert.ok(cand, "双来源候选存在");
  assert.deepEqual(cand.sources, ["body-mention"], "正文候选优先，字段引用不重复立卡（samples 已含两侧）");
});

// ── PR-043B：字段引用信号（frontmatter module → 候选）──
// 背景：module 值在词表内但无实体时，正文 wikilink 通道收不到（值在 frontmatter 不在正文），
// 问题单报缺实体但候选卡不显示——用户被逼手工建页。字段信号补这个洞。

test("PR-043B：module 字段值在词表内且无实体 → 出候选 source=field-reference", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  可观测性:\n    subdomain: observability\n",
    "知识库/raw/precleaned/article.md": "---\ntitle: A\nmodule: 可观测性\n---\n正文不提。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const cand = r.candidates.find((c) => c.name === "可观测性");
  assert.ok(cand, "字段引用产出候选");
  assert.deepEqual(cand.sources, ["field-reference"]);
  assert.equal(cand.samples[0].coordinate, "frontmatter:module");
});

test("PR-043B：module 值已有实体文件 → 不出候选", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  可观测性:\n    subdomain: observability\n",
    "知识库/wiki/entities/可观测性.md": "---\ntitle: 可观测性\n---\n实体在。\n",
    "知识库/raw/precleaned/article.md": "---\ntitle: A\nmodule: 可观测性\n---\n正文。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  assert.ok(!r.candidates.some((c) => c.name === "可观测性"), "实体存在则字段信号静默");
});

test("PR-043B：module 值不在词表 → 不出候选（野生值归 wild_tag 通道）", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  别的模块:\n    subdomain: x\n",
    "知识库/raw/precleaned/article.md": "---\ntitle: A\nmodule: 完全野生值\n---\n正文。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  assert.ok(!r.candidates.some((c) => c.name === "完全野生值"), "词表外不进生长候选");
});

test("PR-043B：同名字段+正文双来源 → 合并为单候选（body-mention 在前）", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": "modules:\n  可观测性:\n    subdomain: observability\n",
    "知识库/wiki/articles/b.md": "---\ntitle: B\n---\n正文提到 [[可观测性]]。\n",
    "知识库/raw/precleaned/c.md": "---\ntitle: C\nmodule: 可观测性\n---\n正文不提。\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const cand = r.candidates.find((c) => c.name === "可观测性");
  assert.ok(cand, "双来源候选存在");
  assert.deepEqual(cand.sources, ["body-mention"], "正文候选优先，字段引用不重复立卡（samples 已含两侧）");
});

// ── WP-116 批1 行为钉：readFrontmatterModule 切分改经文档装载宿主（loadDocument＋docField）——
// 边界输入产出与迁移前基线探针实测逐字一致：引号值同为去引号；块列表/对象形态不出候选（旧正则
// 不匹配 → null，同）；未闭合块/BOM/空文件不出候选；多 --- 只取第一块；CRLF 宿主可解析
// （旧行级正则整文跳过——切分口径收敛的如实增列）。readBody（正文提及）批2 已同口收宿主
// （loadDocument 取 body，见 WP-116 批2 钉）——CRLF 件元数据区 [[提及]] 不再误计（旧缺陷收口）。
const MODULE_VOCAB = "modules:\n  可观测性:\n    subdomain: observability\n";

test("WP-116 module 字段钉：宿主切分与旧口径同产出（含如实增列）", () => {
  const mk = (content, name = "article.md") => {
    const vault = makeVault({
      "知识库/TheSchema/enums.yaml": MODULE_VOCAB,
      [`知识库/raw/precleaned/${name}`]: content,
    });
    return scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) })
      .candidates.some((c) => c.name === "可观测性" && (c.sources || []).includes("field-reference"));
  };
  // 引号标量：旧口径去引号后命中词表 → 出候选；宿主同
  assert.ok(mk("---\ntitle: t\nmodule: \"可观测性\"\n---\n正文不提。"), "引号标量出候选（与旧口径一致）");
  // 块列表形态：旧正则不匹配（值在下一行）→ 无候选；宿主数组形态同样不出字段候选
  assert.ok(!mk("---\ntitle: t\nmodule:\n  - 可观测性\n---\n正文不提。"), "块列表不出字段候选（与旧口径一致）");
  // 未闭合块：无候选（旧 null；宿主空 frontmatter → null，同）
  assert.ok(!mk("---\ntitle: t\nmodule: 可观测性\n"), "未闭合块不出候选（与旧口径一致）");
  // BOM/空文件：无候选
  assert.ok(!mk("﻿---\ntitle: t\nmodule: 可观测性\n---\n正文"), "BOM 不出候选（与旧口径一致）");
  assert.ok(!mk(""), "空文件不出候选");
  // 多 ---：只取第一块——第二块的 module 不触发
  assert.ok(!mk("---\ntitle: t\n---\n正文\n---\nmodule: 可观测性\n---\n"), "第二块 module 不触发（与旧口径一致）");
  // CRLF：宿主可解析 → 出候选（旧行级正则整文跳过——WP-116 切分口径收敛的如实增列）
  assert.ok(mk("---\r\ntitle: t\r\nmodule: 可观测性\r\n---\r\n正文不提。"), "CRLF 宿主可解析（如实增列）");
});

// WP-116 红队修复批（P2-1）：CRLF 件正文提及钉——readBody 批2 已经宿主（loadDocument 取 body），
// CRLF 文件的 frontmatter 块被正确剥离：元数据区内的 [[X]] 不计正文提及（旧正则对 CRLF 件不剥
// 元数据区属旧缺陷，宿主语义与批 1 admission-policy W01 口径一致）。
test("WP-116 批2 readBody 钉：CRLF 件 frontmatter 内 [[X]] 不计正文提及，正文 [[Y]] 照常计", () => {
  const vault = makeVault({
    "知识库/wiki/articles/crlf.md": "---\r\ntitle: t\r\nmeta-link: [[元数据链]]\r\n---\r\n正文提到 [[正文链]]。\r\n",
  });
  const r = scanEntityCandidates({ vaultPath: vault, indexes: indexesOf([]) });
  const names = r.candidates.map((c) => c.name);
  assert.ok(!names.includes("元数据链"), "frontmatter 内 [[X]] 不计提及（宿主已剥元数据区）");
  assert.ok(names.includes("正文链"), "正文 [[Y]] 照常计提及");
});
