// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Component: Version-Registry-Service
// @responsible: 读写产品版本注册表并将 draft 有效状态冻结为不可变发布快照。
// @inputs: TheSchema/versions.yaml、generate-sa.py 只读版本投影
// @outputs: 版本注册 DTO、发布快照、revision 和校验诊断
// @context: Schema-Manager

const crypto = require("crypto");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
const fs = require("fs");
const path = require("path");
const vaultPaths = require("../../vault-paths.cjs");
const { getArchitectureProduct, getArchitectureProductOrNull } = require("../../shared/schema-config.cjs");
// PR-016 方案甲二期：运行时脚本路径解析单点（仓内 scripts/vault-runtime 优先，vault 旧位回退）。
const { resolveVaultRuntimeScript } = require("../../shared/vault-runtime-resolver.cjs");
// enums.yaml 由 publication 拥有；只读查询与 architecture_projection 身份写入通过 options 注入为
// 窄端口（readEnums / writeArchitectureProjectionIdentity），本 analysis 服务不直接 import 写服务，
// 也不持有 enums 通用写权。
const { normalizeVersion, validateVersionRegistry } = require("../../shared/version-contract.cjs");
// 只读注册表读取/规范化/响应构造为共享查询契约，写命令仍在本服务。
const { readRegistryFile, canonicalizeRegistryProducts, buildRegistryResponse, readVersionRegistry, revision } = require("../../shared/version-registry-reader.cjs");

const { createError: serviceError } = require("../../shared/error-factory.cjs");
const { execVaultRuntimeScript } = require("../../shared/vault-runtime-spawn.cjs"); // WP-069 §3.1：唯一拉起点——env 全集（信封物化含内）由构造器组装
const { replaceVault } = require("../../shared/vault-io.cjs"); // 架构版本快照＝vault 内容落点（与 TheSchema 文件分属两域）
const { replaceTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-075/P2-8：落点分流咽喉（仓内主源→repo-schema-io，vault 落点→vault-io）

function safePathPart(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("/") || value.includes("\\") || value.includes("\0") || value === "." || value === "..") {
    throw serviceError("INVALID_VERSION_PATH", label + " 不能用于版本快照路径", 400);
  }
  return value.trim();
}

// WP-079 唯一门：两个落点分属两个数据域，各走各的门——不再由一处「按落点选通道」的判据决定。
// versions.yaml＝TheSchema 文件（唯一入口 theschema-write，仓内通道；vault 侧未钉扎即 fail-closed）；
// 架构版本快照 知识库/architecture/**＝vault 内容（vault-io 全权替换，凭据由排他创建/existsSync 前置给）。
function writeTheSchemaRegistryFile(filePath, raw) {
  try {
    replaceTheSchemaFile(filePath, raw, { summary: "版本注册表原子写（TheSchema 主源）" });
  } catch (error) {
    throw serviceError("VERSION_WRITE_FAILED", error.message, 500);
  }
}

function writeArchSnapshotFile(filePath, raw) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    replaceVault(filePath, raw, { domain: "versions", summary: "版本工件原子写" }); // PR-083：版本快照为生成器全权替换，非读改写
  } catch (error) {
    throw serviceError("VERSION_WRITE_FAILED", error.message, 500);
  }
}

function normalizeProductAliases(values, canonicalProduct) {
  if (!Array.isArray(values)) throw serviceError("INVALID_PRODUCT_ALIASES", "产品别名必须是数组", 400);
  const aliases = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) throw serviceError("INVALID_PRODUCT_ALIAS", "产品别名不能为空", 400);
    const alias = value.trim();
    const key = alias.toLocaleLowerCase("en-US");
    if (key === canonicalProduct.toLocaleLowerCase("en-US")) throw serviceError("INVALID_PRODUCT_ALIAS", "产品别名不能与主产品名（身份锚点）相同", 400, { alias });
    if (seen.has(key)) throw serviceError("DUPLICATE_PRODUCT_ALIAS", "产品别名不能重复", 400, { alias });
    seen.add(key);
    aliases.push(alias);
  }
  return aliases.sort((left, right) => left.localeCompare(right));
}

