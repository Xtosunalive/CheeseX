import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import YAML from "yaml";
import { assertEndpointsInContract } from "./lib/contract-anchor.mjs";
import { E2E_SCOPE_PINS, requireE2EVault } from "./lib/e2e-env.mjs";
import { startE2EStack } from "./lib/e2e-server.mjs";
import vocabLoadPort from "../../server/shared/vocab-load-port.cjs";

const sharedVault = requireE2EVault();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function vocabFile(vaultPath, name) {
  const file = vocabLoadPort.loadVocabFromDir(path.join(vaultPath, "知识库", "TheSchema"), { files: [name] }).files[name];
  if (file.state !== "present") throw new Error(`E2E 词表缺失：${name}`);
  return file;
}

function vocabText(vaultPath, name) {
  return vocabFile(vaultPath, name).text;
}

function vocabDoc(vaultPath, name) {
  return vocabFile(vaultPath, name).raw;
}

function cleanTree(root) {
  if (!root || !fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        try { fs.chmodSync(absolute, 0o755); } catch {}
        stack.push(absolute);
      } else {
        try { fs.chmodSync(absolute, 0o644); } catch {}
      }
    }
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

async function api(baseUrl, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

async function pollUntil(read, predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await delay(250);
  }
  throw new Error(`${message}；最后读数=${JSON.stringify(last)?.slice(0, 800)}`);
}

function sourceScreen(config) {
  const { buttons, empty, ...rest } = config.data.screen;
  const sourceEmpty = { ...empty };
  delete sourceEmpty.guide;
  return {
    ...rest,
    button_layout: buttons.map(({ action_id, label_cn, placement }) => ({ action_id, label_cn, placement })),
    empty: sourceEmpty,
  };
}

