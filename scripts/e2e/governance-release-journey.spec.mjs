// @component: 治理链全旅程——Playwright 迁移件（WP-096 T3 批，WP-067 / SPEC-067 主干）
// @context: 旧件 scripts/e2e/governance-release-journey.e2e.mjs 的运行器层等价迁移——
//   断言集逐条同源（旧 record() 步 ↔ 本 expect/test.step 块），不借机改测试口径。
//   主干（全部经公开端点）：Step1 成对态铸版 → Step2 PUT versions 注册 draft → Step3 freeze
//  （真 generate-sa.py 投影）→ Step4 新版本铸版 → Step5 消费面 200 → Step6 指针恢复 →
//   Step7 恢复后消费面 200 → Step8 指针前向恢复（收尾停在健康发布）。
//   套件序：本流会推进版本表与发布指针——必须末位执行，不扰动其他流（旧件同约束；
//   本流对同一 fixture vault 不可重入：注册/冻结一次性推进版本表）。
//   分层诚实声明（SPEC-067 §二.3）：半填身份 409 负例与消费端半身份 500 由单层真实测试承担，
//   不在本旅程（旧件同口径）。
//   守卫（vault/作用域）在 lib/playwright-global-setup.mjs 前置；契约锚定随本测（旧件同位）。
import { test, expect } from "@playwright/test";
// SPEC-011 WP1：e2e 物理隔离守卫（globalSetup 已前置，此处进程级再证——与旧件头部同形态）
import { requireE2EVault } from "./lib/e2e-env.mjs";
import { assertEndpointsInContract } from "./lib/contract-anchor.mjs";

const VAULT_PATH = requireE2EVault();
const API_BASE = process.env.API_BASE || "http://127.0.0.1:18083";

const PRODUCT = "E2eProduct";
const NEW_VERSION = "2.0";

// 统一 fetch：响应体只读一次，非 JSON 落 null——与旧件 api() 同形
async function api(request, pathname, init) {
  const res = await request.fetch(`${API_BASE}${pathname}`, init);
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status(), ok: res.ok(), body };
}
function errorCode(body) { return body?.error_code ?? body?.errorCode ?? null; }

