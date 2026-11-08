const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  compareVersion,
  isActiveAt,
  normalizeVersion,
  sortVersions,
  validateVersionRegistry,
} = require("../../shared/version-contract.cjs");

const boundaryFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../contracts/fixtures/version-boundaries.json"), "utf8"));

function registry() {
  return {
    schema_version: 1,
    products: {
      AnyShare: {
        versions: [
          { id: "7.0.10", label: "AnyShare 7.0.10", status: "draft", release_date: null, aliases: ["AS-7010"], snapshot: null },
          { id: "7.0.2", label: "AnyShare 7.0.2", status: "draft", release_date: null, aliases: [], snapshot: null },
        ],
      },
    },
  };
}

test("normalizes exact product versions without accepting prose or containers", () => {
  assert.equal(normalizeVersion("v07.0.06.8"), "7.0.6.8");
  assert.equal(normalizeVersion("7.0"), "7.0");
  assert.throws(() => normalizeVersion("7.0.x"), { code: "INVALID_VERSION" });
  assert.throws(() => normalizeVersion("7.0 → 8.0"), { code: "INVALID_VERSION" });
  assert.throws(() => normalizeVersion(["7.0"]), { code: "INVALID_VERSION_TYPE" });
  assert.throws(() => normalizeVersion({ version: "7.0" }), { code: "INVALID_VERSION_TYPE" });
});

test("compares and sorts versions by numeric segments", () => {
  assert.equal(compareVersion("7.0.2", "7.0.10"), -1);
  assert.equal(compareVersion("7.0", "7.0.0"), 0);
  assert.deepEqual(sortVersions(boundaryFixture.sortInput), boundaryFixture.sortExpected);
});

test("uses half-open version ranges", () => {
  for (const item of boundaryFixture.ranges) {
    assert.equal(isActiveAt(item.version, item.since, item.until), item.active, JSON.stringify(item));
  }
});

test("validates duplicate canonical ids, aliases, status, and release snapshots", () => {
  const value = registry();
  value.products.AnyShare.versions.push({
    id: "v07.0.2",
    label: "duplicate",
    status: "released",
    release_date: null,
    aliases: ["AS-7010"],
    snapshot: null,
  });
  const result = validateVersionRegistry(value);
  assert.equal(result.valid, false);
  assert(result.diagnostics.some((item) => item.code === "DUPLICATE_VERSION"));
  assert(result.diagnostics.some((item) => item.code === "DUPLICATE_VERSION_ALIAS"));
  assert(result.diagnostics.some((item) => item.code === "RELEASED_SNAPSHOT_REQUIRED"));
});