function assertReleasedImmutable(currentRegistry, nextRegistry) {
  for (const [product, definition] of Object.entries(currentRegistry.products || {})) {
    for (const entry of definition.versions || []) {
      if (entry.status !== "released") continue;
      const next = nextRegistry.products[product] && nextRegistry.products[product].versions.find((item) => item.id === entry.id);
      if (!next || JSON.stringify(next) !== JSON.stringify(entry)) {
        throw serviceError("RELEASED_VERSION_IMMUTABLE", "已发布版本不可修改或删除，请创建新的产品版本", 409, { product, version: entry.id });
      }
    }
  }
}

function createPythonProjector(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const archRepo = path.resolve(options.archRepo || path.join(__dirname, "..", "..", ".."));
  return async function projectVersion(product, version) { // PR-056：python 投影异步化（120s 超时不再冻结事件循环）
    const scriptsDirectory = resolveVaultRuntimeScript("", { vaultPath });
    const scriptPath = path.join(scriptsDirectory, "generate-sa.py");
    if (!fs.existsSync(scriptPath)) throw serviceError("VERSION_PROJECTOR_NOT_FOUND", "generate-sa.py 不存在", 503);
    // WP-069 §3.1：env 全集（信封物化＋KB_DATA_DIR＋KB_VAULT/ARCH_REPO）经唯一拉起模块
    // 组装——本调用点零自拼 env（2026-11-01 冻结链死链的结构根治：漏配不再有发生位）。
    const result = await execVaultRuntimeScript("generate-sa.py", ["--json", "--version", version], {
      vaultPath,
      archRepo,
      vocabEnvelope: true,
      cwd: scriptsDirectory,
      extraEnv: { ARCH_PRODUCT: product },
      timeout: 120000,
    });
    if (result.status !== 0) throw serviceError("VERSION_PROJECTION_FAILED", (result.stderr || result.stdout || "版本投影失败").trim(), 500);
    try { return JSON.parse(result.stdout); }
    catch (error) { throw serviceError("INVALID_VERSION_PROJECTION", "版本投影没有返回合法 JSON: " + error.message, 500); }
  };
}

