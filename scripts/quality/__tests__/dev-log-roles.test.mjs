import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// 专家团角色注册单测试：守护「角色身份单一事实源」不被抄第二份。
// 数据事实源 = scripts/quality/shared/dev-log-roles.mjs；
// 枚举事实源 = contracts/dev-log.schema.json（owner）。
// 搬运自源库（架构图系统-rebuild）的守护语义，测试体按本仓文件布局新写。
import {
  OWNER_META,
  OWNER_LABELS,
  RESPONSIBILITY_DOMAINS,
  RESPONSIBILITY_NATURE,
  RESPONSIBILITY_ROW_ORDER,
  ROLE_RESPONSIBILITY,
} from "../shared/dev-log-roles.mjs";
import { renderResponsibilityMatrix } from "../shared/dev-log-responsibility-matrix.mjs";
import { OWNER_ZONE_PREFIXES } from "../shared/dev-log-ledger.mjs";

const REAL_SCHEMA_PATH = path.join(import.meta.dirname, "../../../contracts/dev-log.schema.json");
const realSchema = (() => {
  if (!fs.existsSync(REAL_SCHEMA_PATH)) {
    throw new Error(`契约事实源缺失：${REAL_SCHEMA_PATH}——本测试不得在替身上变绿`);
  }
  return JSON.parse(fs.readFileSync(REAL_SCHEMA_PATH, "utf8"));
})();

test("OWNER_META 的键与 schema owner 枚举完全一致（防漂移）", () => {
  const schemaOwners = realSchema.properties.owner.enum;
  assert.deepEqual(
    [...Object.keys(OWNER_META)].sort(),
    [...schemaOwners].sort(),
    "角色注册单的键必须与 contracts/dev-log.schema.json 的 owner 枚举一一对应",
  );
});

test("三向键集一致：OWNER_META ≡ OWNER_ZONE_PREFIXES ≡ schema owner 枚举（PR-216 A5 落地批补固）", async () => {
  const { OWNER_ZONE_PREFIXES } = await import("../shared/dev-log-ledger.mjs");
  const schemaOwners = realSchema.properties.owner.enum;
  assert.deepEqual(
    [...Object.keys(OWNER_ZONE_PREFIXES)].sort(),
    [...Object.keys(OWNER_META)].sort(),
    "机器合规视图（OWNER_ZONE_PREFIXES）与注册单（OWNER_META）键集须一致——AGENTS §四「改角色只改注册单」，辖区表增删角色键＝绕开注册单改角色",
  );
  assert.deepEqual(
    [...Object.keys(OWNER_ZONE_PREFIXES)].sort(),
    [...schemaOwners].sort(),
    "辖区表键集须与 schema owner 枚举一致（三向闭）",
  );
});

test("OWNER_META 每个角色有花名与非空职责", () => {
  for (const [owner, meta] of Object.entries(OWNER_META)) {
    assert.equal(typeof meta.name, "string", `${owner} 缺花名`);
    assert.ok(meta.name.length > 0, `${owner} 花名为空`);
    assert.equal(typeof meta.duty, "string", `${owner} 缺职责`);
    assert.ok(meta.duty.length > 0, `${owner} 职责为空`);
    assert.equal(typeof meta.zone_summary, "string", `${owner} 缺辖区功能总结`);
    assert.ok(meta.zone_summary.length > 0, `${owner} 辖区功能总结为空`);
  }
});

test("OWNER_LABELS 由 OWNER_META 派生（名·职责 单行标识）", () => {
  for (const [owner, label] of Object.entries(OWNER_LABELS)) {
    assert.equal(label, `${OWNER_META[owner].name}·${OWNER_META[owner].duty}`);
  }
});

test("责任矩阵：行序 = OWNER_META 全集、单元格性质合法、职能域有主责", () => {
  assert.deepEqual(
    [...RESPONSIBILITY_ROW_ORDER].sort(),
    [...Object.keys(OWNER_META)].sort(),
    "矩阵行序必须覆盖全部角色",
  );
  const natureKeys = Object.keys(RESPONSIBILITY_NATURE);
  for (const [owner, domains] of Object.entries(ROLE_RESPONSIBILITY)) {
    assert.ok(Object.keys(OWNER_META).includes(owner), `未知角色 ${owner}`);
    for (const [dkey, entry] of Object.entries(domains)) {
      assert.ok(RESPONSIBILITY_DOMAINS.some((d) => d.key === dkey), `${owner} 引用未知职能域 ${dkey}`);
      assert.ok(entry.n.length > 0, `${owner}/${dkey} 性质为空`);
      for (const n of entry.n) assert.ok(natureKeys.includes(n), `${owner}/${dkey} 未知性质 ${n}`);
    }
  }
  // 每个职能域恰好有主责角色（竖读每列不空）
  for (const d of RESPONSIBILITY_DOMAINS) {
    const owners = Object.keys(ROLE_RESPONSIBILITY).filter((o) => ROLE_RESPONSIBILITY[o][d.key]);
    assert.ok(owners.length > 0, `职能域 ${d.name}（${d.key}）无主责角色`);
  }
});

test("SoD 体检：无角色同时兼具门禁执行与门禁治理（执规/执队分离）", () => {
  const conflict = Object.keys(ROLE_RESPONSIBILITY).filter(
    (o) => ROLE_RESPONSIBILITY[o].gateExec && ROLE_RESPONSIBILITY[o].gateGov,
  );
  assert.deepEqual(conflict, [], `以下角色跨门禁执行与治理面：${conflict.join(", ")}`);
});

test("renderResponsibilityMatrix 产出三视图 + SoD 结论且引用真实花名", () => {
  const lines = renderResponsibilityMatrix();
  const text = lines.join("\n");
  assert.ok(text.includes("① 网格矩阵"));
  assert.ok(text.includes("② 按性质分列"));
  assert.ok(text.includes("③ 职能矩阵"));
  assert.ok(text.includes("SoD 体检"));
  assert.ok(text.includes("✅ **SoD 达标**") || text.includes("⚠️ **SoD 缺口**"));
  for (const meta of Object.values(OWNER_META)) {
    assert.ok(text.includes(meta.name), `矩阵缺少角色 ${meta.name}`);
  }
});

test("OWNER_ZONE_PREFIXES（机器合规视图）与 OWNER_META（人读身份视图）同键集", () => {
  assert.deepEqual(
    [...Object.keys(OWNER_ZONE_PREFIXES)].sort(),
    [...Object.keys(OWNER_META)].sort(),
    "两个互补视图必须覆盖同一组角色（键集一致，值域分工不同）",
  );
});