test("U3 正式路由样板：FaqCard、产品模块、定制保护与契约故障", async ({ page }) => {
  test.setTimeout(360_000);
  assertEndpointsInContract([
    "GET /api/individuals/{classId}/config",
    "GET /api/individuals/{classId}",
    "POST /api/individuals/{classId}",
    "GET /api/individuals/{classId}/{individualId}",
    "POST /api/individuals/{classId}/{individualId}/retire",
    "GET /api/derivation/article",
    "PUT /api/schema/ontology",
    "GET /api/schema/enums",
    "GET /api/schema/enums/history",
    "PUT /api/schema/modules/{moduleId}",
    "POST /api/schema/enums/append",
    "POST /api/schema/enums/rollback",
    "POST /api/articles/upload",
    "POST /api/articles/drafts/validate",
    "POST /api/articles/drafts/promote",
    "GET /api/articles/precleaned",
    "POST /api/articles/precleaned/{id}/standardization",
  ]);

  const sharedBefore = [hash(vocabText(sharedVault, "ontology")), hash(vocabText(sharedVault, "enums"))];
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "u3-screen-e2e-vault-"));
  const owned = new Set([vault]);
  const baseEnv = {
    ...process.env,
    AUTH_MODE: "local",
    LOCAL_OPERATOR_ID: "u3-e2e",
    VAULT_GIT_LEDGER_DISABLE: "0",
    GIT_AUTHOR_NAME: "U3 E2E",
    GIT_AUTHOR_EMAIL: "u3@example.invalid",
    GIT_COMMITTER_NAME: "U3 E2E",
    GIT_COMMITTER_EMAIL: "u3@example.invalid",
  };
  for (const key of E2E_SCOPE_PINS) delete baseEnv[key];
  delete baseEnv.API_BASE;
  delete baseEnv.BASE_URL;
  let stack = null;

  try {
    fs.cpSync(sharedVault, vault, {
      recursive: true,
      filter: (source) => source !== path.join(sharedVault, ".git"),
    });
    fs.rmSync(path.join(vault, "知识库", "wiki", "individuals", "FaqCard"), { recursive: true, force: true });
    const enumsPath = path.join(vault, "知识库", "TheSchema", "enums.yaml");
    const enums = vocabDoc(vault, "enums");
    enums.modules = {};
    fs.writeFileSync(enumsPath, YAML.stringify(enums));
    execFileSync("git", ["init", "-q"], { cwd: vault, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: vault, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=U3 E2E", "-c", "user.email=u3@example.invalid", "commit", "--allow-empty", "-qm", "u3: empty samples"], { cwd: vault, stdio: "ignore" });

    stack = await startE2EStack({ vaultPath: vault, baseEnv });
    for (const key of ["KB_DATA_DIR", "PIPELINE_TRAJECTORIES_DIR", "DECISIONS_MIRROR_DIR"]) owned.add(stack.env[key]);
    owned.add(path.dirname(stack.env.TAXONOMY_OBSERVATIONS_FILE));
    const baseUrl = stack.baseUrl;
    const apiBase = stack.apiBase;

    await test.step("FaqCard 空态指引与首条创建", async () => {
      await page.goto(`${baseUrl}/#/individuals`, { waitUntil: "networkidle" });
      await page.getByLabel("类 ID", { exact: true }).fill("FaqCard");
      await page.getByRole("button", { name: "加载", exact: true }).click();
      const empty = page.getByTestId("empty-state");
      await expect(empty).toContainText("当前类还没有问题卡");
      await expect(empty).toContainText("个体派生面 → 新建问题卡");
      await empty.getByRole("button", { name: "新建问题卡", exact: true }).click();
      await page.getByLabel("问题", { exact: true }).fill("U3 契约生成的问题");
      await page.getByLabel("答案", { exact: true }).fill("页面代码未改，屏幕契约改变后列表随契约变化。");
      await page.getByLabel("权重", { exact: true }).fill("7");
      await page.getByRole("button", { name: "保存修改", exact: true }).click();
      await expect(page.getByRole("cell", { name: "U3 契约生成的问题", exact: true })).toBeVisible();
      const list = await api(apiBase, "/api/individuals/FaqCard");
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].fields.weight).toBe("7");
    });

    let faqId;
    await test.step("只改屏幕契约，正式路由零页面代码改动即换列", async () => {
      const config = await api(apiBase, "/api/individuals/FaqCard/config");
      expect(config.status, JSON.stringify(config.body)).toBe(200);
      expect(config.body.data?.screen, JSON.stringify(config.body)).toBeDefined();
      const source = sourceScreen(config.body);
      source.list.columns = ["answer", "question"];
      const ontology = await api(apiBase, "/api/schema/ontology");
      expect(ontology.status).toBe(200);
      const screenContracts = vocabDoc(vault, "ontology").screen_contracts;
      const changed = await api(apiBase, "/api/schema/ontology", {
        method: "PUT",
        body: JSON.stringify({ revision: ontology.body.data.revision, patch: { screen_contracts: { ...screenContracts, FaqCard: source } } }),
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(vocabDoc(vault, "ontology").screen_contracts.KnowledgeArticle.renderer).toBe("custom:article-workflow");
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByLabel("类 ID", { exact: true }).fill("FaqCard");
      await page.getByRole("button", { name: "加载", exact: true }).click();
      await expect(page.getByRole("columnheader", { name: "答案", exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "问题", exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "权重", exact: true })).toHaveCount(0);
      const derivation = await api(apiBase, "/api/derivation/article");
      expect(derivation.status).toBe(200);
      expect(derivation.body.data.uiConfig.screen.renderer).toBe("custom:article-workflow");
      const list = await api(apiBase, "/api/individuals/FaqCard");
      faqId = list.body.data[0].individualId;
      await page.getByRole("row").filter({ hasText: "U3 契约生成的问题" }).getByRole("button", { name: "编辑", exact: true }).click();
      await expect(page.getByRole("definition").filter({ hasText: "页面代码未改，屏幕契约改变后列表随契约变化。" })).toBeVisible();
      await page.getByRole("button", { name: "取消", exact: true }).click();
    });

    await test.step("退役二次确认与保留文件语义", async () => {
      const record = await api(apiBase, `/api/individuals/FaqCard/${encodeURIComponent(faqId)}`);
      expect(record.status).toBe(200);
      const denied = await api(apiBase, `/api/individuals/FaqCard/${encodeURIComponent(faqId)}/retire`, {
        method: "POST",
        body: JSON.stringify({ expectedRevision: record.body.data.revision }),
      });
      expect(denied.status, JSON.stringify(denied.body)).toBe(409);
      expect(denied.body.error_code).toBe("ACTION_CONFIRM_REQUIRED");
      expect(fs.existsSync(path.join(vault, "知识库", "wiki", "individuals", "FaqCard", `${faqId}.md`))).toBe(true);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("row").filter({ hasText: "U3 契约生成的问题" }).getByRole("button", { name: "退役问题卡", exact: true }).click();
      await expect(page.getByTestId("empty-state")).toBeVisible();
      const retiredRaw = fs.readFileSync(path.join(vault, "知识库", "wiki", "individuals", "FaqCard", `${faqId}.md`), "utf8");
      expect(retiredRaw).toContain("lifecycle_status: retired");
      const list = await api(apiBase, "/api/individuals/FaqCard");
      expect(list.body.data).toEqual([]);
    });

    await test.step("产品模块空态、HTTP 原语、Git 快照与回滚", async () => {
      await page.goto(`${baseUrl}/#/schema?tab=modules`, { waitUntil: "networkidle" });
      const empty = page.getByTestId("empty-state");
      await expect(empty).toContainText("产品模块注册表还没有模块");
      await empty.getByRole("button", { name: "新建模块", exact: true }).click();
      await page.getByLabel("模块名称", { exact: true }).fill("结算");
      await page.getByLabel("所属系统", { exact: true }).fill("settlement-service");
      await page.getByLabel("所属子域", { exact: true }).fill("settlement");
      await page.getByRole("button", { name: "保存模块", exact: true }).click();
      const row = page.getByRole("row").filter({ hasText: "结算" }).first();
      await expect(row).toBeVisible();
      const afterCreate = await api(apiBase, "/api/schema/enums");
      expect(afterCreate.status).toBe(200);
      const createRevision = afterCreate.body.data.revision;
      const moduleGitLog = () => execFileSync("git", ["log", "--format=%s", "--", "知识库/TheSchema/enums.yaml"], { cwd: vault, encoding: "utf8" });
      await pollUntil(
        moduleGitLog,
        (value) => value.includes("模块保存 结算"),
        "模块创建未形成 Git 提交",
      );
      const history = await pollUntil(
        () => api(apiBase, "/api/schema/enums/history"),
        (result) => result.status === 200 && result.body.data?.items?.some((item) => item.revision === createRevision),
        "模块创建快照未按精确 revision 出现",
      );
      const snapshot = history.body.data.items.find((item) => item.revision === createRevision);
      await row.getByRole("button", { name: "追加适用产品", exact: true }).click();
      await page.getByLabel("追加到「结算」的适用产品", { exact: true }).fill("2.0.0");
      await page.getByRole("button", { name: "确认追加", exact: true }).click();
      await expect(page.getByRole("cell", { name: "2.0.0", exact: true })).toBeVisible();
      await pollUntil(
        moduleGitLog,
        (value) => value.includes("模块追加适用产品"),
        "模块追加未形成 Git 提交",
      );
      const afterAppend = await api(apiBase, "/api/schema/enums");
      const rollback = await api(apiBase, "/api/schema/enums/rollback", {
        method: "POST",
        body: JSON.stringify({ revision: afterAppend.body.data.revision, snapshotId: snapshot.id }),
      });
      expect(rollback.status, JSON.stringify(rollback.body)).toBe(200);
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("row").filter({ hasText: "结算" }).first()).toBeVisible();
      await expect(page.getByRole("cell", { name: "2.0.0", exact: true })).toHaveCount(0);
      const restored = await api(apiBase, "/api/schema/enums");
      expect(restored.body.data.modules["结算"].products).toEqual([]);
      const gitLog = await pollUntil(
        moduleGitLog,
        (value) => value.includes("模块保存 结算") && value.includes("模块追加适用产品") && value.includes("snapshot 回滚"),
        "模块写链未形成完整 Git 历史",
      );
      expect(gitLog).toContain("模块保存 结算");
    });

    await test.step("定制 renderer 不挂载，定制与词表类不走通用个体写", async () => {
      await page.goto(`${baseUrl}/#/individuals`, { waitUntil: "networkidle" });
      await page.getByLabel("类 ID", { exact: true }).fill("KnowledgeArticle");
      await page.getByRole("button", { name: "加载", exact: true }).click();
      await expect(page.getByText("该种类由所属管理面维护，本页不挂载通用清单或写按钮")).toBeVisible();
      await expect(page.getByRole("table", { name: "个体清单表" })).toHaveCount(0);
      await page.getByRole("button", { name: "前往所属管理面" }).click();
      await expect(page).toHaveURL(/#\/article-workflow$/);
      await page.goto(`${baseUrl}/#/individuals`, { waitUntil: "networkidle" });
      await page.getByLabel("类 ID", { exact: true }).fill("Module");
      await page.getByRole("button", { name: "加载", exact: true }).click();
      await expect(page.getByText("该种类由所属管理面维护，本页不挂载通用清单或写按钮")).toBeVisible();
      await expect(page.getByRole("table", { name: "个体清单表" })).toHaveCount(0);
      await page.getByRole("button", { name: "前往所属管理面" }).click();
      await expect(page).toHaveURL(/#\/schema\?tab=modules$/);
      for (const classId of ["KnowledgeArticle", "Module"]) {
        const blocked = await api(apiBase, `/api/individuals/${classId}`, { method: "POST", body: JSON.stringify({ fields: { title: "越界探针" } }) });
        expect(blocked.status).toBe(422);
        expect(blocked.body.error_code).toBe("INDIVIDUAL_CHANNEL_FORBIDDEN");
      }
    });

    await test.step("运行期契约不可用：读端点 503，通用写 422，恢复后重新激活", async () => {
      const validRaw = vocabText(vault, "ontology");
      const validDoc = YAML.parse(validRaw);
      const brokenDoc = structuredClone(validDoc);
      delete brokenDoc.action_types["individuals.config"].impact;
      const initial = await api(apiBase, "/api/schema/ontology");
      expect(initial.status).toBe(200);
      const changed = await api(apiBase, "/api/schema/ontology", {
        method: "PUT",
        body: JSON.stringify({ revision: initial.body.data.revision, patch: { action_types: brokenDoc.action_types } }),
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      try {
        const config = await api(apiBase, "/api/individuals/FaqCard/config");
        expect(config.status).toBe(503);
        expect(config.body.error_code).toBe("VALIDATOR_UNAVAILABLE");
        const derivation = await api(apiBase, "/api/derivation/article");
        expect(derivation.status).toBe(503);
        expect(derivation.headers.get("X-Derivation-Retained")).toBe("true");
        const blocked = await api(apiBase, "/api/individuals/FaqCard", { method: "POST", body: JSON.stringify({ fields: { question: "坏契约", answer: "不得落盘", weight: 1 } }) });
        expect(blocked.status).toBe(422);
        expect(blocked.body.error_code).toBe("INDIVIDUAL_CHANNEL_FORBIDDEN");
        expect(blocked.body.details.reason).toBe("TYPE_CONTRACT_UNAVAILABLE");
        expect(fs.readdirSync(path.join(vault, "知识库", "wiki", "individuals", "FaqCard")).filter((name) => name.endsWith(".md"))).toHaveLength(1);
      } finally {
        const current = await api(apiBase, "/api/schema/ontology");
        expect(current.status).toBe(200);
        const restored = await api(apiBase, "/api/schema/ontology", {
          method: "PUT",
          body: JSON.stringify({ revision: current.body.data.revision, patch: { action_types: validDoc.action_types } }),
        });
        expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      }
      const recovered = await api(apiBase, "/api/individuals/FaqCard/config");
      expect(recovered.status).toBe(200);
    });

    await test.step("屏幕状态形状非法：完整契约不可用，写通道拒绝且恢复后重活", async () => {
      const validRaw = vocabText(vault, "ontology");
      const validDoc = YAML.parse(validRaw);
      const brokenDoc = structuredClone(validDoc);
      brokenDoc.screen_contracts.FaqCard.states.error.retry = "yes";
      const initial = await api(apiBase, "/api/schema/ontology");
      expect(initial.status).toBe(200);
      const changed = await api(apiBase, "/api/schema/ontology", {
        method: "PUT",
        body: JSON.stringify({ revision: initial.body.data.revision, patch: { screen_contracts: brokenDoc.screen_contracts } }),
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      try {
        const config = await api(apiBase, "/api/individuals/FaqCard/config");
        expect(config.status).toBe(503);
        expect(config.body.error_code).toBe("VALIDATOR_UNAVAILABLE");
        const derivation = await api(apiBase, "/api/derivation/article");
        expect(derivation.status).toBe(503);
        const blocked = await api(apiBase, "/api/individuals/FaqCard", { method: "POST", body: JSON.stringify({ fields: { question: "坏屏幕", answer: "不得落盘", weight: 1 } }) });
        expect(blocked.status).toBe(422);
        expect(blocked.body.error_code).toBe("INDIVIDUAL_CHANNEL_FORBIDDEN");
        expect(blocked.body.details.reason).toBe("TYPE_CONTRACT_UNAVAILABLE");
        expect(fs.readdirSync(path.join(vault, "知识库", "wiki", "individuals", "FaqCard")).filter((name) => name.endsWith(".md"))).toHaveLength(1);
      } finally {
        const current = await api(apiBase, "/api/schema/ontology");
        expect(current.status).toBe(200);
        const restored = await api(apiBase, "/api/schema/ontology", {
          method: "PUT",
          body: JSON.stringify({ revision: current.body.data.revision, patch: { screen_contracts: validDoc.screen_contracts } }),
        });
        expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      }
      const recovered = await api(apiBase, "/api/individuals/FaqCard/config");
      expect(recovered.status).toBe(200);
    });

    await test.step("合法 allow 风险投影为无确认，屏幕端点保持可用", async () => {
      const validDoc = YAML.parse(vocabText(vault, "ontology"));
      const originalRisks = validDoc.risk_types;
      const allowedRisks = {
        ...originalRisks,
        "individual-retire": { ...originalRisks["individual-retire"], decision: "allow" },
      };
      const initial = await api(apiBase, "/api/schema/ontology");
      expect(initial.status).toBe(200);
      const changed = await api(apiBase, "/api/schema/ontology", {
        method: "PUT",
        body: JSON.stringify({ revision: initial.body.data.revision, patch: { risk_types: allowedRisks } }),
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      try {
        const config = await api(apiBase, "/api/individuals/FaqCard/config");
        expect(config.status, JSON.stringify(config.body)).toBe(200);
        const retireButton = config.body.data.screen.buttons.find((button) => button.action_id === "individuals.retire");
        expect(retireButton.confirmation).toBe("none");
      } finally {
        const current = await api(apiBase, "/api/schema/ontology");
        expect(current.status).toBe(200);
        const restored = await api(apiBase, "/api/schema/ontology", {
          method: "PUT",
          body: JSON.stringify({ revision: current.body.data.revision, patch: { risk_types: originalRisks } }),
        });
        expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      }
    });

    await test.step("文章业务流与持久层连续重放两遍", async () => {
      const fileName = "u3-screen-replay.md";
      const content = `---\ntitle: U3 屏幕样板文章\narticle_id: 11111111-1111-4111-8111-111111111111\nproduct: E2eProduct\nversion: 1.0.0\nmodule: 结算\narticle_type: 排错指南\ndoc-type: 用户手册\ncategory-path: ops:maintain\narch_layer: service\narch_category: 服务\ntags: [test, e2e]\n---\n\n# U3 屏幕样板文章\n\n契约样板与持久层重放。\n`;
      let businessIdentity;
      const taskIds = [];
      for (let round = 1; round <= 2; round += 1) {
        const requestBody = JSON.stringify({ fileName, contentBase64: Buffer.from(content).toString("base64") });
        const upload = await api(apiBase, "/api/articles/upload", { method: "POST", body: requestBody });
        expect(upload.status, JSON.stringify(upload.body)).toBe(201);
        const taskId = upload.body.data.taskId;
        const draftPath = upload.body.data.draftPath;
        taskIds.push(taskId);
        const duplicate = await api(apiBase, "/api/articles/upload", { method: "POST", body: requestBody });
        expect(duplicate.status, JSON.stringify(duplicate.body)).toBe(409);
        expect(duplicate.body.error_code).toBe("DRAFT_ALREADY_EXISTS");
        const terminal = await pollUntil(
          () => api(apiBase, `/api/articles/status/${encodeURIComponent(taskId)}`),
          (result) => ["awaiting_architect_processing", "succeeded", "standardized"].includes(result.body?.data?.status),
          `第 ${round} 遍未到终态`,
        );
        expect(terminal.body.data.taskId).toBe(taskId);
        expect(terminal.body.data.draftPath).toBe(draftPath);
        expect(draftPath).toContain("raw/drafts");
        const validated = await api(apiBase, "/api/articles/drafts/validate", { method: "POST", body: JSON.stringify({ filePath: draftPath }) });
        expect(validated.status, JSON.stringify(validated.body)).toBe(200);
        const promoted = await api(apiBase, "/api/articles/drafts/promote", { method: "POST", body: JSON.stringify({ filePath: draftPath, confirmed: true }) });
        expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
        const candidates = await api(apiBase, "/api/articles/precleaned");
        expect(candidates.status).toBe(200);
        const matches = candidates.body.data.items.filter((candidate) => candidate.id === "11111111-1111-4111-8111-111111111111");
        expect(matches).toHaveLength(1);
        const item = matches[0];
        const standardized = await api(apiBase, `/api/articles/precleaned/${encodeURIComponent(item.id)}/standardization`, { method: "POST", body: JSON.stringify({ confirmed: true }) });
        expect(standardized.status, JSON.stringify(standardized.body)).toBe(200);
        expect(standardized.body.data.standardizationStatus).toBe("standardized");
        expect(fs.existsSync(path.join(vault, standardized.body.data.sourcePath))).toBe(true);
        const currentIdentity = {
          itemId: item.id,
          articleId: standardized.body.data.articleId || item.id,
          sourcePath: standardized.body.data.sourcePath,
        };
        expect(currentIdentity.articleId).toBe("11111111-1111-4111-8111-111111111111");
        expect(currentIdentity.itemId).toBe(currentIdentity.articleId);
        if (round === 1) businessIdentity = currentIdentity;
        else expect(currentIdentity).toEqual(businessIdentity);
        const uploads = await api(apiBase, "/api/articles/uploads?limit=50");
        expect(uploads.status).toBe(200);
        expect(uploads.body.data.items.filter((task) => task.originalFileName === fileName)).toHaveLength(round);
        const replay = await api(apiBase, "/api/articles/precleaned");
        expect(replay.body.data.items.filter((candidate) => candidate.id === item.id)).toHaveLength(1);
      }
      expect(new Set(taskIds).size).toBe(2);
      const decisions = fs.readFileSync(path.join(vault, ".ledger", "decisions.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(decisions.some((event) => event.action_id === "schema.modules.upsert" && event.outcome === "success")).toBe(true);
      expect(decisions.some((event) => event.action_id === "schema.enums.append" && event.outcome === "success")).toBe(true);
      expect(decisions.some((event) => event.action_id === "schema.enums.rollback" && event.outcome === "success")).toBe(true);
    });

    expect([hash(vocabText(sharedVault, "ontology")), hash(vocabText(sharedVault, "enums"))]).toEqual(sharedBefore);
  } catch (error) {
    if (stack?.logs) console.error(Object.entries(stack.logs).map(([name, log]) => `--- ${name} ---\n${log.split("\n").slice(-80).join("\n")}`).join("\n"));
    throw error;
  } finally {
    if (stack) await stack.stop();
    for (const root of owned) cleanTree(root);
  }
});
