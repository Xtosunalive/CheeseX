// Component: G1+G5 JS/Py 产品身份归一一致性契约测试（PR-020 批5）
// @responsible: 锁定 schema_loader.resolve_product_identity（Py）与 resolveArchitectureProduct（JS）行为一致
// @inputs: 同一输入集 × Py 侧实测基线（真实 Vault 2026-09-14 生成）
// @outputs: 一致/不一致断言
// @context: Schema-Manager
// 说明：JS 侧 resolveArchitectureProduct 返回字符串（归一后产品名或原值）；Py 侧返回三态对象，
// 一致性锚点 = canonical 字段。Py 基线由真实 Vault 生成（命令见文件尾注释），漂移即红。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const { resolveArchitectureProduct } = require("../../shared/schema-config.cjs");

// Py 侧基线（schema_loader.resolve_product_identity().canonical，真实 Vault 2026-09-14 实测）
const PY_BASELINE = {
  AS: "AnyShare",
  As: "AnyShare",
  AnyShare: "AnyShare",
  "通用": "通用",           // 保留键（reserved）——JS 侧无保留概念，canonical 原样即一致
  NoSuchProduct: "NoSuchProduct", // 未注册透传
};

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "g15-consistency-"));
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), YAML.stringify({
    architecture_projection: {
      product: "AnyShare",
      version: "master",
      product_aliases: { AS: "AnyShare" },
    },
  }));
  fs.writeFileSync(path.join(schemaDir, "versions.yaml"), YAML.stringify({
    schema_version: 1,
    reserved_products: ["通用"],
    products: { As: { versions: [] } },
  }));
  return vault;
}

// PR-170 回归钉（2026-11-01）：双空身份合法空态下解析原样通过——别名归一是「相对身份锚点」
// 的语义，无锚点即无可归一；原实现在此抛 product is required 致注册表读面（entity-check
// 规则集/版本表）空态集体 500。
{
  const pr170Vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr170-unmounted-"));
  try {
    const schemaDir = path.join(pr170Vault, "知识库", "TheSchema");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "enums.yaml"), YAML.stringify({
      architecture_projection: { product: "", version: "", product_aliases: { AS: "AnyShare" } },
    }));
    assert.equal(resolveArchitectureProduct(pr170Vault, "AnyShare"), "AnyShare", "双空态原样通过");
    assert.equal(resolveArchitectureProduct(pr170Vault, "NoSuchProduct"), "NoSuchProduct", "双空态未注册透传");
    console.log("PR-170 双空态透传钉：ok");
  } finally {
    fs.rmSync(pr170Vault, { recursive: true, force: true });
  }
}

(async function run() {
  const vault = makeVault();
  try {
    for (const [input, expectedCanonical] of Object.entries(PY_BASELINE)) {
      const jsResult = resolveArchitectureProduct(vault, input);
      assert.equal(
        jsResult, expectedCanonical,
        `JS/Py 不一致：输入 ${input}，JS 返回 ${jsResult}，Py 基线 ${expectedCanonical}`
      );
      console.log(`PASS  ${input} -> ${jsResult}`);
    }
    console.log("G1+G5 JS/Py 产品身份归一一致性：5/5 PASS");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });

// Py 基线再生命令（漂移时更新本表并注明日期）：
// cd "Obsidian Vault Bare Test/知识库/.claude/scripts" && python3 -c "
//   import schema_loader as sl
//   for v in ['AS','As','AnyShare','通用','NoSuchProduct']:
//       print(repr(v), '->', repr(sl.resolve_product_identity(v)['canonical']))"
