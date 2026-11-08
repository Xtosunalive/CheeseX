// Component: Vocabulary-Profiling-Service Tests（SPEC-006 测试计划四层）
// @responsible: ①纯单元（计数/别名归一/阶段判定/死词）②R1R2 断言（只读/两连扫一致/无落盘）
//               ③集成（fixture vault 全链：实体+文章混合源对账）④形态可组合（波2 discovery 扩展消费示范）
// @inputs: vocabulary-profiling-service + 临时 vault fixture
// @outputs: node:test 断言
// @context: SPEC-006 §测试计划；先例=entity-growth-scanner.test.cjs（SPEC-005 临时目录形态）
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildVocabularyProfile,
  classifyStage,
  DEFAULT_VERIFIED_THRESHOLD,
} = require("../vocabulary-profiling-service.cjs");

function makeVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profiling-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

// 最小词表 fixture：3 module / 2 layer / 2 category / 3 subdomain / 3 tag + 别名一条
const ENUMS = `domains:
  arch: 架构
layers:
  - id: service
  - id: plate
    entity_layer: false
arch_categories:
  - 终端
  - 服务
subdomains:
  arch:
    - api
    - auth
modules:
  可观测性:
    subdomain: api
  消息队列:
    subdomain: api
  孤儿模块:
    subdomain: auth
tags:
  组A:
    - 正式标签一
    - 正式标签二
  组B:
    - 已用标签
disabled_tags: []
tag_aliases:
  别名一: 正式标签一
architecture_projection:
  layer_aliases: {}
  category_aliases: {}
  subdomain_aliases: {}
`;

const ENTITY_OBS = `---
title: 可观测性
architecture-node-id: hh-t
arch_layer: service
arch_category: 终端
arch_subdomain: api
module:
  - 可观测性
tags:
  - 已用标签
---
body
`;

const ENTITY_MQ = `---
title: MQ
architecture-node-id: grown-mq
aliases:
  - mq
module:
  - 消息队列
tags: 别名一
---
body
`;

const ARTICLE_1 = `---
title: 文章一
module: 可观测性
tags:
  - 正式标签一
  - 野生标签X
---
body
`;

const ARTICLE_2 = `---
title: 文章二
arch_layer: 野生层
module:
  - 消息队列
tags: [正式标签二, 正式标签一]
---
body
`;

function fullFixture() {
  return makeVault({
    "知识库/TheSchema/enums.yaml": ENUMS,
    "知识库/wiki/entities/obs.md": ENTITY_OBS,
    "知识库/wiki/entities/mq.md": ENTITY_MQ,
    "知识库/wiki/articles/article-1/a.md": ARTICLE_1,
    "知识库/raw/precleaned/b.md": ARTICLE_2,
  });
}

// ── ① 纯单元 ──

test("classifyStage：0=seed；1..N-1=growing；≥N=verified（阈值注入，2026-10-08 Master 裁决默认 N=1）", () => {
  // 默认阈值 1：任何使用即 verified（真库测试数据宽判定）
  assert.equal(classifyStage(0, 1), "seed");
  assert.equal(classifyStage(1, 1), "verified");
  assert.equal(classifyStage(10, 1), "verified");
  // 阈值参数化：N=3 的判例（页面配置项可调——波2 透传）
  assert.equal(classifyStage(0, 3), "seed");
  assert.equal(classifyStage(1, 3), "growing");
  assert.equal(classifyStage(2, 3), "growing");
  assert.equal(classifyStage(3, 3), "verified");
  // 非法输入防御：阈值非法回落默认 1
  assert.equal(classifyStage(-1, 3), "seed");
  assert.equal(classifyStage(NaN, 3), "seed");
  assert.equal(classifyStage(1, 0), "verified"); // 阈值 0 非法回落默认 1 → 1 次使用即 verified
  assert.equal(classifyStage(DEFAULT_VERIFIED_THRESHOLD, NaN), "verified");
});

// WP-116 红队修复批（P2-2·ADR-015）：parseTagsField 死导出三件退役（函数＋导出＋本空转单测）——
// 其文本级口径无生产调用方，tags 值级由下方 usage 计数/扫描面单测经 articleTagValues 继续在册。

