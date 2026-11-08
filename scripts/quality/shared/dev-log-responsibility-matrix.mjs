// Component: Dev-Log-Responsibility-Matrix-Renderer
// @responsible: 统一责任矩阵（角色 × 职能域）的 Vault 投影 renderer（#1890）。
//   数据单一事实源 = dev-log-roles.mjs（RESPONSIBILITY_* 四导出）；本文件只做渲染派生，
//   不持有任何矩阵数据，杜绝第三份角色职责副本（否决秦执规拟硬编码 ROLE_DIVISION_MATRIX）。
//   与 project-to-vault.mjs 互补：投影装配在 project-to-vault，矩阵渲染在此共享件。
import {
  OWNER_META,
  RESPONSIBILITY_NATURE,
  RESPONSIBILITY_DOMAINS,
  RESPONSIBILITY_ROW_ORDER,
  ROLE_RESPONSIBILITY,
} from "./dev-log-roles.mjs";

function esc(s) {
  return String(s ?? "").replaceAll("|", "\\|");
}

// 从 ROLE_RESPONSIBILITY 派生三视图（网格 / 按性质分列 / 职能矩阵）+ SoD 体检。
// 单一事实源 = dev-log-roles.mjs；否决了秦执规拟硬编码的 ROLE_DIVISION_MATRIX 常量（会成第三份角色职责副本）。
export function renderResponsibilityMatrix() {
  const lines = [];
  lines.push("## 统一责任矩阵（角色 × 职能域 · 单元格 = 性质全字）");
  lines.push("");
  lines.push("> 同一份数据（`scripts/quality/shared/dev-log-roles.mjs` 的 `ROLE_RESPONSIBILITY`）派生三视图：①网格矩阵 ②按性质分列 ③职能矩阵（竖读每列 = 该域谁主责）。单元格标注性质——**登记**=注册/记录归属、**执行**=做、**分析仲裁**=治理/裁决；（轻量）标记分析仲裁的轻量巡检态。改矩阵只改注册单，勿手改本页。");
  lines.push("");

  // ① 网格矩阵
  lines.push("### ① 网格矩阵（谁在哪个职能域承担什么性质）");
  lines.push("");
  const head = ["角色", ...RESPONSIBILITY_DOMAINS.map((d) => d.name)];
  lines.push("| " + head.join(" | ") + " |");
  lines.push("|" + head.map(() => "---").join("|") + "|");
  const cellOf = (owner, dkey) => {
    const entry = ROLE_RESPONSIBILITY[owner]?.[dkey];
    if (!entry) return "—";
    const txt = entry.n.map((x) => RESPONSIBILITY_NATURE[x]).join(" / ");
    return entry.light ? `${txt}（轻量）` : txt;
  };
  for (const owner of RESPONSIBILITY_ROW_ORDER) {
    const meta = OWNER_META[owner] ?? { name: owner };
    const row = [meta.name, ...RESPONSIBILITY_DOMAINS.map((d) => cellOf(owner, d.key))];
    lines.push("| " + row.map(esc).join(" | ") + " |");
  }
  lines.push("");

  // ② 按性质分列（同份数据横向转置）
  lines.push("### ② 按性质分列（同性质归一列 · 横向转置）");
  lines.push("");
  lines.push("> 把「执行」格子归一列、「登记」归一列、「分析仲裁」归一列——与①同一份数据，只是按性质横切。");
  lines.push("");
  const natures = ["execute", "register", "arbitrate"];
  const natColumns = {};
  for (const nat of natures) {
    const arr = [];
    for (const owner of RESPONSIBILITY_ROW_ORDER) {
      for (const d of RESPONSIBILITY_DOMAINS) {
        const entry = ROLE_RESPONSIBILITY[owner]?.[d.key];
        if (entry && entry.n.includes(nat)) {
          const meta = OWNER_META[owner] ?? { name: owner };
          arr.push(`${meta.name} · ${d.name}${entry.light ? "（轻量）" : ""}`);
        }
      }
    }
    natColumns[nat] = arr;
  }
  const maxLen = Math.max(1, ...natures.map((n) => natColumns[n].length));
  lines.push("| " + natures.map((n) => RESPONSIBILITY_NATURE[n]).join(" | ") + " |");
  lines.push("|" + natures.map(() => "---").join("|") + "|");
  for (let i = 0; i < maxLen; i++) {
    const row = natures.map((n) => natColumns[n][i] ?? "");
    lines.push("| " + row.map(esc).join(" | ") + " |");
  }
  lines.push("");

  // ③ 职能矩阵（竖读每列 = 该域谁主责）
  lines.push("### ③ 职能矩阵（竖读每列：该域谁主责）");
  lines.push("");
  lines.push("| 职能域 | 主责角色 | 承担性质 |");
  lines.push("|---|---|---|");
  for (const d of RESPONSIBILITY_DOMAINS) {
    let ownerName = "—";
    let natTxt = "—";
    for (const owner of RESPONSIBILITY_ROW_ORDER) {
      const entry = ROLE_RESPONSIBILITY[owner]?.[d.key];
      if (entry) {
        const meta = OWNER_META[owner] ?? { name: owner };
        ownerName = meta.name;
        natTxt = entry.n.map((x) => RESPONSIBILITY_NATURE[x]).join(" / ") + (entry.light ? "（轻量）" : "");
        break;
      }
    }
    lines.push(`| ${esc(d.name)} | ${esc(ownerName)} | ${esc(natTxt)} |`);
  }
  lines.push("");

  // SoD 体检：门禁域执行与治理/仲裁是否分离
  lines.push("### SoD 体检：门禁「执行」与「治理 / 仲裁」彻底分离");
  lines.push("");
  const gateExecOwners = [];
  const gateGovOwners = [];
  for (const owner of RESPONSIBILITY_ROW_ORDER) {
    const meta = OWNER_META[owner] ?? { name: owner };
    const ex = ROLE_RESPONSIBILITY[owner]?.gateExec;
    const gov = ROLE_RESPONSIBILITY[owner]?.gateGov;
    if (ex) gateExecOwners.push(`${meta.name}（${ex.n.map((x) => RESPONSIBILITY_NATURE[x]).join(" / ")}）`);
    if (gov) gateGovOwners.push(`${meta.name}（${gov.n.map((x) => RESPONSIBILITY_NATURE[x]).join(" / ")}${gov.light ? " · 轻量" : ""}）`);
  }
  const conflict = RESPONSIBILITY_ROW_ORDER.filter((o) => ROLE_RESPONSIBILITY[o]?.gateExec && ROLE_RESPONSIBILITY[o]?.gateGov);
  lines.push(`- 门禁**执行面**（gateExec）：由 ${gateExecOwners.join("、")} 承担——只跑门禁、不注册不仲裁。`);
  lines.push(`- 门禁**治理面**（gateGov）：由 ${gateGovOwners.join("、")} 承担——只管门禁注册与冲突裁决、不跑断言。`);
  if (conflict.length === 0) {
    lines.push("- ✅ **SoD 达标**：无任何角色同时兼具门禁「执行」与门禁「治理 / 仲裁」——执规管执行面、执队管治理面，各管一本账，执行与仲裁彻底分离。");
  } else {
    lines.push(`- ⚠️ **SoD 缺口**：以下角色同时跨门禁执行与治理面，需拆分：${conflict.map((o) => (OWNER_META[o] ?? { name: o }).name).join("、")}。`);
  }
  lines.push("");
  return lines;
}
