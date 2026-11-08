// 层级：纯单元（登记解析器两档）。
// WP-076 收 V04：观察账本落点缺席不再按脚本位置拼仓根——旧住址 data/taxonomy-observations.jsonl
// 落在 .gitignore:/data/* 内，写成功也零可见（面⑦ 只盯 data/theschema|data/governance）＝无痕写。
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { resolveObservationsFile, ObservationsScopeError } from "../shared/observations-path.mjs";

const VAR = "TAXONOMY_OBSERVATIONS_FILE";

test("缺席即拒：不猜仓根，报错点名出口（runtime-scope no_implicit_fallback_on_write）", (t) => {
  const saved = process.env[VAR];
  delete process.env[VAR];
  t.after(() => { if (saved === undefined) delete process.env[VAR]; else process.env[VAR] = saved; });
  assert.throws(() => resolveObservationsFile(), (e) => e instanceof ObservationsScopeError && /export TAXONOMY_OBSERVATIONS_FILE=/.test(e.message));
});

test("钉扎生效：给定落点即原样解析为绝对路径（空串不算给定）", (t) => {
  const saved = process.env[VAR];
  t.after(() => { if (saved === undefined) delete process.env[VAR]; else process.env[VAR] = saved; });
  const dir = path.join(os.tmpdir(), "obs-pin.jsonl");
  process.env[VAR] = dir;
  assert.equal(resolveObservationsFile(), path.resolve(dir));
  process.env[VAR] = "   ";
  assert.throws(() => resolveObservationsFile(), ObservationsScopeError, "空白值不得被当成已登记落点");
});