test("单元：usage 计数——实体+文章双侧、别名归一记入正式词", () => {
  const vault = fullFixture();
  const p = buildVocabularyProfile({ vaultPath: vault });

  // module：可观测性=实体1+文章1=2；消息队列=实体1+文章1=2；孤儿模块=0
  const mod = Object.fromEntries(p.dimensions.module.words.map((w) => [w.word, w.usageCount]));
  assert.equal(mod["可观测性"], 2, JSON.stringify(mod));
  assert.equal(mod["消息队列"], 2);
  assert.equal(mod["孤儿模块"], 0);

  // tag：别名归一——实体 MQ 的「别名一」经 tag_aliases 归入「正式标签一」
  // 正式标签一 = 文章一1 + 文章二1 + 别名归一1 = 3；正式标签二 = 文章二1；已用标签 = 实体1
  const tag = Object.fromEntries(p.dimensions.tag.words.map((w) => [w.word, w.usageCount]));
  assert.equal(tag["正式标签一"], 3, JSON.stringify(tag));
  assert.equal(tag["正式标签二"], 1);
  assert.equal(tag["已用标签"], 1);

  // layer：service=实体1；plate（entity_layer:false）不在正式集
  const layer = Object.fromEntries(p.dimensions.layer.words.map((w) => [w.word, w.usageCount]));
  assert.equal(layer["service"], 1);
  assert.ok(!("plate" in layer), "plate 应被排除（entity_layer=false）");

  // subdomain：api=实体1；auth=0（孤儿模块的 subdomain 声明不算使用——只算 frontmatter 实际使用）
  const sub = Object.fromEntries(p.dimensions.subdomain.words.map((w) => [w.word, w.usageCount]));
  assert.equal(sub["api"], 1);
  assert.equal(sub["auth"], 0);
});

test("单元：deadWords=零使用正式词；wildValues 含 module 维度", () => {
  const vault = fullFixture();
  const p = buildVocabularyProfile({ vaultPath: vault });

  assert.deepEqual(p.dimensions.module.deadWords, ["孤儿模块"]);
  assert.deepEqual(p.dimensions.subdomain.deadWords, ["auth"]);

  // 野生值：module 无（两文都用了正式词）→ 有野生层与野生标签
  const wildTags = p.dimensions.tag.wildValues.map((w) => w.value);
  assert.ok(wildTags.includes("野生标签X"));
  const wildLayers = p.dimensions.layer.wildValues.map((w) => w.value);
  assert.ok(wildLayers.includes("野生层"), JSON.stringify(wildLayers));
  // 野生值带计数与文件样例
  const wx = p.dimensions.tag.wildValues.find((w) => w.value === "野生标签X");
  assert.equal(wx.count, 1);
  assert.ok(wx.files.length === 1);
});

test("单元：阶段徽章——默认阈值1（Master 裁决）下任何使用即 verified", () => {
  const vault = fullFixture();
  const p = buildVocabularyProfile({ vaultPath: vault }); // 不传 threshold → 默认 1
  const tag1 = p.dimensions.tag.words.find((w) => w.word === "正式标签一");
  assert.equal(tag1.usageCount, 3);
  assert.equal(tag1.stage, "verified");
  const tag2 = p.dimensions.tag.words.find((w) => w.word === "正式标签二");
  assert.equal(tag2.usageCount, 1);
  assert.equal(tag2.stage, "verified"); // 阈值 1：1 次使用即 verified
  const orphan = p.dimensions.module.words.find((w) => w.word === "孤儿模块");
  assert.equal(orphan.stage, "seed");
  assert.equal(p.summary.verifiedThreshold, 1);
});

// ── ② R1/R2 断言 ──

test("R1 只读：扫描前后全部文件 mtime/内容不变，且零新文件", () => {
  const vault = fullFixture();
  const snapshotBefore = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else snapshotBefore[full] = { mtime: fs.statSync(full).mtimeMs, content: fs.readFileSync(full, "utf8") };
    }
  };
  walk(vault);
  buildVocabularyProfile({ vaultPath: vault });
  const after = {};
  walk2(vault, after);
  function walk2(dir, acc) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk2(full, acc);
      else acc[full] = { mtime: fs.statSync(full).mtimeMs, content: fs.readFileSync(full, "utf8") };
    }
  }
  assert.deepEqual(Object.keys(after).sort(), Object.keys(snapshotBefore).sort(), "R1 违例：出现新文件或丢文件");
  for (const [full, before] of Object.entries(snapshotBefore)) {
    assert.equal(after[full].mtime, before.mtime, `R1 违例：mtime 变更 ${full}`);
    assert.equal(after[full].content, before.content, `R1 违例：内容变更 ${full}`);
  }
});

