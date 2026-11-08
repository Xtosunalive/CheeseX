import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("npm run dev starts the coupled API and Vite runner", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8"),
  );
  const runner = await readFile(path.join(rootDir, "scripts/dev.mjs"), "utf8");

  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs");
  assert.match(runner, /server", "main\.cjs/);
  assert.match(runner, /node_modules", "vite", "bin", "vite\.js/);
  assert.match(runner, /child\.kill\("SIGTERM"\)/);
  assert.match(runner, /response\.ok/);
  assert.match(runner, /--strictPort/);
  assert.match(runner, /readiness\.includes\(false\)/);
  assert.equal(packageJson.scripts.health, "node scripts/health.mjs");
});
