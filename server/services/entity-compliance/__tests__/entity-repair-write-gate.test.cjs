// Component: Entity-Repair-Service 写入门禁测试（F5，#1415）
// @responsible: 验证实体写入（新建+存量编辑）在落盘前 fail-closed 拦截合规 blocker——
//               postCheck 早已计算 blockerCount，本门禁补上「算而不法」缺失的执法分支。
// @inputs: 临时 Vault entity/article Markdown
// @outputs: 单元测试断言
// @context: Vault
// 背景（2026-09-06 人工验证实录）：Web 创建实体 architecture-node-id 含大写 + tags 空数组 →
// apply 照样落盘 → 管道 Stage 0.5 才 fail-closed，且 V1 重命名保护令错误 id API 不可修。

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createEntityRepairService, revision } = require("../entity-repair-service.cjs");
const { buildWriteGatePolicy } = require("../../../shared/write-gate-policy.cjs");

const rules = {
  archLayers: ["service"], archCategories: ["服务"], statuses: ["有效", "灰度"], moduleNames: ["Fixture模块"], // 2026-10-08 字段托管：statuses 加灰度（创建注入默认值）
  articleTypes: ["最佳实践"], docTypes: ["用户手册"], categoryPaths: ["ops.maintain"], products: ["AnyShare"],
  versionsByProduct: { AnyShare: ["7.0.0.0", "7.0.6.7"] }, layerAliases: {}, categoryAliases: {}, wikilinkTypeLabels: { "关联": "relates_to", "依赖": "depends_on" },
  versionableRelations: new Set(["depends_on"]), wikilinkRelations: new Set(["depends_on", "relates_to"]),
  allRegisteredVersions: ["7.0.0.0", "7.0.6.7", "8.0.0.0"],
};

function setupVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "repair-write-gate-"));
  fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities"), { recursive: true });
  fs.mkdirSync(path.join(vault, "知识库", "raw", "precleaned"), { recursive: true });
  const service = createEntityRepairService({ vaultPath: vault, ruleSetProvider: () => rules });
  return { vault, service };
}

const ENTITY_SOURCE_KEY = "知识库/wiki/entities/target.md";
const ARTICLE_SOURCE_KEY = "知识库/raw/precleaned/article-x.md";

const VALID_ENTITY_RAW = "---\ntitle: Target\narchitecture-node-id: target\narch_component: true\narch_layer: service\narch_category: 服务\nmodule: [Fixture模块]\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]\n---\n\n# Target\n\n正文。\n";

/** 新建实体的最小合法 changes 集（可被用例覆盖个别字段制造违规）。
 *  WP-113 M2：architecture-node-id 已从本集退役——新建身份由系统铸造（entity-identity-mint），
 *  调用方自带任何值（含空串）即被来源门拒（拒面见 T1）。 */
function createChanges(overrides = {}) {
  return {
    title: "Target", arch_component: true,
    arch_layer: "service", arch_category: "服务", module: ["Fixture模块"],
    date: "2025-01-01", updated: "2025-01-01", status: "有效", tags: ["entity"],
    ...overrides,
  };
}

function previewCreate(service, changes) {
  return service.preview({ sourceKey: ENTITY_SOURCE_KEY, createIfMissing: true, initialTitle: "Target", changes });
}

/** 直接在临时库落一篇合规实体（造「已被他人占用的身份」用） */
function writeEntityFile(vault, name, id, title) {
  const file = path.join(vault, "知识库", "wiki", "entities", name + ".md");
  fs.writeFileSync(file, `---\ntitle: ${title}\narchitecture-node-id: ${id}\narch_component: true\narch_layer: service\narch_category: 服务\nmodule: [Fixture模块]\ndate: 2025-01-01\nupdated: 2025-01-01\nstatus: 有效\ntags: [entity]\n---\n\n# ${title}\n\n正文。\n`, "utf8");
  return file;
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓ " + name); }
  catch (error) { failures += 1; console.log("  × " + name + " — " + error.message); }
}

