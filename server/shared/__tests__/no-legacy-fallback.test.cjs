const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mainPath = path.join(__dirname, "..", "..", "main.cjs");
const source = fs.readFileSync(mainPath, "utf-8");
// PR-085 第 1 步：传输层标准框架化——404 文案与装配移至 shared/http-app.cjs；main.cjs 不得再持有自建 http.createServer
const httpAppSource = fs.readFileSync(path.join(__dirname, "..", "http-app.cjs"), "utf-8");

assert.strictEqual(source.includes("18082"), false, "rebuild API server must not depend on legacy port 18082");
assert.strictEqual(source.includes("proxyToFallback"), false, "unknown routes must not proxy to the legacy project");
assert.strictEqual(source.includes("http.createServer"), false, "main.cjs must not rebuild a hand-written transport (ADR-010)");
assert.match(httpAppSource, /未注册的 API 路由/, "unknown routes should return an explicit local 404 (transport layer)");

console.log("No-Legacy-Fallback tests passed: 4 passed, 0 failed");
