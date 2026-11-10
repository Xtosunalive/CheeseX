const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scanEntities } = require("../entity-source-scanner.cjs");

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "entity-source-scanner-"));
const dir = path.join(vault, "知识库", "wiki", "entities");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "b.md"), "---\ntitle: B\narchitecture_node_id: node-b\n---\n", "utf8");
fs.writeFileSync(path.join(dir, "a.md"), "---\ntitle: A\narchitecture-node-id: node-a\n---\n", "utf8");
fs.writeFileSync(path.join(dir, "ignored.txt"), "ignored", "utf8");
// N1/#829 延伸：wiki/entities 的 module/product 引用型字段同样剥 wikilink（[[X]] → X），
// 否则 entity-compliance 枚举比较把 [[主模块]] 当非法值误报"模块无值"。
fs.writeFileSync(path.join(dir, "wikilink.md"), "---\ntitle: Wikilink\narchitecture-node-id: node-wikilink\nmodule: \"[[主模块]]\"\nproduct: \"[[AnyShare]]\"\n---\n", "utf8");
fs.mkdirSync(path.join(dir, "子目录"));
fs.writeFileSync(path.join(dir, "子目录", "nested.md"), "---\ntitle: Nested\narchitecture-node-id: node-nested\n---\n", "utf8");

try {
  const entities = scanEntities(vault);
  assert.deepStrictEqual(entities.map((item) => path.basename(item.file)), ["a.md", "b.md", "wikilink.md", "nested.md"]);
  assert.deepStrictEqual(entities.map((item) => item.id), ["node-a", "node-b", "node-wikilink", "node-nested"]);
  assert.deepStrictEqual(entities.map((item) => item.title), ["A", "B", "Wikilink", "Nested"]);
  const wikilinkEntity = entities.find((item) => item.id === "node-wikilink");
  assert.equal(wikilinkEntity.frontmatter.module, "主模块", "module wikilink 应被剥离");
  assert.equal(wikilinkEntity.frontmatter.product, "AnyShare", "product wikilink 应被剥离");
  assert.deepStrictEqual(scanEntities(path.join(vault, "missing")), []);
  console.log("Entity source scanner tests passed");
} finally {
  fs.rmSync(vault, { recursive: true, force: true });
}
