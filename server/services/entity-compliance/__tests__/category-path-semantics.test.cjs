// @tests: PR-063→WP-040（Master 2026-10-29「2A」两段式）——category-path 语义回归锚
//   ① 修复链（待处理问题）走 A08 结构化：两段合法值过、拼错拒、格式错拒（topic 段退役）
//   ② 首次录入（补齐表单）domain/subdomain 双下拉，整值=domain:subdomain（文件名派生已随 topic 退役移除）
// 层级：纯单元＋Adapter 契约。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { buildRuleSet, validateCategoryPath } = require("../../../shared/enums-loader.cjs");

const RULE_SET = buildRuleSet({
  domains: { ops: "运维", ref: "参考" },
  subdomains: { ops: ["deploy", "monitor"], ref: ["architecture"] },
});

test("① A08 结构化：两段合法值通过（WP-040 topic 段退役）", () => {
  assert.equal(validateCategoryPath("ops:deploy", RULE_SET), null);
  assert.equal(validateCategoryPath("ref:architecture", RULE_SET), null);
});

test("① A08 结构化：domain/subdomain 拼错即拒（枚举域是漂移检测基准——修复链同样守它）", () => {
  assert.match(validateCategoryPath("ops:ghost", RULE_SET), /subdomain 'ghost'/);
  assert.match(validateCategoryPath("ghost:deploy", RULE_SET), /domain 'ghost'/);
});

test("① A08 结构化：格式错（大写/多段/缺子域）即拒", () => {
  assert.ok(validateCategoryPath("Ops:Deploy")); // 大写＝枚举外（domain/subdomain 拼错）
  assert.ok(validateCategoryPath("ops:deploy:extra")); // 三段＝格式非法（topic 已退役）
  assert.ok(validateCategoryPath("ops:")); // 缺子域＝格式不完整
  assert.ok(validateCategoryPath("", RULE_SET));
});

test("② 补齐聚合：整值=domain:subdomain（文件名派生随 topic 段退役移除——WP-040）", () => {
  assert.equal(validateCategoryPath("ops:deploy", RULE_SET), null, "两段整值即合法，聚合不依赖文件名");
  assert.ok(validateCategoryPath(`ops:deploy:${"我的部署文档".toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, RULE_SET), "拼接第三段即格式非法");
});