(function run() {
  console.log("F5 写入门禁（实体 create + edit fail-closed；文章渐进补齐保持 advisory）");

  test("T1（WP-113 M2 ①·原 F02 必填路径改写）新建提交自带身份（含空白串）→ preview 即 400 rule=system-minted，不落盘——身份来源收权，「人把必填留空」不再是可达状态", () => {
    const { vault, service } = setupVault();
    try {
      for (const submitted of ["my-own-id", "", "   "]) {
        assert.throws(() => previewCreate(service, createChanges({ "architecture-node-id": submitted })), (e) => {
          assert.strictEqual(e.code, "VALIDATION_ERROR", "错误码沿用在册 VALIDATION_ERROR（PR-206 教训：只新增 rule 值，不新增码）");
          assert.strictEqual(e.status, 400);
          assert.deepStrictEqual({ field: e.details && e.details.field, rule: e.details && e.details.rule }, { field: "architecture-node-id", rule: "system-minted" });
          return true;
        }, `自带身份「${JSON.stringify(submitted)}」应被 system-minted 拒`);
      }
      assert(!fs.existsSync(path.join(vault, ENTITY_SOURCE_KEY)), "自带身份被拒不落盘");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T1b 批A 反证（WP-113 M2/M6 随迁）：含大写/含中文的标题不再被形状拦——F02 只判必填，身份号与标题无关", () => {
    const { vault, service } = setupVault();
    try {
      for (const title of ["AnyRobot-node-1", "grown-测试模块"]) {
        const preview = previewCreate(service, createChanges({ title }));
        const f02 = (preview.postCheck.blockers || []).filter((b) => b.ruleId === "F02");
        assert.strictEqual(f02.length, 0, `以「${title}」为标题新建不应因身份形状产 F02 阻断（号由系统给）`);
      }
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T2 新建实体 tags 空数组（F16）→ preview 阶段即拒绝（#1803 门禁前移）", () => {
    const { vault, service } = setupVault();
    try {
      assert.throws(() => previewCreate(service, createChanges({ tags: [] })), (e) => {
        if (e.code !== "ENTITY_COMPLIANCE_BLOCKED") return false;
        const blockers = (e.details && e.details.blockers) || [];
        return blockers.some((b) => b.ruleId === "F16");
      });
      assert(!fs.existsSync(path.join(vault, ENTITY_SOURCE_KEY)));
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T3 守卫：完全合规的新建（人不填身份）→ apply 正常落盘，身份为系统铸造的主干号", () => {
    const { vault, service } = setupVault();
    try {
      const preview = previewCreate(service, createChanges());
      const applied = service.apply({ previewId: preview.previewId, confirmed: true });
      assert(applied.entityId && !String(applied.entityId).includes("Target"), `身份应由系统铸造且为不透明串（不带标题语义），实得 ${JSON.stringify(applied.entityId)}`);
      assert(fs.existsSync(path.join(vault, ENTITY_SOURCE_KEY)), "合规实体应落盘");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T4 守卫：存量编辑引入 blocker（tags 清空）→ preview 阶段被 POST_CHECK_REGRESSION 拦截（既有回归语义，本切片回归保护）", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW, "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      assert.throws(() => service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { tags: [] } }), (e) => e.code === "POST_CHECK_REGRESSION");
      assert(fs.readFileSync(file, "utf8") === VALID_ENTITY_RAW, "原文件必须保持不变");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T5 守卫：文章修复带 blocker（渐进补齐中间态）→ apply 保持放行", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ARTICLE_SOURCE_KEY);
      // 故意缺 module/version 等（合法中间态：分步补齐）
      fs.writeFileSync(file, "---\narticle_id: article-x\ntitle: Article X\nstatus: 有效\ndate: 2025-01-01\nupdated: 2025-01-01\ntags: [entity]\nproduct: AnyShare\n---\n\n# Article X\n\n正文。\n", "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const preview = service.preview({ sourceKey: ARTICLE_SOURCE_KEY, sourceRevision, changes: { module: "Fixture模块" } });
      const applied = service.apply({ previewId: preview.previewId, confirmed: true });
      assert(applied.postCheck.blockerCount >= 0, "文章 postCheck 保持计数展示");
      assert(fs.readFileSync(file, "utf8").includes("Fixture模块"), "文章渐进补齐必须放行");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T7 PR-232 随迁（WP-113 M2）：自带与他人相撞的身份 → 先撞来源门 400 system-minted（不再是 F02b 点名持有者的 422）——点名语义移交编辑补填/apply 复算面（T9／T12）", () => {
    const { vault, service } = setupVault();
    try {
      writeEntityFile(vault, "holder", "mysql-primary", "持有者实体");
      assert.throws(() => previewCreate(service, createChanges({ "architecture-node-id": "mysql-primary" })), (e) => {
        assert.strictEqual(e.code, "VALIDATION_ERROR");
        assert.strictEqual(e.status, 400);
        assert.strictEqual(e.details && e.details.rule, "system-minted", "来源门在前：撞号自带值先被「不许自带」拒，而非唯一性点名");
        return true;
      });
      assert(!fs.existsSync(path.join(vault, ENTITY_SOURCE_KEY)), "撞身份实体不得落盘");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T10 复核回件：sourceKey 大小写与盘上文件名不一致时编辑自身 → 不得把自己当冲突（macOS realpath 不校正大小写）", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, "知识库", "wiki", "entities", "Target.md"); // 盘上大写字面
      fs.writeFileSync(file, VALID_ENTITY_RAW, "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const lowerKey = "知识库/wiki/entities/target.md"; // 小写请求
      const req = { sourceKey: lowerKey, sourceRevision, changes: { title: "Target 改名" } };
      // PR-273 根治第二轮（CI 实测打回第一轮修法）：Linux 上抛「源 entity 不存在」的是第一次 preview 本身，
      // 上一版只分叉了断言、调用仍在分支外，故敏感卷照旧崩。现把调用一并放进分支——两支各自真实执行自己的语义。
      const caseInsensitiveVolume = fs.existsSync(path.join(vault, lowerKey));
      if (caseInsensitiveVolume) {
        const preview = service.preview(req);
        const f02b = (preview.postCheck.blockers || []).filter((b) => b.ruleId === "F02b");
        assert.strictEqual(f02b.length, 0, "同一文件的两种大小写写法不得互相判成冲突（大小写不敏感卷）");
      } else {
        assert.throws(() => service.preview(req), (e) => {
          const detail = String((e && (e.message || JSON.stringify(e.details || ""))) || "");
          assert.ok(/源 entity 不存在|not found|ENOENT/i.test(detail), `应 fail-closed 报源不存在，实得：${detail}`);
          return true;
        }, "大小写敏感卷上小写键指向不存在的实体，必须显式拒绝而非静默放行或自判冲突");
      }
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T11 复核回件：实体在子目录里也进唯一性素材（平铺扫描名不副实即红；WP-113 M2 后自带建号入口已关，本用例走编辑补填通道验素材面不变）", () => {
    const { vault, service } = setupVault();
    try {
      fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities", "sub"), { recursive: true });
      fs.writeFileSync(path.join(vault, "知识库", "wiki", "entities", "sub", "holder.md"), VALID_ENTITY_RAW.replace("title: Target", "title: 子夹持有者"), "utf8");
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW.replace("architecture-node-id: target", "architecture-node-id:"), "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      assert.throws(() => service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { "architecture-node-id": "target" } }), (e) => {
        const detail = JSON.stringify(e.details || e.message || "");
        return e.code === "POST_CHECK_REGRESSION" && detail.includes("F02b") && detail.includes("子夹持有者");
      }, "子目录实体的身份同样算冲突（空号补填通道）");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T12 复核回件：preview 铸出身份后、apply 前同一身份被他人落盘 → 复算拒写；占用解除后同一预览仍可完成（不复用 preview 快照）", () => {
    const { vault, service } = setupVault();
    try {
      const keyA = "知识库/wiki/entities/a-dup.md";
      const pa = service.preview({ sourceKey: keyA, createIfMissing: true, initialTitle: "A 组件", changes: createChanges({ title: "A 组件" }) });
      assert(pa.entityId && !String(pa.entityId).includes("A 组件"), "preview 响应须回显系统铸出的不透明身份");
      writeEntityFile(vault, "jumper", pa.entityId, "插队者");
      assert.throws(() => service.apply({ previewId: pa.previewId, confirmed: true }), (e) => {
        const detail = JSON.stringify(e.details || e.message || "");
        return e.code === "ENTITY_COMPLIANCE_BLOCKED" && detail.includes("F02b");
      }, "apply 必须按当前盘态复算并拒绝（快照里没有插队者）");
      assert(!fs.existsSync(path.join(vault, keyA)), "撞号后不得落盘");
      fs.rmSync(path.join(vault, "知识库", "wiki", "entities", "jumper.md"));
      const reApplied = service.apply({ previewId: pa.previewId, confirmed: true });
      assert.strictEqual(reApplied.entityId, pa.entityId, "占用解除后同一预览可完成（铸造号已随 preview 定形）");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T13 复核回件：悬空软链等坏素材不得把无关编辑打成 500", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW, "utf8");
      fs.symlinkSync(path.join(vault, "不存在的目标.md"), path.join(vault, "知识库", "wiki", "entities", "dangling.md"));
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const preview = service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { title: "Target 改名2" } });
      assert(preview.previewId, "含悬空链接的库仍可正常 preview（坏条目跳过，不整体抛错）");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T8 PR-232 反面对照：编辑自身且身份不变 → 不得把自己算成冲突（自排除失效即红）", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW, "utf8"); // 盘上这一篇已带 id=target
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const preview = service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { title: "Target 改名" } });
      const f02b = (preview.postCheck.blockers || []).filter((b) => b.ruleId === "F02b");
      assert.strictEqual(f02b.length, 0, "同一篇文档自身不得触发唯一性阻断");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T9 PR-232 空身份补填成他人已占值 → 被唯一性守卫拦（改名守卫只管已有值，这条是另一入口）", () => {
    const { vault, service } = setupVault();
    try {
      writeEntityFile(vault, "holder", "mysql-primary", "持有者实体");
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW.replace("architecture-node-id: target", "architecture-node-id:"), "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      assert.throws(() => service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { "architecture-node-id": "mysql-primary" } }), (e) => {
        const detail = JSON.stringify(e.details || e.message || "");
        return e.code === "POST_CHECK_REGRESSION" && detail.includes("F02b");
      }, "把空身份补成他人已占值应抛 POST_CHECK_REGRESSION 且明细含 F02b");
      assert(fs.readFileSync(file, "utf8") === VALID_ENTITY_RAW.replace("architecture-node-id: target", "architecture-node-id:"), "被拦后原文件必须不变");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T14 D-1 改身份被拒且判据来自声明（VALIDATION_ERROR/rule=immutable），同值重交不误伤", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW, "utf8"); // 现值 id=target
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      assert.throws(
        () => service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { "architecture-node-id": "other-id" } }),
        (e) => e.code === "VALIDATION_ERROR" && e.status === 422 && e.details && e.details.rule === "immutable" && e.details.field === "architecture-node-id",
        "改身份应 422 且 details.rule=immutable（声明驱动）"
      );
      const same = service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { "architecture-node-id": "target", title: "Target 改名" } });
      assert(same.previewId, "反面对照：提交与现值相同的身份不算重命名，不得误拦");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  // D-1b（WP-110）：文章族「创建后不可修改」的判据改由声明表提供（ARTICLE_GATE_RULES），
  // 原服务端点名裸 if 退役。三条分别钉：拒写形状不变／同值不误伤／空值仍可补填（锁改不锁填）。
  test("T15 D-1b 文章改 article_id 被拒且判据来自声明（VALIDATION_ERROR/422/rule=immutable，文案与声明逐字节同）", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ARTICLE_SOURCE_KEY);
      fs.writeFileSync(file, "---\narticle_id: article-x\ntitle: Article X\nstatus: 有效\ndate: 2025-01-01\nupdated: 2025-01-01\ntags: [entity]\nproduct: AnyShare\n---\n\n# Article X\n\n正文。\n", "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const declaredMessage = require("../../../shared/field-rule-declarations.cjs").ARTICLE_GATE_RULES
        .find((rule) => rule.immutable === true && rule.field === "article_id").message;
      assert.throws(
        () => service.preview({ sourceKey: ARTICLE_SOURCE_KEY, sourceRevision, changes: { article_id: "article-y" } }),
        (e) => {
          assert.strictEqual(e.code, "VALIDATION_ERROR", "错误码沿用在册 VALIDATION_ERROR（不新增码）");
          assert.strictEqual(e.status, 422, "状态沿用 422（对外语义零变化）");
          assert.strictEqual(e.details.field, "article_id", "details.field 归因到身份字段");
          assert.strictEqual(e.details.rule, "immutable", "details.rule 仍为在册 immutable");
          assert.strictEqual(e.message, declaredMessage, "拒写文案＝声明表文案（单源，不在服务端另造）");
          return true;
        },
        "文章改身份应 422 且 details.rule=immutable（声明驱动）",
      );
      assert(!fs.readFileSync(file, "utf8").includes("article-y"), "被拒不得落盘");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T16 D-1b 反面对照：同值重交与另字段改动照常放行（空值补填也不拦——锁的是改不是填）", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ARTICLE_SOURCE_KEY);
      fs.writeFileSync(file, "---\narticle_id: article-x\ntitle: Article X\nstatus: 有效\ndate: 2025-01-01\nupdated: 2025-01-01\ntags: [entity]\nproduct: AnyShare\n---\n\n# Article X\n\n正文。\n", "utf8");
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const same = service.preview({ sourceKey: ARTICLE_SOURCE_KEY, sourceRevision, changes: { article_id: "article-x", title: "Article X 改名" } });
      assert(same.previewId, "反面对照：提交与现值相同的 article_id 不算重命名，不得误拦");

      fs.writeFileSync(file, "---\ntitle: 空身份文章\nstatus: 有效\ndate: 2025-01-01\nupdated: 2025-01-01\ntags: [entity]\nproduct: AnyShare\n---\n\n# 空身份文章\n\n正文。\n", "utf8");
      const blankRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      const filled = service.preview({ sourceKey: ARTICLE_SOURCE_KEY, sourceRevision: blankRevision, changes: { article_id: "first-id" } });
      assert(filled.previewId, "现值为空时补填身份必须放行（不可改性只锁已有值）");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  // ── WP-113 M2 主案五件：新建身份由系统铸造（①拒自带见 T1/T7；以下补 ②铸造落盘 ③同标题不撞路
  //    ④编辑改号仍 immutable 的正对照 ⑤取号耗尽按在册冲突码报且不落半成品）──
  test("T17（M2 ②／M6 改判）新建不带身份 → 成功落盘：id 为不透明串、不含标题语义，人不填也建得成", () => {
    const { vault, service } = setupVault();
    try {
      const preview = previewCreate(service, createChanges({ title: "支付网关" }));
      const applied = service.apply({ previewId: preview.previewId, confirmed: true });
      const writtenFile = path.join(vault, ENTITY_SOURCE_KEY);
      const fm = require("../../../shared/yaml-frontmatter.cjs").parseEntityDocument(fs.readFileSync(writtenFile, "utf8"), writtenFile).frontmatter;
      const minted = String(fm["architecture-node-id"] || "");
      assert(minted, "落盘文档必须带身份");
      assert.strictEqual(applied.entityId, minted, "apply 回执与盘上身份同值");
      assert(!minted.includes("支付网关"), `身份号不得携带标题语义（不透明串），实得 ${minted}`);
      assert(minted.length >= 16, `不透明号应有足够长度以保证不撞，实得 ${minted.length}：${minted}`);
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T18（M2 ③）同标题连建两篇 → 两个不同 id 都能建（撞号不再拦路）", () => {
    const { vault, service } = setupVault();
    try {
      const keyA = "知识库/wiki/entities/twin-a.md";
      const keyB = "知识库/wiki/entities/twin-b.md";
      const pa = service.preview({ sourceKey: keyA, createIfMissing: true, initialTitle: "同名双胞胎", changes: createChanges({ title: "同名双胞胎" }) });
      const appliedA = service.apply({ previewId: pa.previewId, confirmed: true });
      const pb = service.preview({ sourceKey: keyB, createIfMissing: true, initialTitle: "同名双胞胎", changes: createChanges({ title: "同名双胞胎" }) });
      const appliedB = service.apply({ previewId: pb.previewId, confirmed: true });
      assert(appliedA.entityId !== appliedB.entityId, `同标题两次铸造不得给出同一身份：${appliedA.entityId}`);
      assert(!String(appliedA.entityId).includes("同名双胞胎") && !String(appliedB.entityId).includes("同名双胞胎"), "两号均与标题无关（形状不派生自业务语义）");
      assert(fs.existsSync(path.join(vault, keyA)) && fs.existsSync(path.join(vault, keyB)), "两篇都应落盘");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T19（M2 ④ 正对照）编辑既有实体改号 → 仍按 immutable 拒（422 rule=immutable）——自带新号＝system-minted、改已有号＝immutable，两条路不混", () => {
    const { vault, service } = setupVault();
    try {
      const file = path.join(vault, ENTITY_SOURCE_KEY);
      fs.writeFileSync(file, VALID_ENTITY_RAW, "utf8"); // 现值 id=target
      const sourceRevision = revision(fs.readFileSync(file, "utf8"), fs.statSync(file));
      assert.throws(
        () => service.preview({ sourceKey: ENTITY_SOURCE_KEY, sourceRevision, changes: { "architecture-node-id": "brand-new-id" } }),
        (e) => e.code === "VALIDATION_ERROR" && e.status === 422
          && e.details && e.details.field === "architecture-node-id" && e.details.rule === "immutable",
        "编辑改号必须走 F02 immutable 声明位（沿 T14 同判据），不得被新建来源门的 system-minted 语义顶替",
      );
      assert(fs.readFileSync(file, "utf8") === VALID_ENTITY_RAW, "被拒不得落盘");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T20（M2 ⑤）取号全部占用返回 null → 按在册冲突码报（ENTITY_COMPLIANCE_BLOCKED/422·F02b 明细），不产生半成品文件；taken 判重必须接写门同一素材", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "repair-mint-exhaust-"));
    fs.mkdirSync(path.join(vault, "知识库", "wiki", "entities"), { recursive: true });
    writeEntityFile(vault, "holder", "mysql-primary", "持有者实体");
    const mintCalls = [];
    const service = createEntityRepairService({
      vaultPath: vault, ruleSetProvider: () => rules,
      // 测试缝（仅单元层，沿 growCategoryMatrix 注入先例）：注入假取号器走通「64 次全占用」异常路径。
      // 缝内同时断言服务传入的 taken 认得盘上身份——证 taken 接的是 entityDocsForGate＋buildEntityIndexes 素材，不是另起扫描。
      mintIdentity: (options) => {
        mintCalls.push("called");
        assert.strictEqual(typeof options.taken, "function", "服务必须把判重回调传进取号器");
        assert.strictEqual(options.taken("mysql-primary"), true, "taken 应认得盘上已有身份（与写门唯一性素材同源）");
        assert.strictEqual(options.taken("从未出现的号-0000"), false, "taken 不得把未占用号判成占用");
        return null; // 模拟 64 次候选全被占用
      },
    });
    try {
      assert.throws(() => service.preview({
        sourceKey: ENTITY_SOURCE_KEY, createIfMissing: true, initialTitle: "Target", changes: createChanges(),
      }), (e) => e.code === "ENTITY_COMPLIANCE_BLOCKED" && e.status === 422
        && JSON.stringify(e.details || "").includes("F02b"), "取号耗尽须按在册冲突码报，且明细指向唯一性规则 F02b");
      assert(!fs.existsSync(path.join(vault, ENTITY_SOURCE_KEY)), "取号失败不得留下半成品文件");
      assert.strictEqual(mintCalls.length, 1, "取号器应且仅被调用一次");
    } finally { fs.rmSync(vault, { recursive: true, force: true }); }
  });

  test("T6 负例2：门声明缺失 → strictRuleIds fail-closed 返回全部阻断级规则且含 F02（漏声明不放行）", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "write-gate-policy-nogate-"));
    try {
      const rulesPath = path.join(tmp, "entity-readiness-rules.json");
      // 规则存在但整份声明零 gates：buildWriteGatePolicy 的缺省分支必须全量阻断，
      // 否则「哪个门拦哪些规则」的声明漏写会退化为放行（ADR054 D1 fail-closed 缺省）。
      // 2026-09-12 规则声明重写：severity 单值化（error=拦写），双分支字段退役
      fs.writeFileSync(rulesPath, JSON.stringify({
        rules: [
          { id: "B04", severity: "error" },
          { id: "B99", severity: "warn" }
        ]
      }), "utf8");
      // 2026-10-27 降档随迁：F 族自代码内声明恒合并（gates 恒在），「漏声明」场景只能对 B 族构造；
      // 缺省集语义升级为「合并全集 fail-closed」——registry 漏声明（B04 零 gates）与代码内声明（F02）双验。
      const policy = buildWriteGatePolicy(rulesPath);
      const strict = policy.strictRuleIds("entity-repair.apply-create");
      assert(strict.has("B04"), "registry 漏 gates 声明的阻断级规则必须进缺省 strict 集（fail-closed）");
      assert(strict.has("F02"), "代码内声明的 F 族规则在合并全集（降档后恒在）");
      assert(!strict.has("B99"), "warn 级不进阻断集");
      // 计数不抄字面量（PR-232 给 F02b 挂本门时，手抄的 12 会假红/假绿双向失真）：
      // 期望集＝代码内声明里「error 且挂了本门」的规则数，加上本夹具漏声明的 B04。
      const { FIELD_RULES } = require("../../../shared/field-rule-declarations.cjs");
      const expectedDeclaredError = FIELD_RULES.filter((r) => r.severity === "error" && (r.gates || []).includes("entity-repair.apply-create")).length;
      assert.strictEqual(strict.size, expectedDeclaredError + 1, `缺省 strict 集＝挂本门 error(${expectedDeclaredError}, 代码内声明)＋漏声明 B04（精确化 fail-closed）`);
      assert(strict.has("F02b"), "PR-232：唯一性规则 F02b 已挂本门（撞身份的新建在写门即拒，不再推迟到管道 Stage 0.5）");
      const regression = policy.regressionRuleIds("entity-repair.apply-create");
      assert(regression.has("F02") && regression.has("B04"), "regression 含 strict 成员与漏声明者");
      for (const id of strict) assert(regression.has(id), "strict ⊆ regression（本门 warn 级另计回归保护）");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  if (failures > 0) { console.log("FAILED: " + failures); process.exit(1); }
  console.log("ALL PASS");
})();