test("治理链全旅程（注册→冻结→铸版→消费面→指针恢复）", async ({ request }) => {
  // 契约锚定（旧件同位）
  assertEndpointsInContract([
    "POST /api/releases/mint",
    "POST /api/releases/current/restore",
    "GET /api/kg/classification/list",
    "GET /api/schema/product-identity",
    "GET /api/schema/versions",
    "PUT /api/schema/versions",
    "POST /api/schema/versions/freeze",
  ]);
  void VAULT_PATH; // 守卫已证；本流写路径全经公开 API（与旧件同）

  // Step 1: 成对态铸版成功（构建器基线 E2eProduct/1.0.0 已挂载；正向对照；护栏只放行成对态）
  let releaseA;
  await test.step("Step1 成对基线铸版（正向对照）", async () => {
    const identity0 = await api(request, "/api/schema/product-identity");
    expect(
      identity0.ok && identity0.body?.data?.configured === true,
      `Baseline identity is mounted（canonical=${identity0.body?.data?.canonicalProduct}）`,
    ).toBe(true);
    const mintA = await api(request, "/api/releases/mint", { method: "POST" });
    expect(
      mintA.ok && !!mintA.body?.data?.releaseId,
      `Mint succeeds on paired identity（releaseId=${String(mintA.body?.data?.releaseId ?? "").slice(0, 24)}… artifacts=${mintA.body?.data?.artifactCount}）`,
    ).toBe(true);
    releaseA = mintA.body?.data?.releaseId;
  });

  // Step 2: 注册新 draft 版本（读改写全注册表——写语义是整表替换）
  await test.step(`Step2 注册 draft ${PRODUCT}/${NEW_VERSION}`, async () => {
    const reg0 = await api(request, "/api/schema/versions");
    const nextProducts = JSON.parse(JSON.stringify(reg0.body?.data?.products ?? {}));
    nextProducts[PRODUCT] = nextProducts[PRODUCT] || { versions: [] };
    nextProducts[PRODUCT].versions.push({ id: NEW_VERSION, label: `${PRODUCT} ${NEW_VERSION}`, status: "draft", release_date: null, aliases: [], snapshot: null });
    const putVersions = await api(request, "/api/schema/versions", {
      method: "PUT",
      data: { revision: reg0.body?.data?.revision, patch: { products: nextProducts } },
    });
    expect(
      putVersions.ok,
      `PUT versions registers draft（status=${putVersions.status} code=${errorCode(putVersions.body)}）`,
    ).toBe(true);
  });

  // Step 3: 冻结（真 generate-sa.py 投影）→ 身份成对迁移到新版本
  //（2026-11-01 缺陷③回归固化：信封/数据目录漏配即红）
  await test.step(`Step3 冻结 ${PRODUCT}/${NEW_VERSION}（真 Python 投影）`, async () => {
    const reg1 = await api(request, "/api/schema/versions");
    const freeze = await api(request, "/api/schema/versions/freeze", {
      method: "POST",
      data: { revision: reg1.body?.data?.revision, product: PRODUCT, version: NEW_VERSION },
    });
    expect(
      freeze.ok,
      `Freeze succeeds (real projection ran)（status=${freeze.status} code=${errorCode(freeze.body)} product=${freeze.body?.data?.product} version=${freeze.body?.data?.version}）`,
    ).toBe(true);
  });

  // Step 4: 成对态（新版本）铸版成功
  let releaseB;
  await test.step("Step4 新版本成对铸版", async () => {
    const mintB = await api(request, "/api/releases/mint", { method: "POST" });
    expect(
      mintB.ok && !!mintB.body?.data?.releaseId,
      `Paired-identity mint succeeds at new version（releaseId=${String(mintB.body?.data?.releaseId ?? "").slice(0, 24)}… previous=${String(mintB.body?.data?.previousReleaseId ?? "") === String(releaseA) ? "releaseA✓" : String(mintB.body?.data?.previousReleaseId ?? "").slice(0, 24)}）`,
    ).toBe(true);
    releaseB = mintB.body?.data?.releaseId;
  });

  // Step 5: 消费面在 2.0 成对发布上——投影缺席（无投影文件）→ 200＋空列表＋availability 指引
  //（WP-070 空态语义三类定身份：展示类不因缺席报错，指去该去的地方。事件回归点：无论投影
  // 存在与否，绝不允许 500——原 404 断言在 WP-070 后为过时期望。）
  await test.step("Step5 消费面 200（投影缺席 → 定义态空列表＋指引）", async () => {
    const faces = await api(request, "/api/kg/classification/list");
    expect(
      faces.status === 200
        && Array.isArray(faces.body?.data?.items)
        && faces.body?.data?.items.length === 0
        && faces.body?.data?.availability?.empty === true
        && (faces.body?.data?.availability?.kinds ?? []).includes("semantic-architecture-empty")
        && !String(faces.status).startsWith("5"),
      `Classification answers defined 200 + availability guidance (never 500) on projection-less release（status=${faces.status} code=${errorCode(faces.body)} availability=${JSON.stringify(faces.body?.data?.availability ?? null)}）`,
    ).toBe(true);
    const identityFace = await api(request, "/api/schema/product-identity");
    expect(
      identityFace.ok && identityFace.body?.data?.configured === true,
      `Identity read face 200 on paired release（status=${identityFace.status}）`,
    ).toBe(true);
  });

  // Step 6: 指针恢复到 Step 1 发布（恢复链真实通道——2026-11-01 缺陷②回归固化：断裂即红）
  await test.step("Step6 指针恢复到 Step1 发布", async () => {
    const restore = await api(request, "/api/releases/current/restore", {
      method: "POST",
      data: { releaseId: releaseA },
    });
    expect(
      restore.ok && restore.body?.data?.releaseId === releaseA,
      `Restore moves pointer back（status=${restore.status} previous=${String(restore.body?.data?.previousReleaseId ?? "") === String(releaseB) ? "releaseB✓" : String(restore.body?.data?.previousReleaseId ?? "").slice(0, 24)}）`,
    ).toBe(true);
  });

  // Step 7: 恢复到 1.0.0 发布后——该发布内有 1.0.0 投影 → 投影读面 200（恢复真实生效的强证据）
  await test.step("Step7 恢复后投影读面 200", async () => {
    const faces2 = await api(request, "/api/kg/classification/list");
    expect(
      faces2.ok && faces2.body?.success === true,
      `Classification list 200 on restored release (projection present)（status=${faces2.status}）`,
    ).toBe(true);
  });

  // Step 8: 指针前向恢复回新版本发布——恢复是通用指针移动器（双向可走），收尾停在健康发布
  await test.step("Step8 指针前向恢复（收尾停在健康发布）", async () => {
    const restore2 = await api(request, "/api/releases/current/restore", {
      method: "POST",
      data: { releaseId: releaseB },
    });
    expect(
      restore2.ok && restore2.body?.data?.releaseId === releaseB,
      `Forward restore lands on paired release（status=${restore2.status}）`,
    ).toBe(true);
  });
});
