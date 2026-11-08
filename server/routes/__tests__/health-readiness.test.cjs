const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MAIN = path.join(__dirname, "..", "..", "main.cjs");

describe("T4 health readiness aggregation", () => {
  it("main.cjs health handler aggregates readiness signals without breaking 200 semantics", () => {
    const src = fs.readFileSync(MAIN, "utf8");
    // 保留 status:"ok" + 200（gate/dev.mjs 只等 HTTP 200）
    assert.match(src, /registerRoute\("GET", "\/api\/health"/);
    assert.match(src, /status: "ok"/);
    // 聚合三个就绪信号
    assert.match(src, /dashboardRoutes: dashRoutesLoaded/);
    assert.match(src, /formalConsumer: formalKnowledgeConsumerService !== null/);
    assert.match(src, /schemaRuntime: typeof schemaProposalRuntimeHolder !== "undefined"/);
    assert.match(src, /readyState: allReady \? "ready" : "partial"/);
    // schemaProposalRuntimeHolder 模块级声明存在（被 health 与 runtime 共用）
    assert.match(src, /let schemaProposalRuntimeHolder = null;/);
  });
});
