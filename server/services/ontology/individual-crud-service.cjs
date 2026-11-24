// Component: Individual-CRUD-Service（WP-208／SPEC-100 批 2·交付物）
// @responsible: 类级通用个体增删改查引擎——个体＝Markdown 事实源（ADR-014 §Individual：不新增第二实例账），
//   落 知识库/wiki/individuals/<classId>/<individualId>.md（allowedPermanent「知识库/」前缀既有条目覆盖，零合同改动）。
//   写走 vault-io 唯一通道（git 即账）；必填按类绑定 fail-closed；移除＝生命周期退役（ADR-017：
//   lifecycle_status 翻转，非硬删）；乐观锁 contentRevision（PR-083 凭据制同款）。
// @inputs: 类绑定经 setBindingsResolver 端口注入（main＝本体/词表现读经继承解析器；测试＝夹具）
//          ＋ io 端口（默认 vault-io 模块通道；测试注入临时库通道或端口对象）
// @outputs: create／read／update／retire／list——generic:* 执行器（individual-executors.cjs）消费
// @context: 一份代码服务所有类（本体类声明 generic:* 执行器＋契约条目即自动接线——批 1 pendingRoutes
//   转安装，零每类代码）；个体 ID＝slug(title)＋短哈希铸造（OpenMAIC 身份键纪律：服务端铸造＋随机熵）。
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const YAML = require("yaml");
// WP-232：统一业务实例铸造点（实体主键/个体编号同源——ADR-021 §2.2）
const { mintEntityId } = require("../../shared/entity-identity-mint.cjs");
const { createError: serviceError } = require("../../shared/error-factory.cjs");
const vaultIO = require("../../shared/vault-io.cjs");

const INDIVIDUALS_ROOT = path.join("知识库", "wiki", "individuals");
// WP-213（红队 M2）：系统键清单——引擎管理的 frontmatter 基建字段，调用方入参出现即拒
const SYSTEM_KEYS = new Set(["class_id", "individual_id", "lifecycle_status", "created", "updated", "retired", "status"]);