test("R2 现算：两连扫结果逐字一致（无缓存/无状态）", () => {
  const vault = fullFixture();
  const a = JSON.stringify(buildVocabularyProfile({ vaultPath: vault }));
  const b = JSON.stringify(buildVocabularyProfile({ vaultPath: vault }));
  assert.equal(a, b);
});

// ── ③ 集成：混合源全链对账 ──

test("集成：summary 汇总与维度明细互相咬合（五维度齐全）", () => {
  const vault = fullFixture();
  const p = buildVocabularyProfile({ vaultPath: vault });
  const dims = Object.keys(p.dimensions);
  assert.deepEqual(dims.sort(), ["category", "layer", "module", "subdomain", "tag"]);
  for (const dim of dims) {
    const s = p.summary.dimensions[dim];
    const words = p.dimensions[dim].words;
    assert.equal(s.total, words.length);
    assert.equal(s.seed + s.growing + s.verified, words.length, `${dim} 阶段计数不咬合`);
    assert.equal(s.dead, p.dimensions[dim].deadWords.length, `${dim} 死词计数不咬合`);
    assert.equal(s.wild, p.dimensions[dim].wildValues.length, `${dim} 野生计数不咬合`);
  }
  assert.equal(p.summary.verifiedThreshold, 1); // Master 裁决默认
  assert.ok(p.summary.totalWords > 0);
});

// ── ④ 可组合性：波2 discovery 扩展消费示范 ──

test("可组合：profile 输出可被 discovery 响应直接合并扩展（形态契约）", () => {
  const vault = fullFixture();
  const profile = buildVocabularyProfile({ vaultPath: vault });
  // 波2 消费形态示范：discoveryData() 响应上扩展 vocabularyProfile 字段
  const discoveryLike = { discovery: {}, counts: { total: 0 } };
  const extended = { ...discoveryLike, vocabularyProfile: { dimensions: profile.dimensions, summary: profile.summary } };
  // 断言序列化干净（响应可直接 JSON 化——无 Set/Map 泄漏：Map 序列化会变 {}，Set 变 {}）
  const json = JSON.stringify(extended);
  assert.ok(json.includes('"deadWords"'));
  assert.ok(json.includes('"stage":"verified"'));
  assert.ok(!json.includes('"words":{}'), "words 若是 Map 会序列化为空对象——形态契约破坏");
  const roundTrip = JSON.parse(json);
  assert.equal(roundTrip.vocabularyProfile.summary.verifiedThreshold, 1);
});

test("可组合：ruleSet 注入复用（不重复读 enums）+ verifiedThreshold 参数化（页面配置项可调预演）", () => {
  const vault = fullFixture();
  const { buildRuleSet } = require("../../../shared/enums-loader.cjs");
  const { readEnums } = require("../../../shared/schema-config.cjs");
  const ruleSet = buildRuleSet(readEnums(vault));
  const p1 = buildVocabularyProfile({ vaultPath: vault, ruleSet }); // 默认 1
  const p2 = buildVocabularyProfile({ vaultPath: vault, ruleSet, verifiedThreshold: 3 }); // 页面调严
  // 默认 1：usageCount=1 即 verified；调严 3：回到 growing/seed
  const mq1 = p1.dimensions.module.words.find((w) => w.word === "消息队列");
  assert.equal(mq1.usageCount, 2);
  assert.equal(mq1.stage, "verified");
  const mq2 = p2.dimensions.module.words.find((w) => w.word === "消息队列");
  assert.equal(mq2.stage, "growing");
  assert.equal(p2.summary.verifiedThreshold, 3);
});