function createVersionRegistryService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const now = options.now || (() => new Date());
  const projectVersion = options.projectVersion || createPythonProjector({ vaultPath, archRepo: options.archRepo });
  const getDocumentsForVersion = options.getDocumentsForVersion || (() => []);
  const changeDispositionService = options.changeDispositionService || null;
  const readEnums = options.readEnums;
  const writeArchitectureProjectionIdentity = options.writeArchitectureProjectionIdentity;

  function getProductIdentity() {
    if (typeof readEnums !== "function") throw serviceError("ENUMS_PORT_UNAVAILABLE", "readEnums 端口未注入", 500);
    const current = readEnums(vaultPath);
    // 元层无产品身份（SPEC-016 归档清空后合法态）——返回未配置态而非 throw
    const canonicalProduct = getArchitectureProductOrNull(vaultPath);
    if (!canonicalProduct) {
      return {
        canonicalProduct: null,
        aliases: [],
        configured: false,
        note: "元层未配置产品身份（主体挂载后由主体层提供）",
        revision: current.revision || "",
        sourceFile: displayTheSchemaPath(vaultPath, "enums.yaml"),
        renameSupported: false,
      };
    }
    const projection = current.data.architecture_projection || {};
    const configuredAliases = projection.product_aliases && typeof projection.product_aliases === "object" && !Array.isArray(projection.product_aliases)
      ? projection.product_aliases
      : {};
    const aliases = Object.entries(configuredAliases)
      .filter(([, target]) => typeof target === "string" && target.trim().toLocaleLowerCase("en-US") === canonicalProduct.toLocaleLowerCase("en-US"))
      .map(([alias]) => alias.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    // configured/note 契约必填（响应探针 enforce）——已设定分支此前从未被走到（空态死锁时代），
    // 首次设定口（2026-10-27 批）激活本路径即暴露缺字段；热修补齐
    return { canonicalProduct, aliases, configured: true, note: "产品身份已配置（主产品名=身份锚点，别名可维护）", revision: current.revision, sourceFile: displayTheSchemaPath(vaultPath, "enums.yaml"), renameSupported: false };
  }

  function writeProductIdentity(expectedRevision, aliasesValue, productValue) {
    if (typeof writeArchitectureProjectionIdentity !== "function") throw serviceError("ENUMS_PORT_UNAVAILABLE", "writeArchitectureProjectionIdentity 端口未注入", 500);
    // 容错读法（同 GET 侧）：空态（归档清空，product="" 或缺）= null 而非 throw——
    // 严格读法（路径段语义）在真实归档态下会把 PUT 别名也炸成 500（写链路死锁，本批根治）
    const current = getArchitectureProductOrNull(vaultPath) || "";
    // 主产品名（身份锚点）写语义：仅允许从空态首次设定（renameSupported=false——改名=换身份，
    // 走词表治理立案）；此前链路「读出什么写回什么」，空态无任何入口可设定（死锁）——本批补设定口。
    let canonicalProduct = current;
    if (typeof productValue === "string" && productValue.trim()) {
      const requested = productValue.trim();
      if (current && requested !== current) {
        throw serviceError("IDENTITY_ANCHOR_IMMUTABLE", `主产品名（身份锚点）已设定为「${current}」，改名=换身份——不在本接口改（renameSupported=false）`, 409, { current, requested });
      }
      if (!current) canonicalProduct = requested;
    }
    const aliases = normalizeProductAliases(aliasesValue, canonicalProduct);
    writeArchitectureProjectionIdentity({ vaultPath, expectedRevision, product: canonicalProduct, aliases });
    return getProductIdentity();
  }

  function getRegistry() {
    return readVersionRegistry(vaultPath);
  }

  function validateRegistryPayload(payload) {
    const current = readRegistryFile(vaultPath);
    return buildRegistryResponse(current, validateVersionRegistry(canonicalizeRegistryProducts(vaultPath, payload)));
  }

  function writeRegistry(expectedRevision, payload) {
    const current = readRegistryFile(vaultPath);
    // PR-201 码面分离：缺基线（400 SCHEMA_REVISION_REQUIRED，随 PR-200 单点闸同码）与过期（409 VERSIONS_REVISION_CONFLICT）不再混报
    if (typeof expectedRevision !== "string" || expectedRevision.length === 0) {
      throw serviceError("SCHEMA_REVISION_REQUIRED", "必须携带 revision（读侧 GET /api/schema/versions 返回）——缺基线即拒", 400);
    }
    if (expectedRevision !== current.revision) {
      throw serviceError("VERSIONS_REVISION_CONFLICT", "产品版本注册表已被其他流程修改，请重新加载后再保存", 409, { expectedRevision, currentRevision: current.revision });
    }
    const currentValidation = validateVersionRegistry(canonicalizeRegistryProducts(vaultPath, current.data));
    const nextValidation = validateVersionRegistry(canonicalizeRegistryProducts(vaultPath, payload));
    if (!nextValidation.valid) throw serviceError("VALIDATION_ERROR", "产品版本注册表校验失败", 400, { diagnostics: nextValidation.diagnostics });
    if (currentValidation.registry) assertReleasedImmutable(currentValidation.registry, nextValidation.registry);
    current.doc.set("schema_version", 1);
    current.doc.set("products", current.doc.createNode(nextValidation.registry.products));
    writeTheSchemaRegistryFile(current.filePath, current.doc.toString());
    // SPEC-020 波 2：解析物联动（version_registry 配方消费 versions——写后重生成；fire-and-forget＋门禁兜底）
    const { regenerateResolvedDomainsBestEffort } = require("../../shared/regenerate-derived-projections.cjs");
    void regenerateResolvedDomainsBestEffort(vaultPath, null, "versions-written").catch(() => {});
    return getRegistry();
  }

  async function freezeVersion(expectedRevision, productValue, versionValue) { // PR-056：随投影异步化
    const product = safePathPart(productValue, "产品 ID");
    const version = safePathPart(normalizeVersion(versionValue), "产品版本");
    const current = getRegistry();
    // PR-201 码面分离：缺基线 400 / 过期 409（原 undefined 一律混报 409 冲突）
    if (typeof expectedRevision !== "string" || expectedRevision.length === 0) {
      throw serviceError("SCHEMA_REVISION_REQUIRED", "必须携带 revision（读侧 GET /api/schema/versions 返回）——缺基线即拒", 400);
    }
    if (expectedRevision !== current.revision) throw serviceError("VERSIONS_REVISION_CONFLICT", "产品版本注册表已被其他流程修改，请重新加载后再冻结", 409, { expectedRevision, currentRevision: current.revision });
    const definition = current.products[product];
    const entry = definition && definition.versions.find((item) => item.id === version);
    if (!entry) throw serviceError("VERSION_NOT_FOUND", "产品版本不存在", 404, { product, version });
    if (entry.status === "released") throw serviceError("VERSION_ALREADY_RELEASED", "产品版本已经冻结发布", 409, { product, version });
    if (entry.status !== "draft") throw serviceError("VERSION_NOT_DRAFT", "只有 draft 产品版本可以冻结发布", 409, { product, version });

    const projection = await projectVersion(product, version);
    if (!projection || typeof projection !== "object" || Array.isArray(projection) || projection.product !== product || !Array.isArray(projection.components) || !Array.isArray(projection.dependencies)) {
      throw serviceError("INVALID_VERSION_PROJECTION", "版本投影缺少匹配的 product、components 或 dependencies", 500, { product, version });
    }
    if (projection._generated_for_version && normalizeVersion(projection._generated_for_version) !== version) {
      throw serviceError("INVALID_VERSION_PROJECTION", "版本投影目标与请求版本不一致", 500, { expected: version, actual: projection._generated_for_version });
    }
    // PR-152：冻结时刻成对补写投影身份（product 已由注册口设定；version 在此补齐）——
    // 身份半写（有 product 无 version）会让 Release 消费端 fail-closed（ADR-009 两者都要有或都无）。
    // 先写身份后改注册表：注册表失败只留下「完整但指向 draft 的身份」（无害），不产生半身份。
    if (typeof writeArchitectureProjectionIdentity === "function" && typeof readEnums === "function") {
      const enumsNow = readEnums(vaultPath);
      writeArchitectureProjectionIdentity({ vaultPath, expectedRevision: enumsNow.revision, product, version });
    }
    const documents = getDocumentsForVersion(product, version);
    if (changeDispositionService && typeof changeDispositionService.evaluate === "function") {
      const dependencies = projection.dependencies.filter((item) => item && typeof item === "object");
      const reasoning = changeDispositionService.evaluate({ affectedVersions: [{
        product,
        version,
        status: "draft",
        componentIds: projection.components.map((item) => item && (item.id || item["architecture-node-id"])).filter((item) => typeof item === "string"),
        removed: [],
        paths: dependencies.map((item) => ({ nodeIds: [item.source || item.from, item.target || item.to].filter(Boolean) })),
        documents,
        pendingReview: dependencies.some((item) => item.reviewStatus === "pending" || item.properties?.reviewStatus === "pending"),
      }] });
      changeDispositionService.assertWriteAllowed(reasoning);
    }
    const generatedAt = now().toISOString();
    const snapshot = {
      schema_version: 1,
      _format_version: "1.0",
      product,
      version,
      generated_at: generatedAt,
      source_mode: "frozen",
      components: projection.components,
      dependencies: projection.dependencies,
      crosscutting: Array.isArray(projection.crosscutting) ? projection.crosscutting : [],
      documents,
    };
    const snapshotRaw = JSON.stringify(snapshot, null, 2) + "\n";
    const snapshotPath = vaultPaths.getVersionSnapshotPath(vaultPath, product, version);
    const relativeSnapshotPath = path.relative(vaultPath, snapshotPath).split(path.sep).join("/");
    if (fs.existsSync(snapshotPath)) {
      throw serviceError("VERSION_SNAPSHOT_ALREADY_EXISTS", "产品版本快照已存在，拒绝覆盖不可变历史", 409, { product, version, path: relativeSnapshotPath });
    }
    writeArchSnapshotFile(snapshotPath, snapshotRaw);
    try {
      const products = structuredClone(current.products);
      const nextEntry = products[product].versions.find((item) => item.id === version);
      nextEntry.status = "released";
      nextEntry.release_date = nextEntry.release_date || generatedAt.slice(0, 10);
      nextEntry.snapshot = {
        path: relativeSnapshotPath,
        sha256: revision(snapshotRaw),
        generated_at: generatedAt,
      };
      return writeRegistry(current.revision, { schema_version: 1, products });
    } catch (error) {
      try { if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath); } catch (_cleanupError) { /* best-effort: 失败静默可接受 */ }
      throw error;
    }
  }

  return { getProductIdentity, writeProductIdentity, getRegistry, validateRegistryPayload, writeRegistry, freezeVersion };
}

module.exports = { createVersionRegistryService, createPythonProjector, readRegistryFile, revision };
