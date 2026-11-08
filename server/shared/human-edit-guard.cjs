// Component: Human-Edit-Guard
// @responsible: 实体·概念页族「机器回写不覆盖人手改」裁决门（WP-015／SPEC-077 第二落地）。
//   机器写点（Node 经 vault-io、Python 经 write_gateway）写 entities/concepts 页前，比对
//   「人改面」（现文件 vs 机器基线侧账）×「本次写面」（现文件 vs 写后内容）——两面求交非空即拒
//   HUMAN_EDIT_CONFLICT（409），交由操作者裁决；不相交则放行（人改键/正文段原样保留）。
// @inputs: vaultPath、absPath（须含 知识库/wiki/entities|concepts 段）、nextRaw（写后全文）
// @outputs: checkWrite（写前裁决）／record（写后登记基线）／checkDelete（删除裁决）
// @context: 方向语义在册＝contracts/data-domains.json vault-content-data.write_protocol③
//   「机器回写不覆盖人手改」（SPEC-028/WP-007 落地口径）；本件是其机器化。
//   播种语义：文件存在而侧账无基线＝协议生效前的存量形态，视为「当前盘上即已知」——播种后
//   即全保护，存量人改不追溯（SPEC-077 §三 播种条款，可用性优先，如实记不追溯边界）。
//   侧账：知识库/wiki/.machine-write-baseline.json（git 即账；键= vault 相对路径；
//   值= {sha256, fm, body_sha}——fm 为 frontmatter 键值 dict，body_sha 为正文段哈希）。
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
// WP-116 批2（SPEC-083 §二.3）：frontmatter 界面定位经文档装载端口（宿主纯转发出口）——
// 消费面禁直 require yaml-frontmatter 宿主。
const { frontmatterBounds } = require("./document-load-port.cjs");
const { createError } = require("./error-factory.cjs");

const ENTITY_PAGE_RE = /(^|\/)知识库\/wiki\/(entities|concepts)\//;
const BASELINE_REL = path.join("知识库", "wiki", ".machine-write-baseline.json");

const sha256Of = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** 切分页面：frontmatter 键值 dict（YAML 解析失败→整块退化单键）＋正文哈希。
 *  frontmatterBounds 对缺界文件 throw——无 frontmatter 的页正文=全文。 */
function splitPage(raw) {
  let fmText = null;
  let body = raw;
  try {
    const bounds = frontmatterBounds(raw);
    fmText = raw.slice(bounds.contentStart, bounds.close);
    body = raw.slice(bounds.close + 4); // close 指向 "\n---" 的 \n；跳过 "---" 取正文
    if (body.startsWith("\n")) body = body.slice(1);
  } catch {
    fmText = null; // 无 frontmatter：整页视作正文
  }
  let fm = {};
  if (fmText != null) {
    try {
      const YAML = require("yaml");
      const parsed = YAML.parse(fmText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed;
      else fm = { __frontmatter_block__: fmText };
    } catch {
      fm = { __frontmatter_block__: fmText }; // 人改坏 YAML：键级 diff 退化为「整块视为一个键」
    }
  }
  return { fm, bodySha: sha256Of(body), fmBlock: fmText == null ? "" : fmText };
}

// H3（红队）：String() 直比对嵌套 mapping 全盲（[object Object] 同形）——canonical 串化（键排序稳定）。
// 与 Python 侧 str() 比较同构：两侧各自能辨嵌套改动；同构例在测试件钉住。
function canonicalize(v) {
  if (v === null || typeof v !== "object") return String(v);
  const sorted = Object.keys(v).sort().reduce((o, k) => { o[k] = canonicalize(v[k]); return o; }, {});
  return JSON.stringify(sorted);
}
function diffKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const dirty = new Set();
  for (const k of keys) if (canonicalize(a?.[k]) !== canonicalize(b?.[k])) dirty.add(k);
  if (a?.__frontmatter_block__ || b?.__frontmatter_block__) dirty.add("__frontmatter_block__");
  return dirty;
}

function baselinePath(vaultPath) {
  return path.join(vaultPath, BASELINE_REL);
}

function loadBaselines(vaultPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath(vaultPath), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveBaselines(vaultPath, baselines) {
  const tmp = baselinePath(vaultPath) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(baselines, null, 1) + "\n", "utf8");
  fs.renameSync(tmp, baselinePath(vaultPath));
}

/** 登记基线（写成功后调）。返回侧账是否发生落盘变化（供咽喉把侧账搭进账车）。 */
function record(vaultPath, absPath, raw) {
  const rel = path.relative(vaultPath, absPath).split(path.sep).join("/");
  if (!ENTITY_PAGE_RE.test("/" + rel)) return false;
  const baselines = loadBaselines(vaultPath);
  const page = splitPage(raw);
  const entry = { sha256: sha256Of(raw), fm: page.fm, body_sha: page.bodySha };
  if (baselines[rel] && baselines[rel].seeded) entry.seeded = true; // H4：播种痕迹沿条目持久（该页曾被播种＝首写吞人改的审计痕）
  const prev = JSON.stringify(baselines[rel] || null);
  const next = JSON.stringify(entry);
  if (prev === next) return false;
  baselines[rel] = entry;
  saveBaselines(vaultPath, baselines);
  return true;
}