// ADR-008 D1＋Master 2026-10-17 生长观察面：subdomain 词条 label 随画像输出＋unlabeled 计数。
test("画像生长观察面：subdomain 词条带 label，缺 label 计入 unlabeled", () => {
  const enums = {
    domains: { tech: "技术" },
    subdomains: { tech: [{ id: "api", label: "API 接口" }, { id: "auth" }] },
  };
  const vault = makeVault({ "知识库/TheSchema/enums.yaml": require("yaml").stringify(enums) });
  const { buildRuleSet } = require("../../../shared/enums-loader.cjs");
  const ruleSet = buildRuleSet(enums);
  const p = buildVocabularyProfile({ vaultPath: vault, ruleSet });
  const api = p.dimensions.subdomain.words.find((w) => w.word === "api");
  assert.equal(api.label, "API 接口", "带 label 词条随画像输出");
  const auth = p.dimensions.subdomain.words.find((w) => w.word === "auth");
  assert.equal("label" in auth, false, "无 label 词条不带该键");
  assert.equal(p.summary.dimensions.subdomain.unlabeled, 1, "缺 label 计数=1（auth）");
  // 其他维度无 label 概念，unlabeled 恒 0
  assert.equal(p.summary.dimensions.module.unlabeled, 0);
});

// ── WP-116 批1 行为钉：文章侧 frontmatter 装载改经文档装载宿主（loadDocument＋docField）——
// 边界输入产出与迁移前基线探针实测逐字一致：无 frontmatter/空文件/未闭合块/空块整文跳过
// （全部维度不计）；多 --- 只取第一块；CRLF 宿主可解析（旧行级正则整文跳过——切分口径
// 收敛的如实增列）；流式数组按 YAML 数组计（旧标量正则排除 [ 开头不收——如实增列）；
// `[` 起始标量不收（旧排除面保持）；数字标量按文本计野生。
test("WP-116 文章侧装载钉：无 frontmatter/空文件/未闭合/空块整文跳过", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": ENUMS,
    "知识库/raw/precleaned/no-fm.md": "没有frontmatter\nmodule: 可观测性\n",
    "知识库/raw/precleaned/empty.md": "",
    "知识库/raw/precleaned/unclosed.md": "---\nmodule: 可观测性\n",
    "知识库/raw/precleaned/empty-block.md": "---\n---\nmodule: 可观测性\n",
  });
  const p = buildVocabularyProfile({ vaultPath: vault });
  const mod = Object.fromEntries(p.dimensions.module.words.map((w) => [w.word, w.usageCount]));
  assert.equal(mod["可观测性"], 0, "四个边界文件全部跳过——module 不计数：" + JSON.stringify(mod));
  assert.equal(p.dimensions.module.wildValues.length, 0, "野生面同样零记录");
});

test("WP-116 文章侧装载钉：宿主可解析形态按值计数（含如实增列与保持面）", () => {
  const vault = makeVault({
    "知识库/TheSchema/enums.yaml": ENUMS,
    "知识库/raw/precleaned/multi.md": "---\ntitle: t\nmodule: 消息队列\n---\n正文\n---\nmodule: 孤儿模块\n---\n",
    "知识库/raw/precleaned/crlf.md": "---\r\ntitle: c\r\nmodule: 可观测性\r\n---\r\n正文",
    "知识库/raw/precleaned/flow.md": "---\nmodule: [消息队列]\n---\n正文",
    "知识库/raw/precleaned/wikilink.md": "---\nmodule: [[主模块]]\n---\n正文",
    "知识库/raw/precleaned/num.md": "---\nmodule: 123\n---\n正文",
  });
  const p = buildVocabularyProfile({ vaultPath: vault });
  const mod = Object.fromEntries(p.dimensions.module.words.map((w) => [w.word, w.usageCount]));
  assert.equal(mod["消息队列"], 2, "多 --- 第一块＋流式数组各计 1");
  assert.equal(mod["可观测性"], 1, "CRLF 文件宿主可解析（旧正则跳过——如实增列）");
  assert.equal(mod["孤儿模块"], 0, "第二块不计");
  const wild = p.dimensions.module.wildValues.map((w) => w.value);
  assert.ok(wild.includes("123"), "数字标量按文本计野生（与旧口径一致）");
  assert.ok(!wild.includes("[[主模块]]") && !wild.includes("主模块"), "`[` 起始标量不收（旧正则排除面保持）");
});
