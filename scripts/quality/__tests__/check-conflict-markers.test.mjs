// check-conflict-markers 测试（WP-021）。分层：
//   L1 纯单元——scanText（标记行检出/分隔线不误报/多标记首标记上报）
//   L2 门禁契约——main 对真实文件集的判定（FAIL 逐文件行号/二进制跳过/--files 指定面/干净集 ok）
// 验证对象：scripts/quality/check-conflict-markers.mjs（真实临时文件，零 mock）。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main, scanText } from "../check-conflict-markers.mjs";

test("L1 scanText：检出两种标记并报行号；分隔线（非标记）不误报", () => {
  // 字面标记用拼接构造——门禁扫源码文本，字面量会自咬（检查器首跑自证实录）
  const L = "<" + "<" + "<" + "<" + "<" + "<" + "<";
  const R = ">" + ">" + ">" + ">" + ">" + ">" + ">";
  const content = [
    "正常行",
    L + " HEAD",
    "我的内容",
    "=======", // 分隔线——不属于六字符标记对
    "对侧内容",
    R + " origin/main",
  ].join("\n");
  const hits = scanText(content);
  assert.deepEqual(hits.map((h) => h.line), [2, 6], "只报起始/结束标记，不报分隔线");
  assert.equal(hits[0].marker, L);
  assert.equal(hits[1].marker, R);
});

test("L1 scanText：干净文本零命中", () => {
  assert.deepEqual(scanText("a\nb\nc"), []);
});

function runWithFiles(dir, files) {
  return main(["--files", ...files.map((f) => path.join(dir, f))], { cwd: dir });
}

function tmpWith(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-"));
  for (const [name, content] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test("L2 FAIL：违规文件列 文件:行号；多文件聚合", () => {
  const L = "<".repeat(7); const R = ">".repeat(7); // 字面标记拼接构造——门禁扫源码防自咬
  const dir = tmpWith({
    "a.md": "ok\n" + L + " HEAD\n",
    "sub/b.json": '{\n  "k": "' + R + ' origin/main"\n}\n',
    "clean.md": "干净\n",
  });
  let code = 0; let out = "";
  const origLog = console.error;
  console.error = (l) => { out += l + "\n"; };
  try { code = runWithFiles(dir, ["a.md", "sub/b.json", "clean.md"]); } finally { console.error = origLog; }
  assert.equal(code, 1);
  assert.match(out, /conflict_markers=FAIL violations=2/);
  assert.match(out, /a\.md:2/);
  assert.match(out, /sub\/b\.json:2/);
});

test("L2 二进制/未知扩展跳过不误报；干净集 ok 退出 0", () => {
  const dir = tmpWith({
    "bin.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c]),
    "weird.noext": "干净内容\n", // 无扩展名：保守扫描（ext="" 不在黑名单逻辑内）
    "ok.md": "干净",
  });
  let code = 1; let out = "";
  const orig = [console.log, console.error];
  console.log = (l) => { out += l + "\n"; };
  console.error = (l) => { out += l + "\n"; };
  try { code = runWithFiles(dir, ["bin.png", "weird.noext", "ok.md"]); } finally { [console.log, console.error] = orig; }
  assert.equal(code, 0);
  assert.match(out, /conflict_markers=ok files=3/, "无扩展名文件保守扫描（ext 空不跳过）；二进制 .png 跳过");
});

test("L2 --files 指定不存在文件：静默跳过不炸", () => {
  const dir = tmpWith({ "ok.md": "干净" });
  let code = 0;
  const orig = console.log;
  console.log = (l) => { out_log = l; };
  let out_log = "";
  try { code = runWithFiles(dir, ["ok.md", "不存在.md"]); } finally { console.log = orig; }
  assert.equal(code, 0);
  assert.match(out_log, /files=1/);
});
