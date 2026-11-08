const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createObsidianOpenService } = require("../../services/pipeline/obsidian-open-service.cjs");
const routes = require("../obsidian-open-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-C：open-obsidian 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "obsidian-actions-")) });

async function run() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-open-"));
  const sourcePath = "知识库/wiki/entities/sample.md";
  fs.mkdirSync(path.dirname(path.join(vaultPath, sourcePath)), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, sourcePath), "---\ntitle: Sample\n---\n", "utf8");
  const openedUris = [];
  const service = createObsidianOpenService({ vaultPath, openExternal: async function (uri) { openedUris.push(uri); } });
  const h = createRouteHarness();
  routes.register(h.registerRoute, { obsidianOpenService: service });
  assert(h.routes.has("POST /api/system/open-obsidian"), "open route registered");

  const success = await h.call("POST /api/system/open-obsidian", undefined, { sourcePath });
  assert.strictEqual(success.statusCode, 200, JSON.stringify(success.body));
  assert.strictEqual(success.body.data.opened, true);
  assert.strictEqual(success.body.data.sourcePath, sourcePath);
  assert(openedUris[0].startsWith("obsidian://open?vault="));
  assert(openedUris[0].includes("file=%E7%9F%A5%E8%AF%86%E5%BA%93"));

  // PR-085：handler 抛出的业务错误由传输层错误处理器统一承载为封套（原 dispatchRoute.fail 语义）
  const escaped = await h.call("POST /api/system/open-obsidian", undefined, { sourcePath: "../outside.md" });
  assert.strictEqual(escaped.statusCode, 400);
  assert.strictEqual(escaped.body.error_code, "VALIDATION_ERROR");
  assert.strictEqual(openedUris.length, 1);

  const missing = await h.call("POST /api/system/open-obsidian", undefined, { sourcePath: "知识库/wiki/entities/missing.md" });
  assert.strictEqual(missing.statusCode, 404);
  assert.strictEqual(missing.body.error_code, "SOURCE_NOT_FOUND");

  await h.close();
  fs.rmSync(vaultPath, { recursive: true, force: true });
}

run().catch((error) => { console.error(error); process.exit(1); });
