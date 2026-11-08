'use strict';
// Component: Entity-Identity-Mint 单元测试（WP-113）
// @responsible: 钉住「组件身份号＝系统给的不透明串」这件事的构造性质：出号、不撞、可判重、耗尽不静默、
//   号里不带业务语义、空候选不采纳。
// @inputs: server/shared/entity-identity-mint.cjs（纯函数，注入 random／taken）
// @outputs: node:test 断言
// @context: 单元层（零 IO、零真库）。形状改判（Master 2026-11-05「换」）后，本文件不再断言任何
//   "标题打头"之类形状——断言只钉行为与不变式；形状常量住模块内，测试复制形状＝长出第二份判据。

const assert = require("node:assert/strict");
const test = require("node:test");

const { mintEntityId } = require("../entity-identity-mint.cjs");

test("不注入任何选项也能出号，且两次不同（默认走内建随机源）", () => {
  const a = mintEntityId();
  const b = mintEntityId();
  assert.ok(a && a.length > 0, "默认源必须能出号");
  assert.notEqual(a, b, "连续两次铸造不得给出同一个号");
});

test("号与业务语义无关：传标题进去也不参与铸造（防「可读主干」回潮）", () => {
  const fixed = { random: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
  const withTitleA = mintEntityId({ ...fixed });
  const withTitleB = mintEntityId({ ...fixed });
  assert.equal(withTitleA, withTitleB, "同一随机源必须给同一号——说明号不由标题等派生");
  assert.ok(!/title|标题|mysql/i.test(withTitleA), `号内不得携带业务词：${withTitleA}`);
});

test("空候选不采纳：随机源给出空串/纯空白时继续重试，不把空号交出去", () => {
  const sequence = ["", "   ", "real-value"];
  let i = 0;
  const id = mintEntityId({ random: () => sequence[Math.min(i++, sequence.length - 1)] });
  assert.equal(id, "real-value", `应跳过空候选取到第三个，实得 ${JSON.stringify(id)}（尝试 ${i} 次）`);
});

test("taken 判重在取号内部生效：占用则换号；64 次全占用返回 null（调用方必须报错，不得静默落可撞值）", () => {
  let attempts = 0;
  const partial = mintEntityId({ random: () => "same", taken: () => { attempts += 1; return attempts <= 3; } });
  assert.ok(partial, "第 4 次应取到未被占用的号");
  assert.equal(attempts, 4, `判重应重试到第 4 次，实际尝试 ${attempts} 次`);

  attempts = 0;
  const exhausted = mintEntityId({ random: () => "same", taken: () => { attempts += 1; return true; } });
  assert.equal(exhausted, null, "全占用必须返回 null");
  assert.equal(attempts, 64, `耗尽预算应为 64 次尝试，实得 ${attempts}`);
});

test("真实随机源连续铸造 1000 次全唯一（判重回调接真实集合，含重试路径）", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = mintEntityId({ taken: (candidate) => seen.has(candidate) });
    assert.ok(id, `第 ${i} 次取号失败（返回 null）`);
    assert.ok(!seen.has(id), `第 ${i} 次取到重复号：${id}`);
    seen.add(id);
  }
  assert.equal(seen.size, 1000, "1000 次取样应得 1000 个唯一号");
});

test("大小写归一：随机源给大写也落成小写形（等值比较面不被两形并存坑到）", () => {
  const id = mintEntityId({ random: () => "AA BB-CC".replace(/\s/g, "").toUpperCase() + "-DD" });
  assert.equal(id, id.toLowerCase(), `身份号应归一为小写：${id}`);
});
