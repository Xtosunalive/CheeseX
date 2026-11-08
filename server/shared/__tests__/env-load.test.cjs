// Component: Env-Load tests — 覆盖 .env 加载器的存在性、解析、export 优先与零副作用 no-op。
// @responsible: 验证 env-load.cjs 在 .env 存在/缺失两种场景下的行为契约。
const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadEnv, loadEnvFile } = require("../env-load.cjs");

function makeTempEnv(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-load-test-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, contents);
  return { dir, envPath };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("loadEnvFile returns {} when the file does not exist", function () {
  assert.deepStrictEqual(loadEnvFile("/nonexistent/.env"), {});
});

test("loadEnvFile parses KEY=VALUE, comments, blank lines, and strips quotes", function () {
  const { envPath } = makeTempEnv(
    [
      "# 注释行",
      "",
      "FOO=bar",
      "BAZ=\"quoted val\"",
      "QUX='single'",
      "EMPTY=",
    ].join("\n")
  );
  assert.deepStrictEqual(loadEnvFile(envPath), {
    FOO: "bar",
    BAZ: "quoted val",
    QUX: "single",
    EMPTY: "",
  });
});

test("loadEnv merges .env into process.env and exported vars win", function () {
  const { dir } = makeTempEnv("FROM_FILE=yes\nONLY_FILE=value\n");
  const saved = {
    FROM_FILE: process.env.FROM_FILE,
    ONLY_FILE: process.env.ONLY_FILE,
  };
  process.env.FROM_FILE = "from-export";
  try {
    const result = loadEnv(dir);
    assert.strictEqual(result.loadedPath, path.join(dir, ".env"));
    // 已显式设置的环境变量优先，不被 .env 覆盖。
    assert.strictEqual(process.env.FROM_FILE, "from-export");
    // .env 中独有的变量被合并进来。
    assert.strictEqual(process.env.ONLY_FILE, "value");
    assert.deepStrictEqual(result.keys, ["FROM_FILE", "ONLY_FILE"]);
  } finally {
    if (saved.FROM_FILE === undefined) delete process.env.FROM_FILE;
    else process.env.FROM_FILE = saved.FROM_FILE;
    if (saved.ONLY_FILE === undefined) delete process.env.ONLY_FILE;
    else process.env.ONLY_FILE = saved.ONLY_FILE;
    cleanup(dir);
  }
});

test("loadEnv is a zero-side-effect no-op when .env does not exist", function () {
  const missingDir = path.join(os.tmpdir(), "env-load-missing-" + Math.random().toString(36).slice(2));
  // process.env 的原型不是普通对象，deepStrictEqual 直接比较对象会因原型不同而误报；
  // 改用 [key, value] 条目数组比较，等价校验"没有任何键值被增删改"。
  const before = Object.entries(process.env);
  const result = loadEnv(missingDir);
  assert.strictEqual(result.loadedPath, null);
  assert.deepStrictEqual(result.keys, []);
  assert.deepStrictEqual(Object.entries(process.env), before);
});