function createIndividualCrudService({ vaultPath, logger, loadFields, io } = {}) {
  if (!vaultPath) throw new TypeError("[individual-crud] 需要 vaultPath");
  const channel = io || vaultIO; // 注入端口（测试）／默认 vault-io 模块通道（生产）
  const root = path.join(vaultPath, INDIVIDUALS_ROOT);
  let bindingsResolver = null; // (classId) → resolveClassInheritance 结果（data_properties 含 required 绑定）
  let projectionPort = null; // { upsert, markRetired }——批 3 投影同步口（fail-open：投影失败不阻断主写）

  function syncProjection(kind, classId, fm) {
    if (!projectionPort) return;
    try {
      if (kind === "retire") projectionPort.markRetired(classId, fm.individual_id, fm.updated);
      else projectionPort.upsert(classId, fm);
    } catch (error) {
      if (logger) logger.warn({ event: "individual-projection-sync-failed", classId, error: String(error.message).slice(0, 160) });
    }
  }

  function assertIds(classId, individualId) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(classId || ""))) {
      throw serviceError("INDIVIDUAL_CLASS_INVALID", `非法类标识 ${JSON.stringify(classId)}`, 422);
    }
    if (!/^[A-Za-z0-9一-龥][A-Za-z0-9._一-龥-]*$/.test(String(individualId || ""))) {
      throw serviceError("INDIVIDUAL_ID_INVALID", `非法个体 ID ${JSON.stringify(individualId)}`, 422);
    }
  }

  function individualPath(classId, individualId) {
    assertIds(classId, individualId);
    return path.join(root, classId, `${individualId}.md`);
  }

  function classDir(classId) {
    return path.join(root, classId);
  }

  function readRaw(absPath) {
    const fs = require("node:fs");
    if (!fs.existsSync(absPath)) {
      throw serviceError("INDIVIDUAL_NOT_FOUND", `个体不存在：${path.basename(absPath)}`, 404);
    }
    return fs.readFileSync(absPath, "utf8");
  }

  function parseFrontmatter(raw) {
    const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
    if (!match) return { fm: {}, body: raw };
    let fm;
    try {
      fm = YAML.parse(match[1]) || {};
    } catch (error) {
      throw serviceError("INDIVIDUAL_FRONTMATTER_INVALID", error.message, 500);
    }
    return { fm, body: raw.slice(match[0].length) };
  }

  function buildMarkdown(fm) {
    return `---\n${YAML.stringify(fm).trimEnd()}\n---\n`;
  }

  function resolveBindings(classId) {
    if (typeof bindingsResolver !== "function") {
      throw serviceError("INDIVIDUAL_BINDINGS_UNAVAILABLE", "类绑定端口未装配（装配缺陷）", 503);
    }
    return bindingsResolver(classId);
  }

  // WP-213（红队 M2）：系统键拒绝——create/update 入参含系统键即 422（隐身个体/身份伪造/退役绕过三面封死）。
  // 系统键由引擎按自身状态写入，永远不接受调用方供给（fail-loud）。
  function rejectSystemKeys(incoming) {
    const hits = Object.keys(incoming || {}).filter((key) => SYSTEM_KEYS.has(key));
    if (hits.length) {
      throw serviceError("INDIVIDUAL_SYSTEM_KEY_FORBIDDEN", "入参含系统键（class_id/individual_id/lifecycle_status 等由引擎管理，不可供给）", 422, { keys: hits });
    }
  }

  function validateFields(classId, incoming, { allowSystem = false } = {}) {
    if (!allowSystem) rejectSystemKeys(incoming);
    const resolved = resolveBindings(classId);
    const props = (resolved && resolved.data_properties) || {};
    const missing = [];
    const unknown = [];
    const allowed = new Set(Object.keys(props));
    for (const [fieldName, def] of Object.entries(props)) {
      const required = def && def.binding && def.binding.required === true;
      if (required && (incoming[fieldName] === undefined || String(incoming[fieldName]).trim() === "")) {
        missing.push(fieldName);
      }
    }
    for (const key of Object.keys(incoming || {})) {
      if (SYSTEM_KEYS.has(key)) continue;
      if (!allowed.has(key)) unknown.push(key);
    }
    if (missing.length || unknown.length) {
      throw serviceError("INDIVIDUAL_FIELDS_INVALID", "个体字段校验未过（必填缺失／白名单外字段）", 422, { missing, unknown });
    }
  }

  // WP-232（ADR-021 §2.2／U2）：个体编号并入统一铸造点（UUID v4）——标题片段＋短哈希现编关停。
  // mintEntityId 即 server 侧唯一业务实例铸造模块（实体主键同源；taken＝同类目录判重，64 次上限）。
  function mintIndividualId(classId) {
    const id = mintEntityId({
      taken: (candidate) => {
        try { return fs.existsSync(path.join(root, classId, `${candidate}.md`)); } catch { return false; }
      },
    });
    if (!id) throw serviceError("INDIVIDUAL_ID_COLLISION", `个体 ID 铸造 64 次全撞（概率趋零）——重试`, 409);
    return id;
  }

  function create({ classId, fields }) {
    validateFields(classId, fields || {});
    const individualId = mintIndividualId(classId);
    const absPath = individualPath(classId, individualId);
    const now = new Date().toISOString();
    const fm = {
      class_id: classId,
      individual_id: individualId,
      title: String((fields || {}).title || individualId),
      lifecycle_status: "active",
      created: now,
      updated: now,
      ...(fields || {}),
    };
    require("node:fs").mkdirSync(path.dirname(absPath), { recursive: true }); // 类目录惰性建立（vault-io 排他写不建父目录）
    try {
      channel.writeVaultExclusive(absPath, buildMarkdown(fm), { summary: `个体创建（generic:create·${classId}）` });
    } catch (error) {
      if (error && /exists|EEXIST/i.test(String(error.code || error.message))) {
        throw serviceError("INDIVIDUAL_ID_COLLISION", `个体 ID 撞号（概率极低，重试即可）：${individualId}`, 409);
      }
      throw error;
    }
    if (logger) logger.info({ event: "individual-created", classId, individualId });
    syncProjection("upsert", classId, fm);
    return { classId, individualId, path: path.relative(vaultPath, absPath), revision: vaultIO.contentRevision(buildMarkdown(fm)) };
  }

  function read(classId, individualId) {
    const absPath = individualPath(classId, individualId);
    const raw = readRaw(absPath);
    const { fm } = parseFrontmatter(raw);
    return { classId, individualId, fields: fm, revision: vaultIO.contentRevision(raw) };
  }

  function update({ classId, individualId, fields, expectedRevision }) {
    const absPath = individualPath(classId, individualId);
    const raw = readRaw(absPath);
    const currentRevision = vaultIO.contentRevision(raw);
    if (!expectedRevision || expectedRevision !== currentRevision) {
      throw serviceError("INDIVIDUAL_REVISION_CONFLICT", "个体已被其他流程修改，请重新读取后再更新", 409, { expectedRevision, currentRevision });
    }
    const { fm, body } = parseFrontmatter(raw);
    if (fm.lifecycle_status === "retired") {
      throw serviceError("INDIVIDUAL_RETIRED", "个体已退役（ADR-017 生命周期终态）——不可更新", 409);
    }
    rejectSystemKeys(fields || {}); // delta 系统键拒绝（合并校验放行 fm 自身基建键）
    // WP-213（浏览器 E2E 实测缺陷）：update 校验三段分离——①delta 白名单（fields 键 ⊆ 类绑定）
    // ②必填查合并结果（fm 供给既有值）③fm 回退键（如无 title 字段类的 title=个体 ID）不罚——
    // 此前合并整体验 unknown 把引擎自写回退键误拒（无 title 类的更新腿必挂）。
    const resolved = resolveBindings(classId);
    const props = (resolved && resolved.data_properties) || {};
    const allowed = new Set(Object.keys(props));
    const merged = { ...fm, ...(fields || {}) };
    const deltaUnknown = Object.keys(fields || {}).filter((key) => !allowed.has(key));
    const missing = [];
    for (const [fieldName, def] of Object.entries(props)) {
      const required = def && def.binding && def.binding.required === true;
      if (required && (merged[fieldName] === undefined || String(merged[fieldName]).trim() === "")) {
        missing.push(fieldName);
      }
    }
    if (deltaUnknown.length || missing.length) {
      throw serviceError("INDIVIDUAL_FIELDS_INVALID", "个体字段校验未过（白名单外字段／必填缺失）", 422, { deltaUnknown, missing });
    }
    const nextFm = { ...fm, ...(fields || {}), updated: new Date().toISOString() };
    const nextRaw = buildMarkdown(nextFm) + body;
    channel.writeVault(absPath, nextRaw, { expectedContentHash: currentRevision, summary: `个体更新（generic:update·${classId}）` });
    if (logger) logger.info({ event: "individual-updated", classId, individualId });
    syncProjection("upsert", classId, nextFm);
    return { classId, individualId, revision: vaultIO.contentRevision(nextRaw) };
  }

  function retire({ classId, individualId, expectedRevision }) {
    const absPath = individualPath(classId, individualId);
    const raw = readRaw(absPath);
    const currentRevision = vaultIO.contentRevision(raw);
    if (!expectedRevision || expectedRevision !== currentRevision) {
      throw serviceError("INDIVIDUAL_REVISION_CONFLICT", "个体已被其他流程修改，请重新读取后再退役", 409, { expectedRevision, currentRevision });
    }
    const { fm, body } = parseFrontmatter(raw);
    if (fm.lifecycle_status === "retired") return { classId, individualId, alreadyRetired: true };
    const nextFm = { ...fm, lifecycle_status: "retired", retired: new Date().toISOString() };
    channel.writeVault(absPath, buildMarkdown(nextFm) + body, { expectedContentHash: currentRevision, summary: `个体退役（generic:retire·${classId}）` });
    if (logger) logger.info({ event: "individual-retired", classId, individualId });
    syncProjection("retire", classId, nextFm);
    return { classId, individualId, retired: true };
  }

  function list(classId) {
    assertIds(classId, "list");
    const fs = require("node:fs");
    const dir = classDir(classId);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith(".md")) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, name), "utf8");
        const { fm } = parseFrontmatter(raw);
        if (fm.lifecycle_status === "retired") continue;
        out.push({ individualId: fm.individual_id || name.replace(/\.md$/, ""), title: fm.title, revision: vaultIO.contentRevision(raw), fields: fm });
      } catch (_error) {
        // 单文件坏不拖垮清单（fail-open 读面）——坏行由 read 接口显式报错
      }
    }
    return out;
  }

  return {
    create,
    read,
    update,
    retire,
    list,
    setBindingsResolver(fn) {
      bindingsResolver = fn;
    },
    setProjectionPort(port) {
      projectionPort = port;
    },
  };
}

module.exports = { createIndividualCrudService, INDIVIDUALS_ROOT };
