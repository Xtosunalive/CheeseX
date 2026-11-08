#!/usr/bin/env node
// check-derivation-sync.mjs — 派生物同步门禁（注册表派生，quality-gates 第 32 号）
// @responsible: 读两份登记表——① contracts/theschema-roles.json：每条 role=derived 且 generator≠null
//               的行（vault 侧投影，无 vault 明示 skip——CI 门禁阶段先于 e2e vault 构建）；②
//               contracts/reuse-domains.json：每条 generator≠null 的域行（仓内侧契约/代码投影，
//               WP-133 扩第二登记源——theschema-roles 辖区限 data/theschema/，仓内派生行落此，
//               不依赖 vault 故无条件跑）。各自运行其生成器（npm 别名）的 --check——派生物与源
//               漂移即红。检查清单从注册表派生，不硬编码任何投影：新派生物登记即自动入保
//               （generator≠null 即被查），"登记了忘了接线"这一类问题构造性不可能。
// @inputs: contracts/theschema-roles.json、contracts/reuse-domains.json、vault（经 VAULT_PATH/.env
//          解析；缺省明示 skip vault 侧行——CI 门禁阶段先于 e2e vault 构建，check-fields-registry
//          同款先例；仓内侧行不受此限）
// @context: 生成器即校验器（dictionary-of-ai-coding 三件套）；authority：ADR-008 D2＋
//           SPEC-015 §三.2（fields.yaml 投影）＋SPEC-019（角色注册表机制）。
// 边界：generator=null 的派生行（history/** 等 vault 侧管线产物）不在本面——
//       它们无仓内可跑的 --check 生成器，由各自管线自有验证覆盖（pipeline Stage 6 / schema-writers）。
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 纯选择函数（单测直证）：注册表 → 需跑 --check 的派生行。 */
export function selectDerivations(registry) {
  return (registry.entries || []).filter(
    (e) => e && e.role === "derived" && typeof e.generator === "string" && e.generator.trim(),
  );
}

/** 纯选择函数（WP-133 扩第二登记源）：reuse-domains 行 → 仓内侧派生行（generator≠null）。
 * 与 theschema-roles 派生行的区别：登记对象是仓内契约/代码投影（如 contracts/http-api.openapi.json
 * 三个 enum 段←服务端枚举源），不依赖 vault——无 vault 也要跑（error-registry 退役先例：
 * CI 门禁阶段先于 vault 构建，仓内侧派生行跟 vault skip 即假绿豁口，故无条件执行）。
 * 辖区注记：theschema-roles 面⑩辖区互斥（登记文件 ⊆ data/theschema/），仓内契约派生行不可入彼表，
 * 本源即其登记住址（行形态参照 entity-frontmatter-schema：generator=package.json 别名）。 */
export function selectRepoDerivations(registry) {
  return (registry.domains || []).filter(
    (d) => d && typeof d.generator === "string" && d.generator.trim(),
  );
}

function resolveVault() {
  const fromEnv = process.env.VAULT_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return null;
  const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.trim().startsWith("VAULT_PATH="));
  if (!line) return null;
  const v = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  return v && fs.existsSync(v) ? v : null;
}

function main() {
  const registryPath = path.join(ROOT, "contracts", "theschema-roles.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const reusePath = path.join(ROOT, "contracts", "reuse-domains.json");
  const reuse = JSON.parse(fs.readFileSync(reusePath, "utf8"));
  const vaultDerivations = selectDerivations(registry);
  const repoDerivations = selectRepoDerivations(reuse);
  if (!vaultDerivations.length && !repoDerivations.length) {
    console.log("check:derivation-sync=ok derivations=0（两表无 generator 派生行）");
    return;
  }
  const failed = [];
  // 仓内侧派生行：不依赖 vault，无条件跑（真身与投影都在仓内）
  for (const d of repoDerivations) {
    const alias = d.generator.replace(/^npm run /, "").split(/\s+/)[0];
    const cmd = `npm run ${alias} -- --check`;
    console.log(`check:derivation-sync: 校验 ${d.id}（仓内侧） ← ${cmd}`);
    try {
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    } catch {
      failed.push(d.id);
    }
  }
  // vault 侧派生行（投影住 vault）：无 vault 明示 skip（CI 门禁阶段先于 e2e vault 构建先例不变）
  const vault = resolveVault();
  let vaultRan = 0;
  if (!vault) {
    if (vaultDerivations.length) {
      console.log(`check:derivation-sync: (skip VAULT_PATH 未解析——${vaultDerivations.length} 条 vault 侧派生行无对账面，本地/有 vault 环境跑全量；仓内侧 ${repoDerivations.length} 条已无条件执行)`);
    }
  } else {
    for (const d of vaultDerivations) {
      const alias = d.generator.replace(/^npm run /, "").split(/\s+/)[0];
      const cmd = `npm run ${alias} -- --check`;
      console.log(`check:derivation-sync: 校验 ${d.file} ← ${cmd}`);
      vaultRan += 1;
      try {
        execSync(cmd, { cwd: ROOT, stdio: "inherit" });
      } catch {
        failed.push(d.file);
      }
    }
  }
  if (failed.length) {
    console.error(`check:derivation-sync: FAIL（${failed.length} 红：${failed.join("、")}）——派生物与源漂移，重跑对应生成器后重试`);
    process.exit(1);
  }
  const vaultPart = vault ? `vault=live vaultRows=${vaultRan}` : `vault=skipped vaultRows=0`;
  console.log(`check:derivation-sync=ok derivations=${repoDerivations.length + vaultDerivations.length} repoRows=${repoDerivations.length} ${vaultPart}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