function removeBaseline(vaultPath, absPath) {
  const rel = path.relative(vaultPath, absPath).split(path.sep).join("/");
  const baselines = loadBaselines(vaultPath);
  if (!(rel in baselines)) return false;
  delete baselines[rel];
  saveBaselines(vaultPath, baselines);
  return true;
}

/**
 * 写前裁决。返回 {allowed:true} 或 {allowed:false, error}（error 带 code=HUMAN_EDIT_CONFLICT）。
 * 相交判据：humanDirty（现 vs 基线）∩ writeDirty（现 vs 写后）非空 → 拒，附交集键名。
 */
function checkWrite({ vaultPath, absPath, nextRaw }) {
  const rel = path.relative(vaultPath, absPath).split(path.sep).join("/");
  if (!ENTITY_PAGE_RE.test("/" + rel)) return { allowed: true, seeded: false };
  const exists = fs.existsSync(absPath);
  if (!exists) return { allowed: true, seeded: false }; // 新建：写后 record 登记基线
  const baselines = loadBaselines(vaultPath);
  const base = baselines[rel] || null;
  const nowRaw = fs.readFileSync(absPath, "utf8");
  const nowSha = sha256Of(nowRaw);
  let humanDirty;
  let seeded = false;
  if (!base) {
    // 播种：存量无基线 → 现盘形态即已知（SPEC-077 §三），本次放行，写后按新内容登记。
    // H4（红队）：播种事件打标可审计（seeded_pending → record 转正）——「首次机写吞人改」不再无痕，
    // 语义取舍（播种要不要挡/告警）呈报 Master 裁，机器先保证可见。
    humanDirty = new Set();
    seeded = true;
    baselines[rel] = { sha256: nowSha, fm: splitPage(nowRaw).fm, body_sha: sha256Of(nowRaw), seeded: true };
    saveBaselines(vaultPath, baselines);
  } else if (base.sha256 === nowSha) {
    humanDirty = new Set(); // 快路径：无人改
  } else {
    const now = splitPage(nowRaw);
    humanDirty = diffKeys(now.fm, base.fm || {});
    if (now.bodySha !== base.body_sha) humanDirty.add("body");
  }
  const nowPage = splitPage(nowRaw);
  const nextPage = splitPage(String(nextRaw));
  const writeDirty = diffKeys(nowPage.fm, nextPage.fm);
  if (nowPage.bodySha !== nextPage.bodySha) writeDirty.add("body");
  const overlap = [...humanDirty].filter((k) => writeDirty.has(k));
  if (overlap.length > 0) {
    return {
      allowed: false,
      error: createError(
        "HUMAN_EDIT_CONFLICT",
        `人手改动与机器回写在同一面相交（${overlap.join("、")}）——按域行 write_protocol③「机器回写不覆盖人手改」拒写；请先在 Obsidian/页面上确认保留哪一方，或在对应写点按其显式覆盖旗重试`,
        409,
        { path: rel, humanDirtyKeys: [...humanDirty].sort(), overlapKeys: overlap.sort() },
      ),
    };
  }
  return { allowed: true, seeded };
}

/** 删除裁决：有基线且现文件已被改 → 拒删（不可逆动作从严）；无基线（存量占位）→ 放行（SPEC-077 §三 如实记）。 */
function checkDelete({ vaultPath, absPath }) {
  const rel = path.relative(vaultPath, absPath).split(path.sep).join("/");
  if (!ENTITY_PAGE_RE.test("/" + rel)) return { allowed: true };
  const baselines = loadBaselines(vaultPath);
  const base = baselines[rel];
  if (!base || !fs.existsSync(absPath)) return { allowed: true };
  const nowSha = sha256Of(fs.readFileSync(absPath, "utf8"));
  if (nowSha !== base.sha256) {
    return {
      allowed: false,
      error: createError(
        "HUMAN_EDIT_CONFLICT",
        `页面在机器基线之后被手改过，拒绝删除（不可逆动作从严）——若确需删除请先人工确认`,
        409,
        { path: rel },
      ),
    };
  }
  return { allowed: true };
}

// ── 模块级通道的侧账搭账旗标（vault-io writeVault 写成功→mark；scheduleLedgerSafe→consume）──
const _baselineLedgerFlags = new Set();
function markBaselineForLedger(vaultPath) { _baselineLedgerFlags.add(path.resolve(vaultPath)); }
function consumeBaselineLedgerFlag(vaultPath) {
  const key = path.resolve(vaultPath);
  if (!_baselineLedgerFlags.has(key)) return false;
  _baselineLedgerFlags.delete(key);
  return true;
}

module.exports = {
  ENTITY_PAGE_RE,
  markBaselineForLedger,
  consumeBaselineLedgerFlag,
  BASELINE_REL,
  checkWrite,
  checkDelete,
  record,
  removeBaseline,
  baselinePath,
  loadBaselines,
  // 测试与撤线自证用：纯函数判据（不给生产旁路——生产只经 checkWrite）
  _internals: { splitPage, diffKeys, sha256Of },
};
