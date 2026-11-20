// 回归固化（WP-206 清理批发现）：schema-write-service 必须暴露 deprecateVersion 并把
// HTTP body 的 revision 映射为 registry 的 expectedRevision——此前路由层测试用带该方法的
// mock 服务掩盖了真实服务缺方法的断线（端点自上线即 SCHEMA_WRITE_UNAVAILABLE，2026-11-21 实测）。
// 层级：Adapter 契约（服务出参形状＋入参映射）；registry 自身语义由 version-registry-service 测试覆盖。
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { createSchemaWriteService } = require("../schema-manager/schema-write-service.cjs");

test("schemaWriteService.deprecateVersion 存在并按 {revision→expectedRevision} 映射委托 registry", () => {
  const calls = [];
  const fakeRegistry = {
    deprecateVersion(args) {
      calls.push(args);
      return { revision: "sha256:dep" };
    },
  };
  const service = createSchemaWriteService({
    vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "schema-write-deprecate-")),
    versionRegistryServiceFactory: () => fakeRegistry,
  });
  assert.equal(typeof service.deprecateVersion, "function", "服务面必须有 deprecateVersion（2026-11-21 前缺失＝deprecate 端点全红）");
  const result = service.deprecateVersion({ revision: "sha256:base", product: "个人知识管理", version: "1.0" });
  assert.deepEqual(calls, [{ product: "个人知识管理", version: "1.0", expectedRevision: "sha256:base" }]);
  assert.equal(result.category, "versions");
  assert.equal(result.revision, "sha256:dep");
});

test("registry 端口缺席时 fail-closed（500 VERSION_REGISTRY_PORT_UNAVAILABLE）", () => {
  const service = createSchemaWriteService({ vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "schema-write-deprecate-")) });
  assert.throws(() => service.deprecateVersion({ revision: "r", product: "P", version: "1.0" }), /VERSION_REGISTRY_PORT_UNAVAILABLE|registry/i);
});
