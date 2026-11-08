// Component: Error-Throw-Scan（错误抛点扫描——单一实现，生成器与门禁共用）
// @responsible: PR-158（副本→计算第一刀）——错误码的真身=抛点（server/**/*.cjs 的 throw 行上
//   的工厂调用字面量）。本模块是「扫描真身」的唯一实现：生成器（gen-error-registry）用它产出
//   注册物，门禁（check-error-registry）用它核 freshness——同一函数，不存在两套口径。
// @context: Sync（CI 可跑）
import fs from "node:fs";
import path from "node:path";

const THROW_RE = /\b(createError|serviceError|repairError|contractError|gateError|[a-zA-Z]+Error)\s*\(\s*["']([A-Z][A-Z0-9_]+)["']/g;
const STATUS_RE = /,\s*(\d{3})\s*(?:,|\))/;

/** 递归收集 server/ 下 .cjs（跳过 __tests__）。 */
function* walkFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") yield* walkFiles(fp); }
    else if (e.name.endsWith(".cjs")) yield fp;
  }
}

// 扫描全部抛点。
// 多行 throw 兼容（PR-158 实测盲区：`throw createError(\n "CODE",` 的 code 在下一行——
// frozen-artifact-reader.cjs 实例）：throw 行含工厂调用但无全大写字面量时，向下看 3 行取首个。
// @returns {Map<string, Array<{file:string, line:number, status:number|null, detailKeys:string[]}>>}
//   code → 抛点清单（file 相对根、行号、显式 status、details 对象字面量键）。
export function scanThrowSites(root) {
  const found = new Map();
  for (const file of walkFiles(path.join(root, "server"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // H7（红队，WP-015 批）：return-shape 工厂——`return { error: createError(...) }` 形态
      // （guard 类裁决件先构造后由调用方 throw）与 throw 行同码同源，PR-158「真身=抛点」补这一面
      if (/\breturn\b|error\s*:\s*[A-Za-z]*[Ee]rror\s*\(/.test(line)) { // H7：return 形＋对象成员 error: 工厂形（guard 类）
        THROW_RE.lastIndex = 0;
        let rm;
        while ((rm = THROW_RE.exec(line))) {
          if (!/[Ee]rror/.test(rm[1])) continue;
          const code = rm[2];
          const statusMatch = STATUS_RE.exec(line.slice(rm.index));
          const detailKeys = [...line.slice(rm.index).matchAll(/[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((x) => x[1]).filter((k) => k !== "error");
          if (!found.has(code)) found.set(code, []);
          found.get(code).push({ file: rel, line: i + 1, status: statusMatch ? Number(statusMatch[1]) : null, detailKeys });
        }
        // return 多行形态（guard 类：return { error: createError(\n "CODE", ...）——码在后续行
        const openRet = line.match(/(?:return|error\s*:)[^;]*[Ee]rror\s*\(\s*$/); // guard 形态＝对象成员 error: createError(
        if (openRet) {
          const window = lines.slice(i + 1, i + 4);
          for (let j = 0; j < window.length; j++) {
            const codeMatch = window[j].match(/["']([A-Z][A-Z0-9_]+)["']/);
            if (!codeMatch) continue;
            const joined = line + " " + window.slice(0, j + 1).join(" ");
            const statusMatch = STATUS_RE.exec(joined);
            if (!found.has(codeMatch[1])) found.set(codeMatch[1], []);
            found.get(codeMatch[1]).push({ file: rel, line: i + 1, status: statusMatch ? Number(statusMatch[1]) : null, detailKeys: [] });
            break;
          }
        }
      }
      if (!/throw/.test(line)) continue;
      let m;
      THROW_RE.lastIndex = 0;
      while ((m = THROW_RE.exec(line))) {
        if (!/[Ee]rror/.test(m[1])) continue;
        const code = m[2];
        const statusMatch = STATUS_RE.exec(line.slice(m.index));
        const detailKeys = [...line.slice(m.index).matchAll(/[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((x) => x[1]);
        if (!found.has(code)) found.set(code, []);
        found.get(code).push({ file: rel, line: i + 1, status: statusMatch ? Number(statusMatch[1]) : null, detailKeys });
      }
      // 多行形态：工厂调用已开、码字面量在后续行（throw 行本身无第二捕获即走此支）
      const openCall = line.match(/throw\s+[a-zA-Z]*[Ee]rror\s*\(\s*$/);
      if (!openCall) continue;
      const window = lines.slice(i + 1, i + 4);
      for (let j = 0; j < window.length; j++) {
        const codeMatch = window[j].match(/["']([A-Z][A-Z0-9_]+)["']/);
        if (!codeMatch) continue;
        const code = codeMatch[1];
        const joined = line + " " + window.slice(0, j + 1).join(" ");
        const statusMatch = STATUS_RE.exec(joined);
        if (!found.has(code)) found.set(code, []);
        found.get(code).push({ file: rel, line: i + 1, status: statusMatch ? Number(statusMatch[1]) : null, detailKeys: [] });
        break;
      }
    }
  }
  return found;
}
